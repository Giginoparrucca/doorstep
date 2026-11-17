import '../lib/log-scrub.mjs'; // Round 67 Phase 6 — every log line is scrubbed (load first)
// Round 71 — admin host health. One payload for all live properties:
// coverage, filing, autofile/credentials, setup gaps, upcoming arrivals
// without check-in, activity and the health colour with its reasons.
//
// Gate: the same server-side admin check as the Alloggiati support tools —
// caller JWT → /auth/v1/user → rpc/is_admin with the CALLER's JWT. The
// client-side admin check is never trusted. Reads use the service role.
// Privacy: guests leave as surname initial + arrival date (lib/host-health.js);
// the payload is never logged.
import { createRequire } from 'node:module';
import { supabaseAuthHeaders } from './_supabase-auth.js';
import { rejectInvalidEnvironment, SUPABASE_URL, SUPABASE_ANON_KEY, APP_BASE_URL } from './_environment.js';
import { applyCors } from './_cors.js';
import { regionComplianceFor } from './_onboarding-nudges.js';
import { handleBillingAction, billingChip } from './_admin-billing.js';
import { handleDsarAction } from './_admin-dsar.js';
import { buildUsersOverview } from './_admin-users.js';
import { take } from './_rate-limit.js';
import { auditFirst, auditAfter, recordAdminEvent, AUDIT_UNAVAILABLE } from './_admin-audit.js';
import { sendHostEmail, hostAccountEmail } from './_notify-host.js';

const require = createRequire(import.meta.url);
const HostHealth = require('../lib/host-health.js');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE = 1000;

export async function sbGet(path, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const r = await f(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...supabaseAuthHeaders(SERVICE_KEY), Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`read ${path.split('?')[0]} ${r.status}`);
  return r.json();
}
// PostgREST returns at most 1000 rows per request: read every page.
export async function sbGetAll(path, deps = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await sbGet(`${path}&limit=${PAGE}&offset=${offset}`, deps);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function verifyAdmin(req, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const jwt = /^Bearer (.+)$/.exec(req.headers?.authorization || req.headers?.Authorization || '')?.[1];
  if (!jwt) return { status: 401, error: 'Admin sign-in required' };
  const auth = await f(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` } });
  if (!auth.ok) return { status: 401, error: 'Admin session expired' };
  const user = await auth.json();
  if (!user?.id) return { status: 401, error: 'Admin session expired' };
  const admin = await f(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!admin.ok || (await admin.json()) !== true) return { status: 403, error: 'Admin access required' };
  return { user };
}

const enc = encodeURIComponent;
const inList = ids => `(${ids.map(id => `"${id}"`).join(',')})`;

export async function buildHostHealth({ now = new Date(), deps = {} } = {}) {
  const get = path => sbGet(path, deps), getAll = path => sbGetAll(path, deps);
  const props = await getAll('properties?deleted_at=is.null&is_test=is.false&select=id,name,owner_id,timezone,region,city,cir_code,ross1000_codice,tax_rate_eur,tax_rules,ical_feeds,welcome_message,welcome_message_it,welcome_message_en,alloggiati_autofile_mode&order=id.asc');
  if (!props.length) return { generated_at: now.toISOString(), properties: [], action_needed: [] };
  const ids = props.map(p => p.id);
  // Widest window across timezones; per-property tz is applied in the lib.
  const base = HostHealth.ymd(now, 'UTC');
  const from = HostHealth.addDays(base, -32), to = HostHealth.addDays(base, 32);
  const scope = `property_id=in.${enc(inList(ids))}`;
  const [reservations, recentCheckins, oldUnfiled, filingLog, creds, onboarding, recos, guestEvents, users] = await Promise.all([
    getAll(`ota_reservations?${scope}&is_test=is.false&deleted_at=is.null&entry_type=eq.reservation&status=eq.active&covered_by_reservation_id=is.null&checkin_date=gte.${from}&checkin_date=lte.${to}&select=id,property_id,booking_code,checkin_date,platform,entry_type,status,covered_by_reservation_id,created_by,created_at&order=id.asc`),
    getAll(`checkins?${scope}&is_test=is.false&deleted_at=is.null&arrival_date=gte.${from}&select=id,property_id,booking_code,surname,arrival_date,filed_at,autofile_excluded,alloggiati_status,autofile_last_error,filing_method&order=id.asc`),
    getAll(`checkins?${scope}&is_test=is.false&deleted_at=is.null&arrival_date=lt.${from}&filed_at=is.null&autofile_excluded=is.false&select=id,property_id,booking_code,surname,arrival_date,filed_at,autofile_excluded,alloggiati_status,autofile_last_error,filing_method&order=id.asc`),
    getAll(`alloggiati_filing_log?${scope}&outcome=not.like.evidence_*&run_at=gte.${HostHealth.addDays(base, -60)}&select=property_id,trigger,outcome,error_code,error_detail,checkin_ids,run_at&order=run_at.desc`),
    get(`host_alloggiati_credentials?${scope}&select=property_id,verified_at,wskey_expires_at,last_error`),
    getAll(`host_onboarding?${scope}&select=user_id,property_id,skips&order=property_id.asc,user_id.asc`),
    getAll(`recommendations?${scope}&is_test=is.false&deleted_at=is.null&select=property_id&order=id.asc`),
    getAll(`analytics_events?${scope}&is_test=is.false&deleted_at=is.null&event_type=like.guest_*&booking_code=not.is.null&created_at=gte.${HostHealth.addDays(base, -40)}&select=property_id,booking_code&order=id.asc`),
    listUsers(deps),
  ]);
  // Last host activity per owner: latest console event, latest reservation
  // the owner created, last sign-in (Phase 1: events are the reliable source).
  const owners = [...new Set(props.map(p => p.owner_id).filter(Boolean))];
  const ownerEvent = new Map();
  await Promise.all(owners.map(async o => {
    const [e] = await get(`analytics_events?user_id=eq.${enc(o)}&select=created_at&order=created_at.desc&limit=1`);
    if (e) ownerEvent.set(o, e.created_at);
  }));
  const createdBy = new Map();
  for (const r of await getAll(`ota_reservations?created_by=in.${enc(inList(owners.length ? owners : ['00000000-0000-0000-0000-000000000000']))}&select=created_by,created_at&order=id.asc`)) {
    if (!createdBy.has(r.created_by) || r.created_at > createdBy.get(r.created_by)) createdBy.set(r.created_by, r.created_at);
  }
  const userById = new Map(users.map(u => [u.id, u]));
  const latest = (...v) => v.filter(Boolean).sort().at(-1) || null;

  const credBy = new Map(creds.map(c => [c.property_id, c]));
  const recoCount = new Map(); recos.forEach(r => recoCount.set(r.property_id, (recoCount.get(r.property_id) || 0) + 1));
  const codesBy = new Map(); guestEvents.forEach(e => { if (!codesBy.has(e.property_id)) codesBy.set(e.property_id, new Set()); codesBy.get(e.property_id).add(e.booking_code); });
  const checkins = recentCheckins.concat(oldUnfiled);

  const results = props.map(p => {
    const r = HostHealth.computeHostHealth({
      property: p, now,
      reservations: reservations.filter(x => x.property_id === p.id),
      checkins: checkins.filter(x => x.property_id === p.id),
      filingLog: filingLog.filter(x => x.property_id === p.id),
      credentials: credBy.get(p.id) || null,
      onboarding: onboarding.find(o => o.property_id === p.id && o.user_id === p.owner_id) || null,
      recommendationCount: recoCount.get(p.id) || 0,
      guestEventCodes: codesBy.get(p.id) || [],
      lastActivityAt: latest(ownerEvent.get(p.owner_id), createdBy.get(p.owner_id), userById.get(p.owner_id)?.last_sign_in_at),
      regionCompliance: regionComplianceFor(p.region, p.city),
    });
    r.owner_email = userById.get(p.owner_id)?.email || null;
    return r;
  });
  // Round 72 — billing status per host account (chip, row, last 5 events).
  const billing = await readBilling(owners, now, deps).catch(e => ({ error: String(e.message || e).slice(0, 120) }));
  for (const r of results) r.billing = billing.byOwner ? billing.byOwner[r.owner_id] || null : null;
  const sorted = HostHealth.sortByHealth(results);
  return { generated_at: now.toISOString(), properties: sorted, action_needed: HostHealth.actionNeeded(sorted),
    billing_settings: billing.settings || null, billing_error: billing.error || null };
}

async function rpcState(userId, now, deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const r = await f(`${SUPABASE_URL}/rest/v1/rpc/billing_access_state`, { method: 'POST', headers: { ...supabaseAuthHeaders(SERVICE_KEY), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ p_user: userId, p_now: now.toISOString() }), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`billing state ${r.status}`);
  return r.json();
}
export async function readBilling(owners, now, deps = {}) {
  const [settings] = await sbGet('billing_settings?id=eq.1&select=*&limit=1', deps);
  const ids = owners.length ? owners : ['00000000-0000-0000-0000-000000000000'];
  const subs = await sbGetAll(`host_subscriptions?user_id=in.${enc(inList(ids))}&select=*&order=user_id.asc`, deps);
  const events = await sbGetAll(`billing_events?user_id=in.${enc(inList(ids))}&select=user_id,actor,action,old_value,new_value,reason,created_at&order=created_at.desc,id.asc`, deps);
  const byOwner = {};
  for (const o of owners) {
    const state = await rpcState(o, now, deps);
    byOwner[o] = { state, chip: billingChip(state), subscription: subs.find(x => x.user_id === o) || null,
      events: events.filter(e => e.user_id === o).slice(0, 5) };
  }
  return { settings: settings || null, byOwner };
}

function billingDeps(deps = {}) {
  if (deps.billing) return deps.billing;
  const f = deps.fetch || globalThis.fetch;
  const write = async (method, path, body) => {
    const r = await f(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers: { ...supabaseAuthHeaders(SERVICE_KEY), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`${method} ${path.split('?')[0]} ${r.status}`);
    return r.json();
  };
  return {
    get: path => sbGet(path, deps),
    patch: (path, body) => write('PATCH', path, body),
    insert: (table, row) => write('POST', table, row),
    event: row => write('POST', 'billing_events', row),
    userEmail: hostAccountEmail,
    lang: async id => { const [p] = await sbGet(`properties?owner_id=eq.${enc(id)}&deleted_at=is.null&select=host_language&order=created_at.asc&limit=1`, deps).catch(() => []); return p?.host_language || 'it'; },
    send: sendHostEmail,
    consoleUrl: `${APP_BASE_URL || 'https://app.welcomebnb.it'}/host-console.html`,
    rpc: async (name, args) => {
      const r = await f(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...supabaseAuthHeaders(SERVICE_KEY), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(20000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(String(j.message || j.error || `rpc ${name} ${r.status}`));
      return j;
    },
  };
}

// Round 67 Phase 5 — journal writer (injectable for tests).
function auditDeps(deps = {}) {
  if (deps.audit) return deps.audit;
  const d = { fetch: deps.fetch };
  return { first: ev => auditFirst(ev, d), after: ev => auditAfter(ev, d) };
}
// Recent journal entries for the admin page (newest first), with the chain
// check. Filters: action prefix, since (ISO date), limit ≤ 500.
export async function listAuditEvents(body = {}, deps = {}) {
  const prefix = String(body.action_prefix || '');
  if (prefix && !/^[a-z_]{2,40}$/.test(prefix)) return { status: 400, body: { error: 'invalid_filter' } };
  const since = String(body.since || '');
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) return { status: 400, body: { error: 'invalid_filter' } };
  const limit = Math.min(Math.max(parseInt(body.limit, 10) || 200, 1), 500);
  const filters = [prefix ? `action=like.${enc(prefix)}*` : '', since ? `occurred_at=gte.${since}` : ''].filter(Boolean).join('&');
  const events = await sbGet(`admin_access_events?${filters ? filters + '&' : ''}select=id,occurred_at,actor_email,action,outcome,target_table,target_id,metadata&order=id.desc&limit=${limit}`, deps);
  const chain = await billingDeps(deps).rpc('admin_audit_verify', {}).catch(() => null);
  return { status: 200, body: { events, chain } };
}

// Round 67 Phase 4 — data-subject requests (api/_admin-dsar.js).
function dsarDeps(deps = {}) {
  if (deps.dsar) return deps.dsar;
  const f = deps.fetch || globalThis.fetch;
  const billing = billingDeps(deps);
  return {
    get: path => sbGet(path, deps),
    rpc: billing.rpc,
    take: (scope, key, opts) => take(scope, key, opts, { fetch: f }),
    // 7-day signed link to one stored document photo (private bucket).
    sign: async (path, seconds) => {
      const r = await f(`${SUPABASE_URL}/storage/v1/object/sign/documents/${String(path).split('/').map(enc).join('/')}`, { method: 'POST', headers: { ...supabaseAuthHeaders(SERVICE_KEY), 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }), signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.signedURL) throw new Error('sign ' + r.status);
      return `${SUPABASE_URL}/storage/v1${j.signedURL.startsWith('/') ? '' : '/'}${j.signedURL}`;
    },
    audit: async () => {}, // the handler wrapper records the journal entry
  };
}

async function listUsers(deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await f(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: { ...supabaseAuthHeaders(SERVICE_KEY) }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`auth users ${r.status}`);
    const j = await r.json();
    const users = Array.isArray(j?.users) ? j.users : [];
    out.push(...users.map(u => ({ id: u.id, email: u.email || null, last_sign_in_at: u.last_sign_in_at || null,
      created_at: u.created_at || null, email_confirmed_at: u.email_confirmed_at || u.confirmed_at || null, invited_at: u.invited_at || null })));
    if (users.length < 200) return out;
  }
  return out;
}

export default async function handler(req, res, deps = {}) {
  if (rejectInvalidEnvironment(res)) return;
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  res.setHeader('Cache-Control', 'no-store');
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });
  try {
    const gate = await verifyAdmin(req, deps);
    if (gate.error) return res.status(gate.status).json({ error: gate.error });
    const action = String(req.body?.action || '');
    // Round 67 Phase 5 — every admin action is journalled (admin_access_events):
    // changes and personal-data exports are recorded before they run (or not
    // run at all) and again with their outcome; reads after.
    const audit = auditDeps(deps);
    const who = { actorId: gate.user.id, actorEmail: gate.user.email || null, req, route: 'admin-host-health' };
    const outcomeOf = status => status < 300 ? 'ok' : status < 500 ? 'refused' : 'error';
    if (action.startsWith('billing_')) {
      const body = req.body || {};
      const target = /^[0-9a-f-]{36}$/i.test(String(body.user_id || '')) ? { targetTable: 'auth_users', targetId: body.user_id } : { targetTable: 'billing_settings' };
      const ev = { ...who, ...target, action };
      const isRead = action === 'billing_launch_preview' || (action === 'billing_launch_emails' && body.dry !== false) || (action === 'billing_launch' && body.dry !== false);
      if (!isRead && !(await audit.first(ev))) return res.status(AUDIT_UNAVAILABLE.status).json(AUDIT_UNAVAILABLE.body);
      const out = await handleBillingAction(action, body, { actor: gate.user.email || gate.user.id, deps: billingDeps(deps) });
      await audit.after({ ...ev, outcome: outcomeOf(out.status), metadata: { status: out.status, dry_run: isRead } });
      return res.status(out.status).json(out.body);
    }
    if (action.startsWith('dsar_')) {
      const real = action === 'dsar_erase' && req.body?.dry_run === false;
      const ev = { ...who, action: action === 'dsar_export' ? 'dsar_export' : real ? 'dsar_erase' : 'dsar_erase_preview', targetTable: 'data_subject' };
      if (!(await audit.first(ev))) return res.status(AUDIT_UNAVAILABLE.status).json(AUDIT_UNAVAILABLE.body);
      let detail = {};
      const d = { ...dsarDeps(deps), audit: async e => { detail = { identifier_kind: e.identifier_kind, counts: e.counts, document_links: e.document_links === true }; } };
      let out;
      try { out = await handleDsarAction(action, req.body || {}, { actor: gate.user.email || gate.user.id, actorId: gate.user.id, deps: d }); }
      catch (e) { await audit.after({ ...ev, outcome: 'error' }); throw e; }
      await audit.after({ ...ev, outcome: outcomeOf(out.status), metadata: { status: out.status, ...detail } });
      return res.status(out.status).json(out.body);
    }
    if (action === 'users_overview') {
      const out = await buildUsersOverview(deps.users || { get: path => sbGet(path, deps), getAll: path => sbGetAll(path, deps), listUsers: () => listUsers(deps), rpc: billingDeps(deps).rpc, billing: (ids, at) => readBilling(ids, at, deps) });
      await audit.after({ ...who, action: 'host_health_read', targetTable: 'auth_users', metadata: { view: 'users', rows: out.rows.length } });
      return res.status(200).json(out);
    }
    if (action === 'audit_list') {
      const out = await listAuditEvents(req.body || {}, deps);
      await audit.after({ ...who, action: 'audit_read', targetTable: 'admin_access_events', outcome: outcomeOf(out.status), metadata: { rows: out.body.events ? out.body.events.length : 0 } });
      return res.status(out.status).json(out.body);
    }
    const payload = await buildHostHealth({ deps });
    await audit.after({ ...who, action: 'host_health_read', targetTable: 'properties', metadata: { properties: (payload.properties || []).length } });
    return res.status(200).json(payload);
  } catch (e) {
    // Never a silent empty result: the admin sees that the read failed.
    console.warn('[admin-host-health] failed:', String(e && e.message || e).slice(0, 200));
    const failed = String(req.body?.action || '').startsWith('dsar_') ? 'Privacy request failed: nothing was changed by the failed step. Retry in a moment.' : 'Host health unavailable. Retry in a moment.';
    return res.status(503).json({ error: failed });
  }
}
