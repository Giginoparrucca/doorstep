// 19 Nov 2026 — login e-mail change: self-service in the host console
// (confirmation links via Supabase) and assisted change in admin «Utenti»
// (Auth admin API, admin log, notices to both addresses). The trigger
// account_email_changed (real migration, PGlite) moves copies of the old
// address and leaves deliberately different addresses alone. Fictional data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261119090000_account_email_change.sql';
const U1 = '00000000-0000-4000-8000-0000000000a1', U2 = '00000000-0000-4000-8000-0000000000a2';

// 1. Trigger in PGlite.
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.properties(id serial primary key, owner_id uuid, reminder_email text, host_email text);
    create table public.host_notification_settings(host_id uuid primary key, notify_email text);
    create table public.pilot_invites(id serial primary key, email text unique);
    create table public.pilot_hosts(id serial primary key, host_email text unique);
    create table public.admin_users(email text primary key);`);
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  await db.query(`insert into auth.users values ($1, 'old@example.invalid'), ($2, 'other@example.invalid')`, [U1, U2]);
  await db.query(`insert into public.properties(owner_id, reminder_email, host_email) values ($1, 'OLD@example.invalid', 'old@example.invalid'), ($1, 'digest@example.invalid', 'contatti@example.invalid'), ($2, 'old@example.invalid', null)`, [U1, U2]);
  await db.query(`insert into public.host_notification_settings values ($1, ' old@example.invalid '), ($2, 'old@example.invalid')`, [U1, U2]);
  await db.query(`insert into public.pilot_invites(email) values ('old@example.invalid'), ('taken@example.invalid')`);
  await db.query(`insert into public.pilot_hosts(host_email) values ('old@example.invalid')`);
  await db.query(`insert into public.admin_users values ('old@example.invalid')`);
  await db.query(`update auth.users set email = 'new@example.invalid' where id = $1`, [U1]);
  const rows = async q => (await db.query(q)).rows;
  assert.deepEqual(await rows(`select owner_id, reminder_email, host_email from public.properties order by id`), [
    { owner_id: U1, reminder_email: 'new@example.invalid', host_email: 'new@example.invalid' },
    { owner_id: U1, reminder_email: 'digest@example.invalid', host_email: 'contatti@example.invalid' },
    { owner_id: U2, reminder_email: 'old@example.invalid', host_email: null }], 'own copies of the old address move (any case); chosen addresses and other owners stay');
  assert.deepEqual(await rows(`select host_id, notify_email from public.host_notification_settings order by host_id`), [{ host_id: U1, notify_email: 'new@example.invalid' }, { host_id: U2, notify_email: 'old@example.invalid' }]);
  assert.deepEqual(await rows(`select email from public.pilot_invites order by id`), [{ email: 'new@example.invalid' }, { email: 'taken@example.invalid' }], 'invitation follows (registration date kept)');
  assert.deepEqual(await rows(`select host_email from public.pilot_hosts`), [{ host_email: 'new@example.invalid' }]);
  assert.deepEqual(await rows(`select email from public.admin_users`), [{ email: 'new@example.invalid' }], 'an admin keeps admin access');
  // Unique column already holding the new address: skipped, the login change still succeeds.
  await db.query(`update auth.users set email = 'taken@example.invalid' where id = $1`, [U1]);
  assert.deepEqual((await rows(`select email from auth.users where id = '${U1}'`))[0], { email: 'taken@example.invalid' });
  assert.deepEqual(await rows(`select email from public.pilot_invites order by id`), [{ email: 'new@example.invalid' }, { email: 'taken@example.invalid' }], 'conflict skipped, no error');
  // Not callable by API roles.
  assert.equal((await rows(`select has_function_privilege('authenticated', 'public.account_email_changed()', 'execute') x`))[0].x, false);
  console.log('  db: trigger checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// 1b. The real admin log accepts what the endpoint writes (this is what failed in production on 19 Nov).
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.properties(id serial primary key, owner_id uuid, reminder_email text, host_email text);
    create table public.host_notification_settings(host_id uuid primary key, notify_email text);
    create table public.pilot_invites(id serial primary key, email text unique); create table public.pilot_hosts(id serial primary key, host_email text unique);
    create table public.admin_users(email text primary key);
`);
  // The real account-history table (Round 72) and its action list, then the fix (19 Nov: the stand-in hid that the list refused these names).
  { const r72 = read('supabase/migrations/20261115090000_round72_trial_billing.sql'); const i = r72.indexOf('create table if not exists public.billing_events ('); await db.exec(r72.slice(i, r72.indexOf(');', i) + 2)); }
  await assert.rejects(db.query(`insert into public.billing_events(user_id, actor, action) values ('${U1}', 'admin', 'login_email_change_admin')`), /billing_events_action_check/, 'before the fix: refused (what failed in production)');
  { const fix2 = read('supabase/migrations/20261119110000_billing_events_login_email.sql'); await db.exec(fix2); await db.exec(fix2); }
  await db.query(`insert into public.billing_events(user_id, actor, action, old_value, new_value, reason) values ('${U1}', 'admin@example.invalid', 'login_email_change_admin', '{"email":"a"}', '{"email":"b"}', '[verifica] telefonata')`);
  await assert.rejects(db.query(`insert into public.billing_events(user_id, actor, action) values ('${U1}', 'admin', 'something_else')`), /billing_events_action_check/, 'other names still refused');
  await db.exec(read('supabase/migrations/20261116170000_round67_admin_audit_log.sql'));
  await db.exec(read(MIG)); const fix = read('supabase/migrations/20261119100000_admin_audit_account_email.sql'); await db.exec(fix); await db.exec(fix);
  const { cleanMetadata } = await import('../api/_admin-audit.js');
  const { fingerprint: fp } = await import('../api/_admin-account.js');
  const ins = (action, outcome, metadata) => db.query(`insert into public.admin_access_events(actor_id, actor_email, action, outcome, target_table, target_id, metadata) values ($1, 'admin@example.invalid', $2, $3, 'auth_users', $4, $5)`, [U2, action, outcome, U1, JSON.stringify(cleanMetadata(metadata) || {})]);
  await ins('account_email_change', 'requested', {});
  await ins('account_email_change', 'ok', { status: 200, old_email_sha: fp('a@b.it'), new_email_sha: fp('c@d.it'), reason: 'telefonata del 19/11', notices: { old: true, new: true } });
  await ins('account_email_change_preview', 'ok', { status: 200 });
  assert.equal((await db.query(`select count(*)::int n from public.admin_access_events where action like 'account_email_change%'`)).rows[0].n, 3, 'admin log accepts the actions and the metadata');
  await assert.rejects(db.query(`insert into public.admin_access_events(action, metadata) values ('account_email_change', '{"x":"a@b.it"}')`), /check/, 'addresses still refused by the log');
  await assert.rejects(db.query(`insert into public.admin_access_events(action) values ('account_email_whatever')`), /check/, 'other actions still refused');
  // Every change leaves an account-history row (self-service included).
  await db.query(`insert into auth.users values ($1, 'old@example.invalid')`, [U1]);
  await db.query(`update auth.users set email = 'new@example.invalid' where id = $1`, [U1]);
  assert.deepEqual((await db.query(`select action, old_value, new_value from public.billing_events where action = 'login_email_changed'`)).rows, [{ action: 'login_email_changed', old_value: { email: 'old@example.invalid' }, new_value: { email: 'new@example.invalid' } }], 'automatic history row (accepted by the real action list)');
  console.log('  db: admin log and account history checked in PGlite');
}

// 2. Server logic.
const { handleAccountAction, noticeHtml } = await import('../api/_admin-account.js');
const sent = []; let updated = null;
const history = [];
const deps = (over = {}) => ({ recordHistory: async e => { history.push(e); }, getUser: async id => id === U1 ? { id: U1, email: 'Old@Example.invalid' } : null,
  updateEmail: async (id, e) => { updated = [id, e]; return { ok: true, status: 200 }; }, sendEmail: async (to, subj, html) => { sent.push({ to, subj, html }); return { ok: true }; }, ...over });
const act = (body, d = deps()) => handleAccountAction('account_email_change', body, { deps: d });
assert.equal((await act({ user_id: 'x', new_email: 'a@b.it', reason: 'telefonata' })).status, 400);
assert.equal((await act({ user_id: U1, new_email: 'not-an-email', reason: 'telefonata' })).status, 400);
assert.equal((await act({ user_id: U1, new_email: 'new@example.invalid', reason: 'ok' })).status, 400, 'reason required');
assert.equal((await act({ user_id: U2, new_email: 'new@example.invalid', reason: 'telefonata', dry: false })).status, 404);
assert.deepEqual((await act({ user_id: U1, new_email: 'OLD@example.invalid', reason: 'telefonata', dry: false })).body.unchanged, true);
const prev = await act({ user_id: U1, new_email: ' New@Example.invalid ', reason: 'telefonata' });
assert.deepEqual([prev.status, prev.body], [200, { dry: true, user_id: U1, old_email: 'old@example.invalid', new_email: 'new@example.invalid' }]); assert.equal(updated, null, 'preview changes nothing'); assert.equal(sent.length, 0);
const CHECKS = { callback: true, details: true };
const noChecks = await act({ user_id: U1, new_email: 'new@example.invalid', reason: 'telefonata', dry: false, checks: { callback: true } });
assert.deepEqual([noChecks.status, updated, history.length], [400, null, 0], 'both identity checks required on the server');
const taken = await act({ user_id: U1, new_email: 'new@example.invalid', reason: 'telefonata', dry: false, checks: CHECKS }, deps({ updateEmail: async () => ({ ok: false, status: 422, error: 'A user with this email address has already been registered' }) }));
assert.deepEqual([taken.status, taken.body.error], [409, 'Questa email è già usata da un altro account.']); assert.equal(sent.length, 0, 'no notices when nothing changed');
const done = await act({ user_id: U1, new_email: 'new@example.invalid', reason: 'telefonata del 19/11', dry: false, checks: CHECKS });
assert.deepEqual(updated, [U1, 'new@example.invalid']);
assert.deepEqual([done.status, done.body.changed, done.body.notices], [200, true, { old: true, new: true }]);
assert.deepEqual(sent.map(x => x.to), ['old@example.invalid', 'new@example.invalid'], 'both addresses notified');
assert.match(sent[0].html, /da <strong>old@example\.invalid<\/strong> a <strong>new@example\.invalid<\/strong>/); assert.match(sent[0].html, /Se non hai chiesto tu questo cambio/);
const { fingerprint, maskEmails } = await import('../api/_admin-account.js');
assert.deepEqual(done.audit, { old_email_sha: fingerprint('old@example.invalid'), new_email_sha: fingerprint('new@example.invalid'), reason: 'telefonata del 19/11', notices: { old: true, new: true } }, 'log: fingerprints, never addresses');
assert.match(fingerprint('a@b.it'), /^[0-9a-f]{16}$/); assert.equal(maskEmails('scritto da x.y@z.it ieri'), 'scritto da [email] ieri');
assert.deepEqual(history.at(-1), { userId: U1, actor: 'admin', oldEmail: 'old@example.invalid', newEmail: 'new@example.invalid', reason: '[verifica: richiamato al numero in archivio; dettagli della struttura confermati] telefonata del 19/11' }, 'who/why and the checks in the account history');
// No history record → no change.
updated = null;
const noHist = await act({ user_id: U1, new_email: 'new2@example.invalid', reason: 'telefonata', dry: false, checks: CHECKS }, deps({ recordHistory: async () => { throw new Error('down'); } }));
assert.equal(noHist.status, 503); assert.equal(updated, null, 'history first, or nothing changes');
assert.doesNotMatch(noticeHtml({ which: 'new', oldEmail: '<x>@a.it', newEmail: 'b@a.it' }), /<x>/, 'escaped');

// 3. Endpoint: admin gate before anything; journalled before the change and after.
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fictional-service-key';
const { default: handler } = await import('../api/admin-host-health.js');
const authFetch = role => async url => {
  if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: U2, email: 'admin@example.invalid' }));
  if (String(url).endsWith('/rpc/is_admin')) return new Response(JSON.stringify(role === 'admin'));
  throw new Error('unexpected ' + url);
};
const journal = []; let calls = 0;
const post = async (role, body, auditOk = true) => { const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer jwt' }, body }, res, { fetch: authFetch(role),
    account: deps({ getUser: async id => { calls++; return { id, email: 'old@example.invalid' }; } }),
    audit: { first: async e => { journal.push(['first', e.action, e.targetId]); return auditOk; }, after: async e => { journal.push(['after', e.action, e.outcome, e.metadata]); } } }); return res; };
const body = { action: 'account_email_change', user_id: U1, new_email: 'new@example.invalid', reason: 'telefonata', dry: false, checks: { callback: true, details: true } };
assert.equal((await post('host', body)).code, 403); assert.equal(calls, 0, 'nothing read before the admin check');
assert.equal((await post('admin', body, false)).code, 503, 'no journal, no change'); assert.equal(calls, 0);
const ok = await post('admin', body);
assert.equal(ok.code, 200); assert.equal(ok.headers['Cache-Control'], 'no-store');
assert.deepEqual(journal.at(-2), ['first', 'account_email_change', U1]);
assert.deepEqual(journal.at(-1).slice(0, 3), ['after', 'account_email_change', 'ok']); assert.equal(journal.at(-1)[3].new_email_sha, fingerprint('new@example.invalid')); assert.ok(!/@/.test(JSON.stringify(journal.at(-1)[3])), 'no address in the log');
assert.equal(history.at(-1).actor, 'admin@example.invalid', 'history names the admin');

// 4. Browser: host console card and return notices; admin «Utenti» box.
const html = read('host-console.html');
const fn = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i > 0, name); const start = html.lastIndexOf('\n', i) + 1; return html.slice(start, html.indexOf('\n}\n', i) + 2); };
const card = html.slice(html.indexOf('<div class="form-card" id="hostAccountEmailCard"'), html.indexOf('<!-- Round 69 — accepted Terms version'));
const dict = lang => { const start = html.indexOf(lang === 'it' ? "acct_email_lost: 'Non riesci" : "acct_email_lost: 'Can no"); assert.ok(start > 0); return Object.fromEntries([...html.slice(start, html.indexOf('\n    acct_email_sent', start) + 400).matchAll(/^\s*(acct_email_\w+|lost_email_\w+|login_lost_email): '((?:[^'\\]|\\.)*)'/gm)].map(m => [m[1], m[2].replace(/\\'/g, "'")])); };
// Support procedure: paths, identity check, call back on the number on file, hand-over is different.
{ const doc = read('docs/support/EMAIL_CHANGE.md');
  for (const x of ['Self-service', 'Assisted change', 'Not an e-mail change', 'Call back on a number already on file', 'Never use a number, e-mail or link given in the request', 'do not change it']) assert.ok(doc.includes(x), 'procedure: ' + x); }
// Login page: link and help box for a host who lost the mailbox.
assert.match(html, /<a onclick="toggleLostEmailHelp\('lostEmailHelp'\)" data-lost-email-link[^>]*data-h="login_lost_email">/);
assert.ok(html.includes('<div id="lostEmailHelp" data-lost-email-help'));
assert.ok(html.includes("if (id === 'settings' && typeof renderAccountEmailCard === 'function') renderAccountEmailCard();"));
assert.match(html, /try \{ if \(typeof showEmailChangeNotice === 'function'\) showEmailChangeNotice\(\); \} catch \(_\) \{\}\ntry \{ showAuthLinkNotice\(\); \} catch \(_\) \{\}/, 'runs before the generic link notice');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage(); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const boot = async (query = '', hash = '', user = { email: 'old@example.invalid' }) => {
      await page.route('**/*', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${card}</body></html>` }));
      await page.goto('https://console.example.invalid/host-console.html' + query + hash);
      await page.addScriptTag({ content: `var hostLang=${JSON.stringify(lang)};window.__wbnbInitialHash=${JSON.stringify(hash)};const HT=${JSON.stringify(dict(lang))};function h(k){return HT[k]||k;}
        window.updates=[];let U=${JSON.stringify(user)};const sb={auth:{getUser:async()=>({data:{user:U}}),updateUser:async(a,o)=>{window.updates.push([a,o]);if(a.email==='taken@example.invalid')return{error:{message:'A user with this email address has already been registered'}};U={...U,new_email:a.email};return{error:null};}}};
        window.WELCOME_BNB_CONFIG={support:{whatsapp:'+39 350 000 0000',email:'info@example.invalid'}};
        ${fn('_isAdminView')}${fn('toggleLostEmailHelp')}${fn('renderAccountEmailCard')}${fn('requestEmailChange')}${fn('showEmailChangeNotice')}` });
      await page.addScriptTag({ content: read('host-onboarding.js') });
    };
    await boot();
    await page.evaluate(() => renderAccountEmailCard());
    assert.equal(await page.isVisible('#hostAccountEmailCard'), true);
    assert.match(await page.textContent('[data-acct-current]'), lang === 'it' ? /Accedi con old@example\.invalid\./ : /You sign in with old@example\.invalid\./);
    await page.fill('#acctNewEmail', 'not-an-email'); await page.click('#acctEmailBtn');
    assert.match(await page.textContent('[data-acct-msg]'), lang === 'it' ? /Inserisci un indirizzo email valido/ : /Enter a valid email address/);
    await page.fill('#acctNewEmail', 'OLD@example.invalid'); await page.click('#acctEmailBtn');
    assert.match(await page.textContent('[data-acct-msg]'), lang === 'it' ? /È già la tua email/ : /already your login email/);
    await page.fill('#acctNewEmail', 'taken@example.invalid'); await page.click('#acctEmailBtn');
    await page.waitForFunction(() => /già usata|already used/.test(document.querySelector('[data-acct-msg]').textContent));
    await page.fill('#acctNewEmail', ' New@Example.invalid '); await page.click('#acctEmailBtn');
    await page.waitForFunction(() => /new@example\.invalid/.test(document.querySelector('[data-acct-pending]').textContent));
    const upd = await page.evaluate(() => window.updates.at(-1));
    assert.deepEqual(upd, [{ email: 'new@example.invalid' }, { emailRedirectTo: 'https://console.example.invalid/host-console.html?email_change=1' }]);
    assert.match(await page.textContent('[data-acct-msg]'), lang === 'it' ? /link di conferma a new@example\.invalid e al tuo indirizzo attuale/ : /confirmation links to new@example\.invalid and to your current address/);
    assert.equal(await page.isVisible('[data-acct-pending]'), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll');
    // Lost mailbox: the help explains the supported path and opens WhatsApp/email with both addresses asked.
    await page.click('[data-acct-lost]');
    assert.match(await page.textContent('#acctLostEmailHelp'), lang === 'it' ? /possiamo cambiarla noi dopo una verifica: ti richiamiamo a un numero di telefono già indicato/ : /we can change it for you after a check: we call you back on a phone number already entered/);
    const wa = await page.getAttribute('#acctLostEmailHelp [data-lost-email-channel="whatsapp"]', 'href');
    assert.match(wa, /^https:\/\/wa\.me\/393500000000\?text=/); assert.match(decodeURIComponent(wa), lang === 'it' ? /Email attuale: … Nuova email: …/ : /Current email: … New email: …/);
    assert.match(await page.getAttribute('#acctLostEmailHelp [data-lost-email-channel="email"]', 'href'), /^mailto:info@example\.invalid\?subject=/);
    await page.click('[data-acct-lost]'); assert.equal(await page.isVisible('#acctLostEmailHelp'), false, 'toggles closed');
    // Admin view (?p=): hidden and inert (the session there is the admin's own).
    await boot('?p=00000000-0000-4000-8000-000000000001&admin=1');
    await page.evaluate(() => { document.getElementById('hostAccountEmailCard').style.display = ''; return renderAccountEmailCard(); });
    assert.equal(await page.isVisible('#hostAccountEmailCard'), false, 'hidden in admin view');
    await page.evaluate(() => { document.getElementById('acctNewEmail').value = 'x@example.invalid'; return requestEmailChange(); });
    assert.deepEqual(await page.evaluate(() => window.updates), [], 'no change from the admin view');
    // Return notices.
    for (const [hash, kind, re] of [['#message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email', 'half', /altro indirizzo|other address/],
      ['#access_token=x&type=email_change', 'done', /Email di accesso aggiornata|Login email updated/], ['#error=access_denied&error_code=otp_expired', 'failed', /non è più valido|no longer valid/]]) {
      await boot('?email_change=1', hash);
      await page.evaluate(() => showEmailChangeNotice());
      assert.equal(await page.getAttribute('[data-email-change-notice]', 'data-email-change-notice'), kind);
      assert.match(await page.textContent('[data-email-change-notice]'), re);
      const url = new URL(page.url()); assert.equal(url.searchParams.get('email_change'), null, 'marker removed');
      assert.equal(url.hash === '', kind !== 'done', 'hash kept only when it carries the session');
    }
    await boot(); await page.evaluate(() => showEmailChangeNotice()); assert.equal(await page.$('[data-email-change-notice]'), null, 'nothing without the marker');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
  // Admin «Utenti»: the box in the person's record (24 Nov 2026: one tab with contacts) calls the endpoint and reloads.
  const ui = read('admin-users.js');
  const U = await import('../api/_admin-users.js');
  const NOW = Date.parse('2026-11-19T10:00:00Z');
  const rowsP = U.buildRows({ users: [{ id: U1, email: 'old@example.invalid', created_at: '2026-11-01T00:00:00Z', email_confirmed_at: '2026-11-01T00:00:00Z', last_sign_in_at: '2026-11-18T00:00:00Z' }], invites: [], admins: [], properties: [{ id: 'p1', name: 'Casa', owner_id: U1, is_test: false, host_phone: '+39 333 000 0000' }], events: [], checkins: [], plans: {}, now: NOW });
  const payload = { generated_at: new Date(NOW).toISOString(), summary: U.summarize(rowsP, NOW), rows: rowsP, plan_error: null, terms_error: null };
  for (const width of [390, 1440]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage(); const errors = []; const posts = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/admin-host-health') { const b = JSON.parse(route.request().postData()); posts.push(b);
        if (b.action === 'account_email_change') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ changed: true, user_id: U1, old_email: 'old@example.invalid', new_email: b.new_email, notices: { old: true, new: true } }) });
        if (b.action === 'contacts_list') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ today: '2026-11-19', contacts: [{ id: 'c-1', user_id: U1, account: true, full_name: 'Gino', email: 'old@example.invalid', login_email: 'old@example.invalid', phone: null, lead_stage: 'lead', status: { kind: 'trial', days_left: 9 }, properties: [{ id: 'p1', name: 'Casa' }], notes: [] }] }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) }); }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}</style></head><body><div id="content"></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};window.toasts=[];window.adminToast=(m,t)=>toasts.push([m,t]);` });
    await page.addScriptTag({ content: read('admin-table-ui.js') }); await page.addScriptTag({ content: ui }); await page.addScriptTag({ content: read('admin-contacts.js') });
    await page.evaluate(() => UsersAdmin.render()); await page.waitForSelector('[data-users-table]');
    await page.waitForSelector(`[data-users-row="${U1}"] [data-users-open]`);
    await page.waitForFunction(() => window.ContactsAdmin.data());
    await page.click(`[data-users-row="${U1}"] [data-users-open]`);
    await page.waitForSelector(`[data-account-email="${U1}"]`);
    assert.match(await page.textContent(`[data-account-email="${U1}"]`), /Attuale: old@example\.invalid/);
    await page.fill(`#acctNew-${U1}`, 'new@example.invalid'); await page.click(`[data-account-email="${U1}"] [data-account-email-save]`);
    assert.match(await page.textContent(`[data-account-email="${U1}"] [data-account-email-msg]`), /motivo/, 'reason required');
    assert.match(await page.textContent(`[data-account-email="${U1}"] [data-account-phones]`), /Telefoni in archivio: Casa: \+39 333 000 0000/, 'number on file shown');
    assert.equal(await page.getAttribute(`[data-account-email="${U1}"] [data-account-phones] a`, 'href'), 'tel:+393330000000');
    await page.fill(`#acctWhy-${U1}`, 'telefonata del 19/11'); await page.click(`[data-account-email="${U1}"] [data-account-email-save]`);
    assert.match(await page.textContent(`[data-account-email="${U1}"] [data-account-email-msg]`), /due controlli d’identità/, 'checks required in the UI');
    assert.equal(posts.filter(p => p.action === 'account_email_change').length, 0, 'nothing sent without the checks');
    await page.check(`#acctCall-${U1}`); await page.check(`#acctDetails-${U1}`);
    await page.click(`[data-account-email="${U1}"] [data-account-email-save]`);
    await page.waitForFunction(() => window.toasts.length > 0);
    assert.deepEqual(posts.find(p => p.action === 'account_email_change'), { action: 'account_email_change', user_id: U1, new_email: 'new@example.invalid', reason: 'telefonata del 19/11', checks: { callback: true, details: true }, dry: false });
    assert.deepEqual(await page.evaluate(() => window.toasts.at(-1)), ['Email cambiata in new@example.invalid · avvisi inviati', 'success']);
    await page.waitForFunction(() => document.querySelector('[data-users-table]'));
    assert.ok(posts.filter(p => p.action === 'users_overview').length >= 2, 'list reloaded');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal scroll');
    assert.deepEqual(errors, []);
    await page.context().close();
  }
} finally { await browser.close(); }
console.log('PASS account e-mail change: trigger moves own copies of the old address (notify, reminder, contact, invite, admin) and leaves chosen ones and other owners alone, never blocks on a taken unique address; assisted change validates, previews, refuses a taken address, notifies both addresses, admin-only and journalled before/after; host console card (IT/EN, 390/1440) sends confirmation links with the return marker, shows the pending change, is hidden and inert in the admin view; return notices for half/done/failed keep session tokens; Utenti box requires a reason, confirms, calls the endpoint and reloads');
