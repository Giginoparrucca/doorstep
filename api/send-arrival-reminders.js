// api/send-arrival-reminders.js — Round 32 arrival reminder, Round 36
// filing reminder, Round 46 storage purge.
//
// One Vercel cron slot serves THREE independent passes:
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
//   PASS C · storage purge (Round 46)
//     Drains public.storage_purge_queue by calling Supabase's Storage API
//     DELETE endpoint. The queue is filled by the 02:00 UTC SQL purge
//     (purge_old_data_cron → purge_old_id_photos + enqueue_orphan_documents).
//     SQL cannot DELETE storage.objects (storage.protect_delete() rejects
//     it); we moved file deletion out of SQL in Round 46.
//
// Structural independence: PASS C must run even when RESEND_API_KEY is
// missing (A and B then self-skip), is NOT subject to the per-property
// local-hour gate (storage cleanup is property-independent and runs once
// per invocation), and a failure in any one pass does not block the
// others. Pass outcomes are reported side-by-side in the response.
//
// Cron entry (see vercel.json): the job runs once a day at 05:00 UTC —
// that lands 06:00-07:00 across most European timezones. Hobby's 2-cron
// limit is the reason all three passes share this endpoint instead of C
// living in its own file with its own schedule. The ical-sync cron at
// 04:00 UTC is the other half of the Hobby 2-cron allowance.
//
// Auth: Vercel cron adds `Authorization: Bearer <CRON_SECRET>` — we compare
// against process.env.CRON_SECRET. Manual invocations by anyone else are
// rejected with 401.
//
// Env vars required:
//   CRON_SECRET                  — shared with Vercel cron
//   SUPABASE_URL                 — defaults to the project URL (public)
//   SUPABASE_SERVICE_ROLE_KEY    — server-only key that bypasses RLS
//                                  (writes need it to stamp *_sent_at
//                                  regardless of caller, and PASS C hits
//                                  the Storage API with it)
// Optional:
//   RESEND_API_KEY               — https://resend.com/api-keys (passes A+B
//                                  self-skip when missing; PASS C runs)
//   REMINDER_FROM   default "WelcomeBnB <notifiche@welcomebnb.it>"
//   APP_BASE_URL    default "https://app.welcomebnb.it" (also used by
//                                  PASS A to build the guest link)
//   HOST_CONSOLE_URL default "https://app.welcomebnb.it/host-console.html"

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const REMINDER_FROM =
  process.env.REMINDER_FROM || 'WelcomeBnB <notifiche@welcomebnb.it>';
const APP_BASE_URL =
  process.env.APP_BASE_URL || 'https://app.welcomebnb.it';
const HOST_CONSOLE_URL =
  process.env.HOST_CONSOLE_URL || 'https://app.welcomebnb.it/host-console.html';

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
  // Round 46 — RESEND_API_KEY is no longer a hard requirement at the
  // handler level. PASS C (storage purge) does not use Resend; passes
  // A + B self-skip when the key is missing. That way a Resend outage
  // never blocks the GDPR-relevant file deletion pass.

  // ?force=1 skips the local-hour gate. ?dry=1 sends no email, writes
  // no marker, and (PASS C) deletes nothing. ?pass=arrival|filing|storage
  // runs only one of the three passes; omit for all three.
  const url = new URL(req.url, 'http://x');
  const force  = url.searchParams.get('force') === '1';
  const dry    = url.searchParams.get('dry')   === '1';
  const passOnly = url.searchParams.get('pass') || '';
  const runArrival = passOnly === '' || passOnly === 'arrival';
  const runFiling  = passOnly === '' || passOnly === 'filing';
  const runStorage = passOnly === '' || passOnly === 'storage';

  const nowUTC = new Date();
  let props;
  try {
    props = await pgrestGET(
      // Round 37.6 — host_language too, so the digest renders in EN or IT.
      'properties?select=id,name,reminder_email,timezone,welcome_message,host_language&' +
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

  // PASS C — storage purge. Independent of Resend, the per-property
  // loop, and the local-hour gate. Runs once per invocation. A failure
  // here must NOT change the status code of the whole call (passes A
  // and B may have already succeeded) — runStoragePurgePass itself
  // never throws out of its body.
  const storagePurge = runStorage
    ? await runStoragePurgePass(dry)
    : { skipped: 'pass filter' };

  // One-line summary for the Vercel log. Counts only — never paths
  // (they are guest document filenames).
  console.log(
    `[reminders] props=${props.length} arrival_sent=${totalArrivalSent} filing_sent=${totalFilingSent} ` +
    `storage_queued=${storagePurge.queued || 0} storage_deleted=${storagePurge.deleted || 0} ` +
    `storage_failed=${storagePurge.failed || 0} dry=${!!dry}`
  );

  return res.status(200).json({
    ok: true,
    total_properties: props.length,
    total_arrival_sent: totalArrivalSent,
    total_filing_sent:  totalFilingSent,
    per_property: perProperty,
    storagePurge,
    dry_run: !!dry,
  });
}

// ══════════════════════════════════════════════════════════════════════
// PASS A · arrival reminder — Round 32 logic, unchanged behaviour.
// Round 46 — self-skip when Resend is missing so PASS C can still run.
// ══════════════════════════════════════════════════════════════════════
async function runArrivalPass(p, tomorrow, dry) {
  if (!RESEND_KEY) return { skipped: 'RESEND_API_KEY not set' };
  let reservations;
  try {
    // Round 45 Step 4 — covered_by_reservation_id=is.null so a
    // covered OTA echo doesn't trigger a second reminder for the same
    // direct booking. The direct row is the one the host acts on.
    reservations = await pgrestGET(
      `ota_reservations?property_id=eq.${p.id}` +
      `&entry_type=eq.reservation&status=eq.active` +
      `&deleted_at=is.null` +
      `&covered_by_reservation_id=is.null` +
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

  const lang = _hostLang(p);
  const propLabel = p.name || (lang === 'it' ? 'la tua struttura' : 'your property');
  const subject = lang === 'it'
    ? `Arrivi domani presso ${propLabel}: ${toSend.length} prenotazione${toSend.length === 1 ? '' : 'i'}`
    : `Arriving tomorrow at ${propLabel}: ${toSend.length} reservation${toSend.length === 1 ? '' : 's'}`;
  const html = renderArrivalHTML(p, toSend, lang);
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
  if (!RESEND_KEY) return { skipped: 'RESEND_API_KEY not set' };
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

  const lang = _hostLang(p);
  const propLabel = p.name || (lang === 'it' ? 'la tua struttura' : 'your property');
  const subject = lang === 'it'
    ? `Promemoria invio Alloggiati — ${checkins.length} ospit${checkins.length === 1 ? 'e' : 'i'} arrivat${checkins.length === 1 ? 'o' : 'i'} ieri presso ${propLabel}`
    : `Filing reminder — ${checkins.length} guest${checkins.length === 1 ? '' : 's'} arrived yesterday at ${propLabel}`;
  const html = renderFilingHTML(p, yesterday, checkins.length, lang);
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
function pgrestDELETE(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  }).then(async r => {
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status} ${await r.text()}`);
    return true;
  });
}

// ══════════════════════════════════════════════════════════════════════
// PASS C · storage purge (Round 46)
//
// Drain public.storage_purge_queue by calling Supabase's Storage API
// DELETE endpoint. Independent of the per-property loop and of Resend
// (so a Resend outage never blocks file deletion). Guarantees:
//
//   - Must NEVER throw out of its body. A thrown error here would
//     short-circuit the handler's response to passes A/B that already
//     succeeded. Every network call is wrapped.
//   - The queue table enforces bucket='documents' via CHECK; we also
//     filter in JS as belt-and-braces so a hypothetical schema regression
//     cannot send 'receipts' paths to the Storage API.
//   - On HTTP 2xx, the queue rows for those paths are deleted. A path
//     that no longer exists in storage counts as done — the Storage API
//     accepts missing prefixes without erroring.
//   - On failure, attempts is incremented and last_error stamped (500
//     char cap). After 5 attempts the row is left in place for manual
//     inspection; it will no longer be picked up (attempts<5 filter).
// ══════════════════════════════════════════════════════════════════════
async function runStoragePurgePass(dry) {
  const out = { queued: 0, deleted: 0, failed: 0, dry: !!dry };
  let queueRows;
  try {
    queueRows = await pgrestGET(
      'storage_purge_queue?bucket=eq.documents' +
      '&attempts=lt.5' +
      '&select=id,bucket,path,attempts' +
      '&order=queued_at.asc&limit=1000'
    );
  } catch (e) {
    out.error = 'queue read failed: ' + String(e).slice(0, 300);
    return out;
  }
  // JS-level guard: drop any row whose bucket isn't exactly 'documents'.
  // The DB CHECK already enforces this; the second filter here protects
  // against a hypothetical future schema regression + makes the invariant
  // visible in code to any reviewer.
  const safeRows = (queueRows || []).filter(
    r => r && r.bucket === 'documents' && typeof r.path === 'string' && r.path
  );
  out.queued = safeRows.length;
  if (safeRows.length === 0) return out;
  if (dry) return out;

  const paths = safeRows.map(r => r.path);
  // Supabase bulk-remove — DELETE /storage/v1/object/<bucket> with body
  // { prefixes: [...] }. One request handles the whole batch.
  let httpRes;
  try {
    httpRes = await fetch(`${SUPABASE_URL}/storage/v1/object/documents`, {
      method: 'DELETE',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch (e) {
    out.failed = safeRows.length;
    out.error = 'storage DELETE fetch failed: ' + String(e).slice(0, 300);
    await _bumpQueueAttempts(safeRows, 'fetch failed: ' + String(e)).catch(() => {});
    return out;
  }

  if (!httpRes.ok) {
    const bodyText = await httpRes.text().catch(() => '');
    out.failed = safeRows.length;
    out.error = `storage DELETE http ${httpRes.status}: ${bodyText.slice(0, 200)}`;
    await _bumpQueueAttempts(safeRows, `http ${httpRes.status}: ${bodyText}`).catch(() => {});
    return out;
  }

  // 2xx: drop the queue rows. If this cleanup fails, the files are
  // still gone from storage; the next pass will retry the same paths
  // but the Storage API treats a missing-prefix delete as success,
  // so it'll just drain again next cycle. Log but don't fail.
  try {
    const ids = safeRows.map(x => `"${x.id}"`).join(',');
    await pgrestDELETE(`storage_purge_queue?id=in.(${ids})`);
    out.deleted = safeRows.length;
  } catch (e) {
    console.warn('[storage-purge] queue cleanup failed (files were deleted):', String(e).slice(0, 300));
    out.deleted = safeRows.length;
    out.cleanup_warning = 'queue rows not removed';
  }
  return out;
}

// Group the batch by current attempts value and PATCH each group once.
// PostgREST can't INCREMENT server-side, so we SET attempts to curr+1
// based on what we read. There are at most 5 distinct values (0-4),
// so this is at most 5 PATCH calls regardless of batch size.
async function _bumpQueueAttempts(rows, errMsg) {
  const errTrunc = String(errMsg || '').slice(0, 500);
  const byAttempts = new Map();
  for (const r of rows) {
    const k = r.attempts || 0;
    if (!byAttempts.has(k)) byAttempts.set(k, []);
    byAttempts.get(k).push(r.id);
  }
  for (const [curr, grp] of byAttempts) {
    const grpIds = grp.map(x => `"${x}"`).join(',');
    try {
      await pgrestPATCH(
        `storage_purge_queue?id=in.(${grpIds})&attempts=eq.${curr}`,
        { attempts: curr + 1, last_error: errTrunc },
      );
    } catch (e) {
      console.warn('[storage-purge] attempts bump failed:', String(e).slice(0, 200));
    }
  }
}

// ── Email templates ──────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Round 37.6 — the host picks EN or IT in the console; that pref is
// stored on the property. Clamp to the two supported values, default
// 'it' to match the console's own default (Italian pilot).
function _hostLang(property) {
  const v = property && property.host_language;
  return v === 'en' ? 'en' : 'it';
}

function renderArrivalHTML(property, rows, lang) {
  const isIT = lang === 'it';
  const T = isIT ? {
    yourProp:  'la tua struttura',
    heading:   (n) => `Arrivi domani presso ${n}`,
    intro:     'Invia a ciascun ospite il suo link di prenotazione così può completare il check-in prima dell\'arrivo.',
    guest:     'Ospite',
    guestLink: 'Link ospite:',
    noCode:    'Nessun codice prenotazione ancora — apri la prenotazione dal dashboard per generarne uno.',
    footer:    'Inviato da WelcomeBnB · puoi disattivare i promemoria cancellando il campo "email promemoria" nelle impostazioni della proprietà.',
  } : {
    yourProp:  'your property',
    heading:   (n) => `Arriving tomorrow at ${n}`,
    intro:     'Send each guest their unique booking link so they can complete check-in before arrival.',
    guest:     'Guest',
    guestLink: 'Guest link:',
    noCode:    'No booking code yet — open the reservation in the dashboard to generate one.',
    footer:    'Sent by WelcomeBnB · you can turn reminders off by clearing the "reminder email" field in Property settings.',
  };
  const propName = esc(property.name || T.yourProp);
  const list = rows.map(r => {
    // Round 45 Step 4 — 'direct' bookings get a proper localised label
    // instead of the raw string 'direct' appearing in the host's email.
    const platform = ({
      airbnb: 'Airbnb',
      booking: 'Booking.com',
      vrbo: 'Vrbo',
      direct: isIT ? 'Diretta' : 'Direct',
    })[r.platform]
      || (r.platform || (isIT ? 'Prenotazione' : 'Reservation'));
    const guest = r.guest_name ? esc(r.guest_name) : T.guest;
    const link = r.booking_code
      ? `${APP_BASE_URL}/?b=${encodeURIComponent(r.booking_code)}&p=${encodeURIComponent(property.id)}`
      : null;
    const linkBlock = link
      ? `<p style="margin:8px 0 0;">
           ${T.guestLink}
           <a href="${esc(link)}" style="color:#005BFF;font-family:monospace;font-size:13px;">${esc(link)}</a>
         </p>`
      : `<p style="margin:8px 0 0;color:#6B7A90;font-size:13px;"><em>${T.noCode}</em></p>`;
    return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;">
        <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#005BFF;font-weight:600;">${esc(platform)}</div>
        <div style="font-weight:600;margin-top:4px;">${guest} · ${esc(r.checkin_date)} → ${esc(r.checkout_date)}</div>
        ${linkBlock}
      </div>`;
  }).join('');

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;">
      <h2 style="margin:0 0 6px;font-size:20px;">${T.heading(propName)}</h2>
      <p style="margin:0 0 16px;color:#6B7A90;">${T.intro}</p>
      ${list}
      <p style="margin:20px 0 0;color:#6B7A90;font-size:12px;">${T.footer}</p>
    </div>`;
}

// Round 36 filing-reminder template. Deliberately terse — one action,
// no guest personal data anywhere in the body.
function renderFilingHTML(property, yesterday, count, lang) {
  const isIT = lang === 'it';
  const link = HOST_CONSOLE_URL;
  const T = isIT ? {
    yourProp: 'la tua struttura',
    heading:  (n) => `Promemoria invio Alloggiati — ${n}`,
    body:     (c) => `<strong>${c}</strong> ospit${c === 1 ? 'e' : 'i'} ${c === 1 ? 'è arrivato' : 'sono arrivati'} ieri (${esc(yesterday)}) e ${c === 1 ? 'non è' : 'non sono'} ancora ${c === 1 ? 'stato segnato' : 'stati segnati'} come inviat${c === 1 ? 'o' : 'i'} su Alloggiati Web.`,
    tulps:    'La normativa italiana (TULPS art. 109) impone di trasmettere i dati dei clienti ad Alloggiati Web entro 24 ore dall\'arrivo — la scadenza è vicina o già trascorsa.',
    cta:      'Apri console host',
    howHead:  (c) => `Come segnare come inviat${c === 1 ? 'o' : 'i'}`,
    step1:    'Vai su <strong>Dati Check-in</strong> nella console host.',
    step2:    'Clicca <strong>Vedi</strong> sulla riga dell\'ospite.',
    step3:    'Nella sezione <strong>Invio Alloggiati</strong>, carica il PDF della ricevuta (consigliato — conservato 5 anni come prova) oppure usa <em>Segna come inviato senza ricevuta</em> se la ricevuta non è disponibile.',
    footer:   'Inviato da WelcomeBnB · una volta che un ospite è segnato come inviato, il promemoria si ferma per quell\'ospite. Disattiva tutti i promemoria cancellando l\'email promemoria nelle impostazioni della proprietà.',
  } : {
    yourProp: 'your property',
    heading:  (n) => `Filing reminder — ${n}`,
    body:     (c) => `<strong>${c}</strong> ${c === 1 ? 'guest' : 'guests'} checked in yesterday (${esc(yesterday)}) and ${c === 1 ? 'has' : 'have'} not been marked as filed on Alloggiati Web yet.`,
    tulps:    'Italian law (TULPS art. 109) requires transmitting guest data to Alloggiati Web within 24 hours of arrival — that deadline is close or has passed.',
    cta:      'Open host console',
    howHead:  (c) => `How to mark ${c === 1 ? 'them' : 'each of them'} filed`,
    step1:    'Go to <strong>Check-in Data</strong> in the host console.',
    step2:    'Click <strong>View</strong> on the guest\'s row.',
    step3:    'In the <strong>Alloggiati filing</strong> section, either upload the receipt PDF (recommended — kept 5 years as proof) or use <em>Mark filed without receipt</em> if a receipt isn\'t available.',
    footer:   'Sent by WelcomeBnB · once a guest is marked as filed, this reminder stops for that guest. Turn off all reminders by clearing the "reminder email" field in Property settings.',
  };
  const propName = esc(property.name || T.yourProp);
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;">
      <h2 style="margin:0 0 6px;font-size:20px;">${T.heading(propName)}</h2>
      <p style="margin:0 0 12px;">${T.body(count)}</p>
      <p style="margin:0 0 16px;color:#6B7A90;">${T.tulps}</p>
      <p style="margin:0 0 16px;">
        <a href="${esc(link)}" style="display:inline-block;background:#005BFF;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;">${T.cta}</a>
      </p>
      <p style="margin:0 0 8px;font-weight:600;">${T.howHead(count)}</p>
      <ol style="margin:0 0 16px 18px;padding:0;color:#374151;font-size:14px;line-height:1.55;">
        <li>${T.step1}</li>
        <li>${T.step2}</li>
        <li>${T.step3}</li>
      </ol>
      <p style="margin:20px 0 0;color:#6B7A90;font-size:12px;">${T.footer}</p>
    </div>`;
}
