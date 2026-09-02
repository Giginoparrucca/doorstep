// api/_guest-token.js — Round 33
//
// Shared HMAC signer + verifier for guest-session tokens.
//
// A guest session token binds every AI request (chat.js, scan-document.js,
// and Round 34's guest-chat.js) to a specific property. The token is
// server-issued after the client hits /api/guest-token with the property_id
// it already knows from the guest link. The point isn't secrecy — the
// property UUID is already in the URL. The point is that from that moment
// on, the request's identity comes from the *token payload*, not the
// request body, so an attacker can't rebind their session to somebody
// else's property by editing the body.
//
// Token format:  <base64url(payload_json)>.<base64url(hmac_sha256_sig)>
// Payload: { p: property_id, s: session_id, b: booking_code|null, exp: unix_seconds }
//
// Uses node:crypto only — no npm dependency, matches the /api convention.
//
// Env: GUEST_TOKEN_SECRET — any long random string. Fails closed if unset.

import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.GUEST_TOKEN_SECRET;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  // pad back to a multiple of 4
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, '+').replace(/_/g, '/') + pad,
    'base64',
  );
}

function assertSecret() {
  if (!SECRET) {
    throw new Error('GUEST_TOKEN_SECRET env var is not set');
  }
}

// Sign a payload. Callers pass p / s / b / exp explicitly. `exp` is unix
// seconds; if omitted, defaults to now + 12h.
export function signGuestToken({ p, s, b = null, exp }) {
  assertSecret();
  if (!p || typeof p !== 'string') throw new Error('signGuestToken: p (property_id) required');
  if (!s || typeof s !== 'string') throw new Error('signGuestToken: s (session_id) required');
  const now = Math.floor(Date.now() / 1000);
  const payload = { p, s, b: b || null, exp: exp || (now + 12 * 3600) };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(payloadB64).digest();
  const sigB64 = b64urlEncode(sig);
  return {
    token: `${payloadB64}.${sigB64}`,
    payload,
  };
}

// Verify a token string. Returns { ok: true, payload } on success or
// { ok: false, error } on any failure (bad shape, bad sig, expired,
// missing secret). Never throws for the caller — errors are structured
// so the endpoint can return a clean 401 without leaking specifics to
// the wire beyond a generic "Invalid token".
export function verifyGuestToken(token) {
  if (!SECRET)                 return { ok: false, error: 'no-secret' };
  if (!token || typeof token !== 'string') return { ok: false, error: 'no-token' };
  const parts = token.split('.');
  if (parts.length !== 2)      return { ok: false, error: 'malformed' };
  const [payloadB64, sigB64] = parts;

  // Recompute signature over the payload and constant-time compare.
  let expected;
  try {
    expected = createHmac('sha256', SECRET).update(payloadB64).digest();
  } catch (e) { return { ok: false, error: 'sig-compute-failed' }; }

  let provided;
  try {
    provided = b64urlDecode(sigB64);
  } catch (e) { return { ok: false, error: 'sig-decode-failed' }; }

  if (provided.length !== expected.length) return { ok: false, error: 'sig-mismatch' };
  if (!timingSafeEqual(provided, expected)) return { ok: false, error: 'sig-mismatch' };

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch (e) { return { ok: false, error: 'payload-decode-failed' }; }

  if (!payload || typeof payload !== 'object') return { ok: false, error: 'payload-shape' };
  if (!payload.p || !payload.s || !payload.exp) return { ok: false, error: 'payload-fields' };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, error: 'expired' };

  return { ok: true, payload };
}

// Convenience for endpoint code: read the token off the Authorization
// header and verify it in one step.
export function verifyFromAuthHeader(authHeader) {
  const auth = authHeader || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return verifyGuestToken(token);
}
