// Executes the STAGED SQL against disposable PostgreSQL WASM. No hosted data.
// Round 65 owns dependency changes: use the separately installed pinned module
// via ENTRY_PGLITE_MODULE until its package/lockfile work can be reconciled.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
let PGlite;
try {
  ({ PGlite } = await import(process.env.ENTRY_PGLITE_MODULE
    ? pathToFileURL(process.env.ENTRY_PGLITE_MODULE).href : '@electric-sql/pglite'));
} catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.error('SKIP entry storage needs pinned @electric-sql/pglite@0.3.14 (ENTRY_PGLITE_MODULE); no hosted DB substitute');
  process.exit(77);
}
const sql = fs.readFileSync(new URL('../docs/entry-release/staged-migrations/20261026072310_round66_entry_roster_audit.sql', import.meta.url), 'utf8');
const db = new PGlite();
let checks = 0;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner = id(1), stranger = id(2), property = id(10), foreignProperty = id(20), reservation = id(30);
async function rejects(action, expectedCode) {
  await assert.rejects(action, e => { assert.equal(e.code, expectedCode, e.message); return true; }); checks++;
}
async function actor(user, action, role='authenticated') {
  assert.ok(['authenticated','anon','service_role'].includes(role));
  return db.transaction(async tx => {
    await tx.exec(`SET LOCAL ROLE ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user || '']);
    return action(tx);
  });
}
function confirm(tx, extra={}) {
  const p={ property, code:'BOOK-A', count:3, arrival:'2026-11-01', departure:'2026-11-05',
    request:randomUUID(), reservation, version:null, test:false, ...extra };
  return tx.query(`select public.entry_access_confirm_roster($1::uuid,$2::text,$3::integer,$4::date,
    $5::date,$6::uuid,$7::uuid,$8::uuid,$9::boolean) result`,
  [p.property,p.code,p.count,p.arrival,p.departure,p.request,p.reservation,p.version,p.test])
    .then(r=>r.rows[0].result);
}
function release(tx, b, yes, request=randomUUID(), version=b.state_version) {
  return tx.query('select public.entry_access_set_release($1::uuid,$2::boolean,$3::uuid,$4::uuid) result',
    [b.booking_id,yes,version,request]).then(r=>r.rows[0].result);
}
const rows=async (table,booking)=> (await db.query(`select * from entry_access.${table} where booking_id=$1 order by created_at,id`,[booking])).rows;
const current=async b=>(await db.query('select * from entry_access.bookings where id=$1',[b.booking_id])).rows[0];
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create schema auth; grant usage on schema auth to authenticated,anon,service_role;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.properties(id uuid primary key,owner_id uuid,deleted_at timestamptz);
    create table public.ota_reservations(id uuid primary key,property_id uuid,booking_code text,is_test boolean,
      status text,entry_type text,deleted_at timestamptz,guest_count integer,checkin_date date,checkout_date date);
    create table public.checkins(id uuid primary key,property_id uuid,booking_code text,is_test boolean,deleted_at timestamptz);
  `);
  await db.query('insert into properties(id,owner_id) values($1,$2),($3,$4)',[property,owner,foreignProperty,stranger]);
  await db.query(`insert into ota_reservations values($1,$2,'BOOK-A',false,'active','reservation',null,3,'2026-11-01','2026-11-05')`,[reservation,property]);
  await db.exec(sql);
  await db.exec(sql); // clean reapplication without widening grants or erasing data
  checks++;
  const acl=(await db.query(`select
    has_schema_privilege('authenticated','entry_access','usage') host_private,
    has_table_privilege('service_role','entry_access.audit','update') server_audit_update,
    has_function_privilege('anon','public.entry_access_set_release(uuid,boolean,uuid,uuid)','execute') anon_release,
    has_function_privilege('authenticated','public.entry_access_set_release(uuid,boolean,uuid,uuid)','execute') host_release,
    has_function_privilege('service_role','public.entry_access_set_release(uuid,boolean,uuid,uuid)','execute') service_host_release,
    (select bool_and(relrowsecurity) from pg_class where relnamespace='entry_access'::regnamespace and relkind='r') rls
  `)).rows[0];
  assert.deepEqual(acl,{host_private:false,server_audit_update:false,anon_release:false,host_release:true,service_host_release:false,rls:true}); checks++;
  await rejects(()=>actor(null,tx=>confirm(tx),'anon'),'42501');
  await rejects(()=>actor(null,tx=>confirm(tx)),'42501');
  await rejects(()=>actor(stranger,tx=>confirm(tx)),'42501');
  await rejects(()=>actor(owner,tx=>confirm(tx,{count:2})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{reservation:null})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{reservation:id(99)})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{test:true})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{arrival:'2026-11-02'})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{count:0})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx,{count:51})),'22023');
  const initialRequest=randomUUID();
  let b=await actor(owner,tx=>confirm(tx,{request:initialRequest}));
  let slots=await rows('slots',b.booking_id);
  assert.equal(slots.length,3); assert.equal(b.expected_count,3); checks++;
  assert.deepEqual(await actor(owner,tx=>confirm(tx,{request:initialRequest})),b);
  assert.equal((await rows('audit',b.booking_id)).length,1); checks++;
  await rejects(()=>actor(owner,tx=>confirm(tx,{request:initialRequest,count:4})),'22023');
  await rejects(()=>actor(owner,tx=>confirm(tx)),'40001');
  await rejects(()=>actor(stranger,tx=>release(tx,b,true)),'42501');
  await rejects(()=>actor(null,tx=>release(tx,b,true),'anon'),'42501');
  await rejects(()=>actor(owner,tx=>tx.query('update entry_access.bookings set released_manually=true')),'42501');
  await rejects(()=>actor(owner,tx=>tx.query('insert into entry_access.audit default values')),'42501');
  const releaseRequest=randomUUID(), beforeRelease=b;
  b=await actor(owner,tx=>release(tx,b,true,releaseRequest));
  assert.equal((await current(b)).manual_audit_id,b.audit_id);
  const evidence=(await rows('audit',b.booking_id)).at(-1);
  assert.equal(evidence.actor_id,owner); assert.equal(evidence.action,'entry_released'); checks++;
  assert.deepEqual(await actor(owner,tx=>release(tx,beforeRelease,true,releaseRequest)),b);
  assert.equal((await rows('audit',b.booking_id)).length,2); checks++;
  await rejects(()=>actor(owner,tx=>release(tx,b,false,releaseRequest)),'22023');
  await rejects(()=>actor(owner,tx=>release(tx,b,false,randomUUID(),beforeRelease.state_version)),'40001');

  // Fixture-only injected audit failure: actual RPC rolls back every write.
  await db.exec(`create function entry_access.fixture_fail_audit() returns trigger language plpgsql as $$
    begin if current_setting('entry_fixture.audit_fail',true)='yes' then raise exception 'fixture audit unavailable'; end if; return new; end $$;
    create trigger fixture_fail_audit before insert on entry_access.audit for each row execute function entry_access.fixture_fail_audit();`);
  const snapshot=await current(b), auditCount=(await rows('audit',b.booking_id)).length;
  await rejects(()=>actor(owner,async tx=>{
    await tx.query("select set_config('entry_fixture.audit_fail','yes',true)"); return release(tx,b,false);
  }),'P0001');
  assert.deepEqual(await current(b),snapshot); assert.equal((await rows('audit',b.booking_id)).length,auditCount); checks++;
  await rejects(()=>actor(owner,async tx=>{
    await tx.query("select set_config('entry_fixture.audit_fail','yes',true)");
    return confirm(tx,{count:4,version:b.state_version});
  }),'P0001');
  assert.deepEqual(await current(b),snapshot); assert.deepEqual(await rows('slots',b.booking_id),slots); checks++;
  // Failure AFTER the audit insert also removes its event, not just the state.
  await db.exec(`create function entry_access.fixture_fail_state() returns trigger language plpgsql as $$
    begin if current_setting('entry_fixture.state_fail',true)='yes' then raise exception 'fixture state unavailable'; end if; return new; end $$;
    create trigger fixture_fail_state before update on entry_access.bookings for each row execute function entry_access.fixture_fail_state();`);
  await rejects(()=>actor(owner,async tx=>{
    await tx.query("select set_config('entry_fixture.state_fail','yes',true)"); return release(tx,b,false);
  }),'P0001');
  assert.deepEqual(await current(b),snapshot); assert.equal((await rows('audit',b.booking_id)).length,auditCount); checks++;
  await rejects(()=>actor(owner,async tx=>{
    await tx.query("select set_config('entry_fixture.audit_fail','yes',true)");
    return confirm(tx,{code:'AUDIT-ROLLBACK',reservation:null});
  }),'P0001');
  assert.equal((await db.query("select id from entry_access.bookings where booking_code='AUDIT-ROLLBACK'")).rows.length,0); checks++;
  await rejects(()=>db.query('update entry_access.audit set action=action'),'42501');
  await rejects(()=>db.query('delete from entry_access.audit'),'42501');
  b=await actor(owner,tx=>release(tx,b,false)); assert.equal(b.released_manually,false); assert.equal(b.audit_id,null); checks++;

  // Competing writes with the same optimistic version cannot both succeed.
  // PGlite queues one connection: this proves stale-write exclusion, NOT
  // independent-connection lock scheduling/deadlock behavior.
  const competing=await Promise.allSettled([4,5].map(count=>actor(owner,tx=>confirm(tx,{count,version:b.state_version}))));
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(competing.find(r=>r.status==='rejected').reason.code,'40001'); checks++;
  b=competing.find(r=>r.status==='fulfilled').value;
  await db.query('update ota_reservations set guest_count=2 where id=$1',[reservation]);
  b=await actor(owner,tx=>confirm(tx,{count:2,version:b.state_version}));
  const shrunk=(await rows('slots',b.booking_id)).filter(s=>s.retired_at==null);
  assert.deepEqual(shrunk.map(s=>s.id).sort(),slots.filter(s=>s.ordinal<=2).map(s=>s.id).sort()); checks++;
  b=await actor(owner,tx=>confirm(tx,{count:3,version:b.state_version}));
  const grown=(await rows('slots',b.booking_id)).filter(s=>s.retired_at==null);
  assert.equal(grown.length,3); assert.notEqual(grown.find(s=>s.ordinal===3).id,slots.find(s=>s.ordinal===3).id); checks++;
  b=await actor(owner,tx=>release(tx,b,true)); const oldIdentity=b.identity_version;
  await db.query("update ota_reservations set checkin_date='2026-11-02' where id=$1",[reservation]);
  await rejects(()=>actor(owner,tx=>release(tx,b,true)),'22023');
  b=await actor(owner,tx=>confirm(tx,{count:3,arrival:'2026-11-02',version:b.state_version}));
  assert.notEqual(b.identity_version,oldIdentity); assert.equal(b.released_manually,false); assert.equal(b.audit_id,null); checks++;
  const active=(await rows('slots',b.booking_id)).filter(s=>s.retired_at==null);
  assert.ok(active.every(s=>!grown.some(old=>old.id===s.id))); checks++;
  for(const field of ['status','deleted_at','entry_type']){
    const value=field==='status'?'cancelled':field==='entry_type'?'block':'2026-10-26T00:00:00Z';
    await db.query(`update ota_reservations set ${field}=$1 where id=$2`,[value,reservation]);
    await rejects(()=>actor(owner,tx=>release(tx,b,true)),'22023');
    await rejects(()=>actor(owner,tx=>confirm(tx,{count:3,arrival:'2026-11-02',version:b.state_version})),'22023');
    await db.query(`update ota_reservations set ${field}=$1 where id=$2`,[field==='status'?'active':field==='entry_type'?'reservation':null,reservation]);
  }
  const standalone=await actor(owner,tx=>confirm(tx,{code:'STANDALONE',reservation:null,count:2}));
  assert.equal(standalone.expected_count,2); checks++;
  await db.query("insert into checkins values($1,$2,'BOOK-A',false,null),($3,$4,'BOOK-A',false,null),($5,$2,'OTHER',false,null)",[id(101),property,id(102),foreignProperty,id(103)]);
  const bind=(slot,ci)=>db.query('insert into entry_access.submissions(slot_id,booking_id,property_id,checkin_id) values($1,$2,$3,$4)',[slot,b.booking_id,property,ci]);
  await rejects(()=>bind(active[0].id,id(102)),'23514');
  await rejects(()=>bind(active[0].id,id(103)),'23514');
  await rejects(()=>bind(slots[0].id,id(101)),'23514');
  await bind(active[0].id,id(101)); checks++;
  await rejects(()=>bind(active[1].id,id(101)),'23505');
  await rejects(()=>bind(active[0].id,id(101)),'23505');
  await db.query('update checkins set is_test=true where id=$1',[id(101)]);
  await rejects(()=>db.query('update entry_access.submissions set bound_at=bound_at'),'23514');
  await db.query('update checkins set is_test=false,deleted_at=now() where id=$1',[id(101)]);
  await rejects(()=>db.query('update entry_access.submissions set bound_at=bound_at'),'23514');
  await db.query('delete from ota_reservations where id=$1',[reservation]);
  assert.equal((await current(b)).reservation_id,reservation); checks++;
  await rejects(()=>actor(owner,tx=>release(tx,b,true)),'22023');
  // Existing hard property retention deletes the whole private ledger without
  // unlocking a deleted reservation or blocking unrelated global purge work.
  await db.query('delete from public.properties where id=$1',[property]);
  for(const table of ['bookings','slots','submissions','audit']){
    assert.equal((await db.query(`select count(*) n from entry_access.${table} where property_id=$1`,[property])).rows[0].n,0); checks++;
  }
  console.log(`PASS ${checks} staged SQL storage/authorization/audit scenarios on disposable PostgreSQL; no production migration, handler, activation or multi-connection concurrency pass claimed.`);
} finally { await db.close(); }
