// Integrated fictional pilot: real signed gateway, AI context builder, SQL
// submissions/roster/admin audit/history and secure rollback configuration.
import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {createEntryFixture} from './helpers/entry-fixture.mjs';
import {readEnvironment,publicConfiguration} from '../lib/environment.mjs';
process.env.GUEST_TOKEN_SECRET='fictional-round66-pilot-secret-long-enough';process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service';process.env.ANTHROPIC_API_KEY='fictional-ai-key';
const {signGuestToken}=await import('../api/_guest-token.js');const {default:guest}=await import('../api/guest.js');const {default:chat}=await import('../api/chat.js');
const f=await createEntryFixture(),{db,id,pid,other,reservation,owner,code,row,asRole}=f;let checks=0,upstream=null;
try{
 await db.exec("alter table properties add column name text,add column wifi_name text,add column wifi_password text;update properties set name='Fictional pilot',wifi_name='WIFI-PILOT',wifi_password='WIFI-SECRET';");
 const historyTest=fs.readFileSync(new URL('./entry-chat-history.test.mjs',import.meta.url),'utf8');const ddl=historyTest.match(/await db\.exec\(`(alter table properties[\s\S]*?)`\);/)[1];await db.exec(ddl);
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/20261029043321_round66_chat_history_guard.sql',import.meta.url),'utf8'));
 const room=id(80);await db.query("insert into property_rooms values($1,$2,null,'ROOM-PILOT','Fictional blue',2)",[room,pid]);await db.query("update ota_reservations set room_id=$1,keybox_code='ROTATING-PILOT' where id=$2",[room,reservation]);await db.query('update properties set rotating_lockbox_enabled=true where id=$1',[pid]);
 const actor=async(uid,fn)=>asRole('authenticated',async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return fn(tx);});
 await db.query("insert into auth.users values($1,'admin@example.invalid',now()),($2,'owner@example.invalid',now())",[id(90),owner]);await db.exec("insert into admin_users values('admin@example.invalid')");
 global.fetch=async(url,o={})=>{
  const u=new URL(url),path=u.pathname.split('/rest/v1/')[1];
  if(u.hostname==='api.anthropic.com'){upstream=JSON.parse(o.body);return Response.json({content:[{type:'text',text:'<reply>Fictional reply</reply><followups></followups>'}]});}
  if(!path)return Response.json([]);
  if(path.startsWith('rpc/')){
   const name=path.slice(4),a=JSON.parse(o.body||'{}');
   try{
    if(name==='get_reservation_keybox')return Response.json(null); // no lock-code generation in this pilot
    if(name==='get_entry_chat_delivery')return Response.json(await asRole('service_role',tx=>tx.query('select public.get_entry_chat_delivery($1,$2,$3,$4) data',[a.p_property_id,a.p_booking_code,a.p_is_test,a.p_since]).then(r=>r.rows[0].data)));
    if(name==='entry_access_host_state')return Response.json(await actor(o.headers.Authorization==='Bearer fictional-admin'?id(90):owner,tx=>tx.query('select public.entry_access_host_state($1,$2,$3) data',[a.p_property_id,a.p_booking_code,a.p_is_test]).then(r=>r.rows[0].data)));
    const result=await f.callRPC(name,a);return Response.json(await result.json(),{status:result.ok?200:503});
   }catch(_){return Response.json({error:'fixture denial'},{status:403});}
  }
  const table=path.split('?')[0];
  if(table==='api_usage')return Response.json([],{headers:{'content-range':'*/0'}});
  if(['properties','ota_reservations','checkins','property_rooms'].includes(table)){
   if(o.method==='PATCH'){
    assert.equal(table,'checkins');const target=u.searchParams.get('id')?.slice(3),v=JSON.parse(o.body);assert.deepEqual(Object.keys(v),['keybox_code']);await db.query('update checkins set keybox_code=$1 where id=$2',[v.keybox_code,target]);return Response.json([]);
   }
   return Response.json(await (await f.pgrestGET(path+u.search)).json());
  }
  return Response.json([],{headers:{'content-range':'*/0'}});
 };
 const token=signGuestToken({p:pid,b:code,s:'fictional-pilot',exp:Math.floor(Date.now()/1000)+3600}).token;
 async function request(action,extra={},handler=guest,auth='Bearer '+token){let status,body,headers={};await handler({method:'POST',headers:{origin:'https://app.welcomebnb.it',authorization:auth},body:{action,...extra}},
  {setHeader(k,v){headers[k]=v;},status(n){status=n;return this;},json(v){body=v;return this;},write(){},end(){}});return {status,body,headers};}
 const forbidden=r=>{for(const value of ['FIXED-FICTIONAL','Fictional entry','ROOM-PILOT','ROTATING-PILOT','WIFI-SECRET'])assert.ok(!JSON.stringify(r.body).includes(value),value+' withheld');checks++;};
 const read=()=>request('property',{property_id:other,booking_code:'FORGED',is_test:true});
 let response=await read();forbidden(response);assert.equal(response.body.checked_in,false);
 const ids=[];async function submit(n){const uid=randomUUID();ids.push(uid);const r=await request('checkin_insert',{record:row(n),submission_id:uid,guest_ordinal:n});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.expected_count,3);checks++;}
 await submit(1);response=await read();assert.equal(response.body.entry_release.submitted,1);assert.equal(response.body.entry_release.expected,3);forbidden(response);
 await actor(owner,tx=>tx.query("insert into chat_messages(property_id,booking_code,is_test,sender,message) values($1,$2,false,'host','HOST-PILOT-SECRET'),($1,$2,false,'bot','OLD-BOT-PILOT-SECRET')",[pid,code]));
 let history=await request('history');assert.ok(history.body.messages.every(m=>m.entry_withheld));checks++;
 async function host(){return request('host_entry_state',{property_id:pid,booking_code:code,is_test:false},guest,'Bearer fictional-admin');}
 let state=await host();assert.equal(state.body.entry_release.state,'locked');assert.equal(state.body.entry_release.submitted,1);checks++;
 async function override(yes){const s=(await host()).body.summary;await actor(id(90),tx=>tx.query('select public.entry_access_set_release($1,$2,$3,$4)',[s.booking_id,yes,s.state_version,randomUUID()]));}
 await override(true);response=await read();assert.equal(response.body.entry_release.state,'manual');assert.equal(response.body.property.keybox_code,'FIXED-FICTIONAL');assert.equal(response.body.room.door_code,'ROOM-PILOT');assert.equal(response.body.rotating_code,'ROTATING-PILOT');checks++;
 await override(false);forbidden(await read());
 await submit(2);forbidden(await read());await submit(3);response=await read();assert.equal(response.body.entry_release.state,'available');assert.equal(response.body.rotating_code,'ROTATING-PILOT');checks++;
 history=await request('history');assert.equal(history.body.messages.find(m=>m.sender==='host').message,'HOST-PILOT-SECRET');assert.equal(history.body.messages.find(m=>m.sender==='bot').entry_withheld,true);checks+=2;
 async function ai(){upstream=null;const r=await request('',{messages:[{role:'assistant',content:'OLD-CONTEXT-SECRET'},{role:'user',content:'Where are the keys?'}],propertyContext:'FORGED-SECRET',stayContext:{groupSize:1}},chat);assert.equal(r.status,200);assert.ok(!JSON.stringify(upstream).includes('FORGED-SECRET'));assert.ok(!JSON.stringify(upstream).includes('OLD-CONTEXT-SECRET'));return JSON.stringify(upstream);}
 assert.match(await ai(),/FIXED-FICTIONAL/);checks++;
 await db.query('update checkins set checkin_reopened_at=now() where id=$1',[ids[1]]);forbidden(await read());assert.ok(!(await ai()).includes('FIXED-FICTIONAL'));checks++;
 await db.query('update checkins set checkin_reopened_at=null where id=$1',[ids[1]]);
 await db.query("update properties set entry_release_time='23:59',entry_release_timezone='Europe/Rome' where id=$1",[pid]);response=await read();assert.equal(response.body.entry_release.state,'scheduled');forbidden(response);
 // Rollback pause changes only activation/override UI; secure data paths stay on.
 const paused=publicConfiguration(readEnvironment({ENTRY_RELEASE_UI_ENABLED:'false'}));assert.equal(paused.entryReleaseUiEnabled,false);assert.ok(!JSON.stringify(paused).includes('fictional-service'));checks++;
 forbidden(await request('keybox'));forbidden(await request('checkin_list'));history=await request('history');assert.ok(history.body.messages.every(m=>m.entry_withheld));assert.ok(!(await ai()).includes('FIXED-FICTIONAL'));checks+=2;
 await override(true);assert.equal((await read()).body.entry_release.state,'manual');await override(false);forbidden(await read());
 await db.query("update ota_reservations set status='cancelled' where id=$1",[reservation]);forbidden(await read());assert.equal((await host()).body.entry_release.state,'unavailable');checks++;
 assert.ok((await db.query("select count(*)::int n from admin_impersonation_log where action='entry_released'")).rows[0].n>=2);checks++;
 console.log(`PASS ${checks} integrated fictional pilot/rollback checks: signed gateway -> real SQL guest saves -> host/admin status and audit -> release/restore -> history and AI context; reopen, schedule, cancelled booking, forged scope and pause keep secrets closed.`);
}finally{await db.close();}
