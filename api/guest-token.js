// api/guest-token.js — guest session token mint endpoint.
//
// Round 33: introduced; POST /api/guest-token with { property_id,
// session_id, booking_code? } returns a 12h HMAC-signed token that the
// client sends as Authorization: Bearer to chat.js / scan-document.js /
// guest-chat.js.
//
// Round 34.2: three defects fixed here.
//   (1) Fail closed on disallowed Origin. The earlier code fell back to
//       `Access-Control-Allow-Origin: https://welcomebnb.vercel.app` and
//       minted a token anyway, so a plain curl with no Origin header got
//       a valid token — and 200/404 turned this into a free
//       property-existence oracle for anyone who could guess a UUID.
//   (2) Origin allowlist moved into api/_cors.js; the previous
//       .vercel.app regex allowed every deployment on Vercel.
//   (3) Rate-limit token mints (20 per session_id per rolling hour) so
//       an attacker with no auth can't spin the property-existence
//       oracle either.
//
// This is not a secret-keeping mechanism — property_id is already public
// in the guest URL. The token exists so every AI request is
// attributable to a specific property (meterable, cuttable) instead of
// being an anonymous open POST.
//
// Env: GUEST_TOKEN_SECRET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL.

import { signGuestToken } from './_guest-token.js';
import { applyCors } from './_cors.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Round 34.2 — mint limit per rolling hour per session_id. Deliberately
// low; a legitimate guest re-mints at most a few times per session (page
// reload, booking_code resolution, 401 retry). 20 is comfortable headroom
// but nowhere near enough for the oracle attack this closes.
const MINT_HOURLY_LIMIT_PER_SESSION = 20;

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.GUEST_TOKEN_SECRET) {
    console.error('[guest-token] GUEST_TOKEN_SECRET is not set — refusing to mint');
    return res.status(500).json({ error: 'Token minting is not configured' });
  }
  if (!SERVICE_KEY) {
    console.error('[guest-token] SUPABASE_SERVICE_ROLE_KEY is not set — cannot verify property');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { property_id, session_id, booking_code, is_test } = req.body || {};
  if (!property_id || typeof property_id !== 'string') {
    return res.status(400).json({ error: 'property_id required' });
  }
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }
  const bc = booking_code && typeof booking_code === 'string' ? booking_code : null;
  // Round 34.4: is_test carried into the token payload so guest-chat and
  // api_usage can tag rows without trusting the request body of a
  // subsequent call. Coerced to a strict boolean.
  const t = is_test === true;

  // Rate-limit BEFORE the DB lookup so a limited-out caller can't use
  // this endpoint as a property-existence oracle either.
  const gate = await checkMintRateLimit(session_id);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retry_after_seconds));
    return res.status(429).json({
      error: 'Too many token mints for this session. Please wait a moment.',
      retry_after_seconds: gate.retry_after_seconds,
    });
  }

  // Verify the property exists and hasn't been soft-deleted. This is the
  // single "does the caller's URL point somewhere real" gate.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(property_id)}` +
      `&deleted_at=is.null&select=id`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: 'application/json',
        },
      },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[guest-token] property lookup failed', r.status, t);
      return res.status(500).json({ error: 'Property lookup failed' });
    }
    const rows = await r.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
  } catch (e) {
    console.error('[guest-token] property lookup exception', e);
    return res.status(500).json({ error: 'Property lookup exception' });
  }

  const { token, payload } = signGuestToken({ p: property_id, s: session_id, b: bc, t });

  // Record this mint against the rate-limit tally. NOTE: recordUsage
  // swallows insert failures with console.warn, so if the api_usage
  // CHECK constraint is ever narrowed and 'token_mint' becomes invalid
  // again, this call will silently no-op and the rate limit will be
  // disabled. See migration_round34_1_api_usage_endpoint.sql.
  try {
    await recordUsage({
      property_id,
      session_id,
      endpoint: 'token_mint',
      input_tokens: 0,
      output_tokens: 0,
    });
  } catch (e) { console.warn('[guest-token] api_usage insert failed:', e); }

  return res.status(200).json({
    token,
    expires_at: new Date(payload.exp * 1000).toISOString(),
  });
}

// Round 34.2 — mirrors the pattern in api/chat.js checkChatLimits and
// api/scan-document.js checkScanLimits. Fail OPEN on Supabase blip so a
// network hiccup can't lock the app out of minting; only positive limit
// hits produce a 429.
async function checkMintRateLimit(sessionId) {
  if (!sessionId) return { ok: true };
  const hourAgoISO = new Date(Date.now() - 3600 * 1000).toISOString();
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/api_usage?session_id=eq.${encodeURIComponent(sessionId)}` +
      `&endpoint=eq.token_mint&created_at=gte.${encodeURIComponent(hourAgoISO)}` +
      `&select=id`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: 'application/json',
          Prefer: 'count=exact',
        },
      },
    );
    if (!r.ok) return { ok: true };
    const rows = await r.json().catch(() => []);
    const range = r.headers.get('content-range') || '';
    let count = Array.isArray(rows) ? rows.length : 0;
    const m = range.match(/\/(\d+)$/);
    if (m) count = Number(m[1]);
    if (count >= MINT_HOURLY_LIMIT_PER_SESSION) {
      return { ok: false, retry_after_seconds: 900 };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[guest-token] rate-limit check failed, allowing through:', e);
    return { ok: true };
  }
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
    console.warn('[guest-token] api_usage insert failed:', r.status, await r.text().catch(() => ''));
  }
}
