// api/guest-chat.js — Round 34 guest-chat gateway.
//
// Closes the cross-property chat read leak documented in Round 12.1: the
// guest client used to read `chat_messages` directly with the anon key,
// applying a client-side `.eq('property_id', propertyId)` filter that
// anyone with the anon key (which ships in the client HTML) could simply
// drop and read every host's guest messages.
//
// This endpoint is the only path anon guests have to reach chat_messages
// after Round 34's migration revokes the anon grant. All DB access here
// runs as SUPABASE_SERVICE_ROLE_KEY and the *scope of every query* is
// derived from the signed guest token, never from the request body.
//
// Auth: Authorization: Bearer <guest_token> (Round 33's _guest-token.js).
// Origin: same allowlist as the AI endpoints.
//
// Actions (POST body: { action, ...args }):
//   history        → { messages: [...] }   (most recent 50, ordered ASC)
//   send { message, sender } → { ok: true, id }  (INSERT one chat_messages row)
//   poll { since }           → { messages: [...] } (host/system only,
//                                                   after cursor, max 5)
//
// Rate-limit: 60 send calls per session per rolling hour, tracked in
// api_usage under endpoint='chat_write'. Read paths are unmetered — they
// happen on every page load / poll tick and their cost is trivial.
//
// The controlling rule: property_id and booking_code are read from the
// TOKEN PAYLOAD ONLY. If the body contains them, they are ignored, and if
// they disagree a warning line is logged (attack signal for future admin
// review).

import { verifyFromAuthHeader } from './_guest-token.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_MESSAGE_LEN = 4000;
const SEND_HOURLY_LIMIT_PER_SESSION = 60;
const HISTORY_LIMIT = 50;
const POLL_LIMIT    = 5;

export default async function handler(req, res) {
  // Origin allowlist (mirrors chat.js/scan-document.js).
  const origin = req.headers['origin'] || req.headers['Origin'] || '';
  const allowed = resolveOrigin(origin);
  if (allowed) res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured (service key)' });

  const body = req.body || {};
  const action = String(body.action || '').toLowerCase();

  // Body-vs-token divergence detection — the plan calls this out as an
  // attack signal worth logging even though we ignore the body values.
  if (body.property_id && body.property_id !== propertyId) {
    console.warn('[guest-chat] token/body property_id mismatch',
      { token: propertyId, body: body.property_id, session: sessionId });
  }
  if (body.booking_code && body.booking_code !== bookingCode) {
    console.warn('[guest-chat] token/body booking_code mismatch',
      { token: bookingCode, body: body.booking_code, session: sessionId });
  }

  try {
    if (action === 'history') return await doHistory(res, propertyId, bookingCode);
    if (action === 'send')    return await doSend(res, propertyId, bookingCode, sessionId, body);
    if (action === 'poll')    return await doPoll(res, propertyId, bookingCode, body);
    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) {
    console.error('[guest-chat] exception in action=', action, e);
    return res.status(500).json({ error: 'guest-chat error', detail: String(e) });
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
async function doSend(res, propertyId, bookingCode, sessionId, body) {
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
  } catch (e) { console.warn('[guest-chat] api_usage insert failed:', e); }

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
    console.warn('[guest-chat] rate-limit check failed, allowing through:', e);
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

// ── PostgREST + origin helpers (mirrors chat.js) ──────────────────────
function resolveOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://welcomebnb.vercel.app') return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return null;
}

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
    console.warn('[guest-chat] api_usage insert failed:', r.status, await r.text().catch(() => ''));
  }
}
