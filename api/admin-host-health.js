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
import { rejectInvalidEnvironment, SUPABASE_URL, SUPABASE_ANON_KEY } from './_environment.js';
import { applyCors } from './_cors.js';
import { regionComplianceFor } from './_onboarding-nudges.js';

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
    getAll(`alloggiati_filing_log?${scope}&outcome=not.like.evidence_*&select=property_id,trigger,outcome,error_code,run_at&order=run_at.desc`),
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
  const sorted = HostHealth.sortByHealth(results);
  return { generated_at: now.toISOString(), properties: sorted, action_needed: HostHealth.actionNeeded(sorted) };
}

async function listUsers(deps = {}) {
  const f = deps.fetch || globalThis.fetch;
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await f(`${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: { ...supabaseAuthHeaders(SERVICE_KEY) }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`auth users ${r.status}`);
    const j = await r.json();
    const users = Array.isArray(j?.users) ? j.users : [];
    out.push(...users.map(u => ({ id: u.id, email: u.email || null, last_sign_in_at: u.last_sign_in_at || null })));
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
    const payload = await buildHostHealth({ deps });
    return res.status(200).json(payload);
  } catch (e) {
    // Never a silent empty result: the admin sees that the read failed.
    console.warn('[admin-host-health] failed:', String(e && e.message || e).slice(0, 200));
    return res.status(503).json({ error: 'Host health unavailable. Retry in a moment.' });
  }
}
