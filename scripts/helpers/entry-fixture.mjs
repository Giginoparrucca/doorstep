// Real SQL + handler save adapter + current-record loader/policy in disposable
// PostgreSQL. All rows and codes are fictional; no hosted guest data is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { submitEntryCheckin } from '../../api/_entry-submission-save.js';
import { loadEntryReleaseSnapshot, evaluateGuestEntryRelease, projectGuestEntry, loadGuestPropertyAccess } from '../../api/_entry-release-loader.js';


export async function createEntryFixture() {
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pid = id(10), other = id(20), off = id(30), reservation = id(40), owner = id(1);
const code = 'FICTIONAL-ATOMIC';
const migrations = ['20261027041500_round66_entry_roster_audit.sql',
  '20261028033000_round66_entry_access_state_rpc.sql', '20261028082453_round66_atomic_submissions.sql','20261029105517_round66_host_entry_audit.sql'];
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
  if (booking) { values.push(booking); sql += ' and booking_code=$2';values.push(params.get('is_test')==='eq.true');sql+=' and is_test=$3'; }
  if (table !== 'properties' && params.get('id')) {
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
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table public.admin_users(email text primary key);
    create table public.admin_impersonation_log(id uuid primary key default gen_random_uuid(),admin_id uuid not null,admin_email text,property_id uuid not null,action text not null,created_at timestamptz default now());
    create schema storage; create table storage.objects(bucket_id text,name text);
  `);
  await db.query(`insert into properties(id,owner_id,entry_checkin_required,keybox_code,access_method)
    values($1,$4,true,'FIXED-FICTIONAL','Fictional entry'),($2,$4,true,'OTHER-FICTIONAL','Other'),($3,$4,false,'OFF-FICTIONAL','Off')`, [pid,other,off,owner]);
  await db.query(`insert into ota_reservations(id,property_id,booking_code,is_test,status,entry_type,guest_count,checkin_date,checkout_date)
    values($1,$2,$3,false,'active','reservation',3,'2026-11-01','2026-11-05')`, [reservation,pid,code]);
  for (const file of migrations) await db.exec(fs.readFileSync(new URL('../../supabase/migrations/'+file, import.meta.url), 'utf8'));
  await db.exec(fs.readFileSync(new URL('../../supabase/migrations/'+migrations.at(-1), import.meta.url), 'utf8'));

return {db,id,pid,other,off,reservation,owner,code,scope,args,save,row,callRPC,pgrestGET,asRole};
}
