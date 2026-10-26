import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
let PGlite;
try {({PGlite}=await import(process.env.ENTRY_PGLITE_MODULE?pathToFileURL(process.env.ENTRY_PGLITE_MODULE).href:'@electric-sql/pglite'));}
catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;console.error('SKIP disposable PostgreSQL module absent (ENTRY_PGLITE_MODULE; pinned PGlite 0.3.14)');process.exit(77);}
const db=new PGlite();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;
 create schema auth;`);
 await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create table public.properties(id uuid,owner_id uuid,deleted_at timestamptz);
 create table public.ota_reservations(property_id uuid,booking_code text,keybox_code text,deleted_at timestamptz,created_at timestamptz);`);
 await db.query('insert into properties values($1,$2,null),($3,$4,null)',[a,owner,b,other]);
 await db.query("insert into ota_reservations values($1,'SYNTHETIC','CODE-A',null,now()),($2,'SYNTHETIC','CODE-B',null,now())",[a,b]);
 const sql=fs.readFileSync(new URL('../supabase/migrations/20261026081549_round65_keybox_gateway_enforcement.sql',import.meta.url),'utf8');
 await db.exec(sql);await db.exec(sql);
 const call=(role,user,p,claimRole=role)=>db.transaction(async tx=>{
  assert.ok(['anon','authenticated','service_role'].includes(role));await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:claimRole})]);
  return (await tx.query("select public.get_reservation_keybox($1,'SYNTHETIC') code",[p])).rows[0].code;
 });
 assert.equal(await call('authenticated',owner,a),'CODE-A');
 assert.equal(await call('authenticated',other,b),'CODE-B');
 await assert.rejects(()=>call('authenticated',owner,b),e=>e.code==='42501');
 await assert.rejects(()=>call('authenticated',owner,b,'service_role'),e=>e.code==='42501');
 await assert.rejects(()=>call('anon',null,a),e=>e.code==='42501');
 await assert.rejects(()=>call('authenticated',null,a),e=>e.code==='42501');
 assert.equal(await call('service_role',null,a),'CODE-A');
 await db.query('update properties set deleted_at=now() where id=$1',[a]);
 await assert.rejects(()=>call('authenticated',owner,a),e=>e.code==='42501');
 assert.equal((await db.query("select has_function_privilege('anon','public.get_reservation_keybox(uuid,text)','execute') allowed")).rows[0].allowed,false);
 console.log('PASS actual migration: owners, foreign owner, forged role claim, anon, missing identity, trusted server, deleted property and explicit grants. Disposable PostgreSQL only.');
}finally{await db.close();}
