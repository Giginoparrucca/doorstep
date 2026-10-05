// api/guest.js — Round 34 chat gateway + Round 48 guest gateway.
//
// Round 48 Phase 2 renamed api/guest-chat.js → api/guest.js and
// extended the action set. The old URL stays wired up via a Vercel
// rewrite (/api/guest-chat → /api/guest, see vercel.json) so cached
// clients keep working; new client builds point at /api/guest.
//
// Closes the cross-property chat read leak documented in Round 12.1
// AND the broader cross-property SELECT/INSERT/UPDATE holes on
// `checkins`, `properties`, `ota_reservations` and `marketing_consents`
// that Round 48 Phase 1's policy lockdown couldn't reach without
// moving the anon-side writes into a trusted server path first.
//
// This endpoint is the only path anon guests have to reach these
// tables after Round 48 Phase 3's migration revokes the anon grants.
// All DB access here runs as SUPABASE_SERVICE_ROLE_KEY and the
// *scope of every query* is derived from the signed guest token,
// never from the request body.
//
// Auth: Authorization: Bearer <guest_token> (Round 33's _guest-token.js).
// Origin: same allowlist as the AI endpoints.
//
// Actions (POST body: { action, ...args }):
//
//   # Chat (Round 34 — unchanged byte-for-byte)
//   history        → { messages: [...] }   (most recent 50, ordered ASC)
//   send { message, sender } → { ok: true, id }  (INSERT one chat_messages row)
//   poll { since }           → { messages: [...] } (host/system only,
//                                                   after cursor, max 5)
//
//   # Round 48 Phase 2 — guest-visible resources
//   property       → { property: {whitelist} }
//                    Guest-safe property fields, keybox/wifi only
//                    revealed when the token's booking has ≥1 non-
//                    deleted check-in row.
//
//   checkin_list   → { guests: [...] }
//                    This booking's check-ins. Only the columns the
//                    welcome-back + edit UIs need, plus
//                    alloggiati_status, filed_at and a server-computed
//                    `editable` boolean. Never includes id_photo_path.
//
//   checkin_insert { record }
//                  → { id, booking_code }
//                    Server sets property_id, booking_code, is_test
//                    from the token. If the token has no `b` (walk-in),
//                    mint `WB-XXXXXXXX` (Crockford base32) and return
//                    it; the client re-mints its token afterwards.
//                    Side effects: rotating keybox stamp via the
//                    get_reservation_keybox RPC, and clearing the
//                    checkin_reopened_at flag on both checkins and
//                    ota_reservations.
//
//   checkin_update { id, fields }
//                  → { updated: row } | 409 { error: 'already_filed' }
//                    Conditional UPDATE that fails fast when the row
//                    is already filed with Alloggiati. Stamps
//                    guest_edited_at=now(). If the main guest changes
//                    arrival/departure, those apply to every row in
//                    the booking.
//
//   checkin_lookup { surname, arrival_date }
//                  → { property_id, booking_code, guests: n }
//                    Replaces the old cross-property ilike surname
//                    search. Never returns PII. Rate-limited at 10
//                    lookups per session per rolling hour via api_usage
//                    (endpoint='checkin_lookup').
//
//   consent_withdraw { id } → { ok: true }
//                    Scoped by the token's property_id. Replaces the
//                    anon-UPDATE policy on marketing_consents (Phase 3
//                    revokes that policy).
//
// Rate-limit:
//   - `send` : 60 calls / session / rolling hour (endpoint='chat_write')
//   - `checkin_lookup` : 10 calls / session / rolling hour
//     (endpoint='checkin_lookup')
//   - `checkin_insert` / `checkin_update` : counted as endpoint=
//     'checkin_write' with no cap today — the api_usage row is written
//     so a future round can turn on throttling without a schema change.
//
// The controlling rule, same as Round 34: property_id and booking_code
// come from the TOKEN PAYLOAD ONLY. If the body contains them, they are
// ignored, and if they disagree a warning line is logged (attack signal
// for future admin review).

import { verifyFromAuthHeader } from './_guest-token.js';
import { applyCors } from './_cors.js';
import { notifyHostForChatInsert } from './_notify-host.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_MESSAGE_LEN = 4000;
const SEND_HOURLY_LIMIT_PER_SESSION = 60;
const HISTORY_LIMIT = 50;
const POLL_LIMIT    = 5;

export default async function handler(req, res) {
  // Origin / CORS — Round 34.2: shared api/_cors.js.
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Token auth. Everything below trusts only the token payload.
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const v = verifyFromAuthHeader(auth);
  if (!v.ok) return res.status(401).json({ error: 'Invalid or missing guest token' });
  const propertyId = v.payload.p;
  const sessionId  = v.payload.s;
  const bookingCode = v.payload.b || null;  // may be null for pre-checkin
  // Round 34.4: is_test flag from the token — a guest app opened with
  // ?test=1 mints its token with t:true, and every write from that
  // session gets flagged so it never surfaces in the host dashboard.
  const isTest = v.payload.t === true;

  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured (service key)' });

  const body = req.body || {};
  const action = String(body.action || '').toLowerCase();

  // Body-vs-token divergence detection — the plan calls this out as an
  // attack signal worth logging even though we ignore the body values.
  if (body.property_id && body.property_id !== propertyId) {
    console.warn('[guest] token/body property_id mismatch',
      { token: propertyId, body: body.property_id, session: sessionId });
  }
  if (body.booking_code && body.booking_code !== bookingCode) {
    console.warn('[guest] token/body booking_code mismatch',
      { token: bookingCode, body: body.booking_code, session: sessionId });
  }

  try {
    if (action === 'history')          return await doHistory(res, propertyId, bookingCode);
    if (action === 'send')             return await doSend(res, propertyId, bookingCode, sessionId, body, isTest);
    if (action === 'poll')             return await doPoll(res, propertyId, bookingCode, body);
    // Round 48 Phase 2 — guest-visible resources
    if (action === 'property')         return await doProperty(res, propertyId, bookingCode, isTest);
    if (action === 'checkin_list')     return await doCheckinList(res, propertyId, bookingCode, isTest);
    if (action === 'checkin_insert')   return await doCheckinInsert(res, propertyId, bookingCode, sessionId, body, isTest);
    if (action === 'checkin_update')   return await doCheckinUpdate(res, propertyId, bookingCode, sessionId, body, isTest);
    if (action === 'checkin_lookup')   return await doCheckinLookup(res, propertyId, sessionId, body, isTest);
    if (action === 'consent_withdraw') return await doConsentWithdraw(res, propertyId, body);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[guest] exception in action=', action, e);
    return res.status(500).json({ error: 'guest gateway error', detail: String(e) });
  }
}

// ── action: history ───────────────────────────────────────────────────
async function doHistory(res, propertyId, bookingCode) {
  const clauses = buildScopeClauses(propertyId, bookingCode);
  const path = `chat_messages?select=id,sender,message,booking_code,created_at`
             + `&${clauses}`
             + `&order=created_at.asc&limit=${HISTORY_LIMIT}`;
  const r = await pgrestGET(path);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return res.status(500).json({ error: 'history query failed', detail: t });
  }
  const rows = await r.json();
  return res.status(200).json({ messages: rows });
}

// ── action: send ──────────────────────────────────────────────────────
async function doSend(res, propertyId, bookingCode, sessionId, body, isTest) {
  const message = String(body.message || '').trim();
  const sender  = String(body.sender  || 'guest').toLowerCase();

  // A guest client must never be able to insert a `host` message. Only
  // guest/bot/system allowed. host messages are inserted by the host
  // console, which authenticates through Supabase Auth and its own RLS.
  if (!['guest', 'bot', 'system'].includes(sender)) {
    return res.status(400).json({ error: 'Invalid sender' });
  }
  if (!message) return res.status(400).json({ error: 'Empty message' });
  if (message.length > MAX_MESSAGE_LEN) {
    return res.status(413).json({ error: 'Message too long', max_length: MAX_MESSAGE_LEN });
  }

  // Rate-limit sends. Reads are free — writes are the write channel we
  // want to keep small even for a legitimate misconfigured client loop.
  const gate = await checkSendRateLimit(sessionId);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retry_after_seconds));
    return res.status(429).json({
      error: 'Too many chat sends. Please wait a moment and try again.',
      retry_after_seconds: gate.retry_after_seconds,
    });
  }

  const row = {
    property_id: propertyId,
    booking_code: bookingCode,
    sender,
    message,
    is_test: isTest === true,  // Round 34.4: sourced from token payload
  };
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!insRes.ok) {
    const t = await insRes.text().catch(() => '');
    return res.status(500).json({ error: 'insert failed', detail: t });
  }
  const [inserted] = await insRes.json();

  // Record the send in api_usage under endpoint='chat_write'. Await it —
  // R33.1 lesson: fire-and-forget promises get cancelled on Vercel
  // serverless when the handler returns.
  try {
    await recordUsage({
      property_id: propertyId,
      session_id: sessionId,
      endpoint: 'chat_write',
      input_tokens: 0,
      output_tokens: 0,
    });
  } catch (e) { console.warn('[guest] api_usage insert failed:', e); }

  // Round 42 — host notification pipeline. Fixed payload (no guest data)
  // over push / telegram / email based on the host's settings. Awaited so
  // Vercel doesn't cancel the mid-flight fetches; the guest client doesn't
  // await this endpoint anyway, so the added latency is invisible.
  try {
    await notifyHostForChatInsert({
      propertyId,
      bookingCode,
      sender,
      message,
      isTest: isTest === true,
    });
  } catch (e) { console.warn('[guest] notifyHostForChatInsert failed:', e); }

  return res.status(200).json({ ok: true, id: inserted?.id });
}

// ── action: poll ──────────────────────────────────────────────────────
// Returns host/system messages newer than the cursor. The guest UI uses
// this to render responses without a full page refresh.
async function doPoll(res, propertyId, bookingCode, body) {
  const since = String(body.since || '').trim();
  if (!since || Number.isNaN(new Date(since).getTime())) {
    return res.status(400).json({ error: 'since (ISO timestamp) required' });
  }
  const clauses = buildScopeClauses(propertyId, bookingCode);
  // sender=in.(host,system) — only server-side / host replies. The guest's
  // own messages are already on their screen.
  const path = `chat_messages?select=id,sender,message,booking_code,created_at`
             + `&${clauses}`
             + `&sender=in.(host,system)`
             + `&created_at=gt.${encodeURIComponent(since)}`
             + `&order=created_at.asc&limit=${POLL_LIMIT}`;
  const r = await pgrestGET(path);
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return res.status(500).json({ error: 'poll query failed', detail: t });
  }
  const rows = await r.json();
  return res.status(200).json({ messages: rows });
}

// ── Scope: build PostgREST clauses that pin the query to the token's
// property + booking-code bucket, and hide test/soft-deleted rows.
// If the token carries a booking_code, filter to it exactly. Otherwise
// filter to the empty-string/null bucket (Round 28: the column had a
// non-null default and legacy rows exist).
function buildScopeClauses(propertyId, bookingCode) {
  const base = `property_id=eq.${encodeURIComponent(propertyId)}`
             + `&is_test=eq.false`
             + `&deleted_at=is.null`;
  if (bookingCode) {
    return base + `&booking_code=eq.${encodeURIComponent(bookingCode)}`;
  }
  // Pre-checkin / no-code guest: match null OR empty string.
  return base + `&or=(booking_code.is.null,booking_code.eq.)`;
}

// ── Rate limit: 60 sends/session/rolling hour, via api_usage row count
async function checkSendRateLimit(sessionId) {
  if (!sessionId) return { ok: true }; // shouldn't happen — token requires session
  const hourAgoISO = new Date(Date.now() - 3600 * 1000).toISOString();
  try {
    const r = await pgrestGET(
      `api_usage?session_id=eq.${encodeURIComponent(sessionId)}`
      + `&endpoint=eq.chat_write&created_at=gte.${encodeURIComponent(hourAgoISO)}`
      + `&select=id`,
      { headers: { Prefer: 'count=exact' } },
    );
    if (!r.ok) return { ok: true };  // fail-open on Supabase blip
    const count = readCount(r.headers.get('content-range'), await r.json());
    if (count >= SEND_HOURLY_LIMIT_PER_SESSION) {
      return { ok: false, retry_after_seconds: 900 };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[guest] rate-limit check failed, allowing through:', e);
    return { ok: true };
  }
}

function readCount(rangeHeader, dataFallback) {
  if (rangeHeader) {
    const m = rangeHeader.match(/\/(\d+)$/);
    if (m) return Number(m[1]);
  }
  return Array.isArray(dataFallback) ? dataFallback.length : 0;
}

// ── PostgREST helper (origin lives in api/_cors.js since Round 34.2) ───
async function pgrestGET(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function recordUsage(row) {
  if (!SERVICE_KEY) return;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  if (!r.ok) {
    console.warn('[guest] api_usage insert failed:', r.status, await r.text().catch(() => ''));
  }
}

// ═════════════════════════════════════════════════════════════════════
// Round 48 Phase 2 — guest-visible resources
// ═════════════════════════════════════════════════════════════════════

// Fields the guest UI reads from `properties`. Everything that isn't
// in this allowlist is dropped before the response leaves the server.
// Keep in sync with index.html's propData.* reads (survey date 2026-10-05).
const PROPERTY_PUBLIC_FIELDS = [
  'id', 'name', 'city', 'region', 'address', 'zip', 'hero_image_url',
  'maps_link', 'welcome_message',
  'host_names', 'host_phone',
  'checkin_time', 'checkout_time',
  'access_method',
  'wifi_name', 'wifi_password',
  'show_fixed_lockbox_to_guest', 'show_rotating_lockbox_to_guest',
  'use_per_guest_lockbox',
  'rotating_lockbox_enabled', 'rotating_lockbox_length',
];
// Fields revealed only AFTER the booking has at least one check-in row.
// Everything else above is visible from the booking link onwards.
const PROPERTY_POST_CHECKIN_FIELDS = new Set([
  'wifi_name', 'wifi_password', 'access_method',
]);
// Columns the guest form writes. Narrows what checkin_insert and
// checkin_update accept so no caller can set alloggiati_status,
// filed_at, deleted_at, id/booking_code, etc.
const CHECKIN_WRITE_FIELDS = [
  'guest_type', 'surname', 'name', 'sex', 'date_of_birth',
  'place_of_birth', 'birth_province', 'birth_country',
  'citizenship', 'document_type', 'document_number', 'doc_issue_place',
  'arrival_date', 'departure_date', 'nights',
  'id_photo_path', 'docs_status',
  'residence_country', 'residence_place',
];
// Columns we return to the guest for the welcome-back + edit flows.
// Deliberately omits id_photo_path — guest never needs the storage key.
const CHECKIN_READ_FIELDS = [
  'id', 'guest_type', 'surname', 'name', 'sex', 'date_of_birth',
  'place_of_birth', 'birth_province', 'birth_country',
  'citizenship', 'document_type', 'document_number', 'doc_issue_place',
  'arrival_date', 'departure_date', 'nights',
  'docs_status', 'alloggiati_status', 'filed_at',
  'checkin_reopened_at', 'residence_country', 'residence_place',
  'booking_code', 'submitted_at', 'keybox_code',
];

const CHECKIN_LOOKUP_HOURLY_LIMIT_PER_SESSION = 10;
const WALKIN_PREFIX = 'WB-';

// ── action: property ──────────────────────────────────────────────────
async function doProperty(res, propertyId, bookingCode, isTest) {
  const r = await pgrestGET(
    `properties?id=eq.${encodeURIComponent(propertyId)}` +
    `&deleted_at=is.null&select=*&limit=1`
  );
  if (!r.ok) return res.status(500).json({ error: 'property query failed' });
  const [row] = await r.json();
  if (!row) return res.status(404).json({ error: 'property not found' });

  // Does this booking have any guests yet? Keybox + wifi are gated
  // behind "check-in complete" per today's UI behaviour.
  const hasCheckin = await bookingHasCheckin(propertyId, bookingCode, isTest);

  const out = {};
  for (const k of PROPERTY_PUBLIC_FIELDS) {
    if (PROPERTY_POST_CHECKIN_FIELDS.has(k) && !hasCheckin) continue;
    if (row[k] !== undefined) out[k] = row[k];
  }
  return res.status(200).json({ property: out, checked_in: hasCheckin });
}

async function bookingHasCheckin(propertyId, bookingCode, isTest) {
  const base =
    `checkins?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&is_test=eq.${isTest === true ? 'true' : 'false'}` +
    `&deleted_at=is.null&select=id&limit=1`;
  const scoped = bookingCode
    ? base + `&booking_code=eq.${encodeURIComponent(bookingCode)}`
    : base + `&or=(booking_code.is.null,booking_code.eq.)`;
  const r = await pgrestGET(scoped);
  if (!r.ok) return false;
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

// ── action: checkin_list ──────────────────────────────────────────────
async function doCheckinList(res, propertyId, bookingCode, isTest) {
  const scope = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `or=(booking_code.is.null,booking_code.eq.)`;
  const sel = CHECKIN_READ_FIELDS.join(',');
  const path =
    `checkins?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&is_test=eq.${isTest === true ? 'true' : 'false'}` +
    `&deleted_at=is.null` +
    `&${scope}` +
    `&select=${sel}&order=submitted_at.asc`;
  const r = await pgrestGET(path);
  if (!r.ok) return res.status(500).json({ error: 'checkin_list query failed' });
  const rows = await r.json();
  // Server-computed editable flag so the client can't lie about state.
  const guests = rows.map(row => ({
    ...row,
    editable: row.alloggiati_status !== 'filed' && row.alloggiati_status !== 'correction',
  }));
  // Also expose the reopen flag from ota_reservations if the booking has one.
  let reopened_at = null;
  if (bookingCode) {
    const otaRes = await pgrestGET(
      `ota_reservations?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&booking_code=eq.${encodeURIComponent(bookingCode)}` +
      `&select=checkin_reopened_at&limit=1`
    );
    if (otaRes.ok) {
      const [r0] = await otaRes.json();
      reopened_at = r0?.checkin_reopened_at || null;
    }
  }
  return res.status(200).json({ guests, reopened_at });
}

// ── action: checkin_insert ────────────────────────────────────────────
async function doCheckinInsert(res, propertyId, incomingBookingCode, sessionId, body, isTest) {
  const inRecord = body.record || {};
  const errors = validateCheckinRecord(inRecord, { requireAll: true });
  if (errors.length) return res.status(400).json({ error: 'validation_failed', fields: errors });

  // Walk-in mint when the token has no booking code.
  let bookingCode = incomingBookingCode;
  if (!bookingCode) bookingCode = mintWalkinCode();

  const row = pickFields(inRecord, CHECKIN_WRITE_FIELDS);
  row.property_id  = propertyId;
  row.booking_code = bookingCode;
  row.is_test      = isTest === true;
  row.submitted_at = new Date().toISOString();

  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/checkins`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  if (!insRes.ok) {
    const t = await insRes.text().catch(() => '');
    return res.status(500).json({ error: 'checkin_insert failed', detail: t });
  }
  const [inserted] = await insRes.json();

  // Side effect A — clear checkin_reopened_at on checkins + ota_reservations.
  // Round 36 reopen flag: when a host unlocks the booking for the guest to
  // add a late arrival, this flag goes up on both tables; successful insert
  // clears it. The client used to attempt these updates with the anon key
  // but had no UPDATE policy — the update silently no-op'd. Now it works.
  try {
    await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/ota_reservations?property_id=eq.${encodeURIComponent(propertyId)}&booking_code=eq.${encodeURIComponent(bookingCode)}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ checkin_reopened_at: null }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/checkins?property_id=eq.${encodeURIComponent(propertyId)}&booking_code=eq.${encodeURIComponent(bookingCode)}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal',
        },
        body: JSON.stringify({ checkin_reopened_at: null }),
      }),
    ]);
  } catch (e) { console.warn('[guest] reopen clear failed (non-fatal):', e.message); }

  // Side effect B — rotating keybox stamp. If the property has rotating
  // keybox and the main guest row didn't carry a keybox_code, call the
  // SECURITY DEFINER RPC which assigns the stable code for the booking.
  // (The client-side logic that previously handled this is being removed
  // in the same PR.)
  if (row.guest_type === 'single' || row.guest_type === 'head' || row.guest_type === 'group') {
    try {
      const kbRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_reservation_keybox`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_property_id: propertyId, p_booking_code: bookingCode }),
      });
      if (kbRes.ok) {
        const code = await kbRes.json();
        if (code && typeof code === 'string') {
          await fetch(`${SUPABASE_URL}/rest/v1/checkins?id=eq.${encodeURIComponent(inserted.id)}`, {
            method: 'PATCH',
            headers: {
              apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json', Prefer: 'return=minimal',
            },
            body: JSON.stringify({ keybox_code: code }),
          });
        }
      }
    } catch (e) { console.warn('[guest] rotating keybox stamp failed (non-fatal):', e.message); }
  }

  // Count under endpoint='checkin_write' for future throttling.
  try {
    await recordUsage({
      property_id: propertyId, session_id: sessionId,
      endpoint: 'checkin_write', input_tokens: 0, output_tokens: 0,
    });
  } catch (_) {}

  return res.status(200).json({ id: inserted.id, booking_code: bookingCode });
}

// ── action: checkin_update ────────────────────────────────────────────
async function doCheckinUpdate(res, propertyId, bookingCode, sessionId, body, isTest) {
  const id = String(body.id || '').trim();
  const fields = body.fields || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const errors = validateCheckinRecord(fields, { requireAll: false });
  if (errors.length) return res.status(400).json({ error: 'validation_failed', fields: errors });

  const patch = pickFields(fields, CHECKIN_WRITE_FIELDS);
  patch.guest_edited_at = new Date().toISOString();

  // Conditional PATCH. The filters pin us to the token's property +
  // booking, and alloggiati_status=neq.filed enforces "editable until
  // filed". Prefer: return=representation lets us tell "no row updated"
  // (filed → 409) apart from "row updated".
  const scope = bookingCode
    ? `&booking_code=eq.${encodeURIComponent(bookingCode)}`
    : '';
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/checkins?id=eq.${encodeURIComponent(id)}` +
    `&property_id=eq.${encodeURIComponent(propertyId)}` +
    scope +
    `&alloggiati_status=neq.filed`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    }
  );
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return res.status(500).json({ error: 'checkin_update failed', detail: t });
  }
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(409).json({ error: 'already_filed' });
  }
  const updated = rows[0];

  // If the main guest changed arrival/departure, fan the change out to
  // every row in the same booking. We only recognise this when the
  // updated row's guest_type is a main-guest kind and the fields set
  // includes arrival_date or departure_date.
  const mainGuestKinds = new Set(['single', 'head', 'group']);
  if (bookingCode && mainGuestKinds.has(updated.guest_type) &&
      ('arrival_date' in patch || 'departure_date' in patch)) {
    const fanPatch = {};
    if ('arrival_date' in patch)   fanPatch.arrival_date   = patch.arrival_date;
    if ('departure_date' in patch) fanPatch.departure_date = patch.departure_date;
    if ('nights' in patch)         fanPatch.nights         = patch.nights;
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/checkins` +
        `?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&booking_code=eq.${encodeURIComponent(bookingCode)}` +
        `&alloggiati_status=neq.filed` +
        `&id=neq.${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json', Prefer: 'return=minimal',
          },
          body: JSON.stringify(fanPatch),
        }
      );
    } catch (e) { console.warn('[guest] booking date fan-out failed:', e.message); }
  }

  try {
    await recordUsage({
      property_id: propertyId, session_id: sessionId,
      endpoint: 'checkin_write', input_tokens: 0, output_tokens: 0,
    });
  } catch (_) {}

  // Strip the id_photo_path from the response (guest never needs the
  // storage key); the request didn't include it in the whitelist so
  // it can't have been written, but belt-and-braces.
  const out = {};
  for (const k of CHECKIN_READ_FIELDS) if (updated[k] !== undefined) out[k] = updated[k];
  out.editable = updated.alloggiati_status !== 'filed' && updated.alloggiati_status !== 'correction';
  return res.status(200).json({ updated: out });
}

// ── action: checkin_lookup ────────────────────────────────────────────
async function doCheckinLookup(res, propertyId, sessionId, body, isTest) {
  const surname = String(body.surname || '').trim();
  const arrivalDate = String(body.arrival_date || '').trim();
  if (!surname || !arrivalDate) {
    return res.status(400).json({ error: 'surname and arrival_date required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)) {
    return res.status(400).json({ error: 'arrival_date must be ISO yyyy-mm-dd' });
  }

  // Rate limit — 10 per session per rolling hour. If this trips, a bot
  // sweeping surnames can't learn booking codes faster than that cap.
  const gate = await checkLookupRateLimit(sessionId);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retry_after_seconds));
    return res.status(429).json({ error: 'rate_limited', retry_after_seconds: gate.retry_after_seconds });
  }

  // Case-insensitive exact match on surname (not ilike '%...%' — exact
  // match of the whole string, lowered). PostgREST ilike with no
  // wildcard IS an exact-case-insensitive match.
  const path =
    `checkins?property_id=eq.${encodeURIComponent(propertyId)}` +
    `&arrival_date=eq.${encodeURIComponent(arrivalDate)}` +
    `&surname=ilike.${encodeURIComponent(surname)}` +
    `&is_test=eq.${isTest === true ? 'true' : 'false'}` +
    `&deleted_at=is.null` +
    `&select=booking_code`;
  const r = await pgrestGET(path);
  try {
    await recordUsage({
      property_id: propertyId, session_id: sessionId,
      endpoint: 'checkin_lookup', input_tokens: 0, output_tokens: 0,
    });
  } catch (_) {}
  if (!r.ok) return res.status(500).json({ error: 'checkin_lookup failed' });
  const rows = await r.json();
  // Pick the first matching booking_code; count how many rows share it.
  const byCode = new Map();
  for (const row of rows) {
    const k = row.booking_code || null;
    byCode.set(k, (byCode.get(k) || 0) + 1);
  }
  if (byCode.size === 0) return res.status(200).json({ found: false });
  // If multiple codes match, surface the one with the most rows (same
  // booking most likely). No PII returned.
  let bestCode = null, bestN = -1;
  for (const [k, n] of byCode) if (n > bestN) { bestCode = k; bestN = n; }
  return res.status(200).json({
    found: true,
    property_id: propertyId,
    booking_code: bestCode,
    guests: bestN,
  });
}

async function checkLookupRateLimit(sessionId) {
  if (!sessionId) return { ok: true };
  const hourAgoISO = new Date(Date.now() - 3600 * 1000).toISOString();
  try {
    const r = await pgrestGET(
      `api_usage?session_id=eq.${encodeURIComponent(sessionId)}` +
      `&endpoint=eq.checkin_lookup&created_at=gte.${encodeURIComponent(hourAgoISO)}` +
      `&select=id`,
      { headers: { Prefer: 'count=exact' } },
    );
    if (!r.ok) return { ok: true };
    const count = readCount(r.headers.get('content-range'), await r.json());
    if (count >= CHECKIN_LOOKUP_HOURLY_LIMIT_PER_SESSION) {
      return { ok: false, retry_after_seconds: 900 };
    }
    return { ok: true };
  } catch (_) { return { ok: true }; }
}

// ── action: consent_withdraw ──────────────────────────────────────────
async function doConsentWithdraw(res, propertyId, body) {
  const id = String(body.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });

  // Scoped by property_id so a token for property A can't withdraw a
  // consent that belongs to property B.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/marketing_consents?id=eq.${encodeURIComponent(id)}` +
    `&property_id=eq.${encodeURIComponent(propertyId)}` +
    `&withdrawn_at=is.null`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
      body: JSON.stringify({ withdrawn_at: new Date().toISOString() }),
    }
  );
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    return res.status(500).json({ error: 'consent_withdraw failed', detail: t });
  }
  const rows = await r.json();
  return res.status(200).json({ ok: Array.isArray(rows) && rows.length > 0 });
}

// ── helpers ───────────────────────────────────────────────────────────

function pickFields(obj, allow) {
  const out = {};
  for (const k of allow) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
    else if (obj[k] === null) out[k] = null;
  }
  return out;
}

function validateCheckinRecord(rec, { requireAll }) {
  const errors = [];
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const req = (f) => { if (!str(rec[f])) errors.push(f); };
  if (requireAll) {
    ['surname', 'name', 'sex', 'date_of_birth', 'citizenship'].forEach(req);
  }
  // Any field present must be sane. Lengths come from the Alloggiati
  // tracciato (50/30/9) so a user can't blow past the format at submit.
  if (rec.surname && str(rec.surname).length > 50) errors.push('surname');
  if (rec.name    && str(rec.name).length    > 30) errors.push('name');
  if (rec.sex     && !['M', 'F'].includes(str(rec.sex).toUpperCase())) errors.push('sex');
  for (const d of ['date_of_birth', 'arrival_date', 'departure_date']) {
    if (rec[d] && !/^\d{4}-\d{2}-\d{2}$/.test(String(rec[d]))) errors.push(d);
  }
  if (rec.arrival_date && rec.departure_date) {
    const a = Date.parse(rec.arrival_date), b = Date.parse(rec.departure_date);
    if (Number.isFinite(a) && Number.isFinite(b) && b <= a) errors.push('departure_before_arrival');
  }
  if (rec.nights != null) {
    const n = Number(rec.nights);
    if (!Number.isInteger(n) || n < 1 || n > 99) errors.push('nights');
  }
  if (rec.id_photo_path && !String(rec.id_photo_path).startsWith('id-photos/')) {
    errors.push('id_photo_path');
  }
  return errors;
}

// Crockford base32 — unambiguous human-readable, 8 chars = 40 bits of
// entropy. `WB-` prefix mirrors the OTA-side pattern (TRU-, ALB-, …).
function mintWalkinCode() {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * 32)];
  return WALKIN_PREFIX + s;
}
