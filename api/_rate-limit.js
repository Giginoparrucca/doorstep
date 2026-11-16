// Round 74 Phase 5 — audit WBNB-Y002: one rate limiter for the guest side.
//
// take(scope, key, { windowSeconds, limit, onFailure }) reserves a slot
// atomically in the database (rpc rate_take). Keys are always built here on
// the server — the caller's network address (as set by Vercel, hashed), the
// property or the booking — never a value the client chooses, so changing a
// session ID does not reset anything.
//
// When the counter store cannot be reached:
//   'closed'  → refuse (optional features: booking recovery);
//   'open'    → allow (nothing to protect beyond provider caps);
//   'bounded' → fall back to an in-memory counter per server instance with
//               the same limit, so ordinary check-in keeps working but stays
//               bounded during the outage.
import { createHmac } from 'node:crypto';
import { supabaseAuthHeaders } from './_supabase-auth.js';
import { SUPABASE_URL } from './_environment.js';

const memory = new Map(); // `${scope}|${key}|${window}` → hits
export function _resetMemoryLimiter() { memory.clear(); }

export function clientAddress(req) {
  const h = (req && req.headers) || {};
  return String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim() || null;
}
// HMAC of the address with the service key: the raw IP is never stored.
export function addressKey(req, secret = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const ip = clientAddress(req);
  if (!ip) return null;
  return 'ip:' + createHmac('sha256', String(secret || 'no-key')).update(ip).digest('hex').slice(0, 32);
}

function memoryTake(scope, key, windowSeconds, limit, nowMs) {
  const win = Math.floor(nowMs / 1000 / windowSeconds);
  const k = `${scope}|${key}|${win}`;
  const hits = (memory.get(k) || 0) + 1;
  memory.set(k, hits);
  if (memory.size > 5000) for (const old of [...memory.keys()].slice(0, 1000)) memory.delete(old);
  return { ok: hits <= limit, hits, limit, retry_after: windowSeconds - (Math.floor(nowMs / 1000) % windowSeconds), source: 'memory' };
}

export async function take(scope, key, { windowSeconds = 3600, limit, onFailure = 'bounded' } = {}, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const nowMs = deps.now ? deps.now() : Date.now();
  if (!key) key = 'no-address';
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/rpc/rate_take`, {
      method: 'POST',
      headers: { ...supabaseAuthHeaders(deps.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_scope: scope, p_key: key, p_window_seconds: windowSeconds, p_limit: limit }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) throw new Error('rate_take ' + r.status);
    const j = await r.json();
    if (typeof j?.allowed !== 'boolean') throw new Error('rate_take malformed');
    return { ok: j.allowed, hits: j.hits, limit: j.limit, retry_after: j.retry_after, source: 'db' };
  } catch (_) {
    if (onFailure === 'closed') return { ok: false, retry_after: 300, source: 'unavailable' };
    if (onFailure === 'open') return { ok: true, source: 'unavailable' };
    return memoryTake(scope, key, windowSeconds, limit, nowMs);
  }
}

// Several limits at once; the first refusal wins (all are reserved in order).
export async function takeAll(rules, deps = {}) {
  for (const r of rules) {
    const out = await take(r.scope, r.key, r, deps);
    if (!out.ok) return { ...out, scope: r.scope };
  }
  return { ok: true };
}

// Limits used across the guest side (per hour unless stated).
export const LIMITS = Object.freeze({
  mint_address: 60, mint_property: 1500,
  lookup_address: 10, lookup_property: 30,
  upload_address: 20, upload_property: 150,
  write_address: 120, write_booking: 60,
  event_address: 600,
  chat_address: 60, scan_address: 30,
});
