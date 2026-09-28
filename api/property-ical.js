// api/property-ical.js — Round 45 Step 4.5
//
// Outbound iCal feed per property. The host copies the URL from the
// Property Settings panel and pastes it into Airbnb / Booking / Vrbo's
// "Import calendar" screen. Those OTAs then poll this URL every few
// hours and treat each event as unavailable, keeping their calendars
// in sync with WelcomeBnB's direct bookings and blocks.
//
// URL shape:
//   GET /api/property-ical?t=<properties.ical_export_token>
//
// Security model:
//   - The token IS the auth. No login, no cookies, no Bearer header.
//   - The token is a UUID (v4), rotatable from the property panel.
//     Rotating invalidates the URL immediately.
//   - The feed emits ZERO personally-identifying data:
//       - No guest names, no contact_phone / contact_email, no notes.
//       - No booking_code (that would let a URL leak also unlock the
//         guest link).
//       - SUMMARY is always the generic "Blocked" (translated
//         once per host_language for readability in the OTA's UI).
//     Anyone who obtains the URL sees only which date ranges are
//     unavailable — the same information an OTA guest sees when they
//     try to book those dates anyway.
//
// Data source:
//   - ota_reservations rows for this property with
//         status = 'active'
//         deleted_at IS NULL
//         entry_type IN ('reservation','block')
//         covered_by_reservation_id IS NULL      (echoes are redundant)
//         checkout_date >= today - 30d           (past-close window)
//         checkin_date  <= today + 730d          (2-year forward horizon)
//   - Both OTA-sourced and direct rows are included, so re-imported
//     rows still block the OTAs. The covered filter prevents an
//     infinite echo loop (Airbnb sees our block → publishes it back
//     in Airbnb's own feed → we already know about it).
//
// Response:
//   - Content-Type: text/calendar; charset=utf-8
//   - Cache-Control: public, max-age=1800     (30 minutes; OTAs poll
//     every 2-4 hours so a stale-for-30-minutes feed is invisible)
//   - Body: RFC-5545 VCALENDAR with one VEVENT per row, all-day
//     dates (DTSTART/DTEND with VALUE=DATE), TRANSP:OPAQUE.
//
// Response codes:
//   - 200 with the feed body on any valid, existing token (even if
//     zero events — empty feed is legal).
//   - 404 with a text body when the token doesn't match a property.
//     We DON'T reveal whether the token format was even valid, so
//     probing is uniformly slow.
//   - 405 for anything other than GET / HEAD / OPTIONS.
//   - 500 on unexpected DB error.

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Airbnb / Booking / Vrbo all fetch server-side — no browser CORS is
// involved. We still set Access-Control-Allow-Origin: * so a host can
// eyeball the feed in a browser tab while debugging.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Feed lifespan tuning.
const PAST_WINDOW_DAYS   = 30;   // include recent past so late-arriving OTA polls still see cancellations.
const FUTURE_HORIZON_DAYS = 730;  // 2-year forward window; OTAs auto-drop stale entries.

// UUID v4 shape guard. We never DB-query for a malformed token.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toISOStamp(d) {
  // iCal DTSTAMP wants UTC in yyyymmddThhmmssZ form.
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function toISODate(yyyyMmDd) {
  // 'YYYY-MM-DD' → 'YYYYMMDD' with no separators, as iCal DATE wants.
  if (!yyyyMmDd) return null;
  return String(yyyyMmDd).replace(/-/g, '').slice(0, 8);
}
function icsEscape(s) {
  // Backslash, comma, semicolon and newline are the special chars.
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
function foldLine(line) {
  // RFC-5545 says content lines longer than 75 octets must be folded
  // by inserting CRLF + space at 75-octet boundaries. Airbnb tolerates
  // long lines, but Booking's parser is stricter — fold everything.
  const OCTET_LIMIT = 74;
  if (line.length <= OCTET_LIMIT) return line;
  const out = [];
  let start = 0;
  while (start < line.length) {
    out.push((start === 0 ? '' : ' ') + line.slice(start, start + OCTET_LIMIT));
    start += OCTET_LIMIT;
  }
  return out.join('\r\n');
}

async function sbGetJSON(pathAndQuery, method = 'GET') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function summaryForRow(row, hostLang) {
  // The OTAs display SUMMARY in their calendar UI. Keep it generic —
  // NEVER include guest_name or any contact info. The word varies
  // slightly by entry_type so the host sees the right one when they
  // scroll through Airbnb's calendar.
  const isBlock = row.entry_type === 'block';
  if (hostLang === 'it') return isBlock ? 'Bloccato' : 'Prenotato';
  return isBlock ? 'Blocked' : 'Reserved';
}

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'GET only' });
  }
  if (!SERVICE_KEY) {
    console.error('[property-ical] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Accept both ?t=... and ?token=... for host convenience.
  const q = (req.query || {});
  const token = String(q.t || q.token || '').trim();
  if (!UUID_RE.test(token)) {
    // Constant-time 404 for any malformed input.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Not Found');
  }

  let property;
  try {
    const rows = await sbGetJSON(
      `properties?ical_export_token=eq.${encodeURIComponent(token)}&deleted_at=is.null&select=id,name,host_language,timezone&limit=1`
    );
    property = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error('[property-ical] property lookup failed:', e.message);
    return res.status(500).send('Server error');
  }
  if (!property) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Not Found');
  }

  // Compute date windows.
  const now = new Date();
  const pastCutoff = new Date(now.getTime() - PAST_WINDOW_DAYS * 86400000);
  const futureCutoff = new Date(now.getTime() + FUTURE_HORIZON_DAYS * 86400000);
  const pastISO   = pastCutoff.toISOString().slice(0, 10);
  const futureISO = futureCutoff.toISOString().slice(0, 10);

  let rows;
  try {
    rows = await sbGetJSON(
      `ota_reservations` +
      `?property_id=eq.${encodeURIComponent(property.id)}` +
      `&status=eq.active` +
      `&deleted_at=is.null` +
      `&covered_by_reservation_id=is.null` +
      `&entry_type=in.(reservation,block)` +
      `&checkout_date=gte.${pastISO}` +
      `&checkin_date=lte.${futureISO}` +
      `&select=id,uid,entry_type,checkin_date,checkout_date,updated_at` +
      `&order=checkin_date.asc`
    );
  } catch (e) {
    console.error('[property-ical] rows lookup failed:', e.message);
    return res.status(500).send('Server error');
  }

  const hostLang = (property.host_language || 'it').toLowerCase() === 'en' ? 'en' : 'it';
  const dtstamp = toISOStamp(now);
  const prodid = '-//WelcomeBnB//Property Calendar//EN';
  const nameForHeader = (hostLang === 'it')
    ? `WelcomeBnB — ${property.name}`
    : `WelcomeBnB — ${property.name}`;

  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${icsEscape(prodid)}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(foldLine(`X-WR-CALNAME:${icsEscape(nameForHeader)}`));
  lines.push(foldLine(`NAME:${icsEscape(nameForHeader)}`));
  lines.push(`X-WR-TIMEZONE:${icsEscape(property.timezone || 'Europe/Rome')}`);

  for (const r of (rows || [])) {
    const start = toISODate(r.checkin_date);
    const end   = toISODate(r.checkout_date);
    if (!start || !end) continue;
    // iCal DTEND is exclusive for all-day events — our checkout_date is
    // already checkout day (guest leaves that morning), so we pass it
    // verbatim. TRANSP:OPAQUE tells the OTA "this makes the range busy".
    const uid = `${(r.uid || r.id).replace(/[<>\s]/g, '_')}@welcomebnb.vercel.app`;
    const summary = summaryForRow(r, hostLang);
    // LAST-MODIFIED lets the OTAs detect a changed row quickly.
    const lastMod = r.updated_at
      ? toISOStamp(new Date(r.updated_at))
      : dtstamp;
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${icsEscape(uid)}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`LAST-MODIFIED:${lastMod}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(summary)}`));
    lines.push('TRANSP:OPAQUE');
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  const body = lines.join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="welcomebnb-${property.id.slice(0, 8)}.ics"`);
  res.setHeader('Cache-Control', 'public, max-age=1800');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(body);
}
