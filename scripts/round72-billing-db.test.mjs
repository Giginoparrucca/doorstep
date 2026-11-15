// Round 72 Phase 1 — trial/billing data model. Real migration in PGlite
// (twice), real Round 51 accept_my_invite shape, per-role probes, Rome-day
// boundaries incl. DST. Fictional accounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261115090000_round72_trial_billing.sql';
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (!PGlite) { console.log('SKIP round72 billing db: @electric-sql/pglite not installed'); process.exit(0); }

const db = new PGlite();
const HOST = '00000000-0000-4000-8000-0000000000a1', OTHER = '00000000-0000-4000-8000-0000000000a2',
  ADMIN = '00000000-0000-4000-8000-0000000000ad', NEWHOST = '00000000-0000-4000-8000-0000000000a3', LAZY = '00000000-0000-4000-8000-0000000000a4';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid$$;
  create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
  grant execute on function auth.uid(), auth.email() to anon, authenticated, service_role;
  create table public.admin_users(email text primary key);
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.email(), ''))) $$;
  grant execute on function public.is_admin() to authenticated, service_role;
  create table public.pilot_invites(id uuid primary key default gen_random_uuid(), email text unique, status text, invited_at timestamptz, accepted_at timestamptz, invited_by uuid, notes text);
  create function public.accept_my_invite() returns jsonb language sql security definer as $$ select '{}'::jsonb $$;`);
await db.query(`insert into auth.users(id,email,created_at) values ($1,'host@example.invalid','2026-10-01T10:00:00Z'),($2,'other@example.invalid','2026-10-01T10:00:00Z'),
  ($3,'admin@example.invalid','2026-09-01T10:00:00Z'),($4,'new@example.invalid','2026-12-20T10:00:00Z'),($5,'lazy@example.invalid','2026-10-05T10:00:00Z')`, [HOST, OTHER, ADMIN, NEWHOST, LAZY]);
await db.exec(`insert into public.admin_users values ('admin@example.invalid');`);
const sql = read(MIG);
await db.exec(sql);
const snap = async () => JSON.stringify((await db.query(`select (select row_to_json(s) from public.billing_settings s) a, (select count(*) from public.host_subscriptions) b, (select count(*) from public.billing_events) c`)).rows);
const before = await snap(); await db.exec(sql); assert.equal(await snap(), before, 're-running the migration changes nothing');

const claims = (sub, email, role = 'authenticated') => JSON.stringify({ sub, email, role });
const as = (role, c, fn) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); if (c) await tx.query(`select set_config('request.jwt.claims',$1,true)`, [c]); return fn(tx); });
const st = async (u, now) => (await db.query('select public.billing_access_state($1,$2) s', [u, now])).rows[0].s;

// ── Prelaunch for everyone while launch_at is null ──
for (const u of [HOST, OTHER, LAZY]) assert.equal((await st(u, '2027-06-01T10:00:00Z')).state, 'prelaunch');
assert.equal((await as('authenticated', claims(HOST, 'host@example.invalid'), tx => tx.query('select public.host_access_state() s'))).rows[0].s.state, 'prelaunch');
assert.equal((await db.query('select count(*)::int n from public.host_subscriptions')).rows[0].n, 0, 'no row created before launch');
// launch_at in the future is still prelaunch
await db.exec(`update public.billing_settings set launch_at='2026-12-01T09:00:00Z', bank_transfer_iban='IT00X0000000000000000000000', bank_transfer_holder='Fictional SRLS'`);
assert.equal((await st(HOST, '2026-11-30T22:59:00Z')).state, 'prelaunch');

// ── Boundaries: trial ends at Rome midnight 31 Dec (last free day 30 Dec), grace 7 days ──
const ins = (u, x) => db.query(`insert into public.host_subscriptions(user_id, trial_started_at, trial_ends_at, status, free_forever_reason, paid_until)
  values ($1, '2026-12-01T09:00:00Z', $2, $3, $4, $5)`, [u, x.ends ?? null, x.status || 'trialing', x.reason || null, x.paid || null]);
await ins(HOST, { ends: '2026-12-30T23:00:00Z' }); // 31 Dec 00:00 Rome (CET)
let s = await st(HOST, '2026-12-01T09:00:00Z'); assert.equal(s.state, 'trial'); assert.equal(s.days_left, 30, '30 days on launch day');
assert.equal(s.price_eur, 60); assert.equal(Number(s.vat_rate), 22); assert.equal(s.bank_transfer_holder, 'Fictional SRLS');
assert.equal((await st(HOST, '2026-12-24T10:00:00Z')).days_left, 7);
assert.equal((await st(HOST, '2026-12-23T22:59:00Z')).days_left, 8, '23:59 Rome on 23 Dec: still 8');
s = await st(HOST, '2026-12-30T22:59:59Z'); assert.equal(s.state, 'trial'); assert.equal(s.days_left, 1, 'last minute of the last day: 1, never 0');
s = await st(HOST, '2026-12-30T23:00:00Z'); assert.equal(s.state, 'grace'); assert.equal(s.grace_days_left, 7, 'first paid day starts grace');
s = await st(HOST, '2027-01-06T22:59:59Z'); assert.equal(s.state, 'grace'); assert.equal(s.grace_days_left, 1, 'grace last day');
s = await st(HOST, '2027-01-06T23:00:00Z'); assert.equal(s.state, 'read_only'); assert.equal(new Date(s.since).toISOString(), '2027-01-06T23:00:00.000Z');

// ── DST: trial ending 29 Mar 2027 00:00 Rome (night before is the DST switch 28 Mar) ──
await ins(OTHER, { ends: '2027-03-28T23:00:00Z' }); // 29 Mar 00:00 CEST = 28 Mar 22:00Z? check below
await db.query(`update public.host_subscriptions set trial_ends_at = public.billing_day_start('2027-03-29') where user_id=$1`, [OTHER]);
assert.equal(new Date((await db.query(`select public.billing_day_start('2027-03-29') d`)).rows[0].d).toISOString(), '2027-03-28T22:00:00.000Z', 'CEST midnight');
assert.equal(new Date((await db.query(`select public.billing_day_start('2027-03-28') d`)).rows[0].d).toISOString(), '2027-03-27T23:00:00.000Z', 'CET midnight');
assert.equal((await st(OTHER, '2027-03-27T23:30:00Z')).days_left, 1, 'DST day (23 h) counts as one day');
assert.equal((await st(OTHER, '2027-03-27T22:30:00Z')).days_left, 2);
assert.equal((await st(OTHER, '2027-03-28T22:00:00Z')).state, 'grace');
const g = await st(OTHER, '2027-03-28T22:00:00Z'); assert.equal(g.grace_days_left, 7);

// ── Extension moves trial_ends_at; free_forever and paid_until override ──
await db.query(`update public.host_subscriptions set trial_ends_at = public.billing_day_start('2027-01-15') where user_id=$1`, [HOST]);
s = await st(HOST, '2027-01-08T10:00:00Z'); assert.equal(s.state, 'trial', 'an extension restores a read-only host'); assert.equal(s.days_left, 7);
await db.query(`update public.host_subscriptions set paid_until='2028-01-10T00:00:00Z' where user_id=$1`, [HOST]);
assert.equal((await st(HOST, '2027-06-01T10:00:00Z')).state, 'active');
s = await st(HOST, '2028-01-12T10:00:00Z'); assert.equal(s.state, 'grace', 'grace after paid_until too');
assert.equal((await st(HOST, '2028-01-20T10:00:00Z')).state, 'read_only');
await db.query(`update public.host_subscriptions set status='free_forever', free_forever_reason='pilot partner' where user_id=$1`, [HOST]);
s = await st(HOST, '2030-01-01T10:00:00Z'); assert.equal(s.state, 'free'); assert.equal(s.reason, 'free_forever');
await assert.rejects(db.query(`update public.host_subscriptions set free_forever_reason=null where user_id=$1`, [HOST]), /check constraint/, 'free_forever needs a reason');
assert.equal((await st(ADMIN, '2030-01-01T10:00:00Z')).state, 'free', 'admin accounts never see the paywall');
await db.query(`update public.billing_settings set launch_at='2026-11-01T09:00:00Z'`); // launched (in the past) for the RPC probes
await db.query(`update public.host_subscriptions set trial_ends_at = public.billing_day_start('2026-11-02') where user_id=$1`, [OTHER]); // grace ended 9 Nov: read_only now

// ── Who may read which state ──
const hostC = claims(OTHER, 'other@example.invalid');
assert.equal((await as('authenticated', hostC, tx => tx.query('select public.host_access_state() s'))).rows[0].s.state, 'read_only', 'own state');
await assert.rejects(as('authenticated', hostC, tx => tx.query('select public.host_access_state($1) s', [HOST])), /not allowed/, 'not another host');
assert.equal((await as('authenticated', claims(ADMIN, 'admin@example.invalid'), tx => tx.query('select public.host_access_state($1) s', [HOST]))).rows[0].s.state, 'free', 'admin reads any');
assert.equal((await as('service_role', claims(null, null, 'service_role'), tx => tx.query('select public.host_access_state($1) s', [OTHER]))).rows[0].s.state, 'read_only', 'service_role reads any');
await assert.rejects(as('anon', claims(null, null, 'anon'), tx => tx.query('select public.host_access_state($1) s', [HOST])), /permission denied/);
await assert.rejects(as('authenticated', hostC, tx => tx.query(`select public.billing_access_state($1, now())`, [HOST])), /permission denied/, 'pure function not exposed');
assert.equal((await as('authenticated', hostC, tx => tx.query('select public.host_can_write() w'))).rows[0].w, false, 'read_only cannot write');
assert.equal((await as('authenticated', hostC, tx => tx.query('select public.host_can_write($1) w', [HOST]))).rows[0].w, false, 'asking for someone else: false, no leak');
assert.equal((await as('authenticated', claims(HOST, 'host@example.invalid'), tx => tx.query('select public.host_can_write() w'))).rows[0].w, true);

// ── Lazy row after launch (no invite): trial from max(created_at, launch) ──
s = (await as('authenticated', claims(LAZY, 'lazy@example.invalid'), tx => tx.query('select public.host_access_state() s'))).rows[0].s;
const lazyRow = (await db.query('select trial_started_at, trial_ends_at from public.host_subscriptions where user_id=$1', [LAZY])).rows[0];
assert.equal(new Date(lazyRow.trial_started_at).toISOString(), '2026-11-01T09:00:00.000Z', 'launch later than account creation');
assert.equal(new Date(lazyRow.trial_ends_at).toISOString(), '2026-11-30T23:00:00.000Z', 'Rome midnight 1 Dec = 30 days');
await as('authenticated', claims(LAZY, 'lazy@example.invalid'), tx => tx.query('select public.host_access_state() s'));
assert.equal((await db.query(`select count(*)::int n from public.billing_events where user_id=$1 and action='trial_started'`, [LAZY])).rows[0].n, 1, 'created once, logged once');

// ── accept_my_invite after launch opens the 30-day trial ──
await db.query(`insert into public.pilot_invites(email,status,invited_at) values ('new@example.invalid','invited',now()), ('host@example.invalid','accepted',now())`);
const r = (await as('authenticated', claims(NEWHOST, 'new@example.invalid'), tx => tx.query('select public.accept_my_invite() r'))).rows[0].r;
assert.equal(r.ok, true);
const nr = (await db.query('select trial_started_at, trial_ends_at, status from public.host_subscriptions where user_id=$1', [NEWHOST])).rows[0];
assert.equal(nr.status, 'trialing');
const startDay = (await db.query(`select (now() at time zone 'Europe/Rome')::date::text d`)).rows[0].d;
assert.equal(new Date(nr.trial_ends_at).toISOString(), new Date((await db.query(`select public.billing_day_start($1::date + 30) d`, [startDay])).rows[0].d).toISOString(), '30 days from acceptance');
assert.equal((await as('authenticated', claims(NEWHOST, 'new@example.invalid'), tx => tx.query('select public.accept_my_invite() r'))).rows[0].r.already, true, 'second call: already');
assert.equal((await db.query(`select count(*)::int n from public.billing_events where user_id=$1`, [NEWHOST])).rows[0].n, 1);
assert.equal((await as('authenticated', claims(null, null), tx => tx.query('select public.accept_my_invite() r'))).rows[0].r.code, 'no_session', 'Round 51 behaviour kept');
// before launch: no row
await db.query(`update public.billing_settings set launch_at=null`);
await db.query(`update public.pilot_invites set status='invited' where email='host@example.invalid'`);
await db.query(`delete from public.host_subscriptions where user_id=$1`, [HOST]);
await as('authenticated', claims(HOST, 'host@example.invalid'), tx => tx.query('select public.accept_my_invite()'));
assert.equal((await db.query('select count(*)::int n from public.host_subscriptions where user_id=$1', [HOST])).rows[0].n, 0, 'no trial before launch');

// ── Grants and RLS per role ──
const hc = claims(OTHER, 'other@example.invalid');
assert.equal((await as('authenticated', hc, tx => tx.query('select user_id from public.host_subscriptions'))).rows.length, 1, 'host reads own row only');
assert.equal((await as('authenticated', claims(ADMIN, 'admin@example.invalid'), tx => tx.query('select user_id from public.host_subscriptions'))).rows.length, 3, 'admin reads all');
assert.equal((await as('authenticated', hc, tx => tx.query('select id from public.billing_settings'))).rows.length, 1, 'hosts read settings');
for (const q of [`update public.host_subscriptions set status='free_forever', free_forever_reason='me' where user_id='${OTHER}'`,
  `insert into public.host_subscriptions(user_id) values ('${OTHER.replace('a2', 'b9')}')`, `delete from public.host_subscriptions`,
  `update public.billing_settings set annual_price_cents=0`, `insert into public.billing_events(user_id,actor,action) values ('${OTHER}','me','marked_paid')`])
  await assert.rejects(as('authenticated', hc, tx => tx.query(q)), /permission denied/, 'host cannot write: ' + q.slice(0, 40));
for (const t of ['billing_settings', 'host_subscriptions', 'billing_events'])
  await assert.rejects(as('anon', claims(null, null, 'anon'), tx => tx.query(`select * from public.${t}`)), /permission denied/, 'anon: ' + t);
await as('service_role', claims(null, null, 'service_role'), tx => tx.query(`update public.billing_settings set bank_transfer_holder='Fictional SRLS 2'`));
await as('service_role', claims(null, null, 'service_role'), tx => tx.query(`insert into public.billing_events(user_id,actor,action,reason) values ($1,'admin@example.invalid','trial_extended','test')`, [OTHER]));
await assert.rejects(as('service_role', claims(null, null, 'service_role'), tx => tx.query(`delete from public.host_subscriptions`)), /permission denied/, 'no DELETE even for service_role');

// ── billing_events append-only, owner included ──
await assert.rejects(db.query(`update public.billing_events set reason='x'`), /append-only/);
await assert.rejects(db.query(`delete from public.billing_events`), /append-only/);
await assert.rejects(db.query(`truncate public.billing_events`), /append-only/);
await assert.rejects(as('service_role', claims(null, null, 'service_role'), tx => tx.query(`update public.billing_events set reason='x'`)), /permission denied|append-only/);

console.log('PASS round72 billing db: prelaunch for everyone while launch_at null or future (no rows); Rome-day boundaries (30 days on launch day, 8→7 at Rome midnight, 1 on the last minute never 0, grace 7→1, read_only at grace end) incl. DST; extension restores access; paid_until → active then grace/read_only; free_forever needs a reason and overrides; admins free; host reads only own state, admin/service_role any, anon none, pure function hidden; host_can_write false only in read_only and never leaks others; lazy row once from max(created_at, launch); accept_my_invite after launch opens 30 days once, Round 51 answers kept, nothing before launch; grants/RLS per role; billing_events append-only incl. owner and TRUNCATE; migration re-run changes nothing');
