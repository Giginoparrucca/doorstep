// Actual SQL triggers/RPC/policy + guest HTTP handler. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
process.env.GUEST_TOKEN_SECRET='fictional-round66-history-secret-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service-key-long-enough';
const {signGuestToken}=await import('../api/_guest-token.js');
const {default:handler}=await import('../api/guest.js');
const db=new PGlite();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const pid=id(10),off=id(20),other=id(30),owner=id(1),code='FICTIONAL-HISTORY';
let checks=0,failRPC=false;
async function asRole(role,fn){return db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return fn(tx);});}
const originalFetch=global.fetch;
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create schema auth; grant usage on schema auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.properties(id uuid primary key,owner_id uuid,deleted_at timestamptz,
      entry_checkin_required boolean default false,entry_release_time text,entry_release_timezone text,
      access_method text,keybox_code text,show_fixed_lockbox_to_guest boolean default true,
      show_rotating_lockbox_to_guest boolean default true,rotating_lockbox_enabled boolean default false,use_per_guest_lockbox boolean default false);
    create table public.ota_reservations(id uuid primary key,property_id uuid,booking_code text,is_test boolean,
      status text,entry_type text,deleted_at timestamptz,guest_count integer,checkin_date date,checkout_date date,
      room_id uuid,keybox_code text,checkin_reopened_at timestamptz);
    create table public.checkins(id uuid primary key default gen_random_uuid(),property_id uuid,booking_code text,is_test boolean,
      guest_type text,surname text,name text,sex text,date_of_birth date,place_of_birth text,birth_province text,birth_country text,
      citizenship text,document_type text,document_number text,doc_issue_place text,arrival_date date,departure_date date,nights integer,
      id_photo_path text,docs_status text,residence_country text,residence_place text,submitted_at timestamptz,
      deleted_at timestamptz,keybox_code text,room_id uuid,checkin_reopened_at timestamptz);
    create table public.property_rooms(id uuid primary key,property_id uuid,deleted_at timestamptz,door_code text);
    create schema storage; create table storage.objects(bucket_id text,name text);
  `);

 await db.exec(`alter table properties add column region text,add column property_type text;
 create table chat_messages(id uuid primary key default gen_random_uuid(),property_id uuid,booking_code text,is_test boolean default false,
   sender text,message text,created_at timestamptz default now(),deleted_at timestamptz);
 create table chat_qa_pairs(id uuid primary key default gen_random_uuid(),created_at timestamptz default now(),
   question_text text,answer_text text,answered_by text,escalated boolean,category text,language text,message_count integer,
   time_to_first_response_seconds integer,time_to_resolution_seconds integer,property_region text,property_type text,season text,
   stay_length_bucket text,group_size_bucket text,source_hash text unique);
 create table excluded_booking_codes(booking_code text);
 create function public.anonymize_text(t text) returns text language sql as $$select t$$;
 create function public.compute_season(d date) returns text language sql as $$select 'fixture'::text$$;
 create function public.is_admin() returns boolean language sql as $$select current_setting('request.jwt.claim.sub',true)='00000000-0000-4000-8000-000000000001'$$;
 grant select,insert,update on properties,chat_messages to authenticated;
 insert into chat_qa_pairs(question_text,answer_text,source_hash) values('OLD QUESTION','OLD ANSWER','old-unknown');
 `);
 await db.query('insert into properties(id,owner_id,entry_checkin_required) values($1,$4,true),($2,$4,false),($3,$4,true)',[pid,off,other,owner]);
 for(const name of ['20261027041500_round66_entry_roster_audit.sql','20261028033000_round66_entry_access_state_rpc.sql','20261028082453_round66_atomic_submissions.sql']) await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 const migration=fs.readdirSync(new URL('../supabase/migrations',import.meta.url)).find(n=>n.endsWith('_round66_chat_history_guard.sql'));
 await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from entry_access.chat_qa_quarantine')).rows[0].n,1);checks+=2;
 for(const role of ['anon','authenticated']){
   await assert.rejects(asRole(role,tx=>tx.query('select public.get_entry_chat_delivery($1,$2,false,null)',[pid,code])),e=>e.code==='42501');
   await assert.rejects(asRole(role,tx=>tx.query('select * from entry_access.chat_qa_quarantine')),e=>e.code==='42501');checks+=2;
 }
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 async function roster(property=pid,test=false){return asRole('authenticated',async tx=>(await tx.query(
   "select public.entry_access_confirm_roster($1,$2,1,'2099-01-01','2099-01-02',$3,null,null,$4) data",[property,code,randomUUID(),test])).rows[0].data);}
 await roster();await roster(other);await roster(pid,true);
 async function release(value){const b=(await db.query('select * from entry_access.bookings where property_id=$1 and booking_code=$2 and is_test=false',[pid,code])).rows[0];
   return asRole('authenticated',tx=>tx.query('select public.entry_access_set_release($1,$2,$3,$4)',[b.id,value,b.state_version,randomUUID()]));}
 async function insert(property,sender,message,test=false,extra={}){
   return asRole('authenticated',tx=>tx.query(`insert into chat_messages(property_id,booking_code,is_test,sender,message,entry_sensitive,entry_identity_version,entry_content_version)
     values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,[property,code,test,sender,message,extra.entry_sensitive??false,extra.entry_identity_version??null,extra.entry_content_version??'forged']));}
 await insert(pid,'host','PRIVATE-HOST-CODE');await insert(other,'host','FOREIGN-CODE');await insert(pid,'host','TEST-CODE',true);
 const meta=(await db.query('select * from chat_messages where property_id=$1 and is_test=false',[pid])).rows[0];
 assert.equal(meta.entry_sensitive,true);assert.ok(meta.entry_identity_version);assert.notEqual(meta.entry_content_version,'forged');checks+=3;
 global.fetch=async(url,opts={})=>{
   if(String(url).includes('/rpc/get_entry_chat_delivery')){
     if(failRPC)return new Response('fictional unavailable',{status:503});
     const a=JSON.parse(opts.body);
     const result=await asRole('service_role',tx=>tx.query('select public.get_entry_chat_delivery($1,$2,$3,$4) data',[a.p_property_id,a.p_booking_code,a.p_is_test,a.p_since]));
     return Response.json(result.rows[0].data);
   }
   return Response.json([],{headers:{'content-range':'0-0/0'}});
 };
 async function request(action='history',options={}){
   const {token}=signGuestToken({p:options.property||pid,b:code,s:'fixture-session',t:options.test===true,exp:Math.floor(Date.now()/1000)+(options.expired?-1:3600)});
   const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},setHeader(k,v){this.headers[k]=v;},end(){}};
   await handler({method:'POST',headers:{authorization:'Bearer '+token,origin:'https://app.welcomebnb.it'},body:{action,since:'2000-01-01T00:00:00Z',lang:options.lang||'en',property_id:other}},res);
   return res;
 }
 function withheld(res){assert.equal(res.statusCode,200);assert.ok(res.body.entry_chat_restricted);assert.ok(!JSON.stringify(res.body).includes('PRIVATE-HOST-CODE'));
   assert.ok(!JSON.stringify(res.body).includes('FOREIGN-CODE'));assert.ok(!JSON.stringify(res.body).includes('TEST-CODE'));assert.match(res.headers['Cache-Control'],/no-store/);checks++;}
 withheld(await request());withheld(await request('poll'));
 const italian=await request('history',{lang:'it'});assert.match(italian.body.messages[0].message,/Messaggio precedente/);checks++;
 await release(true);
 let response=await request();assert.equal(response.body.messages[0].message,'PRIVATE-HOST-CODE');
 assert.equal(response.body.messages[0].entry_content_version,undefined);assert.equal(response.body.messages[0].entry_identity_version,undefined);checks+=3;
 await release(false);withheld(await request());await release(true);
 await db.query("update properties set keybox_code='CHANGED-PHYSICAL-CODE' where id=$1",[pid]);withheld(await request());
 await insert(pid,'host','CURRENT-HOST-CODE');response=await request();assert.equal(response.body.messages.at(-1).message,'CURRENT-HOST-CODE');checks++;
 const test=await request('history',{test:true});assert.ok(!JSON.stringify(test.body).includes('PRIVATE-HOST-CODE'));assert.ok(!JSON.stringify(test.body).includes('CURRENT-HOST-CODE'));checks++;
 failRPC=true;response=await request();assert.equal(response.statusCode,503);assert.ok(!JSON.stringify(response).includes('PRIVATE-HOST-CODE'));failRPC=false;checks++;
 assert.equal((await request('history',{expired:true})).statusCode,401);checks++;
 await insert(off,'guest','SAFE QUESTION');await insert(off,'bot','SAFE ANSWER');
 response=await request('history',{property:off});assert.equal(response.body.messages.length,2);assert.equal(response.body.messages.at(-1).message,'SAFE ANSWER');checks++;
 await db.query('select public.capture_chat_qa_pairs()');
 assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,1);checks++;
 await db.query('update properties set entry_checkin_required=true where id=$1',[off]);
 assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,0);
 assert.equal((await db.query('select count(*) n from entry_access.chat_qa_quarantine')).rows[0].n,2);checks+=2;
 await db.query('update properties set entry_checkin_required=false,entry_chat_protected=false where id=$1',[off]);
 assert.equal((await db.query('select entry_chat_protected from properties where id=$1',[off])).rows[0].entry_chat_protected,true);checks++;
 await db.query('select public.capture_chat_qa_pairs()');assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,0);checks++;
 response=await request('history',{property:off});assert.ok(response.body.messages.every(m=>m.entry_withheld));checks++;
 await insert(off,'host','NEW OFF MESSAGE');response=await request('history',{property:off});assert.equal(response.body.messages.at(-1).message,'NEW OFF MESSAGE');checks++;
 await db.query("update entry_access.bookings set identity_version=gen_random_uuid(),released_manually=false,manual_audit_id=null where property_id=$1 and is_test=false",[pid]);
 await release(true);response=await request();assert.ok(response.body.messages.every(m=>m.entry_withheld));checks++;
 await db.query("insert into chat_qa_pairs(question_text,answer_text,source_hash) values('UNVERIFIED Q','UNVERIFIED A','late-old-capture')");
 assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,0);checks++;
 await db.query("insert into chat_qa_pairs(question_text,answer_text,source_hash,source_property_id) values('PROTECTED Q','PROTECTED A','forged-protected',$1)",[pid]);
 assert.equal((await db.query('select count(*) n from chat_qa_pairs')).rows[0].n,0);checks++;
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 await assert.rejects(asRole('authenticated',tx=>tx.query('select public.capture_chat_qa_pairs()')),e=>e.code==='42501');checks++;
 await assert.rejects(asRole('anon',tx=>tx.query('select public.capture_chat_qa_pairs()')),e=>e.code==='42501');checks++;
 console.log(`PASS ${checks} actual SQL/guest handler history, provenance, host release/restore, code edit, OFF/test/tenant isolation, expiry/read failure and Q&A quarantine/exclusion checks. Fictional only.`);
}catch(error){console.error(error.message);process.exitCode=1;}finally{global.fetch=originalFetch;await db.close();}
