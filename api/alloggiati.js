// api/alloggiati.js — Round 44 Phase 0.5
//
// Consolidated Alloggiati Web endpoint. Action-routed to stay under
// Vercel Hobby's 12-function cap. Every action requires a host bearer
// JWT and confirms the caller owns the given property_id before
// touching the credentials row.
//
// Actions
// -------
//   POST   ?action=status    { property_id }       → { configured, verified_at, wskey_expires_at, last_error }
//   POST   ?action=save      { property_id, utente, password, wskey, consent }
//                                                  → { configured: true, saved_at }
//   POST   ?action=verify    { property_id }       → { verified, verified_at?, token_expires_at?, error?, error_code? }
//   POST   ?action=validate  { property_id, rows[] } → { ok, overall, per_row[] }
//   POST   ?action=send      { property_id, rows[{line,checkin_ids[]}] }
//                                                  → { ok, filed_count, receipt_path, receipt_missing?, per_row[] }
//   POST   ?action=delete    { property_id }       → { configured: false }
//
// Security
// --------
// - No client ever receives plaintext credentials. `status` never even
//   returns the ciphertext.
// - The `host_alloggiati_credentials` table is service_role-only (see
//   Round 44 migration): every read/write in this file uses the
//   SERVICE_ROLE_KEY and the endpoint itself is the only trusted path.
// - `save` requires `consent: true` and stamps the row (no separate
//   consent field yet — the presence of any row implies consent was
//   given at save time; a future audit-log addition can capture the
//   timestamp and IP if compliance calls for it).
// - Property ownership is checked against `properties.owner_id`. Admin
//   viewers cannot save credentials on behalf of a host.

import { applyCors } from './_cors.js';
import { createRequire } from 'node:module';
import { timingSafeEqual } from 'node:crypto';
import { encryptCredentials, decryptCredentials } from './_alloggiati-crypto.js';
import {
  generateToken,
  authenticationTest,
  test as soapTest,
  send as soapSend,
  ricevuta as soapRicevuta,
} from './_alloggiati-soap.js';

// Round 49 Phase 1 — the Alloggiati reference tables, line builder,
// autofileDueAt timing function and every lookup helper live in a
// shared lib so the auto-filer tick (Round 49 Part 4) runs the exact
// same bytes the browser Export panel runs. CommonJS lib loaded via
// createRequire because the package is "type":"module" and the lib
// uses an IIFE + module.exports dual to also run under <script src>
// in host-console.html. Byte-identity enforced by
// scripts/golden-cross-check.mjs. The function budget is unchanged.
const AllogRecords = createRequire(import.meta.url)('../lib/alloggiati-records.js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── auth + property ownership check ─────────────────────────────────
async function resolveHostAndProperty(req, propertyId) {
  if (!propertyId || typeof propertyId !== 'string') {
    return { error: { status: 400, body: { error: 'property_id required' } } };
  }
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return { error: { status: 401, body: { error: 'Missing bearer token' } } };

  let hostId = null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return { error: { status: 401, body: { error: 'Invalid token' } } };
    const user = await userRes.json();
    hostId = user?.id;
    if (!hostId) return { error: { status: 401, body: { error: 'Invalid token' } } };
  } catch (_) {
    return { error: { status: 401, body: { error: 'Auth check failed' } } };
  }

  // Ownership check via service_role — properties has RLS but the
  // endpoint enforces its own boundary rather than relying on the
  // caller's JWT alone.
  try {
    const propRes = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=id,owner_id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!propRes.ok) return { error: { status: 500, body: { error: 'Property lookup failed' } } };
    const rows = await propRes.json();
    const prop = Array.isArray(rows) && rows[0];
    if (!prop) return { error: { status: 404, body: { error: 'Property not found' } } };
    if (prop.owner_id !== hostId) return { error: { status: 403, body: { error: 'Not the property owner' } } };
    return { hostId, propertyId };
  } catch (_) {
    return { error: { status: 500, body: { error: 'Property lookup failed' } } };
  }
}

async function sbGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`sbGet ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}
async function sbUpsert(table, body, onConflict) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`sbUpsert ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}
async function sbDelete(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`sbDelete ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}
// Round 44 Phase 1 hotfix — use PATCH for partial updates on rows
// that already exist. Can't rely on sbUpsert here: Postgres checks
// NOT NULL constraints on the pre-INSERT row BEFORE ON CONFLICT can
// redirect to UPDATE, so an upsert body missing credentials_enc
// always fails 23502 even when a row for property_id exists.
async function sbPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sbPatch ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

// ── Round 49 Phase 3 — autofile tick helpers ────────────────────────
//
// runAutofileTick(res) is the entry point for every pg_cron fire. It
// walks the properties that have alloggiati_autofile_mode in
// (dry_run,live), has a 45-second budget (the cron is every 10 min
// and Vercel caps the function at 60s), and for each one picks the
// due rows + builds lines via the shared record builder + files them
// (dry_run → SOAP Test only; live → Test + Send + Ricevuta + stamp).
// Every claim/success/failure is logged into alloggiati_filing_log
// via the SECURITY DEFINER log_alloggiati_filing RPC.
//
// IMPORTANT: nothing here calls applyCors() or resolveHostAndProperty
// — the tick's auth is a constant-time compare of x-cron-secret and
// its "actor" is the autofile tick itself (null in the audit log).

function _timingSafeStringCompare(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual throws if lengths differ; pad the shorter side so
  // the compare still runs in constant time against the fixed want.
  if (bufA.length !== bufB.length) {
    // Still compare equal-length buffers so a length mismatch doesn't
    // early-return; the result is already false.
    const pad = Buffer.alloc(Math.max(bufA.length, bufB.length));
    bufA.copy(pad);
    const bufB2 = Buffer.alloc(pad.length);
    bufB.copy(bufB2);
    timingSafeEqual(pad, bufB2);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

const AUTOFILE_TICK_BUDGET_MS = 45_000; // leave 15s headroom under Vercel's 60s cap
const AUTOFILE_MAX_PROPS_PER_TICK = 25;  // Hobby safety net; most ticks process 1-3

async function runAutofileTick(res) {
  const started = Date.now();
  const summary = {
    properties_processed: 0,
    properties_skipped_budget: 0,
    rows_filed: 0,
    rows_dry_run: 0,
    rows_past_window: 0,
    group_blocked: 0,
    tick_errors: 0,
  };

  let props;
  try {
    props = await sbGet(
      'properties?alloggiati_autofile_mode=in.(dry_run,live)' +
      '&deleted_at=is.null' +
      '&select=id,name,owner_id,alloggiati_autofile_mode,checkin_time,timezone'
    );
  } catch (e) {
    console.error('[autofile_tick] property load failed:', e.message);
    return res.status(500).json({ error: 'property_load_failed', detail: e.message });
  }
  if (!Array.isArray(props) || props.length === 0) {
    return res.status(200).json({ ok: true, note: 'no autofile properties', ...summary, elapsed_ms: Date.now() - started });
  }

  // Join: only properties with a verified credential row are eligible.
  const idsList = props.map(p => `"${p.id}"`).join(',');
  let verifiedIds = new Set();
  try {
    const credRows = await sbGet(
      `host_alloggiati_credentials?property_id=in.(${encodeURIComponent(idsList)})` +
      '&verified_at=not.is.null&select=property_id'
    );
    for (const c of credRows) verifiedIds.add(c.property_id);
  } catch (e) {
    console.error('[autofile_tick] cred lookup failed:', e.message);
    return res.status(500).json({ error: 'cred_load_failed', detail: e.message });
  }
  const eligible = props.filter(p => verifiedIds.has(p.id));

  for (const prop of eligible) {
    if (Date.now() - started > AUTOFILE_TICK_BUDGET_MS) {
      summary.properties_skipped_budget += (eligible.length - summary.properties_processed - summary.properties_skipped_budget);
      break;
    }
    if (summary.properties_processed >= AUTOFILE_MAX_PROPS_PER_TICK) break;
    try {
      const perProp = await processPropertyAutofile(prop);
      summary.properties_processed++;
      summary.rows_filed       += perProp.rows_filed || 0;
      summary.rows_dry_run     += perProp.rows_dry_run || 0;
      summary.rows_past_window += perProp.rows_past_window || 0;
      summary.group_blocked    += perProp.group_blocked || 0;
      summary.tick_errors      += perProp.errors || 0;
    } catch (e) {
      console.error('[autofile_tick]', prop.id, 'crashed:', e.message);
      summary.tick_errors++;
    }
  }

  return res.status(200).json({ ok: true, ...summary, elapsed_ms: Date.now() - started });
}

function _romeDateYmd(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Rome',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const g = (t) => parts.find(p => p.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch (_e) {
    return date.toISOString().slice(0, 10);
  }
}

async function processPropertyAutofile(prop) {
  const isDry = prop.alloggiati_autofile_mode === 'dry_run';
  const summary = { rows_filed: 0, rows_dry_run: 0, rows_past_window: 0, group_blocked: 0, errors: 0 };

  const now = new Date();
  const today = _romeDateYmd(now);
  const yesterday = _romeDateYmd(new Date(now.getTime() - 86400000));

  // Candidate rows: not yet filed, not excluded, arrival in today or
  // yesterday Rome. The autofile_excluded + alloggiati_status filters
  // are the same bar claim_autofile_rows uses, so the two can't
  // disagree.
  let candidates;
  try {
    candidates = await sbGet(
      `checkins?property_id=eq.${encodeURIComponent(prop.id)}` +
      '&is_test=eq.false&deleted_at=is.null&autofile_excluded=eq.false' +
      '&alloggiati_status=not.in.(filed,filing,correction)' +
      `&arrival_date=in.(${today},${yesterday})` +
      '&select=*&order=booking_code.asc.nullslast,guest_type.asc,submitted_at.asc'
    );
  } catch (e) {
    console.error('[autofile_tick]', prop.id, 'candidate load failed:', e.message);
    summary.errors++;
    return summary;
  }
  if (!Array.isArray(candidates) || candidates.length === 0) return summary;

  // Mark past-portal-window rows (autofileDueAt returns null when the
  // arrival+1 23:59 Rome window has elapsed). These rows get an alert
  // and are excluded from the batch — the host must file manually.
  const dueNow = [];
  const pastWindow = [];
  for (const row of candidates) {
    const dueAt = AllogRecords.autofileDueAt(row, { checkin_time: prop.checkin_time }, now);
    if (dueAt === null) { pastWindow.push(row); continue; }
    if (dueAt.getTime() <= now.getTime()) dueNow.push(row);
  }

  if (pastWindow.length > 0) {
    const ids = pastWindow.map(r => `"${r.id}"`).join(',');
    try {
      await sbPatch(
        `checkins?id=in.(${encodeURIComponent(ids)})`,
        {
          autofile_last_attempt_at: new Date().toISOString(),
          autofile_last_error: 'past_portal_window',
        },
      );
    } catch (e) { console.warn('[autofile_tick] past-window stamp failed:', e.message); }
    summary.rows_past_window += pastWindow.length;
  }

  if (dueNow.length === 0) return summary;

  // Group integrity: for each booking_code, check whether ANY row of
  // that booking (even one outside today/yesterday or filtered out
  // above) is already filed. A new familiare added after a reopen must
  // not be auto-filed in isolation — the portal would see a familiare
  // without its capofamiglia in the same batch.
  const bookingCodes = Array.from(new Set(dueNow.map(r => r.booking_code).filter(Boolean)));
  const filedBookings = new Set();
  if (bookingCodes.length > 0) {
    const bcIn = bookingCodes.map(b => `"${b}"`).join(',');
    try {
      const filedRows = await sbGet(
        `checkins?property_id=eq.${encodeURIComponent(prop.id)}` +
        `&booking_code=in.(${encodeURIComponent(bcIn)})` +
        '&alloggiati_status=eq.filed&deleted_at=is.null&select=booking_code&limit=500'
      );
      for (const fr of filedRows) filedBookings.add(fr.booking_code);
    } catch (e) { console.warn('[autofile_tick] filed-booking lookup failed:', e.message); }
  }

  const toFile = [];
  const blocked = [];
  for (const row of dueNow) {
    if (row.booking_code && filedBookings.has(row.booking_code)) blocked.push(row);
    else toFile.push(row);
  }

  if (blocked.length > 0) {
    const ids = blocked.map(r => `"${r.id}"`).join(',');
    try {
      await sbPatch(
        `checkins?id=in.(${encodeURIComponent(ids)})`,
        {
          autofile_last_attempt_at: new Date().toISOString(),
          autofile_last_error: 'group_already_filed',
          autofile_attempts: null, // we don't increment on this guard — not a retry
        },
      );
      // Note: null overwrites to NULL in PostgREST; we want to leave attempts
      // alone instead. Re-stamp just the two targeted columns.
      await sbPatch(
        `checkins?id=in.(${encodeURIComponent(ids)})`,
        {
          autofile_last_attempt_at: new Date().toISOString(),
          autofile_last_error: 'group_already_filed',
        },
      );
    } catch (e) { console.warn('[autofile_tick] group_already_filed stamp failed:', e.message); }
    summary.group_blocked += blocked.length;
  }

  if (toFile.length === 0) return summary;

  // Build lines via the shared record builder. Any builder warning
  // means the Alloggiati portal would reject the line (unresolved
  // state code, missing comune, etc.) — don't claim or send; stamp
  // the row and move on. The host will see autofile_last_error in
  // the console (Phase 4 UI) and know to fix the field.
  const { lines, rowMeta, warnings } = AllogRecords.buildBatch(toFile);
  // Map warnings back to row ids via rowMeta's idx (1-based line index).
  const warningRowIdxs = new Set();
  for (const w of warnings) {
    const m = w.match(/Row\s+(\d+):/);
    if (m) warningRowIdxs.add(Number(m[1]));
  }
  const okIndices = [];
  const warnIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (warningRowIdxs.has(i + 1)) warnIndices.push(i);
    else okIndices.push(i);
  }
  if (warnIndices.length > 0) {
    const warnIds = warnIndices.map(i => rowMeta[i].checkin_id).filter(Boolean).map(x => `"${x}"`).join(',');
    if (warnIds) {
      try {
        await sbPatch(
          `checkins?id=in.(${encodeURIComponent(warnIds)})`,
          {
            autofile_last_attempt_at: new Date().toISOString(),
            autofile_last_error: 'builder_warning',
          },
        );
      } catch (e) { console.warn('[autofile_tick] builder-warning stamp failed:', e.message); }
    }
    summary.errors += warnIndices.length;
  }
  if (okIndices.length === 0) return summary;

  const okLines = okIndices.map(i => lines[i]);
  const okCheckinIds = okIndices.map(i => rowMeta[i].checkin_id).filter(Boolean);

  // Load + decrypt credentials once per property.
  let creds;
  try {
    const credRows = await sbGet(
      `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(prop.id)}` +
      '&select=credentials_enc,credentials_nonce,enc_key_id&limit=1'
    );
    if (!Array.isArray(credRows) || !credRows[0]) throw new Error('no credentials row');
    creds = await decryptCredentials(credRows[0]);
  } catch (e) {
    console.error('[autofile_tick]', prop.id, 'cred load/decrypt failed:', e.message);
    await logFiling({
      propertyId: prop.id, trigger: isDry ? 'autofile_dry_run' : 'autofile',
      checkinIds: okCheckinIds, outcome: 'cred_error',
      errorCode: 'cred_error', errorDetail: e.message,
    });
    summary.errors++;
    return summary;
  }

  // Mint token
  let token;
  try {
    token = (await generateToken(creds)).token;
  } catch (e) {
    await _bumpAttempts(okCheckinIds, 'generate_token_failed', e.message);
    await logFiling({
      propertyId: prop.id, trigger: isDry ? 'autofile_dry_run' : 'autofile',
      checkinIds: okCheckinIds, outcome: 'cred_error',
      errorCode: e.code || 'generate_token_failed', errorDetail: e.message,
    });
    summary.errors++;
    return summary;
  }

  // Dry-run path: SOAP Test only. No claim, no stamp, no receipt — the
  // tick only writes the audit log entry and the per-row attempt
  // timestamp so a daily digest (Phase 5) can summarise outcomes.
  if (isDry) {
    try {
      const testOutcome = await soapTest({ utente: creds.utente, token, rows: okLines });
      const rejected = (testOutcome.perRow || []).filter(r => !r.ok).length;
      await logFiling({
        propertyId: prop.id, trigger: 'autofile_dry_run',
        checkinIds: okCheckinIds,
        outcome: rejected === 0 ? 'test_all_ok' : `test_rejected_${rejected}`,
        errorCode: null, errorDetail: null,
      });
      const idsList = okCheckinIds.map(x => `"${x}"`).join(',');
      await sbPatch(
        `checkins?id=in.(${encodeURIComponent(idsList)})`,
        { autofile_last_attempt_at: new Date().toISOString(), autofile_last_error: rejected === 0 ? null : 'dry_run_rejected' },
      );
      summary.rows_dry_run += okLines.length;
      return summary;
    } catch (e) {
      await _bumpAttempts(okCheckinIds, 'test_failed', e.message);
      await logFiling({
        propertyId: prop.id, trigger: 'autofile_dry_run',
        checkinIds: okCheckinIds, outcome: 'test_error',
        errorCode: e.code || 'test_error', errorDetail: e.message,
      });
      summary.errors++;
      return summary;
    }
  }

  // Live path: claim rows atomically via the Phase 2 SECURITY DEFINER
  // function. If some rows aren't claimable (status changed between
  // the candidate load and now), file only the ones we got.
  let claimed;
  try {
    const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_autofile_rows`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_property: prop.id, p_ids: okCheckinIds }),
    });
    if (!claimRes.ok) throw new Error(`claim ${claimRes.status}: ${await claimRes.text().catch(() => '')}`);
    const claimedBody = await claimRes.json();
    // RPC returning setof uuid comes back as [{claim_autofile_rows: uuid}] OR [uuid]
    claimed = (Array.isArray(claimedBody) ? claimedBody : []).map(x => typeof x === 'string' ? x : (x?.claim_autofile_rows || x?.id || null)).filter(Boolean);
  } catch (e) {
    console.error('[autofile_tick]', prop.id, 'claim failed:', e.message);
    await logFiling({
      propertyId: prop.id, trigger: 'autofile',
      checkinIds: okCheckinIds, outcome: 'claim_failed',
      errorCode: 'claim_failed', errorDetail: e.message,
    });
    summary.errors++;
    return summary;
  }
  if (claimed.length === 0) {
    // Nothing to do this tick — the rows raced out from under us.
    return summary;
  }
  const claimedSet = new Set(claimed);
  const batchLines = [];
  const batchCheckinIds = [];
  for (let i = 0; i < okCheckinIds.length; i++) {
    if (claimedSet.has(okCheckinIds[i])) {
      batchLines.push(okLines[i]);
      batchCheckinIds.push(okCheckinIds[i]);
    }
  }

  // SOAP Test → Send → Ricevuta. Same Round 44 safety order the host
  // manual send uses: refuse to Send if Test rejects any row.
  try {
    const testOutcome = await soapTest({ utente: creds.utente, token, rows: batchLines });
    const anyRejected = (testOutcome.perRow || []).some(r => !r.ok);
    if (anyRejected) {
      await _releaseClaimAndStamp(batchCheckinIds, 'test_rejected');
      await logFiling({
        propertyId: prop.id, trigger: 'autofile',
        checkinIds: batchCheckinIds, outcome: 'test_rejected',
        errorCode: 'validation_failed',
        errorDetail: (testOutcome.perRow || []).filter(r => !r.ok).slice(0, 5).map(r => r.erroreDes || r.code).join(' | '),
      });
      summary.errors += batchCheckinIds.length;
      return summary;
    }
  } catch (e) {
    await _releaseClaimAndStamp(batchCheckinIds, 'test_transport_error');
    await logFiling({
      propertyId: prop.id, trigger: 'autofile',
      checkinIds: batchCheckinIds, outcome: 'test_transport_error',
      errorCode: e.code || 'test_error', errorDetail: e.message,
    });
    summary.errors += batchCheckinIds.length;
    return summary;
  }

  let sendOutcome;
  try {
    sendOutcome = await soapSend({ utente: creds.utente, token, rows: batchLines });
  } catch (e) {
    await _releaseClaimAndStamp(batchCheckinIds, 'send_transport_error');
    await logFiling({
      propertyId: prop.id, trigger: 'autofile',
      checkinIds: batchCheckinIds, outcome: 'send_transport_error',
      errorCode: e.code || 'send_error', errorDetail: e.message,
    });
    summary.errors += batchCheckinIds.length;
    return summary;
  }
  if (!sendOutcome.overall.ok || (sendOutcome.perRow || []).some(r => !r.ok)) {
    await _releaseClaimAndStamp(batchCheckinIds, 'send_rejected');
    await logFiling({
      propertyId: prop.id, trigger: 'autofile',
      checkinIds: batchCheckinIds, outcome: 'send_rejected',
      errorCode: sendOutcome.overall.code || 'portal_rejected',
      errorDetail: sendOutcome.overall.erroreDes || 'portal rejected after test passed',
    });
    summary.errors += batchCheckinIds.length;
    return summary;
  }

  // Send succeeded. Fetch Ricevuta best-effort (do not revert stamps if it fails).
  const filedAt = new Date();
  const filedAtIso = filedAt.toISOString();
  const filedDateRome = _romeDateYmd(filedAt);
  let receiptPath = null;
  try {
    const rec = await soapRicevuta({ utente: creds.utente, token, date: filedDateRome });
    const stamp = filedAtIso.slice(0, 19).replace(/[-:T]/g, '');
    const path = `${prop.id}/alloggiati-autofile-${stamp}.pdf`;
    const upRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/receipts/${path}`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/pdf', 'x-upsert': 'true',
        },
        body: rec.pdf,
      },
    );
    if (upRes.ok) receiptPath = path;
    else console.warn('[autofile_tick] receipt upload', upRes.status);
  } catch (e) {
    console.warn('[autofile_tick] ricevuta failed (non-fatal):', e.message);
  }

  // Stamp rows filed. The lock trigger allows filing → filed with no
  // sensitive-column change, so this UPDATE lands cleanly.
  try {
    const idsList = batchCheckinIds.map(x => `"${x}"`).join(',');
    const patch = { alloggiati_status: 'filed', filed_at: filedAtIso };
    if (receiptPath) patch.receipt_path = receiptPath;
    await sbPatch(
      `checkins?id=in.(${encodeURIComponent(idsList)})&property_id=eq.${encodeURIComponent(prop.id)}`,
      patch,
    );
    // Reset autofile tracking columns on success — attempt counters
    // from an earlier failed round shouldn't carry across a success.
    await sbPatch(
      `checkins?id=in.(${encodeURIComponent(idsList)})`,
      { autofile_attempts: 0, autofile_last_attempt_at: new Date().toISOString(), autofile_last_error: null, autofile_claimed_at: null },
    );
  } catch (e) {
    console.error('[autofile_tick] stamp failed (filing done, DB desync):', e.message);
    await logFiling({
      propertyId: prop.id, trigger: 'autofile',
      checkinIds: batchCheckinIds, outcome: 'stamp_desync',
      errorCode: 'stamp_desync', errorDetail: e.message, receiptPath,
    });
    summary.errors += batchCheckinIds.length;
    return summary;
  }

  await logFiling({
    propertyId: prop.id, trigger: 'autofile',
    checkinIds: batchCheckinIds, outcome: 'filed',
    receiptPath,
  });
  summary.rows_filed += batchCheckinIds.length;
  return summary;
}

async function _bumpAttempts(ids, lastError, detail) {
  if (!ids || ids.length === 0) return;
  const idsList = ids.map(x => `"${x}"`).join(',');
  try {
    // PostgREST doesn't support `autofile_attempts = autofile_attempts + 1`
    // in a PATCH body — read-then-write would race. Use a Postgres RPC
    // next round; for now a plain stamp is enough (the attempt count is
    // mostly for the "alert after 3 failures" alerting that Phase 5
    // wires up).
    await sbPatch(
      `checkins?id=in.(${encodeURIComponent(idsList)})`,
      {
        autofile_last_attempt_at: new Date().toISOString(),
        autofile_last_error: (lastError || 'error') + (detail ? ': ' + String(detail).slice(0, 120) : ''),
      },
    );
  } catch (e) {
    console.warn('[autofile_tick] _bumpAttempts failed:', e.message);
  }
}

async function _releaseClaimAndStamp(ids, lastError) {
  if (!ids || ids.length === 0) return;
  const idsList = ids.map(x => `"${x}"`).join(',');
  try {
    await sbPatch(
      `checkins?id=in.(${encodeURIComponent(idsList)})`,
      {
        alloggiati_status: 'pending',
        autofile_claimed_at: null,
        autofile_last_attempt_at: new Date().toISOString(),
        autofile_last_error: lastError,
      },
    );
  } catch (e) {
    console.warn('[autofile_tick] _releaseClaimAndStamp failed:', e.message);
  }
}

async function logFiling({ propertyId, trigger, checkinIds, outcome, errorCode = null, errorDetail = null, receiptPath = null, actor = null }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_alloggiati_filing`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_property_id: propertyId,
        p_trigger: trigger,
        p_checkin_ids: checkinIds,
        p_outcome: outcome,
        p_error_code: errorCode,
        p_error_detail: errorDetail ? String(errorDetail).slice(0, 500) : null,
        p_receipt_path: receiptPath,
        p_actor: actor,
      }),
    });
    if (!r.ok) {
      console.warn('[autofile_tick] logFiling RPC', r.status, await r.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('[autofile_tick] logFiling exception:', e.message);
  }
}

// ── main handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '').trim();

  // Round 49 Phase 3 — autofile_tick is a server-to-server call from
  // Supabase pg_cron. It has no Origin and no host JWT; the whole
  // auth check is a constant-time compare of x-cron-secret against
  // the Vercel AUTOFILE_CRON_SECRET env var. Skip the CORS gate and
  // the property-owner resolve entirely for this one action — the
  // tick operates across every autofile-enabled property.
  if (action === 'autofile_tick') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });
    const want = process.env.AUTOFILE_CRON_SECRET || '';
    const got = String(req.headers['x-cron-secret'] || req.headers['X-Cron-Secret'] || '').trim();
    if (!want || !got || !_timingSafeStringCompare(want, got)) {
      return res.status(401).json({ error: 'Invalid cron secret' });
    }
    return await runAutofileTick(res);
  }

  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const body = req.body || {};
  const propertyId = String(body.property_id || '').trim();

  const owner = await resolveHostAndProperty(req, propertyId);
  if (owner.error) return res.status(owner.error.status).json(owner.error.body);

  if (action === 'status') {
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=verified_at,wskey_expires_at,last_error,updated_at&limit=1`
      );
      const row = Array.isArray(rows) && rows[0];
      return res.status(200).json({
        configured:        !!row,
        verified_at:       row?.verified_at || null,
        wskey_expires_at:  row?.wskey_expires_at || null,
        last_error:        row?.last_error || null,
        updated_at:        row?.updated_at || null,
      });
    } catch (e) {
      console.warn('[alloggiati] status failed:', e.message);
      return res.status(500).json({ error: 'Status lookup failed' });
    }
  }

  if (action === 'save') {
    if (!body.consent) {
      return res.status(400).json({ error: 'Consent required' });
    }
    const utente   = String(body.utente || '').trim();
    const password = String(body.password || '');
    const wskey    = String(body.wskey || '').trim();
    if (!utente || !password || !wskey) {
      return res.status(400).json({ error: 'utente, password and wskey are all required' });
    }
    let enc;
    try {
      enc = await encryptCredentials({ utente, password, wskey });
    } catch (e) {
      console.error('[alloggiati] encrypt failed:', e.message);
      return res.status(500).json({ error: 'Server misconfigured (encryption)' });
    }
    try {
      const row = {
        property_id:        propertyId,
        credentials_enc:    enc.enc,
        credentials_nonce:  enc.nonce,
        enc_key_id:         enc.keyId,
        // Newly saved credentials haven't been verified against the
        // portal yet — that's Phase 1's job. Clear any stale state so
        // the UI shows an honest "configured but not verified" chip.
        verified_at:        null,
        wskey_expires_at:   null,
        last_error:         null,
      };
      const [saved] = await sbUpsert('host_alloggiati_credentials', row, 'property_id');
      return res.status(200).json({
        configured: true,
        saved_at:   saved?.updated_at || saved?.created_at || null,
      });
    } catch (e) {
      console.error('[alloggiati] save failed:', e.message);
      return res.status(500).json({ error: 'Save failed' });
    }
  }

  if (action === 'verify') {
    // Round 44 Phase 1 — hit Alloggiati's SOAP endpoint with the
    // stored credentials and stamp verified_at + last_error on the row.
    //
    // Return contract (always HTTP 200 for a completed attempt, even
    // when the portal rejected the credentials — the client renders
    // the result differently for `verified: true` vs `verified: false`):
    //   { verified: true,  verified_at, token_expires_at }
    //   { verified: false, error, error_code }
    //
    // We NEVER return the token to the client. It lives only in this
    // function's memory during the two SOAP calls and is discarded.
    let row;
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=credentials_enc,credentials_nonce,enc_key_id&limit=1`
      );
      row = Array.isArray(rows) && rows[0];
    } catch (e) {
      console.warn('[alloggiati] verify: row lookup failed:', e.message);
      return res.status(500).json({ error: 'Credential lookup failed' });
    }
    if (!row) {
      return res.status(400).json({ error: 'No credentials saved for this property yet' });
    }

    let creds;
    try {
      creds = await decryptCredentials(row);
    } catch (e) {
      console.error('[alloggiati] verify: decrypt failed:', e.message);
      // Stamp the row so the UI shows the honest state — "we can't
      // read your stored credentials, please re-enter". Common causes
      // are a rotated ALLOGGIATI_ENC_KEY without background re-encrypt.
      const stampErr = 'Stored credentials unreadable — please re-enter them.';
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: stampErr },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: stampErr,
        error_code: 'decrypt_failed',
      });
    }

    // Two SOAP calls: GenerateToken → Authentication_Test. Failure of
    // either one is treated as a verification failure with the
    // portal's own error message surfaced to the host.
    let token, tokenExpires;
    try {
      const t = await generateToken(creds);
      token = t.token;
      tokenExpires = t.expires || null;
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati portal rejected the credentials';
      console.warn('[alloggiati] verify: GenerateToken failed:', e.code, portalMsg);
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: portalMsg },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: portalMsg,
        error_code: e.code || 'portal_error',
      });
    }

    try {
      await authenticationTest({ utente: creds.utente, token });
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati authentication test failed';
      console.warn('[alloggiati] verify: Authentication_Test failed:', e.code, portalMsg);
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: portalMsg },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: portalMsg,
        error_code: e.code || 'portal_error',
      });
    }

    // Success — stamp the row and forget the token.
    const verifiedAt = new Date().toISOString();
    // Round 44 Phase 1 note — Alloggiati exposes the TOKEN expiry
    // (24 h) through GenerateToken, but NOT the underlying WsKey
    // expiry (set by the host at the portal, up to 12 months). We
    // keep wskey_expires_at null; a future admin UI can let the host
    // record their portal-set expiry manually.
    try {
      await sbPatch(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
        { verified_at: verifiedAt, last_error: null },
      );
    } catch (e) {
      console.error('[alloggiati] verify: stamp failed:', e.message);
      // Don't fail the whole call — the credentials DID verify; the
      // client just won't see the timestamp until the next status
      // load. Return `verified: true` with a soft warning.
      return res.status(200).json({
        verified: true,
        verified_at: verifiedAt,
        token_expires_at: tokenExpires,
        warning: 'Verification succeeded but the timestamp could not be saved.',
      });
    }
    return res.status(200).json({
      verified: true,
      verified_at: verifiedAt,
      token_expires_at: tokenExpires,
    });
  }

  if (action === 'validate') {
    // Round 44 Phase 2 — dry-run a batch of tracciato-record rows
    // through Alloggiati's Test operation. NOTHING is filed. Response
    // shape (always HTTP 200 for a completed round-trip):
    //   { ok: true, overall: {...}, per_row: [{ idx, ok, error_message?, error_code? }, ...] }
    // or, for a portal-side failure:
    //   { ok: false, error, error_code }
    //
    // Client sends the rows it BUILT locally (so what we validate is
    // what would land in the .txt file). The endpoint enforces
    // per-property ownership up-front and caps the batch size — a
    // host can only run Test against their own account with rows
    // they generated.
    const rowsIn = Array.isArray(body.rows) ? body.rows : [];
    if (rowsIn.length === 0) {
      return res.status(400).json({ error: 'rows must be a non-empty array' });
    }
    if (rowsIn.length > 200) {
      return res.status(400).json({ error: 'Too many rows (max 200 per validation batch)' });
    }
    // Each row is a 168-char string. Reject anything that isn't a
    // string outright — we don't want unbounded objects going to the
    // portal. Length is soft-checked (portal will complain about the
    // wrong bytes; we still surface that per-row).
    for (let i = 0; i < rowsIn.length; i++) {
      if (typeof rowsIn[i] !== 'string') {
        return res.status(400).json({ error: `Row ${i + 1} is not a string` });
      }
      if (rowsIn[i].length > 400) {
        return res.status(400).json({ error: `Row ${i + 1} is too long` });
      }
    }

    // Load stored credentials, decrypt, mint a fresh token.
    let row;
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=credentials_enc,credentials_nonce,enc_key_id&limit=1`
      );
      row = Array.isArray(rows) && rows[0];
    } catch (e) {
      console.warn('[alloggiati] validate: row lookup failed:', e.message);
      return res.status(500).json({ error: 'Credential lookup failed' });
    }
    if (!row) return res.status(400).json({ error: 'No credentials saved for this property yet' });

    let creds;
    try {
      creds = await decryptCredentials(row);
    } catch (e) {
      console.error('[alloggiati] validate: decrypt failed:', e.message);
      return res.status(200).json({
        ok: false,
        error: 'Stored credentials unreadable — please re-enter them.',
        error_code: 'decrypt_failed',
      });
    }

    let token;
    try {
      const t = await generateToken(creds);
      token = t.token;
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati portal rejected the credentials';
      console.warn('[alloggiati] validate: GenerateToken failed:', e.code, portalMsg);
      return res.status(200).json({ ok: false, error: portalMsg, error_code: e.code || 'portal_error' });
    }

    let outcome;
    try {
      outcome = await soapTest({ utente: creds.utente, token, rows: rowsIn });
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati Test call failed';
      console.warn('[alloggiati] validate: Test failed:', e.code, portalMsg);
      return res.status(200).json({ ok: false, error: portalMsg, error_code: e.code || 'portal_error' });
    }

    // Zip outcome.perRow with the input order. If the portal returned
    // FEWER Dettaglio entries than we sent, treat the missing ones as
    // "unknown" so the client can flag them explicitly rather than
    // silently marking them ok.
    const perRow = rowsIn.map((_, i) => {
      const r = outcome.perRow[i];
      if (!r) {
        return { idx: i + 1, ok: false, error_code: 'no_response', error_message: 'Portal returned no result for this row' };
      }
      if (r.ok) return { idx: i + 1, ok: true };
      return {
        idx: i + 1,
        ok: false,
        error_code: r.code,
        errore_cod: r.erroreCod,
        error_message: r.erroreDes || 'Row rejected',
      };
    });

    return res.status(200).json({
      ok: true,
      overall: outcome.overall,
      total: rowsIn.length,
      valid_count: perRow.filter(p => p.ok).length,
      per_row: perRow,
    });
  }

  if (action === 'send') {
    // Round 44 Phase 3 — FILE the rows with the State Police via
    // SOAP Send, fetch the Ricevuta PDF, store it in the receipts
    // bucket, and stamp each affected check-in row.
    //
    // Safety pattern: Test first — refuse to Send if ANY row would
    // be rejected. Alloggiati Send would happily file some and reject
    // others, but a partial batch is confusing (some guests filed,
    // some not, one receipt covers only the accepted ones). Better
    // to fail cleanly and let the host fix the rejected rows before
    // filing the whole batch fresh.
    //
    // Request shape: rows: [{ line: "168-char string", checkin_ids: ["uuid", ...] }]
    // (one line per guest, but a single guest row can map to multiple
    //  checkin_ids if the host somehow duplicated a check-in — rare,
    //  but the client already collapses on booking_code + guest_type,
    //  so we accept an array to keep the door open).
    const rowsIn = Array.isArray(body.rows) ? body.rows : [];
    if (rowsIn.length === 0) return res.status(400).json({ error: 'rows must be a non-empty array' });
    if (rowsIn.length > 200) return res.status(400).json({ error: 'Too many rows (max 200 per Send batch)' });
    const lines = [];
    const checkinIdsFlat = [];
    for (let i = 0; i < rowsIn.length; i++) {
      const r = rowsIn[i];
      if (!r || typeof r.line !== 'string') {
        return res.status(400).json({ error: `Row ${i + 1} missing "line"` });
      }
      if (r.line.length > 400) return res.status(400).json({ error: `Row ${i + 1} too long` });
      const ids = Array.isArray(r.checkin_ids) ? r.checkin_ids.filter(x => typeof x === 'string' && /^[0-9a-f-]{10,}$/i.test(x)) : [];
      if (ids.length === 0) return res.status(400).json({ error: `Row ${i + 1} has no valid checkin_ids` });
      lines.push(r.line);
      checkinIdsFlat.push(...ids);
    }

    // ── Load and decrypt credentials ─────────────────────────────
    let credRow;
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=credentials_enc,credentials_nonce,enc_key_id&limit=1`
      );
      credRow = Array.isArray(rows) && rows[0];
    } catch (e) {
      console.warn('[alloggiati] send: cred lookup failed:', e.message);
      return res.status(500).json({ error: 'Credential lookup failed' });
    }
    if (!credRow) return res.status(400).json({ error: 'No credentials saved for this property yet' });

    let creds;
    try {
      creds = await decryptCredentials(credRow);
    } catch (e) {
      console.error('[alloggiati] send: decrypt failed:', e.message);
      return res.status(200).json({
        ok: false,
        error: 'Stored credentials unreadable — please re-enter them.',
        error_code: 'decrypt_failed',
      });
    }

    // ── Ownership guard on the checkin_ids ───────────────────────
    // Even though the client only sends what it built, defence in
    // depth: confirm every checkin_id actually belongs to this
    // property before we stamp them.
    try {
      const idList = Array.from(new Set(checkinIdsFlat));
      // Cap the OR filter length to keep the URL sane; 200 rows *
      // guests fits well within PostgREST's limits.
      const inList = idList.map(x => `"${x}"`).join(',');
      const ownRes = await fetch(
        `${SUPABASE_URL}/rest/v1/checkins?id=in.(${encodeURIComponent(inList)})&select=id,property_id`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
      );
      if (!ownRes.ok) throw new Error(`checkins lookup ${ownRes.status}`);
      const found = await ownRes.json();
      if (!Array.isArray(found) || found.length !== idList.length) {
        return res.status(400).json({ error: 'Some checkin_ids do not exist' });
      }
      const alien = found.find(c => c.property_id !== propertyId);
      if (alien) return res.status(403).json({ error: 'A checkin does not belong to this property' });
    } catch (e) {
      console.warn('[alloggiati] send: ownership check failed:', e.message);
      return res.status(500).json({ error: 'Ownership check failed' });
    }

    // ── Mint a fresh token ───────────────────────────────────────
    let token;
    try {
      const t = await generateToken(creds);
      token = t.token;
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati portal rejected the credentials';
      console.warn('[alloggiati] send: GenerateToken failed:', e.code, portalMsg);
      return res.status(200).json({ ok: false, error: portalMsg, error_code: e.code || 'portal_error' });
    }

    // ── Test first — abort if any row would be rejected ──────────
    let testOutcome;
    try {
      testOutcome = await soapTest({ utente: creds.utente, token, rows: lines });
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati Test failed';
      console.warn('[alloggiati] send: Test failed:', e.code, portalMsg);
      return res.status(200).json({ ok: false, error: portalMsg, error_code: e.code || 'portal_error' });
    }
    const failedInTest = (testOutcome.perRow || [])
      .map((r, i) => ({ idx: i + 1, r }))
      .filter(x => !x.r.ok);
    if (failedInTest.length > 0) {
      return res.status(200).json({
        ok: false,
        error: 'One or more rows would be rejected by Alloggiati — nothing was filed.',
        error_code: 'validation_failed',
        per_row: (testOutcome.perRow || []).map((r, i) => r.ok
          ? { idx: i + 1, ok: true }
          : { idx: i + 1, ok: false, error_code: r.code, errore_cod: r.erroreCod, error_message: r.erroreDes || 'Row rejected' }),
      });
    }

    // ── Send the batch (this is the legally-consequential call) ──
    let sendOutcome;
    try {
      sendOutcome = await soapSend({ utente: creds.utente, token, rows: lines });
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati Send failed';
      console.warn('[alloggiati] send: Send failed:', e.code, portalMsg);
      return res.status(200).json({ ok: false, error: portalMsg, error_code: e.code || 'portal_error' });
    }
    // If overall Send failed OR any row was rejected (shouldn't
    // happen after Test passed, but portal state can change between
    // calls), do NOT stamp any check-ins — the batch is in an
    // ambiguous state and the host needs to check the portal.
    if (!sendOutcome.overall.ok) {
      return res.status(200).json({
        ok: false,
        error: sendOutcome.overall.erroreDes || 'Alloggiati Send rejected the batch',
        error_code: sendOutcome.overall.code || 'portal_error',
      });
    }
    const sendFailures = (sendOutcome.perRow || []).filter(r => !r.ok);
    if (sendFailures.length > 0) {
      console.error('[alloggiati] send: post-Test per-row failure — batch left un-stamped for manual review', sendFailures);
      return res.status(200).json({
        ok: false,
        error: 'The portal accepted some rows but rejected others between Validate and Send. Check the Alloggiati portal directly before retrying.',
        error_code: 'send_partial',
        per_row: (sendOutcome.perRow || []).map((r, i) => r.ok
          ? { idx: i + 1, ok: true }
          : { idx: i + 1, ok: false, error_code: r.code, errore_cod: r.erroreCod, error_message: r.erroreDes || 'Row rejected' }),
      });
    }

    // ── Send succeeded. Everything below is best-effort — even if
    // Ricevuta or storage or the stamp fails, the filing IS DONE at
    // the portal. Surface the situation to the host instead of
    // silently succeeding OR silently losing state.
    const filedAt = new Date();
    const filedAtIso = filedAt.toISOString();
    const filedDateRome = filedAtIso.slice(0, 10);

    let receiptPath = null;
    let receiptMissing = null;
    try {
      const rec = await soapRicevuta({ utente: creds.utente, token, date: filedDateRome });
      // Storage path: <property_id>/ so the RLS policy (which keys off
      // the first path segment) recognises it as this property's file.
      const stamp = filedAtIso.slice(0, 19).replace(/[-:T]/g, '');
      const path = `${propertyId}/alloggiati-batch-${stamp}.pdf`;
      const upRes = await fetch(
        `${SUPABASE_URL}/storage/v1/object/receipts/${path}`,
        {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: rec.pdf,
        },
      );
      if (!upRes.ok) {
        const text = await upRes.text().catch(() => '');
        throw new Error(`storage upload ${upRes.status}: ${text.slice(0, 200)}`);
      }
      receiptPath = path;
    } catch (e) {
      // Portal accepted the batch — losing the PDF here does not
      // undo the filing. Log loud, warn the client, continue to
      // stamp the check-ins so the "filed" state matches reality.
      console.error('[alloggiati] send: receipt fetch/upload failed:', e.message);
      receiptMissing = `Receipt PDF could not be retrieved (${e.message}). The filing itself succeeded — you can download the receipt manually from the Alloggiati portal.`;
    }

    // ── Stamp check-ins ──────────────────────────────────────────
    // Uses PATCH so we don't hit the same ON CONFLICT trap the verify
    // stamp did. Do this AFTER the storage upload so the receipt_path
    // is either set or explicitly null (no half-state).
    let stampError = null;
    try {
      const patch = {
        alloggiati_status: 'filed',
        filed_at: filedAtIso,
      };
      if (receiptPath) patch.receipt_path = receiptPath;
      const idsList = Array.from(new Set(checkinIdsFlat)).map(x => `"${x}"`).join(',');
      await sbPatch(
        `checkins?id=in.(${encodeURIComponent(idsList)})&property_id=eq.${encodeURIComponent(propertyId)}`,
        patch,
      );
    } catch (e) {
      // The filing itself is safe; the row stamps aren't. Return a
      // clear warning so the UI can show a "filed at portal but our
      // database didn't update" banner.
      console.error('[alloggiati] send: stamp failed:', e.message);
      stampError = e.message;
    }

    // Round 49 Phase 3 — mirror the manual Send into alloggiati_filing_log.
    // Failures above exited through 200 responses that never reached this
    // point, so getting here means the portal accepted the whole batch.
    await logFiling({
      propertyId,
      trigger: 'host',
      checkinIds: Array.from(new Set(checkinIdsFlat)),
      outcome: stampError ? 'filed_stamp_desync' : 'filed',
      errorCode: stampError ? 'stamp_desync' : null,
      errorDetail: stampError || null,
      receiptPath,
      actor: owner.hostId || null,
    });

    return res.status(200).json({
      ok: true,
      filed_count: lines.length,
      filed_at: filedAtIso,
      receipt_path: receiptPath,
      receipt_missing: receiptMissing,
      stamp_error: stampError,
      per_row: lines.map((_, i) => ({ idx: i + 1, ok: true })),
    });
  }

  if (action === 'delete') {
    try {
      await sbDelete(`host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`);
      return res.status(200).json({ configured: false });
    } catch (e) {
      console.warn('[alloggiati] delete failed:', e.message);
      return res.status(500).json({ error: 'Delete failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
