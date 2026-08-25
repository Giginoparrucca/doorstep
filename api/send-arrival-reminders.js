// api/send-arrival-reminders.js — Round 32 day-before arrival reminders.
//
// Cron design (see vercel.json): the job runs every hour at :00 UTC. Each
// run iterates all properties with a reminder_email set, converts "now" to
// each property's local time, and only fires the reminder for that property
// when the local hour is REMINDER_LOCAL_HOUR (07). That way one cron entry
// serves properties in any timezone without needing per-property schedules.
//
// Dedup: after a successful send, arrival_reminder_sent_at is stamped on
// every reservation included in the digest, so a re-run within the same
// hour (or a manual retry) never double-sends.
//
// Auth: Vercel cron adds `Authorization: Bearer <CRON_SECRET>` — we compare
// against process.env.CRON_SECRET. Manual invocations by anyone else are
// rejected with 401.
//
// Env vars required:
//   CRON_SECRET                  — shared with Vercel cron
//   RESEND_API_KEY               — https://resend.com/api-keys
//   SUPABASE_URL                 — defaults to the project URL (public)
//   SUPABASE_SERVICE_ROLE_KEY    — server-only key that bypasses RLS
//                                  (writes need it to stamp reminder_sent_at
//                                  regardless of caller)
// Optional:
//   REMINDER_FROM   default "WelcomeBnB Reminders <onboarding@resend.dev>"
//   REMINDER_LOCAL_HOUR  default 7  (0-23, property local time)

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const REMINDER_FROM =
  process.env.REMINDER_FROM || 'WelcomeBnB Reminders <onboarding@resend.dev>';
const REMINDER_LOCAL_HOUR = Number(process.env.REMINDER_LOCAL_HOUR ?? 7);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  // Vercel cron uses GET with the Authorization header. Manual triggers
  // (curl -H "Authorization: Bearer …") work with either verb.
  const auth = req.headers['authorization'] || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET env var not set' });
  }
  if (provided !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
  if (!RESEND_KEY)  return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  // ?force=1 skips the local-hour gate — useful when the operator wants to
  // trigger a specific property right now (still deduped by
  // arrival_reminder_sent_at). ?dry=1 goes through the whole flow but
  // sends no email and writes no marker.
  const url = new URL(req.url, 'http://x');
  const force = url.searchParams.get('force') === '1';
  const dry   = url.searchParams.get('dry')   === '1';

  const nowUTC = new Date();
  let props;
  try {
    props = await pgrestGET(
      'properties?select=id,name,reminder_email,timezone,welcome_message&' +
      'reminder_email=not.is.null&deleted_at=is.null',
    );
  } catch (e) {
    return res.status(500).json({ error: 'Load properties failed', detail: String(e) });
  }

  const perProperty = [];
  let totalSent = 0;

  for (const p of props) {
    const tz = p.timezone || 'Europe/Rome';
    const local = localParts(nowUTC, tz);
    if (!force && local.hour !== REMINDER_LOCAL_HOUR) {
      perProperty.push({ property_id: p.id, skipped: `local_hour=${local.hour}` });
      continue;
    }

    // Tomorrow in the property's timezone
    const tomorrow = addDaysISO(local.dateISO, 1);

    let reservations;
    try {
      reservations = await pgrestGET(
        `ota_reservations?property_id=eq.${p.id}` +
        `&entry_type=eq.reservation&status=eq.active` +
        `&deleted_at=is.null` +
        `&arrival_reminder_sent_at=is.null` +
        `&checkin_date=eq.${tomorrow}` +
        `&select=id,platform,guest_name,checkin_date,checkout_date,booking_code`,
      );
    } catch (e) {
      perProperty.push({ property_id: p.id, error: 'reservations query failed: ' + String(e) });
      continue;
    }
    if (reservations.length === 0) {
      perProperty.push({ property_id: p.id, tomorrow, matched: 0 });
      continue;
    }

    // Skip reservations whose guest has already fully checked in.
    // "Fully checked in" here means: at least one checkins row exists for
    // that property + booking_code. Correlates by booking_code first (Round
    // 30.2), so any reservation with a matching checkin is dropped — the
    // reminder would be redundant.
    const codes = reservations.map(r => r.booking_code).filter(Boolean);
    let checkedInCodes = new Set();
    if (codes.length > 0) {
      const inList = codes.map(c => `"${escForIn(c)}"`).join(',');
      try {
        const rows = await pgrestGET(
          `checkins?property_id=eq.${p.id}` +
          `&is_test=eq.false&deleted_at=is.null` +
          `&booking_code=in.(${inList})&select=booking_code`,
        );
        checkedInCodes = new Set(rows.map(r => r.booking_code));
      } catch (_) { /* non-fatal — err on the side of sending */ }
    }
    const toSend = reservations.filter(r => !checkedInCodes.has(r.booking_code));
    if (toSend.length === 0) {
      perProperty.push({ property_id: p.id, tomorrow, matched: reservations.length, sent: 0, note: 'all already checked in' });
      continue;
    }

    // Compose and send one aggregate email per property.
    const subject = `Arriving tomorrow at ${p.name || 'your property'}: ${toSend.length} reservation${toSend.length === 1 ? '' : 's'}`;
    const html = renderReminderHTML(p, toSend);
    let sendOk = dry;
    let sendError = null;
    if (!dry) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: REMINDER_FROM,
            to: [p.reminder_email],
            subject,
            html,
          }),
        });
        if (!r.ok) {
          sendError = `resend http ${r.status}: ${await r.text().catch(() => '')}`;
        } else {
          sendOk = true;
        }
      } catch (e) {
        sendError = 'resend fetch failed: ' + String(e);
      }
    }

    if (sendOk && !dry) {
      // Stamp arrival_reminder_sent_at on every reservation in this batch.
      const ids = toSend.map(r => `"${r.id}"`).join(',');
      try {
        await pgrestPATCH(
          `ota_reservations?id=in.(${ids})`,
          { arrival_reminder_sent_at: new Date().toISOString() },
        );
        totalSent += toSend.length;
      } catch (e) {
        sendError = 'mark-sent failed: ' + String(e);
      }
    }

    perProperty.push({
      property_id: p.id,
      name: p.name,
      tomorrow,
      matched: reservations.length,
      sent: sendOk && !dry ? toSend.length : 0,
      dry_run: !!dry,
      error: sendError,
    });
  }

  return res.status(200).json({
    ok: true,
    total_properties: props.length,
    total_sent: totalSent,
    per_property: perProperty,
    dry_run: !!dry,
  });
}

// ── Time helpers ─────────────────────────────────────────────────────────
// Return { dateISO: 'YYYY-MM-DD', hour: 0-23 } for `dt` in the given IANA tz.
function localParts(dt, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(dt).map(p => [p.type, p.value]));
  return {
    dateISO: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
  };
}
function addDaysISO(dateISO, days) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dd = new Date(t);
  const pad = n => String(n).padStart(2, '0');
  return `${dd.getUTCFullYear()}-${pad(dd.getUTCMonth() + 1)}-${pad(dd.getUTCDate())}`;
}
function escForIn(s) {
  // PostgREST's in.(...) list wants quoted values; escape embedded quotes.
  return String(s).replace(/"/g, '\\"');
}

// ── PostgREST via service role (bypasses RLS) ────────────────────────────
function pgrestGET(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  }).then(async r => {
    if (!r.ok) throw new Error(`GET ${path} → ${r.status} ${await r.text()}`);
    return r.json();
  });
}
function pgrestPATCH(path, body) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  }).then(async r => {
    if (!r.ok) throw new Error(`PATCH ${path} → ${r.status} ${await r.text()}`);
    return true;
  });
}

// ── Email template ───────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderReminderHTML(property, rows) {
  const propName = esc(property.name || 'your property');
  const list = rows.map(r => {
    const platform = ({
      airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'Vrbo',
    })[r.platform] || (r.platform || 'Reservation');
    const guest = r.guest_name ? esc(r.guest_name) : 'Guest';
    const link = r.booking_code
      ? `https://welcomebnb.vercel.app/?b=${encodeURIComponent(r.booking_code)}&p=${encodeURIComponent(property.id)}`
      : null;
    const linkBlock = link
      ? `<p style="margin:8px 0 0;">
           Guest link:
           <a href="${esc(link)}" style="color:#005BFF;font-family:monospace;font-size:13px;">${esc(link)}</a>
         </p>`
      : `<p style="margin:8px 0 0;color:#6B7A90;font-size:13px;">
           <em>No booking code yet — open the reservation in the dashboard to generate one.</em>
         </p>`;
    return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
        <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#005BFF;font-weight:600;">${esc(platform)}</div>
        <div style="font-weight:600;margin-top:4px;">${guest} · ${esc(r.checkin_date)} → ${esc(r.checkout_date)}</div>
        ${linkBlock}
      </div>`;
  }).join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;">
      <h2 style="margin:0 0 6px;font-size:20px;">Arriving tomorrow at ${propName}</h2>
      <p style="margin:0 0 16px;color:#6B7A90;">Send each guest their unique booking link so they can complete check-in before arrival.</p>
      ${list}
      <p style="margin:20px 0 0;color:#6B7A90;font-size:12px;">
        Sent by WelcomeBnB · you can turn reminders off by clearing the "reminder email" field in Property settings.
      </p>
    </div>`;
}
