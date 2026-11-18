// Round 76 Phase 3 — the other Annex B retention limits as one scheduled
// purge. Real migrations in PGlite (the 14 Nov retention guard, Round 66
// entry audit, Round 76 Phase 2 and Phase 3 applied twice). Every rule gets
// a row just past its limit and one just inside it; the dry run changes
// nothing; the guards still refuse ordinary deletes and edits; only
// service_role (and the admin preview) may run it; the daily purge stores
// the counts. The storage worker deletes old receipts and nothing else
// outside 'documents'. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261118110000_round76_retention_purges.sql';

let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
    create function auth.email() returns text language sql stable as $f$ select 'admin@example.invalid' $f$;
    create function public.is_admin() returns boolean language sql stable as $f$ select current_setting('test.admin', true) = 'yes' $f$;
    create table public.properties(id uuid primary key, owner_id uuid, region text, deleted_at timestamptz);
    create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id), booking_code text, is_test boolean default false,
      guest_type text not null default 'single', surname text not null, name text not null, sex text not null default 'F', date_of_birth date not null default '1990-06-15', place_of_birth text not null default 'Bari',
      province_of_birth text, state_of_birth text, birth_province text, birth_country text default 'Italia', citizenship text not null default 'Italia',
      document_type text not null default 'id_card', document_number text not null default 'CA00000AA', doc_issue_place text, arrival_date date, departure_date date, nights int,
      alloggiati_status text default 'pending', filed_at timestamptz, deleted_at timestamptz, submitted_at timestamptz, created_at timestamptz default now(),
      id_photo_path text, selfie_photo_path text, residence_country text default 'Italia', residence_place text default 'Bari', keybox_code text, receipt_path text,
      fiscal_code text, residence_address text, residence_postcode text, residence_province text, invoice_email text, tax_declared_flags jsonb);
    create table public.storage_purge_queue(id bigserial primary key, bucket text not null check (bucket = 'documents'), path text not null, reason text not null, queued_at timestamptz default now(), attempts int default 0, unique (bucket, path));
    create table public.alloggiati_filing_log(id uuid primary key default gen_random_uuid(), property_id uuid, run_at timestamptz, receipt_path text);
    create table public.ota_reservations(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, guest_name text, checkin_date date, checkout_date date,
      contact_email text, contact_phone text, phone_last4 text, raw jsonb, is_test boolean default false, status text, entry_type text, deleted_at timestamptz, guest_count int, created_at timestamptz default now());
    create table public.host_dismissed_bookings(id uuid primary key default gen_random_uuid(), host_id uuid, booking_code text, dismissed_at timestamptz);
    create table public.marketing_consents(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, email text, consent_given_at timestamptz, withdrawn_at timestamptz, created_at timestamptz default now());
    create table public.chat_messages(id uuid primary key default gen_random_uuid(), property_id uuid, booking_code text, sender text, message text, created_at timestamptz);
    create table public.notification_log(id bigserial primary key, host_id uuid, created_at timestamptz);
    create table public.host_subscriptions(user_id uuid primary key, created_at timestamptz, updated_at timestamptz);
    create table public.billing_events(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz);
    create table public.host_terms_acceptances(id uuid primary key default gen_random_uuid(), host_id uuid, receipt_email_id text, created_at timestamptz);
    create function public.host_terms_acceptances_guard() returns trigger language plpgsql as $f$ begin raise exception 'host_terms_acceptances is append-only'; end $f$;
    create trigger host_terms_acceptances_append_only before update or delete on public.host_terms_acceptances for each row execute function public.host_terms_acceptances_guard();
    create table public.purge_settings(id int primary key, live_after timestamptz);
    create table public.data_purge_log(id bigserial primary key, run_at timestamptz default now(), dry_run boolean, triggered_by text, chat_resolved_purged int, orphans_queued int);
    create function public.purge_old_data(p_dry_run boolean default true, p_triggered_by text default 'cron') returns public.data_purge_log language plpgsql as $f$
      DECLARE
        v_chat_resolved_d  INTEGER := 90;
        v public.data_purge_log;
      BEGIN insert into public.data_purge_log(dry_run, triggered_by, chat_resolved_purged) values (p_dry_run, p_triggered_by, v_chat_resolved_d) returning * into v; return v; END $f$;
    create function public.enqueue_orphan_documents(p boolean) returns int language sql as $f$ select 0 $f$;
    create function public.checkins_prevent_filed_edit() returns trigger language plpgsql as $f$ begin return new; end $f$;
    create trigger checkins_filed_edit_guard before update on public.checkins for each row execute function public.checkins_prevent_filed_edit();`);
  await db.exec(read('supabase/migrations/20261114090000_filed_checkins_retained.sql'));
  await db.exec(read('supabase/migrations/20261027041500_round66_entry_roster_audit.sql'));
  await db.exec(read('supabase/migrations/20261118100000_round76_police_data_minimisation.sql'));
  await db.exec(`grant all on all tables in schema public to service_role, authenticated; grant all on all sequences in schema public to service_role;
    grant all on all tables in schema entry_access to service_role; grant select on auth.users to service_role;`);
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  await db.exec(`grant all on all tables in schema public to service_role, authenticated;`);
  assert.match((await db.query(`select pg_get_functiondef('public.purge_old_data(boolean,text)'::regprocedure) d`)).rows[0].d, /v_chat_resolved_d {2}INTEGER := 365;/, 'resolved chats: 12 months');

  const P = '00000000-0000-4000-8000-0000000000b1', HOST = '00000000-0000-4000-8000-0000000000c1', GONE_OLD = '00000000-0000-4000-8000-0000000000c2', GONE_NEW = '00000000-0000-4000-8000-0000000000c3';
  await db.query(`insert into public.properties values ($1, $2, 'Puglia', null)`, [P, HOST]);
  await db.query(`insert into auth.users values ($1)`, [HOST]);
  const ymd = d => d.toISOString().slice(0, 10);
  const now = new Date(); const Y = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric' }).format(now));
  const ago = (y = 0, m = 0, d = 0) => { const t = new Date(now); t.setUTCFullYear(t.getUTCFullYear() - y, t.getUTCMonth() - m, t.getUTCDate() - d); return t; };
  const monthStart = back => { const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15)); return ymd(t); }; // mid-month, months back
  const ck = async (name, x) => (await db.query(`insert into public.checkins(property_id, booking_code, surname, name, arrival_date, departure_date, alloggiati_status, filed_at, receipt_path, id_photo_path, fiscal_code, invoice_email, residence_address, submitted_at)
    values ($1, $2, 'FICTIONAL', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $6) returning id`,
    [P, name, x.arr, x.dep, x.filed ? 'filed' : 'pending', x.filed || null, x.receipt || null, x.photo || null, x.inv ? 'XXXXXX00X00X000X' : null, x.inv ? 'inv@example.invalid' : null, x.inv ? 'Via Finta 1' : null])).rows[0].id;
  // Statistics: stay 13 months back (due) vs 12 months back (not yet).
  const S_OLD = await ck('S_OLD', { arr: monthStart(13), dep: monthStart(13), filed: ago(1, 1).toISOString(), photo: 'p/s-old.jpg' });
  const S_NEW = await ck('S_NEW', { arr: monthStart(11), dep: monthStart(11), filed: ago(0, 11).toISOString() });
  // Tax: arrival in year Y-6 (deleted, receipt older than 5 years) vs Y-5 (kept).
  const T_OLD = await ck('T_OLD', { arr: `${Y - 6}-12-30`, dep: `${Y - 6}-12-31`, filed: `${Y - 6}-12-30T12:00:00Z`, receipt: 'r/t-old.pdf' });
  const T_NEW = await ck('T_NEW', { arr: `${Y - 5}-01-02`, dep: `${Y - 5}-01-03`, filed: `${Y - 5}-01-02T12:00:00Z`, receipt: 'r/t-new.pdf' });
  // Filed late: the stay is past the tax period but the receipt is not 5 years old → row kept.
  const T_LATE = await ck('T_LATE', { arr: `${Y - 6}-12-30`, dep: `${Y - 6}-12-31`, filed: ago(4, 11).toISOString(), receipt: 'r/t-late.pdf' });
  // Invoice rows: 10 years from the stay.
  const I_OLD = await ck('I_OLD', { arr: ymd(ago(10, 0, 3)), dep: ymd(ago(10, 0, 2)), filed: ago(10, 0, 3).toISOString(), inv: true });
  const I_NEW = await ck('I_NEW', { arr: ymd(ago(9, 11)), dep: ymd(ago(9, 11)), filed: ago(9, 11).toISOString(), inv: true });
  // Receipts: filed 5 years + 1 day ago vs 5 years − 1 day.
  const R_OLD = await ck('R_OLD', { arr: ymd(ago(5, 0, 2)), dep: ymd(ago(5, 0, 1)), filed: ago(5, 0, 1).toISOString(), receipt: 'r/old.pdf' });
  const R_NEW = await ck('R_NEW', { arr: ymd(ago(4, 11, 29)), dep: ymd(ago(4, 11, 28)), filed: ago(4, 11, 28).toISOString(), receipt: 'r/new.pdf' });
  await db.query(`insert into public.alloggiati_filing_log(property_id, run_at, receipt_path) values ($1, $2, 'r/log-old.pdf'), ($1, $3, null)`, [P, ago(5, 0, 1).toISOString(), ago(4, 11).toISOString()]);
  // Reservations: contacts 12 months, records 10 years.
  await db.query(`insert into public.ota_reservations(property_id, booking_code, guest_name, checkin_date, checkout_date, contact_email, contact_phone, phone_last4, raw) values
    ($1, 'RC_OLD', 'Fictional', $2, $3, 'old@example.invalid', '+390000000', '0000', '{"description":"tel 0000","summary":"Reserved"}'),
    ($1, 'RC_NEW', 'Fictional', $4, $5, 'new@example.invalid', '+390000001', '0001', '{"description":"tel 0001"}'),
    ($1, 'RR_OLD', 'Fictional', $6, $7, null, null, null, null),
    ($1, 'RR_NEW', 'Fictional', $8, $9, null, null, null, null)`,
    [P, ymd(ago(1, 0, 5)), ymd(ago(1, 0, 1)), ymd(ago(0, 11, 5)), ymd(ago(0, 11, 1)), ymd(ago(10, 0, 5)), ymd(ago(10, 0, 1)), ymd(ago(9, 11, 5)), ymd(ago(9, 11, 1))]);
  await db.query(`insert into public.host_dismissed_bookings(host_id, booking_code, dismissed_at) values ($1, 'D_OLD', $2), ($1, 'D_NEW', $3)`, [HOST, ago(10, 0, 1).toISOString(), ago(9, 11).toISOString()]);
  // Marketing: active 24 months from the stay; withdrawals 24 months.
  await db.query(`insert into public.marketing_consents(property_id, booking_code, email, consent_given_at, withdrawn_at) values
    ($1, 'M_OLD', 'a@example.invalid', $2, null), ($1, 'M_NEW', 'b@example.invalid', $3, null),
    ($1, 'MW_OLD', 'c@example.invalid', $2, $4), ($1, 'MW_NEW', 'd@example.invalid', $2, $5)`,
    [P, ago(2, 0, 1).toISOString(), ago(1, 11).toISOString(), ago(2, 0, 1).toISOString(), ago(1, 11).toISOString()]);
  // Chat: 12 months from the stay; a conversation still active is kept.
  await db.query(`insert into public.chat_messages(property_id, booking_code, sender, message, created_at) values
    ($1, 'C_OLD', 'guest', 'ciao', $2), ($1, 'C_OLD', 'host', 'ciao', $2), ($1, 'C_NEW', 'guest', 'ciao', $3), ($1, 'C_ACTIVE', 'guest', 'ciao', $2), ($1, 'C_ACTIVE', 'guest', 'ancora', $3)`,
    [P, ago(1, 0, 1).toISOString(), ago(0, 11).toISOString()]);
  // Door-access audit: the entry booking with its append-only audit and a manual release.
  const eb = async (code, arr, dep) => (await db.query(`insert into entry_access.bookings(property_id, booking_code, is_test, arrival_date, departure_date, expected_count) values ($1, $2, false, $3, $4, 2) returning id`, [P, code, arr, dep])).rows[0].id;
  const E_OLD = await eb('E_OLD', ymd(ago(1, 0, 5)), ymd(ago(1, 0, 1))); const E_NEW = await eb('E_NEW', ymd(ago(0, 11, 5)), ymd(ago(0, 11, 1)));
  for (const b of [E_OLD, E_NEW]) {
    const a = (await db.query(`insert into entry_access.audit(id, booking_id, property_id, actor_id, request_id, action, request_data, result) values (gen_random_uuid(), $1, $2, $3, gen_random_uuid(), 'entry_released', '{}', '{}') returning id`, [b, P, HOST])).rows[0].id;
    await db.query(`update entry_access.bookings set released_manually = true, manual_audit_id = $1 where id = $2`, [a, b]);
  }
  await assert.rejects(db.query(`delete from entry_access.audit where booking_id = $1`, [E_OLD]), /append-only/, 'audit stays append-only');
  await db.query(`insert into public.notification_log(host_id, created_at) values ($1, $2), ($1, $3)`, [HOST, ago(1, 0, 1).toISOString(), ago(0, 11).toISOString()]);
  // Closed accounts: account gone for 10 years vs gone recently; live host untouched.
  for (const [u, at] of [[GONE_OLD, ago(10, 0, 1)], [GONE_NEW, ago(9, 11)], [HOST, ago(11)]]) {
    await db.query(`insert into public.host_subscriptions values ($1, $2, $2)`, [u, at.toISOString()]);
    await db.query(`insert into public.billing_events(user_id, created_at) values ($1, $2)`, [u, at.toISOString()]);
    await db.query(`insert into public.host_terms_acceptances(host_id, created_at) values ($1, $2)`, [u, at.toISOString()]);
  }

  const as = (role, q, a = [], admin = false) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('test.admin', $2, true)`, [JSON.stringify({ role }), admin ? 'yes' : 'no']); return tx.query(q, a); });
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, 'select public.retention_purge(false)'), /permission denied/, role + ': cannot run it');
  await assert.rejects(as('authenticated', 'select public.purge_old_data_admin(true)'), /Admin privileges required/, 'non-admin: no preview');

  const snap = async () => { const out = []; for (const t of ['public.checkins', 'public.ota_reservations', 'public.alloggiati_filing_log', 'public.marketing_consents', 'public.chat_messages', 'public.notification_log', 'public.host_dismissed_bookings', 'public.host_subscriptions', 'public.billing_events', 'public.host_terms_acceptances', 'public.storage_purge_queue', 'entry_access.bookings', 'entry_access.audit']) out.push(JSON.stringify((await db.query(`select * from ${t} order by 1`)).rows)); return out.join('\n'); };
  const expected = { dry_run: true, receipts: 3, filing_log: 1, statistics: 8, tax_records: 1, invoice_records: 1, contacts: 1, reservations: 1, dismissed: 1, marketing: 2, chat: 2, entry: 1, notifications: 1, closed_accounts: 1 };
  const before = await snap();
  const dry = (await as('service_role', 'select public.retention_purge(true) r')).rows[0].r;
  assert.deepEqual(dry, expected, 'dry-run counts'); assert.equal(await snap(), before, 'dry run changes nothing');
  // Admin preview stores the same counts in the purge log and changes nothing.
  const prev = (await as('authenticated', 'select (public.purge_old_data_admin(true)).legal l', [], true)).rows[0].l;
  assert.deepEqual(prev, expected); assert.equal(await snap(), before, 'admin preview changes nothing');

  // Daily purge, live.
  await db.query(`insert into public.purge_settings values (1, now() - interval '1 day')`);
  const log = (await db.query('select (public.purge_old_data_cron()).legal l')).rows[0].l;
  assert.deepEqual(log, { ...expected, dry_run: false });
  assert.deepEqual((await db.query(`select legal->'statistics' s from public.data_purge_log order by id desc limit 1`)).rows[0].s, 8, 'counts stored in data_purge_log');

  const row = async id => (await db.query('select * from public.checkins where id = $1', [id])).rows[0];
  const s = await row(S_OLD);
  assert.deepEqual([s.sex, s.birth_year, s.citizenship, s.residence_country, s.residence_place, s.document_number, s.date_of_birth, s.id_photo_path], [null, null, null, null, null, null, null, null], 'statistics + identity erased');
  assert.ok(s.statistics_erased_at && s.identity_erased_at); assert.equal(s.surname, 'FICTIONAL'); assert.ok(s.age_at_arrival >= 35, 'age kept for the tourist tax');
  const sn = await row(S_NEW); assert.equal(sn.statistics_erased_at, null); assert.equal(sn.sex, 'F', 'inside 12 months: kept');
  assert.equal(await row(T_OLD), undefined, 'tax record past 5 years after the tax year: deleted');
  assert.ok(await row(T_NEW), 'tax record inside the period: kept');
  assert.equal((await row(T_LATE)).receipt_path, 'r/t-late.pdf', 'late filing: receipt inside 5 years keeps the row');
  assert.equal(await row(I_OLD), undefined, 'invoice row past 10 years: deleted');
  const inv = await row(I_NEW); assert.equal(inv.fiscal_code, 'XXXXXX00X00X000X'); assert.equal(inv.residence_country, 'Italia', 'invoice address kept'); assert.equal(inv.sex, null, 'statistics erased on invoice rows too');
  assert.equal((await row(R_OLD)).receipt_path, null, 'receipt past 5 years released'); assert.equal((await row(R_NEW)).receipt_path, 'r/new.pdf');
  assert.equal((await row(T_NEW)).receipt_path, null, 'filed Jan of Y-5: receipt past 5 years, tax row still kept');
  assert.deepEqual((await db.query(`select bucket, path, reason from public.storage_purge_queue order by path`)).rows, [
    { bucket: 'documents', path: 'p/s-old.jpg', reason: 'retention_12m' },
    { bucket: 'receipts', path: 'r/log-old.pdf', reason: 'receipt_5y' }, { bucket: 'receipts', path: 'r/old.pdf', reason: 'receipt_5y' }, { bucket: 'receipts', path: 'r/t-new.pdf', reason: 'receipt_5y' }, { bucket: 'receipts', path: 'r/t-old.pdf', reason: 'receipt_5y' }]);
  assert.equal((await db.query(`select count(*)::int n from public.alloggiati_filing_log`)).rows[0].n, 1, 'filing log: old row gone, recent kept');
  const res = Object.fromEntries((await db.query(`select booking_code, contact_email, contact_phone, phone_last4, raw from public.ota_reservations`)).rows.map(r => [r.booking_code, r]));
  assert.deepEqual([res.RC_OLD.contact_email, res.RC_OLD.contact_phone, res.RC_OLD.phone_last4, res.RC_OLD.raw], [null, null, null, { summary: 'Reserved' }], 'old contacts erased, reservation kept');
  assert.equal(res.RC_NEW.contact_email, 'new@example.invalid'); assert.equal(res.RR_OLD, undefined, 'reservation past 10 years deleted'); assert.ok(res.RR_NEW);
  assert.deepEqual((await db.query(`select booking_code from public.host_dismissed_bookings`)).rows, [{ booking_code: 'D_NEW' }]);
  assert.deepEqual((await db.query(`select booking_code from public.marketing_consents order by 1`)).rows.map(r => r.booking_code), ['MW_NEW', 'M_NEW']);
  assert.deepEqual((await db.query(`select distinct booking_code from public.chat_messages order by 1`)).rows.map(r => r.booking_code), ['C_ACTIVE', 'C_NEW'], 'chat: old conversation gone, active one kept');
  assert.deepEqual((await db.query(`select booking_code from entry_access.bookings`)).rows, [{ booking_code: 'E_NEW' }]);
  assert.deepEqual((await db.query(`select booking_id from entry_access.audit`)).rows, [{ booking_id: E_NEW }], 'entry audit: only the recent booking left');
  assert.equal((await db.query(`select count(*)::int n from public.notification_log`)).rows[0].n, 1);
  for (const t of ['host_subscriptions', 'billing_events']) assert.deepEqual((await db.query(`select user_id from public.${t} order by 1`)).rows.map(r => r.user_id).sort(), [HOST, GONE_NEW].sort(), t);
  assert.deepEqual((await db.query(`select host_id from public.host_terms_acceptances`)).rows.map(r => r.host_id).sort(), [HOST, GONE_NEW].sort(), 'evidence of a live or recent account kept');
  assert.deepEqual((await db.query('select public.retention_purge(false) r')).rows[0].r, { dry_run: false, receipts: 0, filing_log: 0, statistics: 0, tax_records: 0, invoice_records: 0, contacts: 0, reservations: 0, dismissed: 0, marketing: 0, chat: 0, entry: 0, notifications: 0, closed_accounts: 0 }, 'idempotent');

  // Guards outside the purge: unchanged for every API role.
  for (const role of ['authenticated', 'service_role']) {
    await assert.rejects(as(role, `delete from public.checkins where id = $1`, [T_NEW]), /checkin_filed_retained/, role + ': filed row not deletable');
    await assert.rejects(as(role, `update public.checkins set sex = null where id = $1`, [S_NEW]), /checkin_locked_filed/, role + ': statistics locked');
    await assert.rejects(as(role, `delete from public.host_terms_acceptances where host_id = $1`, [GONE_NEW]), /append-only/, role + ': evidence append-only');
    await assert.rejects(as(role, `select set_config('welcomebnb.retention_purge', 'on', false); delete from public.checkins where id = '${T_NEW}'`), /cannot insert multiple commands|checkin_filed_retained/, role + ': no smuggled flag in one call');
  }
  const qc = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.storage_purge_queue'::regclass and contype = 'c'`)).rows.map(r => r.d);
  assert.equal(qc.length, 1); assert.match(qc[0], /documents.*receipts.*receipt_5y/);
  await assert.rejects(db.query(`insert into public.storage_purge_queue(bucket, path, reason) values ('receipts', 'r/x.pdf', 'other')`), /check/i, 'no other receipt can be queued');
  console.log('  db: retention purges checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// Storage worker: receipts only with reason receipt_5y.
process.env.SUPABASE_URL ||= 'https://fixture.supabase.invalid';
const { runStoragePurgePass, purgeQueueRowAllowed } = await import('../api/send-arrival-reminders.js');
assert.equal(purgeQueueRowAllowed({ bucket: 'documents', path: 'a', reason: 'x' }), true);
assert.equal(purgeQueueRowAllowed({ bucket: 'receipts', path: 'a', reason: 'receipt_5y' }), true);
assert.equal(purgeQueueRowAllowed({ bucket: 'receipts', path: 'a', reason: 'dsar' }), false);
assert.equal(purgeQueueRowAllowed({ bucket: 'property-images', path: 'a', reason: 'receipt_5y' }), false);
const calls = [], deleted = [];
const rows = [{ id: 1, bucket: 'documents', path: 'p/1.jpg', reason: 'filed_minimised', attempts: 0 }, { id: 2, bucket: 'receipts', path: 'r/1.pdf', reason: 'receipt_5y', attempts: 0 },
  { id: 3, bucket: 'receipts', path: 'r/2.pdf', reason: 'manual', attempts: 0 }];
const out = await runStoragePurgePass(false, null, { get: async q => { assert.match(q, /bucket=in\.\(documents,receipts\)/); return rows; }, del: async q => { deleted.push(q); },
  fetch: async (url, init) => { calls.push([url.split('/object/')[1], JSON.parse(init.body).prefixes]); return { ok: true }; }, bump: async () => {} });
assert.deepEqual(calls, [['documents', ['p/1.jpg']], ['receipts', ['r/1.pdf']]], 'one request per bucket; the other receipt is never sent');
assert.deepEqual(deleted, ['storage_purge_queue?id=in.("1")', 'storage_purge_queue?id=in.("2")']);
assert.deepEqual(out, { queued: 2, deleted: 2, failed: 0, dry: false });
const dry = await runStoragePurgePass(true, null, { get: async () => rows, fetch: async () => { throw Error('no fetch in dry run'); } });
assert.equal(dry.queued, 2);
// Admin preview shows the legal counts.
const admin = read('admin.html');
assert.match(admin, /r\.legal/, 'admin preview renders the legal limits');
console.log('PASS round76 retention purges: receipts and filing log 5 years; statistics fields at the end of the 12th month (identity and photos too, age kept); tourist-tax rows 5 years after the tax year, invoice rows 10 years, a receipt inside its 5 years keeps the row; reservation contacts 12 months, reservations 10 years; marketing 24 months, withdrawals 24 months; chat 12 months unless still active; entry bookings with their append-only audit 12 months; notifications 12 months; closed accounts 10 years; dry run and admin preview change nothing; daily purge stores counts; idempotent; guards unchanged for API roles; only old receipts can reach the receipts bucket; resolved chats 365 days');
