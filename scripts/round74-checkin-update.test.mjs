// Round 74 Phase 2 — audit WBNB-R002 (edits need a booking-bound token and
// stay inside that booking) and WBNB-Y003 (party date changes are atomic).
// Real migration in PGlite + the actual api/guest.js checkin_update handler
// wired to it. Fictional guests only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GUEST_TOKEN_SECRET = 'fictional-round74-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { PGlite } = await import('@electric-sql/pglite');
const { signGuestToken } = await import('../api/_guest-token.js');
const { default: guest } = await import('../api/guest.js');

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, is_test boolean default false, deleted_at timestamptz,
    guest_type text, surname text, name text, sex text, date_of_birth date, place_of_birth text, birth_province text, birth_country text, citizenship text,
    document_type text, document_number text, doc_issue_place text, arrival_date date, departure_date date, nights int, id_photo_path text, docs_status text,
    residence_country text, residence_place text, fiscal_code text, residence_address text, residence_postcode text, residence_province text, invoice_email text,
    guest_edited_at timestamptz, checkin_reopened_at timestamptz, alloggiati_status text default 'pending', keybox_code text);
  create table public.properties(id uuid primary key, region text, invoice_required boolean default false);`);
const mig = read('supabase/migrations/20261116100000_round74_guest_checkin_update.sql');
await db.exec(mig); await db.exec(mig);
await db.query(`insert into public.properties(id) values ($1),($2)`, [P, P2]);
const add = async (code, type, surname, x = {}) => (await db.query(`insert into public.checkins(property_id,booking_code,guest_type,surname,name,arrival_date,departure_date,nights,residence_country,residence_place,alloggiati_status,is_test)
  values ($1,$2,$3,$4,'Guest','2026-12-10','2026-12-13',3,'Germany','Berlin',$5,$6) returning id`, [x.p || P, code, type, surname, x.status || 'pending', x.test || false])).rows[0].id;
const A1 = await add('BOOK-A', 'head', 'ROSSI'), A2 = await add('BOOK-A', 'member', 'ROSSI'), A3 = await add('BOOK-A', 'member', 'ROSSI');
const B1 = await add('BOOK-B', 'single', 'BIANCHI');
const C1 = await add('BOOK-C', 'head', 'VERDI'), C2 = await add('BOOK-C', 'member', 'VERDI', { status: 'filed' });
const D1 = await add('BOOK-D', 'head', 'NERI', { p: P2 });
const T1 = await add('BOOK-T', 'single', 'TEST', { test: true });
const row = async id => (await db.query('select surname, arrival_date::text a, departure_date::text d, nights, guest_edited_at from public.checkins where id=$1', [id])).rows[0];
const upd = (booking, id, patch, x = {}) => db.query('select public.guest_update_checkin($1,$2,$3,$4,$5) r', [x.p || P, booking, x.test || false, id, JSON.stringify(patch)]).then(r => r.rows[0].r);

// ── Function ──
await assert.rejects(upd(null, B1, { surname: 'X' }), /booking_required/, 'no booking: refused');
await assert.rejects(upd('', B1, { surname: 'X' }), /booking_required/);
await assert.rejects(upd('BOOK-A', B1, { surname: 'X' }), /not_found/, 'another booking\'s row');
await assert.rejects(upd('BOOK-D', D1, { surname: 'X' }), /not_found/, 'another property\'s row');
await assert.rejects(upd('BOOK-T', T1, { surname: 'X' }), /not_found/, 'test row from a real session');
assert.equal((await row(B1)).surname, 'BIANCHI', 'untouched');
let out = await upd('BOOK-B', B1, { surname: 'BIANCHI-ROSSI', guest_type: 'head', alloggiati_status: 'filed', property_id: P2, booking_code: 'X' });
assert.equal(out.surname, 'BIANCHI-ROSSI'); assert.equal(out.guest_type, 'single', 'role not editable'); assert.equal(out.alloggiati_status, 'pending', 'status not editable');
assert.equal(out.property_id, P); assert.equal(out.booking_code, 'BOOK-B'); assert.ok(out.guest_edited_at);
// Party date change: everyone, nights recomputed, one transaction.
out = await upd('BOOK-A', A1, { arrival_date: '2026-12-11', departure_date: '2026-12-15' });
for (const id of [A1, A2, A3]) assert.deepEqual(await row(id).then(r => [r.a, r.d, r.nights]), ['2026-12-11', '2026-12-15', 4]);
// A companion editing dates changes only their own row (not the party).
await upd('BOOK-A', A2, { departure_date: '2026-12-16' });
assert.equal((await row(A2)).d, '2026-12-16'); assert.equal((await row(A1)).d, '2026-12-15');
// Filed companion: the whole date edit is refused and nothing changes.
await assert.rejects(upd('BOOK-C', C1, { arrival_date: '2026-12-11' }), /party_filed/);
assert.equal((await row(C1)).a, '2026-12-10', 'leader unchanged after refusal');
assert.equal(await upd('BOOK-C', C1, { name: 'Ok' }).then(r => r.name), 'Ok', 'non-date edit still allowed');
await assert.rejects(upd('BOOK-C', C2, { name: 'X' }), /already_filed/);
await assert.rejects(upd('BOOK-B', B1, { arrival_date: '2026-12-14', departure_date: '2026-12-13' }), /invalid_dates/);
// Injected companion failure → full rollback (the leader keeps the old dates).
await db.exec(`create function public.fail_companion() returns trigger language plpgsql as $$ begin
  if new.guest_type = 'member' and new.arrival_date is distinct from old.arrival_date then raise exception 'injected companion failure'; end if; return new; end $$;
  create trigger fail_companion before update on public.checkins for each row execute function public.fail_companion();`);
await assert.rejects(upd('BOOK-A', A1, { arrival_date: '2026-12-12' }), /injected companion failure/);
assert.equal((await row(A1)).a, '2026-12-11', 'leader rolled back with the party');
await db.exec('drop trigger fail_companion on public.checkins');
for (const role of ['anon', 'authenticated']) assert.equal((await db.query(`select has_function_privilege('${role}','public.guest_update_checkin(uuid,text,boolean,uuid,jsonb)','EXECUTE') a`)).rows[0].a, false);

// ── Actual handler ──
const originalFetch = global.fetch; const rpcs = [];
global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('/rpc/guest_update_checkin')) {
    const a = JSON.parse(init.body); rpcs.push(a);
    try { return Response.json((await db.query('select public.guest_update_checkin($1,$2,$3,$4,$5) r', [a.p_property, a.p_booking, a.p_is_test, a.p_id, JSON.stringify(a.p_patch)])).rows[0].r); }
    catch (e) { return Response.json({ code: 'P0001', message: e.message }, { status: 400 }); }
  }
  if (url.includes('/rest/v1/checkins?') && (!init.method || init.method === 'GET')) {
    const u = new URL(url); const g = k => (u.searchParams.get(k) || '').replace(/^eq\./, '');
    const r = await db.query(`select * from public.checkins where id::text=$1 and property_id::text=$2 and booking_code=$3 and is_test=$4 and deleted_at is null`, [g('id'), g('property_id'), g('booking_code'), g('is_test') === 'true']);
    return Response.json(r.rows);
  }
  if (url.includes('/rest/v1/checkins') && init.method === 'PATCH') throw new Error('handler must not PATCH checkins directly any more');
  if (url.includes('/properties?')) return Response.json([{ region: null, invoice_required: false }]);
  if (url.includes('/rest/v1/api_usage')) return new Response(null, { status: 201 });
  return Response.json([]);
};
const tok = (b, p = P) => signGuestToken({ p, s: 'fictional', ...(b ? { b } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }).token;
const call = async (token, id, fields) => { let status = 200, body;
  await guest({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer ' + token }, body: { action: 'checkin_update', id, fields } },
    { setHeader() {}, status(n) { status = n; return this; }, json(v) { body = v; return this; }, end() { return this; }, write() {} });
  return { status, body }; };
try {
  const before = await row(B1);
  let r = await call(tok(null), B1, { surname: 'HACKED' });
  assert.equal(r.status, 403); assert.deepEqual(r.body, { error: 'booking_required' }, 'property-only token: refused, nothing returned');
  r = await call(tok('BOOK-A'), B1, { surname: 'HACKED' }); assert.equal(r.status, 404); assert.deepEqual(r.body, { error: 'not_found' }, 'other booking: no data in the answer');
  r = await call(tok('BOOK-D', P), D1, { surname: 'HACKED' }); assert.equal(r.status, 404, 'other property');
  r = await call(tok('BOOK-B'), 'not-a-uuid', { surname: 'HACKED' }); assert.equal(r.status, 404);
  assert.equal((await row(B1)).surname, before.surname, 'no change from any mismatch');
  r = await call(tok('BOOK-B'), B1, { surname: 'BIANCHI' }); assert.equal(r.status, 200); assert.equal(r.body.updated.surname, 'BIANCHI');
  assert.ok(!('keybox_code' in r.body.updated) || r.body.updated.keybox_code == null);
  r = await call(tok('BOOK-C'), C1, { arrival_date: '2026-12-11', departure_date: '2026-12-13', nights: 2 }); assert.equal(r.status, 409); assert.equal(r.body.error, 'party_filed', 'clear error, no partial success');
  r = await call(tok('BOOK-A'), A1, { arrival_date: '2026-12-12', departure_date: '2026-12-14', nights: 2 }); assert.equal(r.status, 200);
  for (const id of [A1, A2, A3]) assert.equal((await row(id)).a, '2026-12-12', 'whole party moved');
  assert.ok(rpcs.every(a => a.p_booking), 'the function is only reached with a booking');
} finally { global.fetch = originalFetch; }
const src = read('api/guest.js'); const h = src.slice(src.indexOf('async function doCheckinUpdate('), src.indexOf('\n}\n', src.indexOf('async function doCheckinUpdate(')));
assert.ok(!/fan-out failed|method: 'PATCH'/.test(h), 'no separate, error-swallowing companion PATCH left');
console.log('PASS round74 check-in edits (WBNB-R002 + Y003): no booking → refused (function and handler, 403 with no data); other booking / other property / test-real mismatch / bad id → not found, nothing changed, no identity returned; role, status, property and booking not editable; main-guest date change moves the whole party with nights recomputed in one transaction; filed companion → whole edit refused (party_filed); filed row → already_filed; departure before arrival refused; injected companion failure rolls the leader back; companions edit only their own dates; function service_role only; handler never PATCHes check-ins directly');
