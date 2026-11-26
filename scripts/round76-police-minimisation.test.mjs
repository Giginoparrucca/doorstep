// Round 76 Phase 2 — police data minimised after filing (DM 7/1/2013 art.
// 4-bis; Garante 29/4/2026; Annex B of the host agreement). Real migration in
// PGlite (twice) next to the real retention guard: photos queued and cleared
// at filing; identity fields erased 24 h after filing, or for properties with
// regional statistics at the end of the month after departure; unfiled rows
// untouched; birth year and exact age at arrival kept; dry run changes
// nothing; idempotent; the filed lock still refuses every other change; only
// service_role may run it. Console and regional exports handle erased rows.
// Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261118100000_round76_police_data_minimisation.sql';

let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;
    create table public.properties(id uuid primary key, owner_id uuid, region text);
    create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id), booking_code text, is_test boolean default false,
      guest_type text not null default 'single', surname text not null, name text not null, sex text not null default 'F', date_of_birth date not null, place_of_birth text not null,
      province_of_birth text, state_of_birth text, birth_province text, birth_country text, citizenship text not null default 'Italia',
      document_type text not null, document_number text not null, doc_issue_place text, arrival_date date, departure_date date, nights int,
      alloggiati_status text default 'pending', filed_at timestamptz, deleted_at timestamptz, submitted_at timestamptz, created_at timestamptz default now(),
      id_photo_path text, selfie_photo_path text, residence_country text default 'Italia');
    create table public.storage_purge_queue(id bigserial primary key, bucket text not null check (bucket = 'documents'), path text not null, reason text not null, unique (bucket, path));
    grant all on all tables in schema public to service_role, authenticated; grant all on all sequences in schema public to service_role;
    create function public.checkins_prevent_filed_edit() returns trigger language plpgsql as $f$ begin return new; end $f$;
    create trigger checkins_filed_edit_guard before update on public.checkins for each row execute function public.checkins_prevent_filed_edit();`);
  await db.exec(read('supabase/migrations/20261114090000_filed_checkins_retained.sql'));
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  const PUGLIA = '00000000-0000-4000-8000-0000000000a1', ABROAD = '00000000-0000-4000-8000-0000000000a2';
  await db.query(`insert into public.properties values ($1, null, 'Puglia'), ($2, null, null)`, [PUGLIA, ABROAD]);
  const add = async (prop, x) => (await db.query(`insert into public.checkins(property_id, surname, name, date_of_birth, place_of_birth, birth_country, document_type, document_number, doc_issue_place, arrival_date, departure_date, alloggiati_status, filed_at, id_photo_path, selfie_photo_path, submitted_at)
    values ($1,'FICTIONAL',$2,'1990-06-15','Bari','Italia','id_card','CA00000AA','Bari',$3,$4,$5,$6,$7,$8, now() - interval '3 days') returning id`,
    [prop, x.name, x.arr, x.dep, x.filed ? 'filed' : 'pending', x.filed || null, x.photo || null, x.selfie || null])).rows[0].id;
  const today = new Date(); const ymd = d => d.toISOString().slice(0, 10); const daysAgo = n => new Date(Date.now() - n * 86400000);
  const A = await add(PUGLIA, { name: 'A', arr: ymd(daysAgo(2)), dep: ymd(daysAgo(1)), filed: daysAgo(1).toISOString(), photo: 'p/a.jpg', selfie: 'p/a-s.jpg' }); // regional, departed this month → photos only
  const D = await add(PUGLIA, { name: 'D', arr: ymd(daysAgo(75)), dep: ymd(daysAgo(70)), filed: daysAgo(74).toISOString() });                                 // regional, window closed → erased
  const B = await add(ABROAD, { name: 'B', arr: ymd(daysAgo(3)), dep: ymd(daysAgo(1)), filed: new Date(Date.now() - 25 * 3600e3).toISOString(), photo: 'p/b.jpg' }); // no regional duty, filed 25 h ago → erased
  const E = await add(ABROAD, { name: 'E', arr: ymd(today), dep: ymd(daysAgo(-2)), filed: new Date(Date.now() - 3600e3).toISOString(), photo: 'p/e.jpg' });          // filed 1 h ago → photos only
  const C = await add(ABROAD, { name: 'C', arr: ymd(daysAgo(10)), dep: ymd(daysAgo(8)), photo: 'p/c.jpg' });                                                    // unfiled → untouched
  const as = (role, q, a = []) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role })]); return tx.query(q, a); });
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, 'select public.minimise_filed_checkins(false)'), /permission denied/, role + ': cannot run it');
  const snap = async () => JSON.stringify((await db.query('select * from public.checkins order by name')).rows) + JSON.stringify((await db.query('select * from public.storage_purge_queue')).rows);
  const before = await snap();
  const dry = (await as('service_role', 'select public.minimise_filed_checkins(true) r')).rows[0].r;
  assert.deepEqual(dry, { dry_run: true, photos: 3, identity: 2 }); assert.equal(await snap(), before, 'dry run changes nothing');
  const run = (await as('service_role', 'select public.minimise_filed_checkins(false) r')).rows[0].r;
  assert.deepEqual(run, { dry_run: false, photos: 3, identity: 2 });
  const row = async id => (await db.query('select * from public.checkins where id = $1', [id])).rows[0];
  for (const id of [D, B]) {
    const r = await row(id);
    assert.deepEqual([r.document_type, r.document_number, r.doc_issue_place, r.place_of_birth, r.birth_country, r.date_of_birth], [null, null, null, null, null, null], 'identity erased');
    assert.equal(r.birth_year, 1990); assert.ok(r.age_at_arrival >= 35 && r.age_at_arrival <= 36); assert.ok(r.identity_erased_at);
    assert.deepEqual([r.surname, r.sex, r.citizenship, r.alloggiati_status], ['FICTIONAL', 'F', 'Italia', 'filed'], 'stay record kept');
  }
  for (const id of [A, E]) { const r = await row(id); assert.equal(r.document_number, 'CA00000AA', 'not yet due'); assert.equal(r.identity_erased_at, null); assert.equal(r.id_photo_path, null, 'photos gone at filing'); assert.equal(r.selfie_photo_path, null); }
  const c = await row(C); assert.equal(c.document_number, 'CA00000AA'); assert.equal(c.id_photo_path, 'p/c.jpg', 'unfiled: untouched (the 7-day photo rule applies)');
  assert.deepEqual((await db.query(`select path, reason from public.storage_purge_queue order by path`)).rows, [{ path: 'p/a-s.jpg', reason: 'filed_minimised' }, { path: 'p/a.jpg', reason: 'filed_minimised' }, { path: 'p/b.jpg', reason: 'filed_minimised' }, { path: 'p/e.jpg', reason: 'filed_minimised' }]);
  assert.deepEqual((await as('service_role', 'select public.minimise_filed_checkins(false) r')).rows[0].r, { dry_run: false, photos: 0, identity: 0 }, 'idempotent');
  // The filed lock still refuses everything else, for every API role.
  for (const role of ['authenticated', 'service_role']) {
    await assert.rejects(as(role, `update public.checkins set document_number = null where id = $1`, [A]), /checkin_locked_filed/, role + ': no manual erasure');
    await assert.rejects(as(role, `update public.checkins set surname = 'X' where id = $1`, [B]), /checkin_locked_filed/, role + ': stay record locked');
    await assert.rejects(as(role, `delete from public.checkins where id = $1`, [B]), /checkin_filed_retained/, role + ': filed rows stay (receipt evidence)');
  }
  console.log('  db: minimisation checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// Console
const html = read('host-console.html');
const fn = name => { const i = html.indexOf('function ' + name + '('); return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const ctx = { hostLang: 'it', toasts: [], toast(m) { ctx.toasts.push(m); } }; vm.createContext(ctx);
vm.runInContext(['_identityErased', '_identityErasedText', '_skipErasedForExport', '_ageAtArrival'].map(n => n === '_identityErased' ? html.slice(html.indexOf('function _identityErased('), html.indexOf('\n', html.indexOf('function _identityErased(')) + 1) : n === '_identityErasedText' ? html.slice(html.indexOf('function _identityErasedText('), html.indexOf('\n', html.indexOf('function _identityErasedText(')) + 1) : fn(n)).join('\n'), ctx);
const kept = vm.runInContext(`_skipErasedForExport([{id:1},{id:2,identity_erased_at:'2026-11-18'}])`, ctx);
assert.deepEqual(JSON.parse(JSON.stringify(kept)), [{ id: 1 }]); assert.match(ctx.toasts[0], /1 ospiti già inviati esclusi: i loro dati di identità sono stati cancellati per legge/);
assert.equal(vm.runInContext(`_ageAtArrival({date_of_birth:null, age_at_arrival:9, arrival_date:'2026-11-01'})`, ctx), 9, 'tax age after erasure');
assert.equal(vm.runInContext(`_ageAtArrival({date_of_birth:'2016-11-02', arrival_date:'2026-11-01'})`, ctx), 9);
assert.match(html, /hasDocs: !!row\.document_number \|\| !!row\.identity_erased_at,/, 'erased guests still count as documented');
assert.match(html, /toExport = typeof _skipErasedForExport === 'function' \? _skipErasedForExport\(toExport\) : toExport;[\s\S]*Round 40 T2/, 'Alloggiati export skips erased rows');
for (const marker of ['data-identity-erased', 'data-identity-erased-notice', 'data-identity-erased-doc', 'data-identity-erased-edit']) assert.ok(html.includes(marker), marker);
// Regional exports
const R = require('../lib/regional-exports.js');
const src = read('lib/regional-exports.js');
assert.match(src, /if\(r\.identity_erased_at&&\['ross','ps','spot'\]\.includes\(format\)\)\{errors\.push\(issue\(r\.id,'identity','erased'\)\);continue;\}/);
assert.match(src, /function spotAge\(row\)\{if\(!row\.date_of_birth&&Number\.isInteger\(row\.age_at_arrival\)\)return row\.age_at_arrival;/);
assert.match(read('host-regional-exports.js'), /erased:text\('dati già cancellati per legge/);
assert.match(read('host-regional-exports.js'), /room_id,birth_year,age_at_arrival,identity_erased_at,statistics_erased_at,autofile_excluded'\)/, 'the export query fetches the erasure markers and the stored age');
assert.ok(R, 'regional module loads');
console.log('PASS round76 police minimisation: service_role only; dry run changes nothing; photos queued and cleared at filing; identity erased 24 h after filing or, with regional statistics, at the end of the month after departure; unfiled untouched; birth year and age at arrival kept; stay record kept and still locked; filed rows not deletable; idempotent; console keeps erased guests documented, explains the erasure, skips them in exports and uses the stored age; regional exports report erased rows clearly');
