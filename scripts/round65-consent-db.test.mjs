import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
let PGlite;try{({PGlite}=await import(process.env.ENTRY_PGLITE_MODULE?pathToFileURL(process.env.ENTRY_PGLITE_MODULE).href:'@electric-sql/pglite'));}
catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;console.error('SKIP disposable PostgreSQL module absent (ENTRY_PGLITE_MODULE; pinned PGlite 0.3.14)');process.exit(77);}
const db=new PGlite();const property='11111111-1111-4111-8111-111111111111';
async function roleCall(role,fn){assert.ok(['anon','authenticated','service_role'].includes(role));return db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return fn(tx)});}
const save=(tx,extra={})=>tx.query('select public.save_guest_marketing_consent($1,$2,$3,$4,$5) result',
 [extra.property||property,extra.booking||'SYNTHETIC',extra.email===undefined?'guest@example.invalid':extra.email,extra.phone||null,extra.consent??true]).then(r=>r.rows[0].result);
const denied=async(fn,code)=>assert.rejects(fn,e=>e.code===code);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;
 create table public.properties(id uuid primary key,deleted_at timestamptz,is_test boolean default false);
 create table public.ota_reservations(property_id uuid,booking_code text,status text,entry_type text,deleted_at timestamptz);
 create table public.checkins(id uuid default gen_random_uuid(),property_id uuid,booking_code text,is_test boolean default false,deleted_at timestamptz,submitted_at timestamptz default now(),guest_type text,surname text,name text);
 create table public.marketing_consents(id uuid default gen_random_uuid(),property_id uuid references properties(id),booking_code text,guest_name text,email text,phone text,consent_text_version text,withdrawn_at timestamptz,created_at timestamptz default now());
 alter table marketing_consents enable row level security;
 create policy marketing_consents_anon_insert on marketing_consents for insert to anon with check(property_id is not null);
 grant insert on marketing_consents to anon;
 grant select on properties,ota_reservations,checkins to service_role;
 grant select,insert on marketing_consents to service_role;
 create function public.purge_old_id_photos(boolean,integer,integer,integer) returns integer language sql as $$select 0$$;
 create function public.enqueue_orphan_documents(boolean,integer) returns integer language sql as $$select 0$$;
 create function public.list_hosts_for_admin() returns integer language sql as $$select 0$$;`);
 const sql=fs.readFileSync(new URL('../supabase/migrations/20261026082622_round65_database_grants_consent.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
 await db.query('insert into properties(id) values($1)',[property]);
 await db.query("insert into checkins(property_id,booking_code,guest_type,surname,name) values($1,'SYNTHETIC','head','Synthetic','Guest')",[property]);
 for(const role of ['anon','authenticated']){
  await denied(()=>roleCall(role,tx=>tx.query('select public.purge_old_id_photos(true,null,168,7)')),'42501');
  await denied(()=>roleCall(role,tx=>tx.query('select public.enqueue_orphan_documents(true,7)')),'42501');
  await denied(()=>roleCall(role,tx=>save(tx)),'42501');
 }
 await denied(()=>roleCall('anon',tx=>tx.query('select public.list_hosts_for_admin()')),'42501');
 await roleCall('authenticated',tx=>tx.query('select public.list_hosts_for_admin()'));
 await roleCall('service_role',tx=>tx.query('select public.purge_old_id_photos(true,null,168,7),public.enqueue_orphan_documents(true,7),public.list_hosts_for_admin()'));
 await denied(()=>roleCall('anon',tx=>tx.query('insert into public.marketing_consents(property_id) values($1)',[property])),'42501');
 assert.equal((await roleCall('service_role',tx=>save(tx))).ok,true);
 assert.equal((await roleCall('service_role',tx=>save(tx))).duplicate,true);
 assert.equal((await db.query('select count(*) n from marketing_consents')).rows[0].n,1);
 await roleCall('service_role',tx=>save(tx,{email:null,phone:'+39 123 456 789'}));
 for(let i=0;i<3;i++)await roleCall('service_role',tx=>save(tx,{email:`guest${i}@example.invalid`}));
 await denied(()=>roleCall('service_role',tx=>save(tx,{email:'limited@example.invalid'})),'P0001');
 // Reusing a new session cannot reset the booking-wide cap; exact retries
 // still succeed without an additional row or timestamp refresh.
 assert.equal((await roleCall('service_role',tx=>save(tx))).duplicate,true);
 await denied(()=>roleCall('service_role',tx=>save(tx,{consent:false})),'22023');
 await denied(()=>roleCall('service_role',tx=>save(tx,{email:'bad'})),'22023');
 await denied(()=>roleCall('service_role',tx=>save(tx,{property:'22222222-2222-4222-8222-222222222222'})),'42501');
 await denied(()=>roleCall('service_role',tx=>save(tx,{booking:'OTHER'})),'42501');
 await db.query("insert into ota_reservations values($1,'SYNTHETIC','cancelled','reservation',null)",[property]);
 await denied(()=>roleCall('service_role',tx=>save(tx)),'42501');
 await db.query('delete from ota_reservations');await db.query('update checkins set is_test=true');
 await denied(()=>roleCall('service_role',tx=>save(tx)),'42501');
 await db.query('update checkins set is_test=false');await db.query('update properties set deleted_at=now()');
 await denied(()=>roleCall('service_role',tx=>save(tx)),'42501');
 console.log('PASS actual SQL: cron/admin grants, closed anon consent insert/RPC, valid standalone save, idempotent retry, booking-wide cap, consent/contact/property/booking/test/deletion/cancellation checks. No production writes.');
}finally{await db.close();}
