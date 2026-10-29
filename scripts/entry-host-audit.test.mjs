import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createEntryFixture} from './helpers/entry-fixture.mjs';
const {db,id,pid,other,off,reservation,owner,code,scope,args,save,row,callRPC,pgrestGET,asRole}=await createEntryFixture();
let checks=0;
try {
  const admin=id(90);
  await db.query("insert into auth.users values($1,'admin@example.invalid',now()),($2,'owner@example.invalid',now()),($3,'other@example.invalid',now())",[admin,owner,id(91)]);
  await db.exec("insert into admin_users values('admin@example.invalid')");
  async function actor(uid,fn,role='authenticated'){
    return asRole(role,async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);return fn(tx);});
  }
  const hostState=(uid,property=pid,booking=code,test=false)=>actor(uid,tx=>tx.query('select public.entry_access_host_state($1,$2,$3) data',[property,booking,test]).then(r=>r.rows[0].data));
  const confirmAs=(uid,version)=>actor(uid,tx=>tx.query("select public.entry_access_confirm_roster($1,$2,3,'2026-11-01','2026-11-05',$3,$4,$5,false) data",[pid,code,randomUUID(),reservation,version]).then(r=>r.rows[0].data));
  const releaseAs=(uid,b,yes,request=randomUUID())=>actor(uid,tx=>tx.query('select public.entry_access_set_release($1,$2,$3,$4) data',[b.booking_id,yes,b.state_version,request]).then(r=>r.rows[0].data));
  for(const role of ['anon','service_role'])await assert.rejects(actor(owner,tx=>tx.query('select public.entry_access_host_state($1,$2,false)',[pid,code]),role),e=>e.code==='42501');
  await assert.rejects(hostState(id(91)),e=>e.code==='42501');checks+=3;
  assert.equal((await save(1)).enabled,true);checks++;
  let state=await hostState(owner),b=state.summary;
  assert.equal(state.snapshot.current_rows.length,1);
  let after=await confirmAs(admin,b.state_version);assert.equal(after.expected_count,3);checks++;
  const request=randomUUID(),previous=after;
  after=await releaseAs(admin,after,true,request);assert.equal(after.released_manually,true);checks++;
  const log=(await db.query('select * from admin_impersonation_log order by created_at')).rows;
  assert.ok(log.some(r=>r.admin_id===admin&&r.property_id===pid&&r.action==='entry_released'));
  assert.equal((await db.query("select actor_id from entry_access.audit where action='entry_released'")).rows[0].actor_id,admin);checks++;
  assert.deepEqual(await releaseAs(admin,previous,true,request),after);
  assert.equal((await db.query("select count(*)::int n from admin_impersonation_log where action='entry_released'")).rows[0].n,1);checks++;
  // Audit failure rolls back both the state change and the immutable entry event.
  await db.exec("create function public.fixture_admin_audit_fail() returns trigger language plpgsql as $$begin raise exception 'fixture audit failure';end$$;create trigger fixture_admin_audit_fail before insert on admin_impersonation_log for each row execute function public.fixture_admin_audit_fail();");
  const baseline=(await db.query('select * from entry_access.bookings where id=$1',[after.booking_id])).rows[0];
  const audits=(await db.query('select count(*)::int n from entry_access.audit')).rows[0].n;
  await assert.rejects(releaseAs(admin,after,false),e=>e.code==='P0001');
  assert.deepEqual((await db.query('select * from entry_access.bookings where id=$1',[after.booking_id])).rows[0],baseline);
  assert.equal((await db.query('select count(*)::int n from entry_access.audit')).rows[0].n,audits);checks++;
  await db.exec('drop trigger fixture_admin_audit_fail on admin_impersonation_log');
  after=await releaseAs(admin,after,false);assert.equal(after.released_manually,false);checks++;
  // Actual HTTP host route uses real SQL role/actor authorization and strips PII/codes.
  process.env.GUEST_TOKEN_SECRET='fictional-round66-integrated-secret-000000000000';process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service';
  const {default:gateway}=await import('../api/guest.js');
  global.fetch=async(url,options)=>{
    assert.ok(String(url).endsWith('/rpc/entry_access_host_state'));
    const auth=options.headers.Authorization;
    try {const a=JSON.parse(options.body);const data=await hostState(auth==='Bearer fictional-admin'?admin:auth==='Bearer fictional-owner'?owner:id(91),a.p_property_id,a.p_booking_code,a.p_is_test);return new Response(JSON.stringify(data),{status:200});}
    catch(_){return new Response('{}',{status:403});}
  };
  async function http(auth,scope=pid){let body,status;await gateway({method:'POST',headers:{origin:'https://app.welcomebnb.it',authorization:auth},body:{action:'host_entry_state',property_id:scope,booking_code:code,is_test:false}},
    {setHeader(){},status(n){status=n;return this;},json(v){body=v;return this;},end(){return this;}});return {body,status};}
  let response=await http('Bearer fictional-admin');assert.equal(response.status,200,JSON.stringify(response.body));assert.equal(response.body.entry_release.state,'locked');assert.equal(response.body.entry_release.submitted,1);assert.equal(response.body.entry_release.expected,3);
  for(const secret of ['FICTIONAL123','FIXED-FICTIONAL','Guest1','Synthetic'])assert.ok(!JSON.stringify(response.body).includes(secret));checks++;
  assert.equal((await http('Bearer other')).status,403);assert.equal((await http(null)).status,401);checks+=2;
  await db.query("insert into properties(id,owner_id,entry_checkin_required) values($1,$2,true)",[id(92),id(91)]);assert.equal((await http('Bearer fictional-owner',id(92))).status,403);checks++;
  await save(2);await save(3);response=await http('Bearer fictional-owner');assert.equal(response.body.entry_release.state,'available');checks++;
  await db.query("update properties set entry_release_time='23:59',entry_release_timezone='Europe/Rome' where id=$1",[pid]);
  response=await http('Bearer fictional-owner');assert.equal(response.body.entry_release.state,'scheduled');checks++;
  after=await releaseAs(owner,after,true);response=await http('Bearer fictional-owner');assert.equal(response.body.entry_release.state,'manual');checks++;
  after=await releaseAs(owner,after,false);assert.equal((await http('Bearer fictional-owner')).body.entry_release.state,'scheduled');checks++;
  await db.query('update auth.users set email_confirmed_at=null where id=$1',[admin]);await assert.rejects(hostState(admin),e=>e.code==='42501');checks++;await db.query('update auth.users set email_confirmed_at=now() where id=$1',[admin]);
  await db.exec("delete from admin_users where email='admin@example.invalid'");await assert.rejects(hostState(admin),e=>e.code==='42501');await assert.rejects(releaseAs(admin,after,true),e=>e.code==='42501');checks+=2;
  await assert.rejects(actor(owner,tx=>tx.query('select entry_access.booking_snapshot($1,$2,false)',[pid,code])),e=>e.code==='42501');checks++;
  console.log(`PASS ${checks} actual SQL/HTTP host-admin audit and release/restore checks: tenant/role denial, real actor, idempotency, audit rollback, current membership, shared completion/time policy and no secret response.`);
} finally { await db.close(); }
