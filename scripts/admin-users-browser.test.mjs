// Admin «Utenti» (admin-users.js + admin-contacts.js) in Chromium. Since 24
// Nov 2026 one row per PERSON: host accounts (users_overview) joined with the
// contacts (contacts_list), plus prospects. Fictional data; payload built by
// the real server module.
//   - columns and their content, sortable headers, search (name, e-mail,
//     property, phone digits), show test/admin, terms evidence download;
//   - status filters with counts: Tutti, Lead, Prova, Paganti, Gratis, Scaduti, Da fare;
//   - one-tap WhatsApp/call in the row;
//   - clicking a person opens the full record: contact fields, notes, next
//     action, properties, and the account section (the real per-host
//     subscription box from admin.html, login e-mail change, terms, deep
//     dive); extending the trial from there reloads the list and keeps the
//     record open; a prospect has no account section;
//   - no horizontal scroll at 390/768/1024/1440: a table from 1200 px, cards
//     with a «Ordina per» menu below;
//   - server error shown; billing settings and recent activity under the table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const ui = fs.readFileSync(new URL('../admin-users.js', import.meta.url), 'utf8');
const contactsUi = fs.readFileSync(new URL('../admin-contacts.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const billingStart = adminHtml.indexOf('// Round 72 Phase 4 — billing per host account');
const billingBlock = adminHtml.slice(billingStart, adminHtml.indexOf('// Round 51 Phase 6 — onboarding readiness', billingStart));
const escStart = adminHtml.indexOf('function escapeHtml(s) {');
const escapeFn = adminHtml.slice(escStart, adminHtml.indexOf('\n}\n', escStart) + 2);
assert.ok(billingStart > 0 && billingBlock.includes('function renderBillingBox(') && billingBlock.includes('function renderBillingSettings(') && escapeFn.includes('function escapeHtml'));
const U = await import('../api/_admin-users.js');
const NOW = Date.parse('2026-11-17T10:00:00Z'), D = 86400000, iso = ms => new Date(ms).toISOString();
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c', ADM = '00000000-0000-4000-8000-00000000000e';
const users = [
  { id: A, email: 'anna@example.invalid', created_at: iso(NOW - 10 * D), email_confirmed_at: iso(NOW - 10 * D), last_sign_in_at: iso(NOW - 1 * D) },
  { id: B, email: 'bruno@example.invalid', created_at: iso(NOW - 60 * D), email_confirmed_at: iso(NOW - 60 * D), last_sign_in_at: iso(NOW - 40 * D) },
  { id: C, email: 'carla@example.invalid', created_at: iso(NOW - 1 * D), email_confirmed_at: null, last_sign_in_at: null },
  { id: ADM, email: 'admin@example.invalid', created_at: iso(NOW - 300 * D), email_confirmed_at: iso(NOW - 300 * D), last_sign_in_at: iso(NOW) },
];
const properties = [{ id: 'p1', name: 'Casa Anna', owner_id: A, is_test: false, host_phone: '333 123 4567' }, { id: 'p3', name: 'Bruno B&B', owner_id: B, is_test: false }];
const plans = { [A]: { state: 'trial', trial_ends_at: iso(NOW + 5 * D) }, [B]: { state: 'active', paid_until: iso(NOW + 200 * D) }, [C]: { state: 'prelaunch' }, [ADM]: { state: 'free', reason: 'admin' } };
const rows = U.buildRows({ users, invites: [], admins: [{ email: 'admin@example.invalid' }], properties, events: [{ user_id: A, created_at: iso(NOW - D) }, { user_id: B, created_at: iso(NOW - 45 * D) }], checkins: [{ property_id: 'p1' }, { property_id: 'p1' }], plans, now: NOW });
for (const r of rows) {
  r.terms = r.user_id === A ? { version: 1, accepted_at: iso(NOW - D), host_kind: 'business' } : null;
  if (r.user_id) r.billing = { state: r.plan, chip: null, subscription: r.plan && r.plan.trial_ends_at ? { trial_ends_at: r.plan.trial_ends_at } : {}, events: [] };
}
const usersPayload = { generated_at: iso(NOW), summary: U.summarize(rows, NOW), rows, plan_error: null, terms_error: null };
const contactsPayload = () => ({ generated_at: iso(NOW), today: ymd(NOW), billing_error: null, contacts: [
  { id: 'c-a', user_id: A, account: true, full_name: 'Anna Fittizia', email: 'anna@example.invalid', login_email: 'anna@example.invalid', phone: '+393331234567', source: 'whatsapp', lead_stage: 'lead', next_action: 'Chiamare per il rinnovo', next_action_due: ymd(NOW - D), status: { kind: 'trial', days_left: 5 }, properties: [{ id: 'p1', name: 'Casa Anna' }], notes: [{ id: 'n-1', contact_id: 'c-a', body: 'Prima nota', created_at: iso(NOW - D), created_by: 'admin@example.invalid' }], last_note_at: iso(NOW - D), created_at: iso(NOW - 10 * D) },
  { id: 'c-b', user_id: B, account: true, full_name: null, email: 'bruno@example.invalid', login_email: 'bruno@example.invalid', phone: null, lead_stage: 'lead', status: { kind: 'paying' }, properties: [{ id: 'p3', name: 'Bruno B&B' }], notes: [], created_at: iso(NOW - 60 * D) },
  { id: 'c-c', user_id: null, account: false, full_name: null, email: 'carla@example.invalid', phone: null, lead_stage: 'invited', status: { kind: 'lead', stage: 'invited' }, properties: [], notes: [], created_at: iso(NOW - D) },
  { id: 'c-g', user_id: null, account: false, full_name: 'Gino Prospect', email: null, phone: '+393471112222', lead_stage: 'demo', next_action: 'Mandare la demo', next_action_due: ymd(NOW + 3 * D), status: { kind: 'lead', stage: 'demo' }, properties: [], notes: [], created_at: iso(NOW - 2 * D) },
  { id: 'c-l', user_id: null, account: false, full_name: 'Luca Perso', email: null, phone: null, lead_stage: 'lost', status: { kind: 'lead', stage: 'lost' }, properties: [], notes: [], created_at: iso(NOW - 30 * D) }] });

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 768, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = [], calls = []; let usersStatus = 200;
    page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => d.accept());
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(req.postData()); calls.push(b);
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (b.action === 'users_overview') return usersStatus === 200 ? json(usersPayload) : json({ error: 'Host health unavailable. Retry in a moment.' }, usersStatus);
        if (b.action === 'contacts_list') return json(contactsPayload());
        return json({ ok: true });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><select id="userFilter"><option value="">all</option></select><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})},
      from:t=>{const q={_t:t,select:()=>q,eq:(k,v)=>(q._eq=[k,v],q),in:(k,v)=>(q._in=[k,v],Promise.resolve({data:[{id:'doc-1',kind:'host_terms',version:1,specific_clauses:[{ref:'15.2'}]}],error:null})),
        order:()=>Promise.resolve({data:q._eq&&q._eq[1]===${JSON.stringify(A)}?[{id:'acc-1',host_id:${JSON.stringify(A)},document_id:'doc-1',version:1,ip:'192.0.2.1'}]:[],error:null})};return q;}};
      let activeTab='users'; let hostHealth={ billing_settings: { launch_at: null, annual_price_cents: 6000, bank_transfer_iban: '', bank_transfer_holder: '' } };
      window.__tabs=[]; function setActiveTab(t){ activeTab=t; window.__tabs.push(t); }
      window.__toasts=[]; function adminToast(m,k){ window.__toasts.push([m,k||'ok']); }
      async function loadHostHealth(){ return hostHealth; } function renderView(){ UsersAdmin.render(); }
      function renderRecentActivity(){ return '<section data-recent-activity>Recent activity</section>'; }
      ${escapeFn}
      ${billingBlock}` });
    await page.addScriptTag({ content: ui });
    await page.addScriptTag({ content: contactsUi });
    await page.evaluate(() => UsersAdmin.render());
    await page.waitForFunction(() => document.querySelectorAll('[data-users-row]').length === 5);
    const ids = () => page.$$eval('[data-users-row]', trs => trs.map(tr => tr.dataset.usersRow));
    const row = key => page.locator(`[data-users-row="${key}"]`);
    const text = async (key, sel) => (await row(key).locator(sel).first().textContent()).replace(/\s+/g, ' ').trim();
    // One row per person: three accounts (admin hidden) + two prospects; default newest first.
    assert.deepEqual((await ids()).sort(), [A, B, C, 'c-g', 'c-l'].sort(), 'accounts joined with their contacts; prospects added; admin hidden');
    assert.equal((await ids()).filter(x => x === 'c-a' || x === 'c-b' || x === 'c-c').length, 0, 'no duplicate rows for contacts of accounts or invitations');
    assert.match(await text(A, '.u-main'), /Anna Fittizia anna@example\.invalid \+39 333 123 4567 Casa Anna/);
    assert.equal(await row(A).locator('[data-users-wa]').getAttribute('href'), 'https://wa.me/393331234567');
    assert.equal(await row(A).locator('[data-users-call]').getAttribute('href'), 'tel:+393331234567');
    assert.match(await text(B, '.u-main'), /bruno@example\.invalid Bruno B&B/);
    assert.match(await text('c-g', '.u-main'), /Gino Prospect \+39 347 111 2222 Nessun account/);
    assert.match(await text(A, '[data-plan]'), /^Prova · scade il 22\/11\/2026 \(5 gg\)$/); assert.match(await text(B, '[data-plan]'), /^Pagato fino al 05\/06\/2027$/);
    assert.equal(await text(C, '[data-plan]'), 'Invitato'); assert.equal(await text('c-g', '[data-plan]'), 'Demo'); assert.equal(await text('c-l', '[data-plan]'), 'Perso');
    assert.match(await text(C, 'td:nth-child(3)'), /invitato il 16\/11\/2026\s*password non creata/);
    assert.match(await text(A, '[data-days]'), /1 \/ 7 · 1 \/ 30/); assert.match(await text(A, '[data-checkins]'), /2/); assert.match(await text(A, '[data-activity-chip]'), /Attivo/);
    assert.match(await text(A, '[data-next]'), /16\/11\s*Chiamare per il rinnovo/); assert.match(await text('c-g', '[data-next]'), /20\/11\s*Mandare la demo/);
    assert.equal(await row(A).locator('[data-next] strong').evaluate(e => getComputedStyle(e).color), 'rgb(180, 35, 24)', 'overdue in red');
    // Terms per account and the evidence download.
    assert.match(await text(A, '[data-terms]'), /v1 · 16\/11\/2026 Scarica prova/); assert.match(await text(B, '[data-terms]'), /Non accettate/);
    {const [dl] = await Promise.all([page.waitForEvent('download'), row(A).locator('[data-terms-evidence]').click()]);
     assert.equal(dl.suggestedFilename(), `welcomebnb-terms-evidence-${A}.json`); assert.equal(JSON.parse(fs.readFileSync(await dl.path(), 'utf8')).documents[0].specific_clauses[0].ref, '15.2');}
    // Status filters with counts.
    const filt = async k => { await page.click(`[data-users-filter="${k}"]`); return (await ids()).sort(); };
    assert.match(await page.textContent('[data-users-filter="leads"]'), /Lead\s*3/); assert.match(await page.textContent('[data-users-filter="due"]'), /Da fare\s*1/);
    assert.deepEqual(await filt('leads'), [C, 'c-g', 'c-l'].sort()); assert.deepEqual(await filt('trial'), [A]); assert.deepEqual(await filt('paying'), [B]);
    assert.deepEqual(await filt('free'), []); assert.deepEqual(await filt('expired'), []); assert.deepEqual(await filt('due'), [A]);
    await filt('all');
    // Search: name, property, phone digits; show test/admin.
    const search = async q => { await page.fill('#usersSearch', q); return (await ids()).sort(); };
    assert.deepEqual(await search('347 111'), ['c-g']); assert.deepEqual(await search('bruno b&b'), [B]); assert.deepEqual(await search('fittizia'), [A]); assert.deepEqual(await search('carla@'), [C]);
    await search('');
    await page.check('#usersShowTest'); assert.ok((await ids()).includes(ADM), 'admin shown on request'); assert.match(await text(ADM, '.u-main'), /Admin/);
    await page.uncheck('#usersShowTest');
    // Sorting: headers on wide screens, «Ordina per» below 1200 px.
    const wide = width >= 1200;
    assert.equal(await page.isVisible('[data-users-table] thead'), wide, 'header row only on wide screens');
    assert.equal(await page.isVisible('#usersSortSel'), !wide, 'sort menu on narrow screens');
    // Bring the sort to (column, direction) with the controls a person uses.
    const setSort = async (k, dir) => {
      for (let i = 0; i < 4; i++) {
        const st = await page.evaluate(() => UsersAdmin._view());
        if (st.sort === k && st.dir === dir) return ids();
        if (wide) await page.click(`[data-users-sort="${k}"]`);
        else if (st.sort !== k) await page.selectOption('#usersSortSel', k); else await page.click('[data-users-dir]');
      }
      throw new Error('sort not reached: ' + k + ' ' + dir);
    };
    const shown = () => page.$$eval('[data-users-row] [data-users-open]', bs => bs.map(b => b.textContent.trim().toLowerCase()));
    await setSort('host', 'asc'); { const n = await shown(); assert.deepEqual(n, [...n].sort(), 'name A→Z'); }
    await setSort('host', 'desc'); { const n = await shown(); assert.deepEqual(n, [...n].sort().reverse(), 'name Z→A'); }
    let order = await setSort('next', 'asc'); assert.deepEqual(order.slice(0, 2), [A, 'c-g'], 'next action ascending: overdue first, then the next due');
    order = await setSort('activity', 'desc'); assert.ok(order.indexOf(B) < order.indexOf(A), 'inactive before active when descending');
    order = await setSort('plan', 'asc'); assert.equal(order[0], A, 'trial ending soonest first');
    order = await setSort('checkins', 'desc'); assert.equal(order[0], A, 'most check-ins first');
    // No horizontal scroll at this width.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal page scroll');
    if (!wide) {
      const small = await page.$$eval('[data-users-row] .u-act', bs => bs.filter(b => b.getBoundingClientRect().height < 44).length);
      assert.equal(small, 0, 'tap targets 44 px on phones');
    }
    // Billing settings and recent activity under the table.
    assert.equal(await page.locator('[data-billing-settings]').count(), 1); assert.equal(await page.locator('#content [data-recent-activity]').count(), 1);
    // Open Anna: full record = contact + account section with the real subscription box.
    await row(A).locator('[data-users-open]').click();
    await page.waitForSelector('#contactModal [data-account-section]');
    const modal = () => page.textContent('#contactModal').then(x => x.replace(/\s+/g, ' '));
    assert.match(await modal(), /Anna Fittizia[\s\S]*Prossima azione[\s\S]*Strutture[\s\S]*Casa Anna[\s\S]*Account[\s\S]*Condizioni:[\s\S]*Estendi prova[\s\S]*Email di accesso[\s\S]*Prima nota/);
    assert.equal(await page.inputValue('#contactModal [name="next_action"]'), 'Chiamare per il rinnovo');
    assert.equal(await page.locator('#contactModal [data-billing-box]').count(), 1);
    await page.fill(`#bx-reason-${A}`, 'Fiera di novembre');
    const before = calls.filter(c => c.action === 'users_overview').length;
    await page.click(`#contactModal [data-billing-box="${A}"] button:has-text("+14")`);
    await page.waitForFunction(() => window.__toasts.length > 0);
    assert.deepEqual(calls.find(c => c.action === 'billing_extend'), { action: 'billing_extend', user_id: A, days: 14, reason: 'Fiera di novembre' });
    await page.waitForFunction(n => true, before);
    await page.waitForSelector('#contactModal [data-account-section]');
    assert.ok(calls.filter(c => c.action === 'users_overview').length > before, 'list reloaded after the change; record still open');
    // Deep dive from the record.
    await page.click('#contactModal [data-users-deepdive]');
    assert.deepEqual(await page.evaluate(() => [window.__tabs.at(-1), document.getElementById('userFilter').value]), ['deepdive', 'anna@example.invalid']);
    assert.equal(await page.locator('#contactModal').count(), 0, 'record closed');
    await page.evaluate(() => { activeTab = 'users'; UsersAdmin.render(); });
    // A prospect: contact only, no account section.
    await page.waitForSelector('[data-users-row="c-g"] [data-users-open]');
    await row('c-g').locator('[data-users-open]').click();
    await page.waitForSelector('#contactModal [data-contact-form]');
    assert.equal(await page.locator('#contactModal [data-account-section]').count(), 0); assert.equal(await page.inputValue('#contactModal [name="full_name"]'), 'Gino Prospect');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': record fits');
    await page.click('[data-contact-close]');
    // «Aggiungi contatto» opens the new-contact form.
    await page.click('[data-contacts-add]'); await page.waitForSelector('#contactModal [data-contact-form]'); await page.click('[data-contact-close]');
    // Server error.
    usersStatus = 503; await page.evaluate(() => UsersAdmin.reload()); await page.waitForSelector('[data-users-error]');
    assert.match(await page.textContent('[data-users-error]'), /Utenti non disponibili: Host health unavailable/);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS admin users (browser) 390/768/1024/1440: one row per person (accounts joined with contacts, prospects added, admin hidden), name/e-mail/phone/properties with WhatsApp and call, status chips (trial, paid, Invitato, Demo, Perso), next action (overdue red), terms evidence; filters Lead/Prova/Paganti/Gratis/Scaduti/Da fare with counts; search by name, property, e-mail, phone digits; show test/admin; headers sort on wide screens and «Ordina per» on narrow ones; no horizontal scroll; record with contact, notes, properties and the account section (real subscription box: +14 days reloads the list and keeps the record open; deep dive); prospect without account section; add contact; server error');
