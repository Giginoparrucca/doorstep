// Round 67 Phase 4 — data-subject requests (GDPR Art. 15/17/20).
// (1) Real migration dsar_erase in PGlite (twice), next to the real filed-
//     retention guard: service_role only; dry run changes nothing; erasure is
//     soft delete; filed check-ins kept by law (photos removed); test rows
//     erased; consents withdrawn and blanked; reservation contacts cleared;
//     chat of the given bookings only.
// (2) Actual admin endpoint: anon 401, non-admin 403 before any read; exact
//     lookups (wildcards refused, "_" re-checked, phone digits through
//     spaces/prefixes); export has every section; access codes removed from
//     chat; document links only when asked; erase needs CANCELLA, dry run by
//     default; the 11th request in an hour → 429 (real limiter); audited
//     without the identifier value. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261116160000_round67_dsar_erase.sql';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fictional-service-key';

// ── (1) Database ──
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.properties(id uuid primary key, owner_id uuid);
    create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, is_test boolean default false,
      surname text, document_number text, alloggiati_status text default 'pending', filed_at timestamptz, deleted_at timestamptz,
      id_photo_path text, selfie_photo_path text);
    create table public.marketing_consents(id uuid primary key default gen_random_uuid(), property_id uuid not null, booking_code text, guest_name text,
      email text, phone text, consent_given_at timestamptz not null default now(), consent_text_version text not null default 'v1', withdrawn_at timestamptz, created_at timestamptz not null default now());
    create table public.ota_reservations(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, guest_name text,
      contact_email text, contact_phone text, phone_last4 text, deleted_at timestamptz);
    create table public.chat_messages(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, message text, deleted_at timestamptz);
    create table public.storage_purge_queue(id bigserial primary key, bucket text not null check (bucket = 'documents'), path text not null, reason text not null, unique (bucket, path));
    grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role;`);
  await db.exec(read('supabase/migrations/20261114090000_filed_checkins_retained.sql'));
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  const P = '00000000-0000-4000-8000-0000000000aa', Q = '00000000-0000-4000-8000-0000000000bb';
  const one = async (q, a) => (await db.query(q, a)).rows[0];
  const open = (await one(`insert into checkins(property_id,booking_code,surname,document_number,id_photo_path,selfie_photo_path) values ($1,'B1','FICTIONAL','AB12345','p/open.jpg','p/open-s.jpg') returning id`, [P])).id;
  const filed = (await one(`insert into checkins(property_id,booking_code,surname,document_number,id_photo_path) values ($1,'B1','FICTIONAL','AB12345','p/filed.jpg') returning id`, [P])).id;
  await db.query(`update checkins set alloggiati_status='filed', filed_at=now() where id=$1`, [filed]);
  const testFiled = (await one(`insert into checkins(property_id,booking_code,surname,is_test) values ($1,'T1','FICTIONAL',true) returning id`, [P])).id;
  await db.query(`update checkins set alloggiati_status='filed', filed_at=now() where id=$1`, [testFiled]);
  const other = (await one(`insert into checkins(property_id,booking_code,surname) values ($1,'B1','COMPANION') returning id`, [P])).id;
  const consent = (await one(`insert into marketing_consents(property_id,booking_code,guest_name,email,phone) values ($1,'B1','Fictional Guest','guest@example.invalid','+39 333 000 0000') returning id`, [P])).id;
  const res = (await one(`insert into ota_reservations(property_id,booking_code,guest_name,contact_email,contact_phone,phone_last4) values ($1,'B1','Fictional Guest','guest@example.invalid','+39 333 000 0000','0000') returning id`, [P])).id;
  await db.query(`insert into chat_messages(property_id,booking_code,message) values ($1,'B1','hello'),($1,'B1','bye'),($1,'B2','other booking'),($2,'B1','other property')`, [P, Q]);
  const args = [[open, filed, testFiled], [consent], [res], JSON.stringify([{ property_id: P, booking_code: 'B1' }])];
  const call = (role, dry) => db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role })]);
    return (await tx.query('select public.dsar_erase($1::uuid[], $2::uuid[], $3::uuid[], $4::jsonb, $5) r', [...args, dry])).rows[0].r;
  });
  for (const role of ['anon', 'authenticated']) await assert.rejects(call(role, true), /permission denied/, role + ': no access');
  const snapshot = async () => JSON.stringify([(await db.query('select * from checkins order by id')).rows, (await db.query('select * from marketing_consents')).rows, (await db.query('select * from ota_reservations')).rows, (await db.query('select * from chat_messages order by id')).rows, (await db.query('select * from storage_purge_queue')).rows]);
  const before = await snapshot();
  const preview = await call('service_role', true);
  assert.equal(await snapshot(), before, 'dry run changes nothing');
  assert.deepEqual(preview, { dry_run: true, checkins_erased: 2, checkins_retained: [{ id: filed, reason: 'filed_alloggiati_legal_retention' }], photos_queued: 3, consents_withdrawn: 1, reservations_redacted: 1, chat_messages_erased: 2 });
  const done = await call('service_role', false);
  assert.deepEqual({ ...done, dry_run: true }, preview, 'the real run does what the preview said');
  const row = id => one('select * from checkins where id=$1', [id]);
  assert.ok((await row(open)).deleted_at, 'unfiled: soft-deleted (row still there for the 30-day purge)');
  assert.equal((await row(open)).id_photo_path, null); assert.equal((await row(open)).selfie_photo_path, null);
  assert.equal((await row(filed)).deleted_at, null, 'filed: kept by law'); assert.equal((await row(filed)).surname, 'FICTIONAL'); assert.equal((await row(filed)).id_photo_path, null, 'filed: photo removed');
  assert.ok((await row(testFiled)).deleted_at, 'test row: erased even if marked filed');
  assert.equal((await row(other)).deleted_at, null, 'companion not touched');
  assert.deepEqual((await db.query(`select path, reason from storage_purge_queue order by path`)).rows, [{ path: 'p/filed.jpg', reason: 'dsar_erasure' }, { path: 'p/open-s.jpg', reason: 'dsar_erasure' }, { path: 'p/open.jpg', reason: 'dsar_erasure' }]);
  const c = await one('select * from marketing_consents where id=$1', [consent]);
  assert.ok(c.withdrawn_at); assert.equal(c.email, null); assert.equal(c.phone, null); assert.equal(c.guest_name, null); assert.ok(c.consent_given_at, 'dated record kept');
  const r = await one('select * from ota_reservations where id=$1', [res]);
  assert.deepEqual([r.contact_email, r.contact_phone, r.phone_last4, r.guest_name, r.deleted_at], [null, null, null, 'Fictional Guest', null], 'contacts cleared, booking stays');
  assert.deepEqual((await db.query(`select booking_code, property_id = $1 as same, deleted_at is not null as gone from chat_messages order by message`, [P])).rows.map(x => [x.booking_code, x.same, x.gone]),
    [['B1', true, true], ['B1', true, true], ['B2', true, false], ['B1', false, false]], 'only the given booking on the given property');
  const again = await call('service_role', false);
  assert.deepEqual([again.checkins_erased, again.checkins_retained.length, again.photos_queued, again.consents_withdrawn, again.reservations_redacted, again.chat_messages_erased], [0, 1, 0, 0, 0, 0], 'idempotent');
  await assert.rejects(db.query(`select public.dsar_erase(array(select gen_random_uuid() from generate_series(1,501)), '{}', '{}', '[]', true)`), /too many rows/);
  await assert.rejects(db.query(`select public.dsar_erase('{}', '{}', '{}', '{}', true)`), /must be an array/);
  console.log('  db: dsar_erase checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// ── (2) Endpoint ──
const D = await import('../api/_admin-dsar.js');
const { default: handler } = await import('../api/admin-host-health.js');
const { take, _resetMemoryLimiter } = await import('../api/_rate-limit.js');
assert.deepEqual(D.normalizeQuery({ email: ' Guest@Example.invalid ' }), { kind: 'email', value: 'guest@example.invalid' });
for (const bad of [{ email: 'a*@example.invalid' }, { email: 'a%b@example.invalid' }, { email: 'g@x.invalid', phone: '3330000000' }, {}, { phone: '12 34' }, { document: 'AB*12' }, { document: 'ab' }, { email: 'x'.repeat(130) + '@e.it' }])
  assert.ok(D.normalizeQuery(bad).error, JSON.stringify(bad));
assert.deepEqual(D.normalizeQuery({ document: 'ab 123-45' }), { kind: 'document', value: 'AB12345' });
assert.ok(D.samePhone('+39 333 123 4567', '3331234567') && D.samePhone('0039-333-1234567', '+393331234567') && !D.samePhone('4567', '3331234567') && !D.samePhone('+39 333 123 4568', '3331234567'));

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const rows = {
  checkins: [{ id: 'c1', property_id: P, booking_code: 'B1', invoice_email: 'Guest@Example.invalid', document_number: 'AB 12345', surname: 'FICTIONAL', id_photo_path: 'P/x.jpg', selfie_photo_path: null, filed_at: '2026-11-01T10:00:00Z' },
    { id: 'c2', property_id: P, booking_code: 'B2', invoice_email: 'guestXexample.invalid', document_number: 'ZZ99999' }],
  ota_reservations: [{ id: 'r1', property_id: P, booking_code: 'B1', contact_email: 'guest@example.invalid', contact_phone: '+39 333 123 4567', checkin_date: '2026-11-01' },
    { id: 'r2', property_id: P, booking_code: 'B3', contact_email: 'other@example.invalid', contact_phone: '+39 333 999 9999' }],
  marketing_consents: [{ id: 'm1', property_id: P, booking_code: 'B1', email: 'GUEST@example.invalid', phone: '3331234567', consent_given_at: '2026-11-01T10:00:00Z' }],
};
const reads = [];
const fakeGet = async path => {
  reads.push(path);
  const [table, qs] = path.split('?'); const p = new URLSearchParams(qs);
  if (table === 'properties') return [{ id: P, name: 'Casa Fittizia', city: 'Bari' }];
  if (table === 'chat_messages') return p.get('booking_code') === 'eq.B1' ? [{ id: 'h1', sender: 'guest', message: 'ciao', entry_sensitive: false }, { id: 'h2', sender: 'host', message: 'codice 4321', entry_sensitive: true }] : [];
  let list = rows[table] || [];
  for (const [k, v] of p) {
    if (v.startsWith('ilike.')) { const pat = new RegExp('^' + v.slice(6).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/\*/g, '.*') + '$', 'i'); list = list.filter(r => pat.test(String(r[k] ?? ''))); }
    if (v === 'not.is.null') list = list.filter(r => r[k] != null);
    if (k === 'id' && v.startsWith('in.(')) { const ids = v.slice(4, -1).split(','); list = list.filter(r => ids.includes(r.id)); }
  }
  const off = Number(p.get('offset') || 0); return list.slice(off, off + Number(p.get('limit') || 1000));
};
let rpcCalls = [], audits = [], signed = [];
const rateStore = new Map();
const fakeRateFetch = async (url, init) => { const b = JSON.parse(init.body); const k = b.p_scope + '|' + b.p_key; const n = (rateStore.get(k) || 0) + 1; rateStore.set(k, n); return new Response(JSON.stringify({ allowed: n <= b.p_limit, hits: n, limit: b.p_limit, retry_after: 600 }), { status: 200 }); };
const dsar = { get: fakeGet, rpc: async (n, a) => { rpcCalls.push([n, a]); return { dry_run: a.p_dry_run, checkins_erased: 0, checkins_retained: [{ id: 'c1', reason: 'filed_alloggiati_legal_retention' }], photos_queued: 1, consents_withdrawn: 1, reservations_redacted: 1, chat_messages_erased: 2 }; },
  sign: async (path, s) => { signed.push([path, s]); return 'https://fictional.supabase.co/storage/v1/object/sign/documents/' + path + '?token=t'; },
  take: (scope, key, opts) => take(scope, key, opts, { fetch: fakeRateFetch }), audit: async e => { audits.push(e); }, now: () => Date.parse('2026-11-16T12:00:00Z') };
// verifyAdmin through the real code, with a fictional auth server.
const authFetch = role => async url => {
  if (String(url).endsWith('/auth/v1/user')) return role === 'expired' ? new Response('{}', { status: 401 }) : new Response(JSON.stringify({ id: 'admin-1', email: 'admin@example.invalid' }));
  if (String(url).endsWith('/rpc/is_admin')) return new Response(JSON.stringify(role === 'admin'));
  throw new Error('unexpected fetch ' + url);
};
const call = async (body, { role = 'admin', auth = 'Bearer jwt' } = {}) => {
  const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...(auth ? { authorization: auth } : {}) }, body }, res, { fetch: authFetch(role), dsar });
  return res;
};
reads.length = 0;
let o = await call({ action: 'dsar_export', email: 'guest@example.invalid' }, { auth: null }); assert.equal(o.code, 401);
o = await call({ action: 'dsar_export', email: 'guest@example.invalid' }, { role: 'expired' }); assert.equal(o.code, 401);
o = await call({ action: 'dsar_export', email: 'guest@example.invalid' }, { role: 'host' }); assert.equal(o.code, 403);
assert.equal(reads.length, 0, 'nothing read before the admin check');
o = await call({ action: 'dsar_export', email: 'Guest@Example.invalid' });
assert.equal(o.code, 200); assert.equal(o.headers['Cache-Control'], 'no-store');
for (const k of ['format', 'generated_at', 'properties', 'checkins', 'reservations', 'marketing_consents', 'chat_messages', 'documents', 'information', 'counts']) assert.ok(k in o.body, 'export has ' + k);
assert.deepEqual(o.body.checkins.map(c => c.id), ['c1'], '"_"-style near-miss (guestXexample) excluded by the exact re-check');
assert.ok(!('id_photo_path' in o.body.checkins[0]), 'storage paths not exported');
assert.deepEqual(o.body.reservations.map(r => r.id), ['r1']); assert.deepEqual(o.body.marketing_consents.map(r => r.id), ['m1']);
assert.deepEqual(o.body.chat_messages.map(m => m.message), ['ciao', '[access code removed]'], 'access codes never exported');
assert.deepEqual(o.body.documents, [{ checkin_id: 'c1', kind: 'id_document', stored: true }], 'no link unless asked'); assert.equal(signed.length, 0);
assert.ok(o.body.information.recipients.length && o.body.information.retention.checkins && o.body.information.legal_basis.checkins, 'Art. 15 information');
assert.deepEqual(audits.at(-1), { actor: 'admin@example.invalid', action: 'dsar_export', identifier_kind: 'email', outcome: 'exported', counts: o.body.counts, document_links: false });
assert.ok(!JSON.stringify(audits).includes('guest@'), 'the identifier value is never audited');
o = await call({ action: 'dsar_export', phone: '+39 333 123 4567', document_links: true });
assert.deepEqual([o.body.reservations.map(r => r.id), o.body.marketing_consents.map(r => r.id)], [['r1'], ['m1']], 'phone through spaces and prefixes');
rows.checkins.push({ id: 'c3', property_id: P, booking_code: 'B4', document_number: 'XAB123456' });
o = await call({ action: 'dsar_export', document: 'ab-12345', document_links: true });
assert.deepEqual(o.body.checkins.map(c => c.id), ['c1'], 'stored "AB 12345" found from "ab-12345"; the longer XAB123456 is not');
assert.deepEqual(signed, [['P/x.jpg', 7 * 24 * 3600]]); assert.match(o.body.documents[0].download_url, /token=t$/); assert.equal(o.body.documents[0].link_expires_at, '2026-11-23T12:00:00.000Z');
for (const bad of [{ email: 'a*@example.invalid' }, { email: '' }]) { o = await call({ action: 'dsar_export', ...bad }); assert.equal(o.code, 400); }
// Erase.
o = await call({ action: 'dsar_erase', email: 'guest@example.invalid' });
assert.equal(o.code, 200); assert.equal(rpcCalls.at(-1)[1].p_dry_run, true, 'dry run by default');
assert.deepEqual(rpcCalls.at(-1)[1], { p_checkin_ids: ['c1'], p_consent_ids: ['m1'], p_reservation_ids: ['r1'], p_chat_bookings: [{ property_id: P, booking_code: 'B1' }], p_dry_run: true });
assert.deepEqual(o.body.found, { checkins: 1, reservations: 1, marketing_consents: 1, bookings: 1 });
const n = rpcCalls.length;
o = await call({ action: 'dsar_erase', email: 'guest@example.invalid', dry_run: false }); assert.equal(o.code, 400); assert.equal(o.body.error, 'confirm_required'); assert.equal(rpcCalls.length, n, 'no erase without CANCELLA');
o = await call({ action: 'dsar_erase', email: 'guest@example.invalid', dry_run: false, confirm: 'CANCELLA' }); assert.equal(o.code, 200); assert.equal(rpcCalls.at(-1)[1].p_dry_run, false);
assert.equal(audits.at(-1).outcome, 'erased'); assert.equal(audits.at(-1).counts.checkins_retained, 1);
// The 11th request in the hour is refused (counted per admin, all DSAR actions).
const used = rateStore.get('dsar_admin|admin-1');
for (let i = used; i < 10; i++) assert.equal((await call({ action: 'dsar_export', email: 'guest@example.invalid' })).code, 200);
o = await call({ action: 'dsar_export', email: 'guest@example.invalid' }); assert.equal(o.code, 429); assert.equal(o.body.error, 'rate_limited');
// Counter store down → refused (closed), not unlimited.
_resetMemoryLimiter();
const down = await take('dsar_admin', 'admin-2', { windowSeconds: 3600, limit: 10, onFailure: 'closed' }, { fetch: async () => { throw new Error('down'); } });
assert.equal(down.ok, false);
// Wiring: mounted on the admin endpoint; admin page tab; migration grants.
const mig = read(MIG);
assert.match(mig, /revoke all on function public\.dsar_erase\(uuid\[\], uuid\[\], uuid\[\], jsonb, boolean\) from public, anon, authenticated;/);
assert.match(mig, /grant execute on function public\.dsar_erase\(uuid\[\], uuid\[\], uuid\[\], jsonb, boolean\) to service_role;/);
const admin = read('admin.html');
assert.match(admin, /data-tab="privacy"/); assert.match(admin, /<script src="\/admin-dsar\.js\?v=67\.4"><\/script>/); assert.match(admin, /activeTab === 'privacy'/);
const runbook = read('docs/compliance/DSAR_RUNBOOK.md');
for (const must of [/conservati per legge[\s\S]*TULPS art\. 109/, /type \*\*CANCELLA\*\*/, /one month/, /never its value/]) assert.match(runbook, must);
console.log('PASS round67 DSAR (Phase 4): dsar_erase is service_role only, dry run changes nothing and the real run matches it, unfiled check-ins soft-deleted with photos queued, filed ones kept by law with photos removed, test rows erased, companions untouched, consents withdrawn and blanked, reservation contacts cleared (booking kept), chat of the given bookings only, idempotent, capped; endpoint: anon/expired 401, non-admin 403 before any read, exact lookups (wildcards refused, near-misses re-checked, phones through spaces and prefixes), export with every section and Art. 15 information, access codes removed, 7-day document links only when asked, erase dry-run by default and only with CANCELLA, 11th request in an hour → 429, closed when the counter is down, audited without the identifier value');
