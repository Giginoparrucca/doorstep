// Round 72 Phase 6 — launch rehearsal: the actual admin billing handler
// (billing_launch_preview / billing_launch / billing_launch_emails) wired to
// PGlite running the real Round 72 migrations; launch screen in Chromium
// 390/1440. Fictional accounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const B = await import('../api/_admin-billing.js');
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
assert.ok(PGlite, 'PGlite required for the launch rehearsal');

const H1 = '00000000-0000-4000-8000-0000000000c1', H2 = '00000000-0000-4000-8000-0000000000c2', H3 = '00000000-0000-4000-8000-0000000000c3',
  TEST = '00000000-0000-4000-8000-0000000000c4', ADMIN = '00000000-0000-4000-8000-0000000000ad', INV = '00000000-0000-4000-8000-0000000000c5';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
  create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$select null::uuid$$; create function auth.email() returns text language sql stable as $$select null::text$$;
  create table public.admin_users(email text primary key);
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  create table public.pilot_invites(id uuid primary key default gen_random_uuid(), email text unique, status text, invited_at timestamptz, accepted_at timestamptz, invited_by uuid, notes text);
  create table public.properties(id uuid primary key default gen_random_uuid(), owner_id uuid, name text, is_test boolean default false, deleted_at timestamptz, host_language text);`);
await db.exec(read('supabase/migrations/20261115090000_round72_trial_billing.sql'));
const launchSql = read('supabase/migrations/20261115110000_round72_launch.sql');
await db.exec(launchSql); await db.exec(launchSql);
await db.query(`insert into auth.users(id,email,created_at) values ($1,'one@example.invalid','2026-09-01T10:00:00Z'),($2,'two@example.invalid','2026-10-01T10:00:00Z'),
  ($3,'three@example.invalid','2026-10-10T10:00:00Z'),($4,'test@example.invalid','2026-08-01T10:00:00Z'),($5,'admin@example.invalid','2026-07-01T10:00:00Z'),($6,'invited@example.invalid','2026-11-01T10:00:00Z')`, [H1, H2, H3, TEST, ADMIN, INV]);
await db.exec(`insert into public.admin_users values ('admin@example.invalid');
  insert into public.pilot_invites(email,status,accepted_at) values ('invited@example.invalid','accepted','2026-11-02T10:00:00Z'), ('two@example.invalid','accepted','2026-10-02T10:00:00Z');`);
await db.query(`insert into public.properties(owner_id,name,is_test,host_language) values ($1,'Uno',false,'it'),($2,'Due',false,'en'),($3,'Tre',false,'it'),($4,'Prova',true,'it'),($5,'Admin',false,'it')`, [H1, H2, H3, TEST, ADMIN]);
// H3 already has a row (e.g. admin set free for life before launch): untouched.
await db.query(`insert into public.host_subscriptions(user_id,status,free_forever_reason) values ($1,'free_forever','partner')`, [H3]);

const LAUNCH = '2026-12-01T09:00:00Z'; // 1 Dec 2026 Rome
const sent = [];
const deps = {
  rpc: async (name, a) => {
    if (name === 'billing_launch_candidates') return (await db.query('select public.billing_launch_candidates($1) r', [a.p_launch_at])).rows[0].r;
    if (name === 'billing_launch') return (await db.query('select public.billing_launch($1,$2,$3,$4) r', [a.p_launch_at, JSON.stringify(a.p_hosts), a.p_actor, a.p_dry])).rows[0].r;
    throw new Error('unexpected rpc ' + name);
  },
  get: async path => {
    if (path.startsWith('billing_settings')) return (await db.query('select * from public.billing_settings')).rows;
    if (path.startsWith('host_subscriptions')) return (await db.query('select * from public.host_subscriptions order by user_id')).rows;
    return [];
  },
  patch: async (path, body) => {
    const uid = /user_id=eq\.([0-9a-f-]+)/.exec(path)[1];
    const cond = /reminders_sent->>launch=is\.null/.test(path) ? ` and reminders_sent->>'launch' is null` : '';
    return (await db.query(`update public.host_subscriptions set reminders_sent=$2 where user_id=$1${cond} returning user_id`, [uid, JSON.stringify(body.reminders_sent)])).rows;
  },
  event: async r => { await db.query(`insert into public.billing_events(user_id,actor,action,new_value,reason) values ($1,$2,$3,$4,$5)`, [r.user_id, r.actor, r.action, JSON.stringify(r.new_value), r.reason]); return true; },
  userEmail: async id => (await db.query('select email from auth.users where id=$1', [id])).rows[0]?.email || null,
  lang: async id => (await db.query('select host_language from public.properties where owner_id=$1 limit 1', [id])).rows[0]?.host_language || 'it',
  send: async (to, subject, html) => { sent.push({ to, subject, html }); return { ok: true, id: 'r' + sent.length }; },
  consoleUrl: 'https://app.invalid/host-console.html',
};
const act = (action, body) => B.handleBillingAction(action, body, { actor: 'admin@example.invalid', deps, now: new Date('2026-12-01T09:00:00Z') });
const count = async (t, w = '') => (await db.query(`select count(*)::int n from public.${t} ${w}`)).rows[0].n;

// Preview: eligible hosts, admins excluded, suggested and earliest dates.
let r = await act('billing_launch_preview', { launch_at: LAUNCH });
const emails = r.body.hosts.map(h => h.email);
assert.deepEqual(emails, ['invited@example.invalid', 'one@example.invalid', 'test@example.invalid', 'three@example.invalid', 'two@example.invalid'], 'owners + accepted invites, admin excluded');
const one = r.body.hosts.find(h => h.email === 'one@example.invalid');
assert.equal(one.suggested_last_free_day, '2026-12-30', 'launch + 30 days'); assert.equal(one.earliest_last_free_day, '2026-12-07', 'launch + 7 days');
assert.equal(r.body.hosts.find(h => h.email === 'test@example.invalid').all_test, true); assert.equal(r.body.hosts.find(h => h.email === 'three@example.invalid').has_row, true);
assert.equal(new Date(r.body.hosts.find(h => h.email === 'two@example.invalid').trial_started_at).toISOString(), '2026-10-02T10:00:00.000Z', 'trial start = invite acceptance');
const plan = [{ user_id: H1, last_free_day: '2026-12-30' }, { user_id: H2, last_free_day: '2027-01-15' }, { user_id: INV, last_free_day: '2026-12-07' },
  { user_id: TEST, free_forever_reason: 'account di test' }, { user_id: H3, last_free_day: '2026-12-30' }];
// A date before launch + 7 refuses the whole launch; nothing written.
r = await act('billing_launch', { launch_at: LAUNCH, hosts: [...plan.slice(0, 2), { user_id: INV, last_free_day: '2026-12-06' }], dry: false });
assert.equal(r.status, 400); assert.equal(r.body.error, 'date_before_launch_plus_7');
assert.equal(await count('host_subscriptions'), 1); assert.equal((await db.query('select launch_at from public.billing_settings')).rows[0].launch_at, null);
// Admins cannot be launched.
assert.equal((await act('billing_launch', { launch_at: LAUNCH, hosts: [{ user_id: ADMIN, last_free_day: '2026-12-30' }], dry: false })).body.error, 'host_not_eligible');
// Dry run writes nothing.
r = await act('billing_launch', { launch_at: LAUNCH, hosts: plan });
assert.equal(r.body.dry_run, true); assert.deepEqual(r.body.hosts.map(h => h.outcome).sort(), ['already_has_row', 'would_create', 'would_create', 'would_create', 'would_set_free']);
assert.equal(await count('host_subscriptions'), 1); assert.equal(await count('billing_events'), 0); assert.equal((await db.query('select launch_at from public.billing_settings')).rows[0].launch_at, null);
// Launch.
r = await act('billing_launch', { launch_at: LAUNCH, hosts: plan, dry: false });
assert.equal(r.body.created, 3); assert.equal(r.body.free_forever, 1); assert.equal(r.body.skipped_existing, 1);
assert.equal(new Date((await db.query('select launch_at from public.billing_settings')).rows[0].launch_at).toISOString(), '2026-12-01T09:00:00.000Z');
const row = async u => (await db.query('select * from public.host_subscriptions where user_id=$1', [u])).rows[0];
assert.equal(new Date((await row(H1)).trial_ends_at).toISOString(), '2026-12-30T23:00:00.000Z', 'exactly the chosen date (last free day 30 Dec)');
assert.equal(new Date((await row(H2)).trial_ends_at).toISOString(), '2027-01-15T23:00:00.000Z');
assert.equal(new Date((await row(INV)).trial_ends_at).toISOString(), '2026-12-07T23:00:00.000Z', 'minimum notice: launch + 7');
assert.equal((await row(TEST)).status, 'free_forever'); assert.equal((await row(TEST)).free_forever_reason, 'account di test');
assert.equal((await row(H3)).free_forever_reason, 'partner', 'existing row untouched');
assert.equal(await count('host_subscriptions', `where user_id='${ADMIN}'`), 0, 'admins get no row');
assert.equal(await count('billing_events', `where action='trial_started'`), 3); assert.equal(await count('billing_events', `where action='free_forever_on'`), 1);
const st = async (u, t) => (await db.query('select public.billing_access_state($1,$2) s', [u, t])).rows[0].s;
assert.equal((await st(H1, '2026-12-01T10:00:00Z')).days_left, 30, 'H1 sees 30 days on launch day');
assert.equal((await st(INV, '2026-12-01T10:00:00Z')).days_left, 7);
// Lancia twice: no new rows, no date moves, launch_at unchanged.
const before = JSON.stringify((await db.query('select user_id, trial_ends_at, status from public.host_subscriptions order by user_id')).rows);
r = await act('billing_launch', { launch_at: '2026-12-05T09:00:00Z', hosts: plan.map(p => p.last_free_day ? { ...p, last_free_day: '2027-03-01' } : p), dry: false });
assert.equal(r.body.already_launched, true); assert.equal(r.body.created, 0); assert.equal(r.body.skipped_existing, 5);
assert.equal(JSON.stringify((await db.query('select user_id, trial_ends_at, status from public.host_subscriptions order by user_id')).rows), before);
assert.equal(new Date((await db.query('select launch_at from public.billing_settings')).rows[0].launch_at).toISOString(), '2026-12-01T09:00:00.000Z');
// Launch emails: preview, then once each with that host's own date.
r = await act('billing_launch_emails', {}); assert.equal(r.body.dry_run, true); assert.equal(sent.length, 0);
assert.equal(r.body.results.filter(x => x.outcome === 'would_send').length, 5);
r = await act('billing_launch_emails', { dry: false }); assert.equal(r.body.results.filter(x => x.outcome === 'sent').length, 5);
const mail = to => sent.find(m => m.to === to);
assert.match(mail('one@example.invalid').html, /Nuove condizioni WelcomeBnB: accedi per firmarle\. Puoi continuare a usare WelcomeBnB gratis fino al 30 dicembre 2026; poi costa 60 € l&#39;anno, IVA inclusa\./);
assert.match(mail('invited@example.invalid').html, /gratis fino al 7 dicembre 2026/, 'each host its own date');
assert.match(mail('two@example.invalid').html, /free until 15 January 2027; after that it costs €60\/year, VAT included/, 'English host');
assert.match(mail('test@example.invalid').html, /Per te WelcomeBnB resta gratuito/);
assert.ok(!sent.some(m => m.to === 'admin@example.invalid'));
r = await act('billing_launch_emails', { dry: false }); assert.equal(sent.length, 5, 'sent once per host'); assert.equal(r.body.results.filter(x => x.outcome === 'already_sent').length, 5);
assert.equal(await count('billing_events', `where action='reminder_sent'`), 5);
// Grants: only service_role may launch.
for (const f of ['billing_launch(timestamptz, jsonb, text, boolean)', 'billing_launch_candidates(timestamptz)']) {
  assert.equal((await db.query(`select has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') a`)).rows[0].a, false, f);
  assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE') a`)).rows[0].a, true, f);
}

// ── Launch screen, Chromium 390/1440 ──
const html = read('admin.html');
const fn = name => { let i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); if (html.slice(i - 6, i) === 'async ') i -= 6;
  const line = html.slice(i, html.indexOf('\n', i)); if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line + '\n';
  return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const constBlock = name => { const i = html.indexOf('const ' + name + ' = '); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('};\n', i) + 3); };
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const preview = (await act('billing_launch_preview', { launch_at: LAUNCH })).body;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
    await page.setContent(`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="content"></div></body></html>`);
    await page.addScriptTag({ content: `
      window.posted = []; window.toasts = [];
      let hostHealth = { billing_settings: { id: 1, launch_at: null, annual_price_cents: 6000 } };
      const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
      function adminToast(m, t) { toasts.push([m, t]); } async function loadHostHealth() { return { billing_settings: { id: 1, launch_at: '${LAUNCH}', annual_price_cents: 6000 } }; }
      const PREVIEW = ${JSON.stringify({ ...preview, hosts: preview.hosts.map(h => h.email === 'three@example.invalid' ? h : { ...h, has_row: false }) })};
      window.fetch = async (url, o) => { const b = JSON.parse(o.body); posted.push(b);
        const body = b.action === 'billing_launch_preview' ? PREVIEW : b.action === 'billing_launch' ? { ok: true, dry_run: b.dry, created: 3, free_forever: 1, skipped_existing: 1, hosts: b.hosts.map(h => ({ user_id: h.user_id, outcome: h.free_forever_reason ? 'would_set_free' : 'would_create', last_free_day: h.last_free_day })) }
          : { ok: true, results: [{ outcome: 'would_send' }] };
        return { ok: true, status: 200, json: async () => body }; };
      ${fn('escapeHtml')}${constBlock('BILLING_ERRORS')}
      ${['renderBillingSettings', 'launchVal', 'billingLaunchPrepare', 'billingLaunchApplyAll', 'billingLaunchPayload', 'billingLaunch', 'billingLaunchEmails', 'adminBillingRaw', 'renderLaunchControls', 'billingVal'].map(fn).join('\n')}
      let launchPlan = null;
      function renderView() { document.getElementById('content').innerHTML = renderBillingSettings(); }
      renderView();` });
    await page.click('[data-launch-prepare]'); await page.waitForSelector('[data-launch-plan]');
    assert.equal(await page.inputValue(`#launch-date-${H1}`), '2026-12-30'); assert.equal(await page.getAttribute(`#launch-date-${H1}`, 'min'), '2026-12-07');
    assert.equal(await page.isChecked(`#launch-free-${TEST}`), true, 'test-only accounts suggested free for life');
    assert.match(await page.locator('[data-launch-plan]').textContent(), /ha già un abbonamento: non cambia/);
    await page.fill('#launch-all-date', '2027-01-10'); await page.click('text=Applica a tutti');
    assert.equal(await page.inputValue(`#launch-date-${H2}`), '2027-01-10'); assert.equal(await page.inputValue(`#launch-date-${TEST}`), '2026-12-30', 'free-for-life rows not changed by «Applica a tutti»');
    await page.fill(`#launch-date-${H1}`, '2026-12-20');
    await page.click('[data-launch-dry]'); await page.waitForSelector('[data-launch-preview]');
    const dry = (await page.evaluate(() => posted)).find(p => p.action === 'billing_launch');
    assert.equal(dry.dry, true); assert.equal(new Date(dry.launch_at).toISOString(), new Date(LAUNCH).toISOString());
    assert.deepEqual(dry.hosts.find(h => h.user_id === H1), { user_id: H1, last_free_day: '2026-12-20' });
    assert.deepEqual(dry.hosts.find(h => h.user_id === TEST), { user_id: TEST, free_forever_reason: 'account di test' });
    assert.ok(!dry.hosts.some(h => h.user_id === H3), 'hosts with a row are not sent');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal scroll');
    if (process.env.R72_QA_DIR) await page.screenshot({ path: `${process.env.R72_QA_DIR}/launch-${width}.png`, fullPage: true });
    await page.click('[data-launch-go]'); await page.waitForSelector('[data-launch-done]');
    assert.equal((await page.evaluate(() => posted)).filter(p => p.action === 'billing_launch').at(-1).dry, false);
    await page.click('[data-launch-emails="dry"]'); await page.waitForFunction(() => posted.some(p => p.action === 'billing_launch_emails'));
    assert.equal((await page.evaluate(() => posted)).find(p => p.action === 'billing_launch_emails').dry, true);
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
assert.match(read('docs/legal/LAUNCH_RUNBOOK.md'), /blocked — owner action/);
console.log('PASS round72 launch rehearsal (PGlite, real migrations, actual handler): preview lists owners + accepted invites without admins, suggested launch+30 and earliest launch+7, trial start = invite acceptance; a date before launch+7 or an admin refuses the whole launch with nothing written; dry run writes nothing; Lancia gives each host exactly its date, free for life with reason, existing rows untouched, admins no row, launch_at set once; second Lancia creates/moves nothing; launch emails previewed, then once per host with that host\'s own date (IT/EN, free-for-life variant); functions service_role only; launch screen 390/1440 (dates, min, apply to all, free for life, preview payload, Lancia, launch emails) without horizontal scroll');
