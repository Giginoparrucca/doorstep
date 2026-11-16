// Round 67 Phase 5 — admin audit log writer (public.admin_access_events via
// rpc admin_audit_record, service role). One helper for every admin path:
// admin-host-health (health read, billing_*, dsar_*, audit_read),
// admin-invite-host, the Alloggiati admin/support paths.
//
// What is recorded: actor (admin id + email), action, outcome, target table
// and ID, a keyed hash of address + browser + route, and metadata made of
// IDs, kinds and counts only. Text values are dropped unless they are short
// identifiers; anything shaped like an email address is refused here and by
// the database.
//
// Writes before a change ('requested') must succeed, or the change does not
// run (auditFirst); results after it are best effort and never hide the
// outcome from the admin.
import { createHmac } from 'node:crypto';
import { supabaseAuthHeaders } from './_supabase-auth.js';
import { SUPABASE_URL } from './_environment.js';
import { clientAddress } from './_rate-limit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAILISH = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const SAFE_TEXT = /^[A-Za-z0-9_.:\-]{1,64}$/;

export function keyedHash(value, secret = process.env.SUPABASE_SERVICE_ROLE_KEY, n = 32) {
  return createHmac('sha256', String(secret || 'no-key')).update(String(value)).digest('hex').slice(0, n);
}
export function fingerprint(req, route) {
  const h = (req && req.headers) || {};
  return keyedHash(`${clientAddress(req) || '-'}|${String(h['user-agent'] || '').slice(0, 300)}|${route}`);
}

// Keep numbers, booleans, null, short identifier-like strings and nested
// objects/arrays of those; drop everything else (free text, names, emails).
export function cleanMetadata(value, depth = 0) {
  if (value == null || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return SAFE_TEXT.test(value) && !EMAILISH.test(value) ? value : undefined;
  if (depth > 3) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map(v => cleanMetadata(v, depth + 1)).filter(v => v !== undefined);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (!SAFE_TEXT.test(k)) continue;
      const c = cleanMetadata(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export async function recordAdminEvent(event, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const targetId = event.targetId == null ? null : String(event.targetId);
  const body = {
    p_actor_id: UUID.test(String(event.actorId || '')) ? event.actorId : null,
    p_actor_email: event.actorEmail ? String(event.actorEmail).slice(0, 320) : null,
    p_action: event.action,
    p_outcome: event.outcome || 'ok',
    p_target_table: event.targetTable || null,
    p_target_id: targetId && !EMAILISH.test(targetId) ? targetId.slice(0, 100) : (targetId ? keyedHash(targetId) : null),
    p_fingerprint: event.req ? fingerprint(event.req, event.route || event.action) : null,
    p_metadata: cleanMetadata(event.metadata || {}) || {},
  };
  const r = await f(`${SUPABASE_URL}/rest/v1/rpc/admin_audit_record`, {
    method: 'POST',
    headers: { ...supabaseAuthHeaders(deps.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error('admin audit ' + r.status);
  return r.json();
}

// Before a change: must be recorded or the change does not run.
export async function auditFirst(event, deps = {}) {
  try { await recordAdminEvent({ ...event, outcome: 'requested' }, deps); return true; }
  catch (e) { console.warn('[admin-audit] not recorded, action refused:', event.action, String(e && e.message || e).slice(0, 120)); return false; }
}
// After: best effort, never throws.
export async function auditAfter(event, deps = {}) {
  try { await recordAdminEvent(event, deps); } catch (e) { console.warn('[admin-audit] result not recorded:', event.action, String(e && e.message || e).slice(0, 120)); }
}

export const AUDIT_UNAVAILABLE = { status: 503, body: { error: 'audit_unavailable', message: 'The admin audit log cannot be written right now, so nothing was changed. Retry in a moment.' } };
