// Round 67 Phase 5 — admin audit log (admin_access_events).
// (1) Real migration in PGlite (twice): insert via admin_audit_record works
//     for service_role, 42501 for anon/authenticated; no back-dating; UPDATE/
//     DELETE/TRUNCATE refused for every role; e-mail-shaped metadata and
//     unknown actions refused; hash chain verified, tampering detected;
//     retention purge removes only rows older than 2 years and the chain
//     still verifies; «view as host» rows mirrored.
// (2) Writers: metadata cleaning, keyed hashes (no raw address/email), and
//     the actual endpoints — billing/DSAR/invite changes do not run when the
//     journal cannot be written; health read, billing, DSAR, invites,
//     Alloggiati admin reads and the journal read are recorded; audit_list
//     validates filters and returns the chain check. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261116170000_round67_admin_audit_log.sql';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fictional-service-key';

let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.admin_impersonation_log(id uuid primary key default gen_random_uuid(), admin_id uuid, admin_email text, property_id uuid, action text, created_at timestamptz default now());
    grant insert, select on public.admin_impersonation_log to authenticated, service_role;`);
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  const as = (role, q, args = []) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(q, args); });
  const rec = (role, action = 'host_health_read', meta = { properties: 3 }, target = null) =>
    as(role, `select public.admin_audit_record($1, 'admin@example.invalid', $2, 'ok', 'properties', $3, 'abcdef0123456789', $4::jsonb) id`, ['00000000-0000-4000-8000-000000000001', action, target, JSON.stringify(meta)]);
  for (const role of ['anon', 'authenticated']) await assert.rejects(rec(role), /permission denied/, role + ': cannot write');
  for (let i = 0; i < 4; i++) await rec('service_role', i % 2 ? 'dsar_export' : 'host_health_read', { n: i });
  await assert.rejects(rec('service_role', 'drop_everything'), /check constraint/, 'unknown action refused');
  await assert.rejects(rec('service_role', 'dsar_export', { note: 'guest@example.invalid' }), /check constraint/, 'e-mail in metadata refused');
  await assert.rejects(as('service_role', `insert into public.admin_access_events(action, occurred_at) values ('audit_read', '2020-01-01')`), /permission denied/, 'no back-dating');
  for (const role of ['service_role', 'postgres']) {
    await assert.rejects(as(role, `update public.admin_access_events set outcome = 'refused' where id = 1`), /append-only|permission denied/, role + ': no update');
    await assert.rejects(as(role, `delete from public.admin_access_events where id = 1`), /append-only|permission denied/, role + ': no delete');
    await assert.rejects(as(role, `truncate public.admin_access_events`), /append-only|permission denied/, role + ': no truncate');
  }
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, 'select * from public.admin_access_events'), /permission denied/, role + ': cannot read');
  const verify = async () => (await db.query('select public.admin_audit_verify() v')).rows[0].v;
  assert.deepEqual(await verify(), { ok: true, checked: 4 });
  const rows = (await db.query('select id, occurred_at, prev_hash, row_hash from public.admin_access_events order by id')).rows;
  assert.equal(rows[0].prev_hash, 'genesis'); assert.equal(rows[1].prev_hash, rows[0].row_hash, 'chained');
  assert.ok(Date.now() - new Date(rows[0].occurred_at).getTime() < 60000, 'stamped now');
  // Tampering (owner bypassing the guard) is detected.
  await db.exec(`alter table public.admin_access_events disable trigger admin_access_events_append_only;
    update public.admin_access_events set outcome = 'refused' where id = 3;
    alter table public.admin_access_events enable trigger admin_access_events_append_only;`);
  assert.deepEqual(await verify(), { ok: false, broken_at: 3, reason: 'content', checked: 2 });
  await db.exec(`alter table public.admin_access_events disable trigger admin_access_events_append_only;
    update public.admin_access_events set outcome = 'ok' where id = 3; delete from public.admin_access_events where id = 2;
    alter table public.admin_access_events enable trigger admin_access_events_append_only;`);
  assert.deepEqual(await verify(), { ok: false, broken_at: 3, reason: 'link', checked: 1 }, 'a removed row breaks the link');
  // Retention: rebuild a clean journal whose first two rows are 3 years old.
  const db2 = new PGlite();
  await db2.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to service_role;`);
  await db2.exec(sql);
  for (let i = 0; i < 4; i++) await db2.query(`select public.admin_audit_record(null, null, 'audit_read', 'ok', null, null, null, '{}')`);
  await db2.exec(`alter table public.admin_access_events disable trigger admin_access_events_append_only;
    update public.admin_access_events set occurred_at = now() - interval '3 years' where id <= 2;
    alter table public.admin_access_events enable trigger admin_access_events_append_only;`);
  await assert.rejects(db2.query(`delete from public.admin_access_events where id = 1`), /append-only/, 'old rows: only through the purge');
  assert.equal((await db2.query('select public.admin_audit_purge() n')).rows[0].n, 2);
  assert.deepEqual((await db2.query('select id from public.admin_access_events order by id')).rows.map(r => Number(r.id)), [3, 4]);
  assert.deepEqual((await db2.query('select public.admin_audit_verify() v')).rows[0].v, { ok: true, checked: 2 }, 'chain verifies after the purge');
  assert.equal((await db2.query('select public.admin_audit_purge() n')).rows[0].n, 0, 'recent rows never purged');
  await assert.rejects(db2.exec(`select set_config('welcomebnb.admin_audit_purge', 'on', false); delete from public.admin_access_events where id = 3`), /append-only/, 'the purge flag alone cannot delete recent rows');
  // «View as host» mirrored.
  await as('authenticated', `insert into public.admin_impersonation_log(admin_id, admin_email, property_id, action) values ($1, 'admin@example.invalid', $2, 'view')`, ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa']);
  const mirrored = (await db.query(`select action, target_table, target_id, metadata from public.admin_access_events where action = 'impersonation_view'`)).rows;
  assert.deepEqual(mirrored, [{ action: 'impersonation_view', target_table: 'properties', target_id: '00000000-0000-4000-8000-0000000000aa', metadata: { mode: 'view', source: 'admin_impersonation_log' } }]);
  console.log('  db: admin_access_events checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// ── (2) Writers ──
const A = await import('../api/_admin-audit.js');
assert.deepEqual(A.cleanMetadata({ status: 200, counts: { checkins: 2 }, identifier_kind: 'email', note: 'Mario Rossi called', email: 'guest@example.invalid', ok: true, list: ['a', 'b c', 3], 'bad key!': 1 }),
  { status: 200, counts: { checkins: 2 }, identifier_kind: 'email', ok: true, list: ['a', 3] }, 'free text, emails and odd keys dropped');
const sent = [];
const okFetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('1'); };
await A.recordAdminEvent({ actorId: '00000000-0000-4000-8000-000000000001', actorEmail: 'admin@example.invalid', action: 'invite_send', targetTable: 'pilot_invites', targetId: 'host@example.invalid', req: { headers: { 'x-real-ip': '203.0.113.9', 'user-agent': 'Fictional' } }, metadata: { email_sent: true } }, { fetch: okFetch });
const b = sent[0].body;
assert.match(sent[0].url, /\/rest\/v1\/rpc\/admin_audit_record$/);
assert.match(b.p_target_id, /^[0-9a-f]{32}$/, 'invited address stored as a keyed hash'); assert.match(b.p_fingerprint, /^[0-9a-f]{32}$/);
assert.ok(!JSON.stringify(b).includes('203.0.113.9') && !JSON.stringify(b).includes('host@'), 'no raw address or invited email');
assert.equal(await A.auditFirst({ action: 'audit_read' }, { fetch: async () => new Response('x', { status: 500 }) }), false);
await A.auditAfter({ action: 'audit_read' }, { fetch: async () => { throw new Error('down'); } }); // never throws

const { default: health, listAuditEvents } = await import('../api/admin-host-health.js');
const authFetch = async url => {
  if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.invalid' }));
  if (String(url).endsWith('/rpc/is_admin')) return new Response('true');
  throw new Error('unexpected fetch ' + url);
};
const resStub = () => ({ code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; } });
const post = async (body, deps) => { const res = resStub(); await health({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer jwt' }, body }, res, { fetch: authFetch, ...deps }); return res; };
const journal = [];
const up = { first: async e => { journal.push({ ...e, outcome: 'requested' }); return true; }, after: async e => { journal.push(e); } };
const down = { first: async () => false, after: async e => { journal.push(e); } };
let billingRan = 0;
const billing = { get: async () => [{}], patch: async () => { billingRan++; return [{}]; }, insert: async () => { billingRan++; return [{}]; }, event: async () => { billingRan++; return [{}]; }, rpc: async () => { billingRan++; return {}; }, userEmail: async () => null, lang: async () => 'it', send: async () => ({ ok: true }) };
let r = await post({ action: 'billing_free_forever', user_id: '00000000-0000-4000-8000-0000000000bb', on: true, reason: 'test' }, { audit: down, billing });
assert.equal(r.code, 503); assert.equal(r.body.error, 'audit_unavailable'); assert.equal(billingRan, 0, 'no billing change without a journal entry');
r = await post({ action: 'billing_free_forever', user_id: '00000000-0000-4000-8000-0000000000bb', on: true, reason: 'test' }, { audit: up, billing });
assert.deepEqual(journal.slice(-2).map(e => [e.action, e.outcome, e.targetTable, e.targetId]), [['billing_free_forever', 'requested', 'auth_users', '00000000-0000-4000-8000-0000000000bb'], ['billing_free_forever', r.code < 300 ? 'ok' : r.code < 500 ? 'refused' : 'error', 'auth_users', '00000000-0000-4000-8000-0000000000bb']]);
assert.ok(!('reason' in (journal.at(-1).metadata || {})), 'free-text reason not journalled');
let dsarRan = 0;
r = await post({ action: 'dsar_export', email: 'guest@example.invalid' }, { audit: down, dsar: { get: async () => { dsarRan++; return []; } } });
assert.equal(r.code, 503); assert.equal(dsarRan, 0, 'no personal-data export without a journal entry');
const n0 = journal.length;
r = await post({ action: 'billing_launch_preview' }, { audit: up, billing: { ...billing, get: async () => [{}], rpc: async () => [] } });
assert.deepEqual(journal.slice(n0).map(e => e.outcome), ['ok'], 'a preview is a read: recorded after only');
// Journal read: filters validated, chain returned, read recorded.
const auditRows = [{ id: 2, action: 'dsar_export' }];
const listFetch = async (url, init) => {
  if (String(url).includes('/rpc/admin_audit_verify')) return new Response(JSON.stringify({ ok: true, checked: 2 }));
  if (String(url).includes('/rest/v1/admin_access_events?')) { assert.match(String(url), /action=like\.dsar_\*&occurred_at=gte\.2026-11-01&select=id,occurred_at,actor_email,action,outcome,target_table,target_id,metadata&order=id\.desc&limit=50$/); return new Response(JSON.stringify(auditRows)); }
  return authFetch(url, init);
};
r = await post({ action: 'audit_list', action_prefix: 'dsar_', since: '2026-11-01', limit: 50 }, { audit: up, fetch: listFetch });
assert.equal(r.code, 200); assert.deepEqual(r.body, { events: auditRows, chain: { ok: true, checked: 2 } });
assert.deepEqual([journal.at(-1).action, journal.at(-1).metadata], ['audit_read', { rows: 1 }]);
for (const bad of [{ action_prefix: "x'or" }, { since: 'yesterday' }]) assert.equal((await listAuditEvents(bad, {})).status, 400);
// Invites: refused without a journal entry, nothing sent.
process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'https://app.welcomebnb.it';
const inv = await import('../api/admin-invite-host.js');
const origFetch = globalThis.fetch; let inviteWrites = 0;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.invalid' }));
  if (u.endsWith('/rpc/is_admin')) return new Response('true');
  if (u.endsWith('/rpc/admin_audit_record')) return new Response('nope', { status: 500 });
  inviteWrites++; return new Response('[]');
};
try {
  const res = resStub();
  await inv.default({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer jwt' }, body: { action: 'revoke', email: 'host@example.invalid' } }, res);
  assert.equal(res.code, 503); assert.equal(res.body.error, 'audit_unavailable'); assert.equal(inviteWrites, 0, 'no invite change without a journal entry');
} finally { globalThis.fetch = origFetch; }
// Every admin path writes the journal.
const src = f => read('api/' + f);
assert.match(src('admin-host-health.js'), /action: 'host_health_read'/);
assert.match(src('admin-host-health.js'), /if \(!isRead && !\(await audit\.first\(ev\)\)\)/);
assert.match(src('admin-host-health.js'), /action === 'dsar_export' \? 'dsar_export' : real \? 'dsar_erase' : 'dsar_erase_preview'/);
assert.match(src('admin-invite-host.js'), /if \(!\(await auditFirst\(audit\)\)\) return res\.status\(AUDIT_UNAVAILABLE\.status\)/);
assert.match(src('alloggiati.js'), /if \(owner\.admin\) await auditAfter\(\{[^}]*action: 'alloggiati_admin_status'/);
assert.match(src('_alloggiati-support.js'), /if \(overview\) await auditAfter\(\{[^}]*action: 'alloggiati_support_read'/);
const mig = read(MIG);
assert.match(mig, /grant execute on function public\.admin_audit_record\(uuid, text, text, text, text, text, text, jsonb\), public\.admin_audit_verify\(\),\n  public\.admin_access_events_content\(public\.admin_access_events\), public\.admin_access_events_chain\(\) to service_role;/);
assert.ok(!/grant[^;]*admin_audit_purge[^;]*to service_role/.test(mig), 'only the scheduled job purges');
assert.match(mig, /cron\.schedule\('welcomebnb_admin_audit_purge'/);
console.log('PASS round67 admin audit log (Phase 5): admin_audit_record service_role only (anon/authenticated 42501), no back-dating, update/delete/truncate refused for every role, unknown actions and e-mail-shaped metadata refused, hash chain verified and tampering (edit or removed row) detected, 2-year purge only through the purge function and the chain still verifies, «view as host» mirrored; writer keeps IDs/kinds/counts only, invited e-mail and client address as keyed hashes; billing changes, personal-data exports and invite changes do not run without a journal entry; previews recorded after; journal read validated, returns the chain check and is itself recorded; every admin path wired');
