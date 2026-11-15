// Round 72 Phase 2 — billing state on the server.
//
// One question for every choke point: "is the owner of this property
// read-only?" The answer comes from the database (rpc billing_access_state
// with the service role), the same rule the console and RLS use.
//
// Principle: billing never blocks guests who already have a link, never
// blocks Alloggiati filing, and never blocks anything when the state cannot
// be read (fail open: a Supabase blip must not stop a check-in). Before
// launch (billing_settings.launch_at NULL) every state is 'prelaunch'.
import { supabaseAuthHeaders } from './_supabase-auth.js';
import { SUPABASE_URL } from './_environment.js';

const CACHE_MS = 60 * 1000;
const cache = new Map(); // owner_id → { at, state }

export const READ_ONLY_MESSAGE = Object.freeze({
  it: 'Account in sola lettura: la prova o l’abbonamento sono scaduti. Abbonati per creare nuovi link e prenotazioni.',
  en: 'Read-only account: the trial or subscription has ended. Subscribe to create new links and reservations.',
});

export function readOnlyBody() {
  return { error: 'read_only', message_it: READ_ONLY_MESSAGE.it, message_en: READ_ONLY_MESSAGE.en };
}

export function _resetBillingCache() { cache.clear(); }

// State of one user ('prelaunch' | 'free' | 'active' | 'trial' | 'grace' |
// 'read_only' | 'none' | 'unknown'). 'unknown' on any error.
export async function ownerBillingState(ownerId, deps = {}) {
  if (!ownerId) return 'unknown';
  const now = deps.now ? deps.now() : Date.now();
  const hit = cache.get(ownerId);
  if (hit && now - hit.at < CACHE_MS) return hit.state;
  const f = deps.fetch || globalThis.fetch;
  const key = deps.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/rpc/billing_access_state`, {
      method: 'POST',
      headers: { ...supabaseAuthHeaders(key), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_user: ownerId, p_now: new Date(now).toISOString() }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return 'unknown';
    const j = await r.json();
    const state = typeof j?.state === 'string' ? j.state : 'unknown';
    cache.set(ownerId, { at: now, state });
    return state;
  } catch (_) {
    return 'unknown';
  }
}

export async function propertyOwnerId(propertyId, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const key = deps.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=owner_id&limit=1`, {
      headers: { ...supabaseAuthHeaders(key), Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const [row] = await r.json();
    return row?.owner_id || null;
  } catch (_) { return null; }
}

// True only when the owner is positively read-only.
export async function propertyIsReadOnly(propertyId, deps = {}) {
  const owner = deps.ownerId || await propertyOwnerId(propertyId, deps);
  if (!owner) return false;
  return (await ownerBillingState(owner, deps)) === 'read_only';
}
