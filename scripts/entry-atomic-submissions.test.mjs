// Real SQL + handler save adapter + current-record loader/policy in disposable
// PostgreSQL. All rows and codes are fictional; no hosted guest data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { submitEntryCheckin } from '../api/_entry-submission-save.js';
import { loadEntryReleaseSnapshot, evaluateGuestEntryRelease, projectGuestEntry, loadGuestPropertyAccess } from '../api/_entry-release-loader.js';

const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = id(10), other = id(20), off = id(30), reservation = id(40), owner = id(1);
const code = 'FICTIONAL-ATOMIC';
const migrations = ['20261027041500_round66_entry_roster_audit.sql',
  '20261028033000_round66_entry_access_state_rpc.sql', '20261028082453_round66_atomic_submissions.sql'];
const scope = { propertyId: pid, bookingCode: code, isTest: false,
  sessionValidUntil: new Date(Date.now() + 86400000).toISOString() };
let checks = 0;
async function asRole(role, action) {
  assert.ok(['service_role','anon','authenticated'].includes(role));
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    return action(tx);
  });
}
async function callRPC(name, args) {
  try {
    const data = await asRole('service_role', async tx => {
      if (name === 'entry_access_submit_checkin') {
        const a = args;
        return (await tx.query('select public.entry_access_submit_checkin($1,$2,$3,$4,$5,$6) data',
          [a.p_property_id,a.p_booking_code,a.p_is_test,a.p_submission_id,a.p_ordinal,a.p_record])).rows[0].data;
      }
      assert.equal(name, 'get_entry_access_booking_snapshot');
      return (await tx.query('select public.get_entry_access_booking_snapshot($1,$2,$3) data',
        [args.p_property_id,args.p_booking_code,args.p_is_test])).rows[0].data;
    });
    return { ok: true, json: async () => data };
  } catch (e) { return { ok: false, json: async () => ({ code: e.code }) }; }
}
async function pgrestGET(path) {
  const table = path.split('?')[0];
  assert.ok(['properties','ota_reservations','checkins','property_rooms'].includes(table));
  const params = new URLSearchParams(path.split('?')[1]);
  const property = params.get(table === 'properties' ? 'id' : 'property_id')?.slice(3);
  const booking = params.get('booking_code')?.slice(3);
  let sql = `select * from public.${table} where ${table === 'properties' ? 'id' : 'property_id'}=$1 and deleted_at is null`;
  const values = [property];
  if (booking) { values.push(booking); sql += ' and booking_code=$2 and is_test=false'; }
  if (table === 'property_rooms' && params.get('id')) {
    values.push(params.get('id').slice(3)); sql += ` and id=$${values.length}`;
  }
  const rows = (await db.query(sql, values)).rows;
  return { ok: true, json: async () => rows };
}
const args = () => ({ ...scope, pgrestGET, callRPC });
const row = (ordinal=1) => ({ guest_type: ordinal===1 ? 'head' : 'member', surname: 'Synthetic',
  name: 'Guest'+ordinal, sex: 'F', date_of_birth: ordinal===1 ? '1980-01-01' : '2020-01-01',
  place_of_birth: 'London', birth_country: 'United Kingdom', birth_province: 'EE', citizenship: 'United Kingdom',
  document_type: ordinal===1 ? 'passport' : '', document_number: ordinal===1 ? 'FICTIONAL123' : '',
  doc_issue_place: ordinal===1 ? 'London' : '', arrival_date: '2026-11-01', departure_date: '2026-11-05',
  nights: 4, id_photo_path: null, docs_status: 'pending' });
const save = (ordinal, submissionId=randomUUID(), extra={}) => submitEntryCheckin({ callRPC,
  propertyId: pid, bookingCode: code, isTest: false, ordinal, submissionId, record: row(ordinal), ...extra });
async function state(expected, submitted) {
  const p = await evaluateGuestEntryRelease(args());
  assert.equal(p.state, expected);
  if (submitted!=null) assert.equal(p.submitted, submitted);
  if (!p.allow_entry) assert.deepEqual(await projectGuestEntry(args()), {});
  checks++;
}
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
    create table public.property_rooms(id uuid primary key,property_id uuid,deleted_at timestamptz,door_code text,name text,beds integer);
    create schema storage; create table storage.objects(bucket_id text,name text);
  `);
  await db.query(`insert into properties(id,owner_id,entry_checkin_required,keybox_code,access_method)
    values($1,$4,true,'FIXED-FICTIONAL','Fictional entry'),($2,$4,true,'OTHER-FICTIONAL','Other'),($3,$4,false,'OFF-FICTIONAL','Off')`, [pid,other,off,owner]);
  await db.query(`insert into ota_reservations(id,property_id,booking_code,is_test,status,entry_type,guest_count,checkin_date,checkout_date)
    values($1,$2,$3,false,'active','reservation',3,'2026-11-01','2026-11-05')`, [reservation,pid,code]);
  for (const file of migrations) await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+file, import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(new URL('../supabase/migrations/'+migrations.at(-1), import.meta.url), 'utf8'));
  for (const role of ['anon','authenticated']) {
    await assert.rejects(asRole(role, tx => tx.query('select public.entry_access_submit_checkin($1,$2,false,$3,1,$4)',[pid,code,randomUUID(),row()])), e=>e.code==='42501');
    await assert.rejects(asRole(role, tx => tx.query('select public.get_entry_access_booking_snapshot($1,$2,false)',[pid,code])), e=>e.code==='42501');
    checks+=2;
  }
  assert.deepEqual(await save(1,randomUUID(),{propertyId:off}), {enabled:false}); checks++;
  assert.equal((await save(1,randomUUID(),{bookingCode:'UNKNOWN'})).status,409); checks++;
  assert.equal((await save(1,randomUUID(),{submissionId:null})).status,409); checks++;
  const first=randomUUID(), second=randomUUID(), third=randomUUID();
  assert.equal((await save(1,first)).id,first); await state('locked',1);
  assert.equal((await save(1,first)).id,first); await state('locked',1);
  assert.equal((await db.query('select count(*)::int n from checkins')).rows[0].n,1); checks++;
  assert.equal((await save(1,first,{record:{...row(),name:'Different'}})).status,409); checks++;
  assert.equal((await save(1)).status,409); checks++;
  assert.equal((await save(4)).status,409); checks++;
  assert.equal((await save(2,randomUUID(),{record:row(1)})).status,409); checks++;
  assert.equal((await save(2,second)).id,second); await state('locked',2);
  // Inject a real binding failure after insertion: both records roll back.
  await db.exec(`create function entry_access.test_binding_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure'; end$$;
    create trigger test_failure before insert on entry_access.submissions for each row execute function entry_access.test_binding_failure();`);
  assert.equal((await save(3,third)).status,503);
  assert.equal((await db.query('select count(*)::int n from checkins where id=$1',[third])).rows[0].n,0); checks++;
  await db.query(`insert into ota_reservations(id,property_id,booking_code,is_test,status,entry_type,guest_count,checkin_date,checkout_date)
    values($1,$2,'FICTIONAL-ROLLBACK',false,'active','reservation',1,'2026-11-01','2026-11-05')`,[id(60),pid]);
  const failedFirst=randomUUID();
  assert.equal((await save(1,failedFirst,{bookingCode:'FICTIONAL-ROLLBACK'})).status,503);
  assert.equal((await db.query("select count(*)::int n from entry_access.bookings where booking_code='FICTIONAL-ROLLBACK'")).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from checkins where id=$1',[failedFirst])).rows[0].n,0); checks++;
  await db.exec('drop trigger test_failure on entry_access.submissions');
  assert.equal((await save(3,third)).id,third); await state('available',3);
  assert.equal((await projectGuestEntry(args())).fixed_code,'FIXED-FICTIONAL'); checks++;
  // Real installed SQL resolves all live check-in and reservation assignments.
  // Feed that exact RPC output through the property projector, with no stub policy.
  const roomA=id(80),roomB=id(81),foreignRoom=id(82);
  await db.query("insert into property_rooms(id,property_id,door_code,name,beds) values($1,$4,'ROOM-A','Fictional A',2),($2,$4,'ROOM-B','Fictional B',3),($3,$5,'FOREIGN-ROOM','Foreign',1)",[roomA,roomB,foreignRoom,pid,other]);
  await db.query('update ota_reservations set room_id=$1 where id=$2',[roomA,reservation]);
  await db.query('update checkins set room_id=$1 where id=$2',[roomA,first]);
  let access=await loadGuestPropertyAccess(args());
  assert.equal(access.policy.state,'available');assert.equal(access.room.door_code,'ROOM-A');assert.equal(access.room.name,'Fictional A');checks++;
  // Change the assignment/code after the coherent RPC returns. Only the exact
  // earlier snapshot code may accompany that snapshot's allowed decision.
  access=await loadGuestPropertyAccess({...args(),callRPC:async(...a)=>{
    const result=await callRPC(...a);
    await db.query('update checkins set room_id=$1 where id=$2',[roomB,first]);
    await db.query("update property_rooms set door_code='ROOM-A-LATER' where id=$1",[roomA]);
    return result;
  }});
  assert.equal(access.room.door_code,'ROOM-A');checks++;
  access=await loadGuestPropertyAccess(args());
  assert.equal(access.policy.state,'unavailable');assert.equal(access.policy.reason,'unknown_room');assert.equal(access.room,null);checks++;
  await db.query('update ota_reservations set room_id=$1 where id=$2',[roomB,reservation]);
  assert.equal((await loadGuestPropertyAccess(args())).room.door_code,'ROOM-B');checks++;
  await db.query('update property_rooms set deleted_at=now() where id=$1',[roomB]);
  access=await loadGuestPropertyAccess(args());assert.equal(access.policy.state,'unavailable');assert.equal(access.room,null);checks++;
  await db.query('update ota_reservations set room_id=$1 where id=$2',[foreignRoom,reservation]);
  await db.query('update checkins set room_id=$1 where id=$2',[foreignRoom,first]);
  access=await loadGuestPropertyAccess(args());assert.equal(access.policy.state,'unavailable');assert.equal(access.room,null);checks++;
  await db.query('update ota_reservations set room_id=null where id=$1',[reservation]);
  await db.query('update checkins set room_id=null where id=$1',[first]);

  await db.query("update checkins set document_number='' where id=$1",[first]); await state('locked',2);
  await db.query("update checkins set document_number='FICTIONAL123',name='Valid correction',docs_status='pending' where id=$1",[first]); await state('available',3);
  await db.query('update checkins set checkin_reopened_at=now() where id=$1',[second]); await state('locked',2);
  await db.query('update checkins set checkin_reopened_at=null where id=$1',[second]); await state('available',3);
  await db.query('update ota_reservations set guest_count=4 where id=$1',[reservation]); await state('unavailable');
  const fourth=randomUUID(); assert.equal((await save(4,fourth)).id,fourth); await state('available',4);
  // Storage existence alone is insufficient: the path must belong to this row/property.
  await db.query('update entry_access.slots set photo_required=true where ordinal=1'); await state('locked',3);
  const path=`id-photos/${pid}/${first}/synthetic.jpg`;
  await db.query('update checkins set id_photo_path=$1 where id=$2',[path,first]); await state('locked',3);
  await db.query("insert into storage.objects values('documents',$1)",[path]); await state('available',4);
  await db.query("update checkins set id_photo_path='id-photos/foreign.jpg' where id=$1",[first]);
  await db.exec("insert into storage.objects values('documents','id-photos/foreign.jpg')"); await state('locked',3);
  await db.query('update checkins set id_photo_path=$1 where id=$2',[path,first]);
  await db.query("update properties set entry_release_time='23:59',entry_release_timezone='Europe/Rome' where id=$1",[pid]); await state('scheduled',4);
  await db.query('update properties set entry_release_time=null,entry_release_timezone=null where id=$1',[pid]);
  await db.query("update ota_reservations set status='cancelled' where id=$1",[reservation]); await state('unavailable');
  assert.equal((await save(4)).status,409); checks++;
  await db.query("update ota_reservations set status='active' where id=$1",[reservation]);
  await db.query('delete from checkins where id=$1',[second]); await state('locked',3);
  assert.equal((await loadEntryReleaseSnapshot(args())).roster.slots.length,4); checks++;
  // Standalone authority comes from an existing owner-confirmed contract,
  // never the browser's claimed party size or the number of saved rows.
  await asRole('authenticated',async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await tx.query("select public.entry_access_confirm_roster($1,'STANDALONE',2,'2026-11-01','2026-11-05',$2,null,null,false)",[other,randomUUID()]);
  });
  assert.equal((await save(1,first,{propertyId:other,bookingCode:'STANDALONE'})).status,409); checks++;
  assert.equal((await save(1,randomUUID(),{propertyId:other,bookingCode:'STANDALONE'})).enabled,true); checks++;
  assert.equal((await save(2,randomUUID(),{propertyId:other,bookingCode:'STANDALONE'})).enabled,true); checks++;
  assert.equal((await evaluateGuestEntryRelease({...args(),propertyId:other,bookingCode:'STANDALONE'})).state,'available');checks++;
  // Transport errors cannot opt into the legacy INSERT.
  assert.equal((await save(1,randomUUID(),{callRPC:async()=>{throw Error('fictional outage')}})).status,503); checks++;
  console.log(`PASS ${checks} actual SQL/adapter/loader/policy checks: role grants, OFF/unknown roster, stable retries, slot conflicts, atomic failure rollback, 1-of-3/final unlock, live edits/reopen/deletion, guest-count growth, scoped storage proof, schedule and cancellation.`);
} finally { await db.close(); }
