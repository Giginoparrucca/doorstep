// 17 Nov 2026 — the free trial starts at registration (Daniele). The real
// Round 72 migrations + 20261117090000_trial_from_registration.sql in PGlite
// (run twice): backfill for registered hosts only (not admins, not invited
// without a password, existing rows untouched), registration date order
// (e-mail confirmed → accepted invite → account creation), Rome-day end;
// still «prelaunch» for everyone; new hosts get their trial at first console
// load or when accepting the invitation, before the launch too; launch
// candidates carry the trial end; a trial that ended before the launch is
// read-only right after it (the launch screen warns). Admin extend action:
// before launch any date (also past) and «shortened» when earlier; after
// launch past dates refused. Fictional accounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261117090000_trial_from_registration.sql';
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (!PGlite) { console.log('SKIP trial from registration: @electric-sql/pglite not installed'); process.exit(0); }

const A = '00000000-0000-4000-8000-0000000000e1', B = '00000000-0000-4000-8000-0000000000e2', C = '00000000-0000-4000-8000-0000000000e3',
  NOPW = '00000000-0000-4000-8000-0000000000e4', ADMIN = '00000000-0000-4000-8000-0000000000ad', KEEP = '00000000-0000-4000-8000-0000000000e5',
  LATE = '00000000-0000-4000-8000-0000000000e6', INV = '00000000-0000-4000-8000-0000000000e7';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid$$;
  create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
  grant execute on function auth.uid(), auth.email() to anon, authenticated, service_role;
  create table public.admin_users(email text primary key);
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.email(), ''))) $$;
  grant execute on function public.is_admin() to authenticated, service_role;
  create table public.pilot_invites(id uuid primary key default gen_random_uuid(), email text unique, status text, invited_at timestamptz, accepted_at timestamptz, invited_by uuid, notes text);
  create table public.properties(id uuid primary key default gen_random_uuid(), owner_id uuid, name text, is_test boolean default false, deleted_at timestamptz, host_language text);
  create function public.accept_my_invite() returns jsonb language sql security definer as $$ select '{}'::jsonb $$;`);
await db.query(`insert into auth.users(id,email,created_at,email_confirmed_at) values
  ($1,'a@example.invalid','2026-10-01T08:00:00Z','2026-10-01T09:00:00Z'),
  ($2,'b@example.invalid','2026-10-20T08:00:00Z',null),
  ($3,'c@example.invalid','2026-11-10T23:30:00Z','2026-11-10T23:30:00Z'),
  ($4,'nopw@example.invalid','2026-11-15T08:00:00Z',null),
  ($5,'admin@example.invalid','2026-07-01T08:00:00Z','2026-07-01T08:00:00Z'),
  ($6,'keep@example.invalid','2026-09-01T08:00:00Z','2026-09-01T08:00:00Z')`, [A, B, C, NOPW, ADMIN, KEEP]);
await db.exec(`insert into public.admin_users values ('admin@example.invalid');
  insert into public.pilot_invites(email,status,invited_at,accepted_at) values ('b@example.invalid','accepted','2026-10-19T08:00:00Z','2026-10-21T08:00:00Z'), ('inv@example.invalid','invited','2026-11-16T08:00:00Z',null);`);
for (const m of ['20261115090000_round72_trial_billing.sql', '20261115100000_round72_read_only_rls.sql', '20261115110000_round72_launch.sql']) {
  try { await db.exec(read('supabase/migrations/' + m)); } catch (e) { if (!m.includes('read_only_rls')) throw e; } // RLS policies need the console tables
}
await db.query(`insert into public.host_subscriptions(user_id,trial_started_at,status,free_forever_reason) values ($1,'2026-09-01T08:00:00Z','free_forever','partner')`, [KEEP]);
// B has no confirmed e-mail but an accepted invite: registered at the invite.
await db.exec(`update auth.users set email_confirmed_at = null where email = 'b@example.invalid';`);
const sql = read(MIG);
await db.exec(sql);
const rows = async () => (await db.query(`select user_id, trial_started_at, trial_ends_at, status from public.host_subscriptions order by user_id`)).rows;
const snap = JSON.stringify(await rows());
await db.exec(sql);
assert.equal(JSON.stringify(await rows()), snap, 're-running changes nothing');
const by = Object.fromEntries((await rows()).map(r => [r.user_id, r]));
// A: confirmed 1 Oct 09:00 UTC (Rome 1 Oct) → last free day 30 Oct, ends at 31 Oct 00:00 Rome (UTC+1 after DST ends 25 Oct).
assert.equal(by[A].trial_started_at.toISOString(), '2026-10-01T09:00:00.000Z'); assert.equal(by[A].trial_ends_at.toISOString(), '2026-10-30T23:00:00.000Z'); assert.equal(by[A].status, 'trialing');
// C: confirmed 10 Nov 23:30 UTC = 11 Nov 00:30 Rome → day 11 Nov + 30 → ends 11 Dec 00:00 Rome.
assert.equal(by[C].trial_ends_at.toISOString(), '2026-12-10T23:00:00.000Z', 'Rome day, not UTC day');
assert.ok(!by[B], 'no confirmed e-mail: no row in the backfill (the invite acceptance or first login creates it)');
assert.ok(!by[NOPW], 'invited without a password: no row yet'); assert.ok(!by[ADMIN], 'admins: no trial');
assert.equal(by[KEEP].status, 'free_forever', 'existing rows untouched');
const ev = (await db.query(`select user_id, action, reason from public.billing_events where action = 'trial_started' order by user_id`)).rows;
assert.deepEqual(ev.map(e => [e.user_id, e.reason]), [[A, 'registration (assumed, 17 Nov 2026)'], [C, 'registration (assumed, 17 Nov 2026)']]);
// Still prelaunch for everyone: nothing visible to hosts.
for (const u of [A, C, KEEP]) assert.equal((await db.query('select public.billing_access_state($1, now()) s', [u])).rows[0].s.state, 'prelaunch');
// First console load of B (registered through the accepted invite): row from the invite date, still prelaunch.
const as = (sub, email, q, args = []) => db.transaction(async tx => { await tx.exec('set local role authenticated'); await tx.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub, email, role: 'authenticated' })]); return tx.query(q, args); });
assert.equal((await as(B, 'b@example.invalid', 'select public.host_access_state() s')).rows[0].s.state, 'prelaunch');
const b = (await db.query('select * from public.host_subscriptions where user_id = $1', [B])).rows[0];
assert.equal(b.trial_started_at.toISOString(), '2026-10-21T08:00:00.000Z', 'registration = accepted invite'); assert.equal(b.trial_ends_at.toISOString(), '2026-11-19T23:00:00.000Z');
// Admin console load: no row.
await as(ADMIN, 'admin@example.invalid', 'select public.host_access_state() s');
assert.equal((await db.query('select count(*)::int n from public.host_subscriptions where user_id = $1', [ADMIN])).rows[0].n, 0);
// Accepting an invitation now starts the trial now, before the launch.
await db.query(`insert into auth.users(id,email,created_at,email_confirmed_at) values ($1,'inv@example.invalid',now(),now())`, [INV]);
const accepted = (await as(INV, 'inv@example.invalid', 'select public.accept_my_invite() r')).rows[0].r;
assert.equal(accepted.ok, true);
const inv = (await db.query('select * from public.host_subscriptions where user_id = $1', [INV])).rows[0];
assert.ok(inv && inv.status === 'trialing' && Date.now() - inv.trial_started_at.getTime() < 60000, 'trial starts at acceptance');
assert.equal((await db.query(`select count(*)::int n from public.billing_events where user_id = $1 and reason = 'invite accepted'`, [INV])).rows[0].n, 1);
// Launch candidates carry the trial end and status.
const cands = (await db.query(`select public.billing_launch_candidates('2026-12-01T09:00:00Z') r`)).rows[0].r;
await db.query(`insert into public.properties(owner_id,name) values ($1,'Casa A'),($2,'Casa C'),($3,'Keep')`, [A, C, KEEP]);
const c2 = (await db.query(`select public.billing_launch_candidates('2026-12-01T09:00:00Z') r`)).rows[0].r;
const ca = c2.find(x => x.user_id === A);
assert.deepEqual([ca.has_row, ca.subscription_status, ca.trial_ends_at.slice(0, 19)], [true, 'trialing', '2026-10-30T23:00:00']);
assert.equal(c2.find(x => x.user_id === KEEP).subscription_status, 'free_forever');
assert.ok(Array.isArray(cands));
// After the launch, A's trial (ended 31 Oct) has also passed its 7-day grace: read-only at once — hence the warning on «Lancia».
await db.exec(`update public.billing_settings set launch_at = '2026-12-01T09:00:00Z'`);
assert.equal((await db.query(`select public.billing_access_state($1, '2026-12-01T10:00:00Z') s`, [A])).rows[0].s.state, 'read_only');
assert.equal((await db.query(`select public.billing_access_state($1, '2026-12-01T10:00:00Z') s`, [C])).rows[0].s.state, 'trial');
await db.exec(`update public.billing_settings set launch_at = null`);
// The admin «until» date: any date before the launch (also past), «shortened» when earlier; after launch past refused.
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fictional';
const { handleBillingAction } = await import('../api/_admin-billing.js');
const events = [];
const deps = launchAt => ({
  get: async path => path.startsWith('billing_settings') ? [{ launch_at: launchAt }] : path.startsWith('host_subscriptions') ? [{ user_id: A, status: 'trialing', trial_ends_at: '2026-12-31T23:00:00Z' }] : [],
  patch: async (p, row) => [row], insert: async (t, row) => [row], event: async e => { events.push(e); return [e]; },
});
const now = new Date('2026-11-17T10:00:00Z');
let out = await handleBillingAction('billing_extend', { user_id: A, until: '2026-11-05', reason: 'scadenza reale' }, { actor: 'admin@example.invalid', now, deps: deps(null) });
assert.equal(out.status, 200, 'before launch a past expiry can be recorded'); assert.equal(out.body.last_free_day, '2026-11-05');
assert.equal(events.at(-1).action, 'trial_shortened', 'earlier date recorded as shortened');
out = await handleBillingAction('billing_extend', { user_id: A, until: '2027-02-01', reason: 'accordo' }, { actor: 'admin@example.invalid', now, deps: deps(null) });
assert.equal(events.at(-1).action, 'trial_extended');
out = await handleBillingAction('billing_extend', { user_id: A, until: '2026-11-05', reason: 'x y z' }, { actor: 'admin@example.invalid', now, deps: deps('2026-11-01T09:00:00Z') });
assert.equal(out.status, 400, 'after the launch a past date is refused'); assert.equal(out.body.error, 'date_invalid');
// Wiring: launch screen warning, prefilled date, Utenti shows stored dates before launch.
const html = read('admin.html'), users = read('admin-users.js');
assert.match(html, /data-launch-early/); assert.match(html, /scade prima di lancio \+ 7 giorni: al lancio sarà in sola lettura/);
assert.match(html, /id="bx-until-\$\{u\}" \$\{typeof hostHealth !== "undefined"/, 'no minimum date before the launch');
assert.match(users, /if \(p\.state === 'prelaunch' && sub\)/);
console.log('PASS trial from registration: backfill for registered hosts only (admins, invited without password and existing rows untouched), registration = e-mail confirmed → accepted invite → account, Rome-day end, idempotent, still prelaunch for everyone; first console load and invite acceptance start the trial before the launch too; launch candidates carry trial end/status; a trial ended before the launch is read-only after it (warned on «Lancia»); admin date: any date before launch (past allowed, «shortened» when earlier), past refused after launch');
