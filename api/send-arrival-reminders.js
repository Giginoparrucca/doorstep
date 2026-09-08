// api/send-arrival-reminders.js — Round 32 arrival reminder + Round 36 filing reminder.
//
// One Vercel cron slot serves two per-property reminder passes:
//
//   PASS A · arrival reminder (Round 32)
//     Fires the morning before tomorrow's arrivals so hosts can send each
//     guest their unique booking link. Reads ota_reservations, sends a
//     digest email per property, stamps ota_reservations.arrival_reminder_sent_at.
//
//   PASS B · filing reminder (Round 36)
//     Fires the morning after arrivals so hosts don't miss the 24-hour
//     Alloggiati Web filing deadline. Reads checkins (real guests who
//     completed check-in), sends a *count-only* digest per property (never
//     guest names, document numbers, or DOB — that would be exactly the
//     unencrypted-PII-over-email practice the Garante's April 2026 note
//     criticises), stamps checkins.filing_reminder_sent_at.
//
// Both passes share: the CRON_SECRET auth, the per-property local-hour
// gate, Resend transport, and the "one email per property per day" dedup
// pattern. The passes are structurally independent — one failing does not
// block the other, and their per-property outcomes are reported side by
// side in the response.
//
// Cron entry (see vercel.json): the job runs once a day at 05:00 UTC —
// that lands 06:00-07:00 across most European timezones. Hobby's 2-cron
// limit is the reason both passes share this endpoint instead of B living
// in its own file with its own schedule.
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
//                                  (writes need it to stamp *_sent_at
//                                  regardless of caller)
// Optional:
//   REMINDER_FROM   default "WelcomeBnB Reminders <onboarding@resend.dev>"
//   HOST_CONSOLE_URL default "https://welcomebnb.vercel.app/host-console.html"

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const REMINDER_FROM =
  process.env.REMINDER_FROM || 'WelcomeBnB Reminders <onboarding@resend.dev>';
const HOST_CONSOLE_URL =
  process.env.HOST_CONSOLE_URL || 'https://welcomebnb.vercel.app/host-console.html';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const auth = req.headers['authorization'] || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!CRON_SECRET) return res.status(500).json({ error: 'CRON_SECRET env var not set' });
  if (provided !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
  if (!RESEND_KEY)  return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  // ?force=1 skips the local-hour gate. ?dry=1 sends no email and writes
  // no marker. ?pass=arrival|filing runs only one of the two passes;
  // omit for both. All three flags apply to both passes identically.
  const url = new URL(req.url, 'http://x');
  const force  = url.searchParams.get('force') === '1';
  const dry    = url.searchParams.get('dry')   === '1';
  const passOnly = url.searchParams.get('pass') || '';
  const runArrival = passOnly === '' || passOnly === 'arrival';
  const runFiling  = passOnly === '' || passOnly === 'filing';

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
  let totalArrivalSent = 0;
  let totalFilingSent  = 0;

  for (const p of props) {
    const tz = p.timezone || 'Europe/Rome';
    const local = localParts(nowUTC, tz);
    // Vercel Hobby crons are once-per-day (see vercel.json — 05:00 UTC).
    // 05:00 UTC lands at 06:00-07:00 Europe local depending on DST, and
    // similar mornings across most European TZs. We accept a 5-10 local
    // window so a property in any of those zones still fires on both
    // sides of a DST change. Anything outside the window is skipped —
    // avoids sending mail at 22:00 local for far-off timezones. The
    // *_sent_at markers guarantee no double-send if the cron ever fires
    // more than once per day.
    if (!force && (local.hour < 5 || local.hour > 10)) {
      perProperty.push({ property_id: p.id, skipped: `local_hour=${local.hour}` });
      continue;
    }

    const tomorrow  = addDaysISO(local.dateISO,  1);
    const yesterday = addDaysISO(local.dateISO, -1);

    const arrivalOutcome = runArrival
      ? await runArrivalPass(p, tomorrow, dry).catch(e => ({ error: 'arrival pass exception: ' + String(e) }))
      : { skipped: 'pass filter' };
    const filingOutcome = runFiling
      ? await runFilingPass(p, yesterday, dry).catch(e => ({ error: 'filing pass exception: ' + String(e) }))
      : { skipped: 'pass filter' };

    totalArrivalSent += arrivalOutcome.sent || 0;
    totalFilingSent  += filingOutcome.sent  || 0;

    perProperty.push({
      property_id: p.id,
      name: p.name,
      local_date: local.dateISO,
      local_hour: local.hour,
      arrival: arrivalOutcome,
      filing:  filingOutcome,
    });
  }

  return res.status(200).json({
    ok: true,
    total_properties: props.length,
    total_arrival_sent: totalArrivalSent,
    total_filing_sent:  totalFilingSent,
    per_property: perProperty,
    dry_run: !!dry,
  });
}

// ══════════════════════════════════════════════════════════════════════
// PASS A · arrival reminder — Round 32 logic, unchanged behaviour.
// ══════════════════════════════════════════════════════════════════════
async function runArrivalPass(p, tomorrow, dry) {
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
    return { error: 'reservations query failed: ' + String(e) };
  }
  if (reservations.length === 0) return { tomorrow, matched: 0 };

  // Skip reservations whose guest already completed check-in.
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
    return { tomorrow, matched: reservations.length, sent: 0, note: 'all already checked in' };
  }

  const subject = `Arriving tomorrow at ${p.name || 'your property'}: ${toSend.length} reservation${toSend.length === 1 ? '' : 's'}`;
  const html = renderArrivalHTML(p, toSend);
  const sendResult = await sendEmail(p.reminder_email, subject, html, dry);
  if (!sendResult.ok) {
    return { tomorrow, matched: reservations.length, sent: 0, error: sendResult.error };
  }
  if (dry) return { tomorrow, matched: reservations.length, sent: 0, dry_run: true };

  const ids = toSend.map(r => `"${r.id}"`).join(',');
  try {
    await pgrestPATCH(
      `ota_reservations?id=in.(${ids})`,
      { arrival_reminder_sent_at: new Date().toISOString() },
    );
    return { tomorrow, matched: reservations.length, sent: toSend.length };
  } catch (e) {
    return { tomorrow, matched: reservations.length, sent: 0, error: 'mark-sent failed: ' + String(e) };
  }
}

// ══════════════════════════════════════════════════════════════════════
// PASS B · filing reminder — Round 36.
// Guests who checked in yesterday, still not marked filed on Alloggiati.
// Digest is COUNT-ONLY: no guest names, document numbers, or dates of
// birth appear in the email. That is the specific practice the Garante's
// April 2026 note criticised — and doing it as the processor would be
// worse than a host doing it. Hosts open the host console (already
// authenticated) to see who needs filing.
// ══════════════════════════════════════════════════════════════════════
async function runFilingPass(p, yesterday, dry) {
  let checkins;
  try {
    checkins = await pgrestGET(
      `checkins?property_id=eq.${p.id}` +
      `&is_test=eq.false&deleted_at=is.null` +
      // "not filed" — the receipt-upload flow flips alloggiati_status to
      // 'filed'; anything else (usually 'pending') still needs filing.
      `&alloggiati_status=neq.filed` +
      `&filing_reminder_sent_at=is.null` +
      `&arrival_date=eq.${yesterday}` +
      `&select=id`,
    );
  } catch (e) {
    return { error: 'filing query failed: ' + String(e) };
  }
  if (checkins.length === 0) return { yesterday, matched: 0 };

  const subject = `Filing reminder — ${checkins.length} guest${checkins.length === 1 ? '' : 's'} arrived yesterday at ${p.name || 'your property'}`;
  const html = renderFilingHTML(p, yesterday, checkins.length);
  const sendResult = await sendEmail(p.reminder_email, subject, html, dry);
  if (!sendResult.ok) {
    return { yesterday, matched: checkins.length, sent: 0, error: sendResult.error };
  }
  if (dry) return { yesterday, matched: checkins.length, sent: 0, dry_run: true };

  const ids = checkins.map(r => `"${r.id}"`).join(',');
  try {
    await pgrestPATCH(
      `checkins?id=in.(${ids})`,
      { filing_reminder_sent_at: new Date().toISOString() },
    );
    return { yesterday, matched: checkins.length, sent: checkins.length };
  } catch (e) {
    return { yesterday, matched: checkins.length, sent: 0, error: 'mark-sent failed: ' + String(e) };
  }
}

// ── Email transport ─────────────────────────────────────────────────────
async function sendEmail(to, subject, html, dry) {
  if (dry) return { ok: true, dry: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: REMINDER_FROM, to: [to], subject, html }),
    });
    if (!r.ok) return { ok: false, error: `resend http ${r.status}: ${await r.text().catch(() => '')}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'resend fetch failed: ' + String(e) };
  }
}

// ── Time helpers ─────────────────────────────────────────────────────────
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

// ── Email templates ──────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderArrivalHTML(property, rows) {
  const propName = esc(property.name || 'your property');
  const list = rows.map(r => {
    const platform = ({ airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'Vrbo' })[r.platform]
      || (r.platform || 'Reservation');
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

// Round 36 filing-reminder template. Deliberately terse — one action,
// no guest personal data anywhere in the body.
function renderFilingHTML(property, yesterday, count) {
  const propName = esc(property.name || 'your property');
  const link = HOST_CONSOLE_URL;
  const guestWord = count === 1 ? 'guest' : 'guests';
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;">
      <h2 style="margin:0 0 6px;font-size:20px;">Filing reminder — ${propName}</h2>
      <p style="margin:0 0 12px;">
        <strong>${count}</strong> ${guestWord} checked in yesterday (${esc(yesterday)}) and ${count === 1 ? 'has' : 'have'} not been marked as filed on Alloggiati Web yet.
      </p>
      <p style="margin:0 0 16px;color:#6B7A90;">
        Italian law (TULPS art. 109) requires transmitting guest data to Alloggiati Web within 24 hours of arrival — that deadline is close or has passed.
      </p>
      <p style="margin:0 0 16px;">
        <a href="${esc(link)}" style="display:inline-block;background:#005BFF;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">Open host console</a>
      </p>
      <p style="margin:20px 0 0;color:#6B7A90;font-size:12px;">
        Sent by WelcomeBnB · after you upload the Alloggiati receipt for a guest, this reminder stops for that guest. Turn off all reminders by clearing the "reminder email" field in Property settings.
      </p>
    </div>`;
}
