// Round 72 Phase 4 — admin billing actions on /api/admin-host-health:
// server-side admin gate before any read, each action's exact changes and
// one event, reasons and notice rules, the switch-to-paid email, the paywall
// from that date (PGlite + real migration), and the admin UI in Chromium
// 390/1440. Fictional accounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service';
const { default: handler } = await import('../api/admin-host-health.js');
const B = await import('../api/_admin-billing.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const U = '00000000-0000-4000-8000-0000000000a1';

// ── Gate: anon, forged, non-admin refused before any billing read ──
{
  let role = 'host'; const calls = [];
  const json = d => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
  const fetch = async (url, opts = {}) => { calls.push(String(url));
    if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === 'Bearer valid' ? json({ id: 'admin-1', email: 'admin@example.invalid' }) : { ok: false, status: 401, json: async () => ({}) };
    if (url.endsWith('/rpc/is_admin')) { assert.equal(opts.headers.Authorization, 'Bearer valid', 'caller JWT'); return json(role === 'admin'); }
    return json([]); };
  const call = async (auth, body) => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...(auth ? { authorization: auth } : {}) }, body }, res, { fetch, billing: { get: async () => { calls.push('billing-read'); return []; } } }); return res; };
  const body = { action: 'billing_free_forever', user_id: U, on: true, reason: 'pilot partner' };
  assert.equal((await call(null, body)).code, 401); assert.equal((await call('Bearer forged', body)).code, 401);
  assert.equal((await call('Bearer valid', body)).code, 403, 'non-admin');
  assert.ok(!calls.some(c => c === 'billing-read' || c.includes('host_subscriptions') || c.includes('billing_')), 'nothing read before the admin check');
}

// ── Actions on an in-memory store (exact fields, one event each) ──
function store(row) {
  const db = { sub: row ? { ...row } : null, events: [], sent: [], settings: { id: 1, annual_price_cents: 6000, bank_transfer_iban: null, bank_transfer_holder: null } };
  db.deps = {
    get: async path => path.startsWith('billing_settings') ? [db.settings] : (db.sub ? [db.sub] : []),
    patch: async (path, body) => { if (path.startsWith('billing_settings')) { Object.assign(db.settings, body); return [db.settings]; } Object.assign(db.sub, body); return [db.sub]; },
    insert: async (t, r) => { db.sub = { ...r }; return [db.sub]; },
    event: async r => { db.events.push(r); return true; },
    userEmail: async () => 'host@example.invalid', lang: async () => db.lang || 'it',
    send: async (to, subject, html) => { db.sent.push({ to, subject, html }); return { ok: true, id: 'r1' }; },
  };
  return db;
}
const NOW = new Date('2026-12-10T10:00:00Z'); // 10 Dec 2026 Rome
const act = (db, action, body) => B.handleBillingAction(action, { user_id: U, ...body }, { actor: 'admin@example.invalid', deps: db.deps, now: NOW });
const trialing = (last = '2026-12-31') => ({ user_id: U, status: 'trialing', trial_started_at: '2026-12-01T09:00:00Z', trial_ends_at: B.romeMidnight(B.addDays(last, 1)), paid_until: null, free_forever_reason: null });
// Rome midnights incl. DST
assert.equal(B.romeMidnight('2027-01-01'), '2026-12-31T23:00:00.000Z'); assert.equal(B.romeMidnight('2027-03-29'), '2027-03-28T22:00:00.000Z');
assert.equal(B.lastDay('2026-12-31T23:00:00.000Z'), '2026-12-31');
// Estendi prova
{ let db = store(trialing());
  let r = await act(db, 'billing_extend', { days: 7 }); assert.equal(r.status, 400); assert.equal(r.body.error, 'reason_required');
  r = await act(db, 'billing_extend', { days: 7, reason: 'asked for more time' }); assert.equal(r.status, 200); assert.equal(r.body.last_free_day, '2027-01-07');
  assert.equal(db.sub.trial_ends_at, '2027-01-07T23:00:00.000Z'); assert.equal(db.sub.status, 'trialing'); assert.equal(db.events.length, 1);
  assert.equal(db.events[0].action, 'trial_extended'); assert.equal(db.events[0].actor, 'admin@example.invalid'); assert.equal(db.events[0].reason, 'asked for more time');
  assert.equal(db.events[0].old_value.trial_ends_at, '2026-12-31T23:00:00.000Z');
  // expired host: counted from today, status back to trialing (access restored)
  db = store({ ...trialing('2026-11-20'), status: 'expired', read_only_since: '2026-11-28T23:00:00Z' });
  r = await act(db, 'billing_extend', { days: 14, reason: 'reactivate' }); assert.equal(r.body.last_free_day, '2026-12-23'); assert.equal(db.sub.status, 'trialing'); assert.equal(db.sub.read_only_since, null);
  r = await act(db, 'billing_extend', { until: '2027-02-15', reason: 'chosen date' }); assert.equal(db.sub.trial_ends_at, B.romeMidnight('2027-02-16'));
  // 17 Nov 2026: before the launch any real expiry can be recorded (also past); after it, past dates are refused.
  db.settings.launch_at = null;
  assert.equal((await act(db, 'billing_extend', { until: '2026-12-01', reason: 'real expiry' })).status, 200, 'before launch: past date recorded');
  assert.equal(db.events.at(-1).action, 'trial_shortened');
  db.settings.launch_at = '2026-11-01T09:00:00Z';
  assert.equal((await act(db, 'billing_extend', { until: '2026-12-01', reason: 'x past' })).body.error, 'date_invalid');
  assert.equal((await act(db, 'billing_extend', { days: 9, reason: 'odd days' })).body.error, 'days_invalid');
  assert.equal((await act(store({ ...trialing(), status: 'free_forever', free_forever_reason: 'p' }), 'billing_extend', { days: 7, reason: 'abc' })).status, 409); }
// Passa a pagamento
{ let db = store(trialing());
  let r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-16' }); assert.equal(r.body.error, 'notice_too_short', 'before today+7 refused without the host asking');
  r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-11', host_asked: true }); assert.equal(r.body.error, 'note_required');
  r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-09', host_asked: true, note: 'wants to pay now' }); assert.equal(r.body.error, 'date_in_past');
  assert.equal(db.events.length, 0); assert.equal(db.sent.length, 0);
  r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-17' }); assert.equal(r.status, 200); assert.equal(r.body.email_sent, true);
  assert.equal(db.sub.trial_ends_at, B.romeMidnight('2026-12-17'), 'payment due from that Rome day'); assert.equal(db.events.length, 1); assert.equal(db.events[0].action, 'trial_shortened');
  assert.equal(db.sent.length, 1); assert.match(db.sent[0].subject, /a pagamento dal 17 dicembre 2026/);
  assert.match(db.sent[0].html, /Dal 17 dicembre 2026 l&#39;uso di WelcomeBnB è a pagamento \(60 € l&#39;anno, IVA inclusa\)\. Fino ad allora non cambia nulla\./);
  r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-17' }); assert.equal(r.body.unchanged, true, 're-applying is idempotent'); assert.equal(db.sent.length, 1); assert.equal(db.events.length, 1);
  db = store(trialing()); r = await act(db, 'billing_switch_to_paid', { due_date: '2026-12-10', host_asked: true, note: 'host asked on the phone' });
  assert.equal(r.status, 200, 'today allowed when the host asked'); assert.equal(db.events[0].new_value.host_asked, true); assert.equal(db.events[0].reason, 'host asked on the phone');
  // from free_forever
  db = store({ ...trialing(), status: 'free_forever', free_forever_reason: 'pilot', trial_ends_at: null }); db.lang = 'en';
  r = await act(db, 'billing_switch_to_paid', { due_date: '2027-01-15' }); assert.equal(db.sub.status, 'trialing'); assert.equal(db.sub.free_forever_reason, null);
  assert.equal(db.events[0].action, 'free_forever_off'); assert.match(db.sent[0].html, /From 15 January 2027 WelcomeBnB is paid \(€60\/year, VAT included\)\. Nothing changes until then\./);
  // a paying host is not switchable
  assert.equal((await act(store({ ...trialing(), status: 'active', paid_until: '2027-12-01T00:00:00Z' }), 'billing_switch_to_paid', { due_date: '2027-01-15' })).status, 409);
  // no row yet (e.g. before launch): created
  db = store(null); r = await act(db, 'billing_switch_to_paid', { due_date: '2027-01-15' }); assert.equal(db.sub.user_id, U); assert.equal(db.sub.status, 'trialing'); }
// Gratis a vita
{ let db = store(trialing());
  assert.equal((await act(db, 'billing_free_forever', { on: true })).body.error, 'reason_required');
  await act(db, 'billing_free_forever', { on: true, reason: 'pilot partner' }); assert.equal(db.sub.status, 'free_forever'); assert.equal(db.sub.free_forever_reason, 'pilot partner'); assert.equal(db.events.at(-1).action, 'free_forever_on');
  assert.equal((await act(db, 'billing_free_forever', { on: true, reason: 'again' })).body.unchanged, true); assert.equal(db.events.length, 1);
  db.sub.trial_ends_at = null; await act(db, 'billing_free_forever', { on: false, reason: 'end of pilot' });
  assert.equal(db.sub.status, 'trialing'); assert.equal(db.sub.trial_ends_at, B.romeMidnight('2026-12-17'), 'never without 7 days of notice'); assert.equal(db.events.at(-1).action, 'free_forever_off'); }
// Segna pagato
{ const db = store({ ...trialing('2026-11-20'), status: 'expired' });
  const r = await act(db, 'billing_mark_paid', { paid_on: '2026-12-09', note: 'bonifico ricevuto' });
  assert.equal(r.body.last_paid_day, '2027-12-08'); assert.equal(db.sub.status, 'active'); assert.equal(db.sub.payment_method, 'bank_transfer');
  assert.equal(db.sub.paid_until, B.romeMidnight('2027-12-09')); assert.equal(db.events.at(-1).action, 'marked_paid'); assert.equal(db.events.at(-1).reason, 'bonifico ricevuto');
  assert.equal((await act(db, 'billing_mark_paid', { paid_on: '2027-01-01' })).body.error, 'date_invalid', 'not in the future');
  assert.equal(B.billingChip({ state: 'active', paid_until: db.sub.paid_until }), 'Pagato fino al 08/12/2027'); }
// Settings
{ const db = store(trialing());
  assert.equal((await act(db, 'billing_settings', { bank_transfer_iban: 'not an iban' })).body.error, 'iban_invalid');
  await act(db, 'billing_settings', { annual_price_cents: 6000, bank_transfer_iban: 'it60 x054 2811 1010 0000 0123 456', bank_transfer_holder: 'Fictional SRLS' });
  assert.equal(db.settings.bank_transfer_iban, 'IT60X0542811101000000123456'); assert.equal(db.settings.bank_transfer_holder, 'Fictional SRLS'); assert.ok(!('launch_at' in db.settings && db.settings.launch_at), 'settings never touch the launch switch'); }
// Chips
assert.equal(B.billingChip({ state: 'trial', days_left: 12 }), 'Prova · 12 gg'); assert.equal(B.billingChip({ state: 'grace', grace_days_left: 3 }), 'Grazia · 3 gg');
assert.equal(B.billingChip({ state: 'read_only' }), 'Sola lettura'); assert.equal(B.billingChip({ state: 'free', reason: 'free_forever' }), 'Gratis a vita');

// ── The paywall appears on the chosen day and not before (real state function) ──
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select null::uuid$$; create function auth.email() returns text language sql stable as $$select null::text$$;
    create table public.admin_users(email text primary key);
    create function public.is_admin() returns boolean language sql stable as $$ select false $$;
    create table public.pilot_invites(id uuid primary key default gen_random_uuid(), email text unique, status text, invited_at timestamptz, accepted_at timestamptz, invited_by uuid, notes text);`);
  await db.exec(read('supabase/migrations/20261115090000_round72_trial_billing.sql'));
  await db.exec(`update public.billing_settings set launch_at='2026-12-01T09:00:00Z'`);
  const s = store(trialing()); await act(s, 'billing_switch_to_paid', { due_date: '2026-12-17' });
  await db.query(`insert into public.host_subscriptions(user_id, trial_ends_at, status) values ($1,$2,'trialing')`, [U, s.sub.trial_ends_at]);
  const st = async t => (await db.query('select public.billing_access_state($1,$2) s', [U, t])).rows[0].s;
  assert.equal((await st('2026-12-16T22:59:00Z')).state, 'trial', '16 Dec 23:59 Rome: still free'); assert.equal((await st('2026-12-16T22:59:00Z')).days_left, 1);
  assert.equal((await st('2026-12-16T23:00:00Z')).state, 'grace', '17 Dec 00:00 Rome: paywall');
}

// ── Admin UI, Chromium 390/1440 ──
const html = read('admin.html');
const fn = name => { let i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); if (html.slice(i - 6, i) === 'async ') i -= 6;
  const line = html.slice(i, html.indexOf('\n', i)); if ((line.match(/\{/g) || []).length === (line.match(/\}/g) || []).length) return line + '\n'; // one-line function
  return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const constLine = name => { const i = html.indexOf('const ' + name + ' = '); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('};\n', i) + 3); };
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const billing = { state: { state: 'trial', days_left: 12 }, chip: 'Prova · 12 gg', subscription: { trial_ends_at: '2026-12-31T23:00:00Z' },
  events: [{ action: 'trial_extended', actor: 'admin@example.invalid', reason: 'more time', created_at: '2026-12-05T10:00:00Z' }] };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setContent(`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="content"></div></body></html>`);
    await page.addScriptTag({ content: `
      window.posted = []; window.toasts = [];
      let hostHealth = { billing_settings: { id: 1, launch_at: null, annual_price_cents: 6000, bank_transfer_iban: null, bank_transfer_holder: null } };
      const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
      function adminToast(m, t) { toasts.push([m, t]); } async function loadHostHealth() { return hostHealth; } function renderView() {}
      window.fetch = async (url, o) => { const b = JSON.parse(o.body); posted.push(b); const err = b.action === 'billing_extend' && !b.reason ? 'reason_required' : null;
        return { ok: !err, status: err ? 400 : 200, json: async () => err ? { error: err } : { ok: true, email_sent: b.action === 'billing_switch_to_paid' ? true : undefined } }; };
      ${fn('escapeHtml')}${constLine('BILLING_EVENT_LABEL')}${constLine('BILLING_ERRORS')}
      ${['billingYmd', 'billingLastDay', 'billingChipHtml', 'adminBilling', 'billingVal', 'billingExtend', 'billingSwitch', 'billingFree', 'billingPaid', 'billingSaveSettings', 'renderBillingBox', 'renderBillingSettings'].map(fn).join('\n')}
      document.getElementById('content').innerHTML = renderBillingBox(${JSON.stringify(billing)}, '${U}') + renderBillingSettings();` });
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    assert.match(await page.locator('[data-billing-chip]').first().textContent(), /Prova · 12 gg/);
    assert.match(await page.locator('[data-billing-events]').textContent(), /Prova estesa · admin@example\.invalid · more time/);
    assert.match(await page.locator('[data-billing-box]').textContent(), /prova fino al 31\/12\/2026/);
    // Extend without a reason: refused with the Italian message
    await page.click('[data-billing-extend="7"]'); await page.waitForFunction(() => toasts.length === 1);
    assert.match((await page.evaluate(() => toasts))[0][0], /motivo obbligatorio/);
    await page.fill(`#bx-reason-${U}`, 'more time'); await page.click('[data-billing-extend="7"]');
    await page.waitForFunction(() => posted.length === 2); assert.deepEqual((await page.evaluate(() => posted))[1], { action: 'billing_extend', user_id: U, days: 7, reason: 'more time' });
    // Switch to paid: date min is today+7, unless the host asked
    const min7 = await page.getAttribute(`#bs-date-${U}`, 'min'); await page.check(`#bs-asked-${U}`);
    const min0 = await page.getAttribute(`#bs-date-${U}`, 'min'); assert.ok(min0 < min7, 'checkbox allows an earlier date');
    await page.fill(`#bs-note-${U}`, 'host asked'); await page.click('[data-billing-switch]'); await page.waitForFunction(() => posted.length === 3);
    const sw = (await page.evaluate(() => posted))[2]; assert.equal(sw.action, 'billing_switch_to_paid'); assert.equal(sw.host_asked, true); assert.equal(sw.note, 'host asked'); assert.equal(sw.due_date, min7);
    assert.match((await page.evaluate(() => toasts)).at(-1)[0], /email inviata/);
    await page.fill(`#bf-reason-${U}`, 'pilot'); await page.click('[data-billing-free="on"]'); await page.waitForFunction(() => posted.length === 4);
    assert.deepEqual((await page.evaluate(() => posted))[3], { action: 'billing_free_forever', user_id: U, on: true, reason: 'pilot' });
    await page.fill(`#bp-note-${U}`, 'bonifico'); await page.click('[data-billing-paid]'); await page.waitForFunction(() => posted.length === 5);
    assert.equal((await page.evaluate(() => posted))[4].action, 'billing_mark_paid');
    await page.fill('#bset-iban', 'IT60X0542811101000000123456'); await page.fill('#bset-holder', 'Fictional SRLS'); await page.click('[data-billing-settings] button');
    await page.waitForFunction(() => posted.length === 6); assert.deepEqual((await page.evaluate(() => posted))[5], { action: 'billing_settings', annual_price_cents: 6000, bank_transfer_iban: 'IT60X0542811101000000123456', bank_transfer_holder: 'Fictional SRLS' });
    assert.match(await page.locator('[data-billing-settings]').textContent(), /non ancora/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal scroll');
    if (process.env.R72_QA_DIR) await page.screenshot({ path: `${process.env.R72_QA_DIR}/admin-${width}.png`, fullPage: true });
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
assert.match(html, /billingChipHtml\(h\.billing\) : ''/, 'chip on the overview cards');
assert.match(html, /renderBillingBox\(billingOwner\.billing, billingOwner\.owner_id\) : ''/, 'box on the host deep dive');
console.log('PASS round72 admin billing: anon/forged/non-admin refused before any read (caller JWT is_admin); extend +7/+14/+30/date with reason, from today when expired (access restored), free_forever refused; switch to paid ≥ today+7 or earlier/today only when the host asked with a note, from trialing/expired/free_forever (not paying), host emailed once IT/EN with the date and price, idempotent, row created when missing; free for life on/off with reason, off never without 7 days; mark paid one year, bank_transfer, not in the future; settings IBAN normalised, launch untouched; one event per change with actor and reason; Rome midnights incl. DST; paywall from the chosen day not before (real state function); admin UI 390/1440 chip, events, forms, Italian errors, no horizontal scroll');
