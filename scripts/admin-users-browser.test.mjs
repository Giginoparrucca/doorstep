// 17 Nov 2026 — admin home «Utenti» (admin-users.js) in Chromium at
// 390/1440 against a fictional /api/admin-host-health: summary tiles,
// table with registration, trial/plan chips (prelaunch, ending soon, paid),
// last activity, active days, check-ins, activity chips; sort, search, show
// test/admin, open host → deep dive; server error shown; no horizontal
// scroll. Payload built by the real server module. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const ui = fs.readFileSync(new URL('../admin-users.js', import.meta.url), 'utf8');
const adminHtml = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const billingStart = adminHtml.indexOf('// Round 72 Phase 4 — billing per host account');
const billingBlock = adminHtml.slice(billingStart, adminHtml.indexOf('// Round 51 Phase 6 — onboarding readiness', billingStart));
const escStart = adminHtml.indexOf('function escapeHtml(s) {');
const escapeFn = adminHtml.slice(escStart, adminHtml.indexOf('\n}\n', escStart) + 2);
assert.ok(billingStart > 0 && billingBlock.includes('function renderBillingBox(') && billingBlock.includes('function renderBillingSettings(') && escapeFn.includes('function escapeHtml'));
const U = await import('../api/_admin-users.js');
const NOW = Date.parse('2026-11-17T10:00:00Z'), D = 86400000, iso = ms => new Date(ms).toISOString();
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c', ADM = '00000000-0000-4000-8000-00000000000e';
const users = [
  { id: A, email: 'anna@example.invalid', created_at: iso(NOW - 10 * D), email_confirmed_at: iso(NOW - 10 * D), last_sign_in_at: iso(NOW - 1 * D) },
  { id: B, email: 'bruno@example.invalid', created_at: iso(NOW - 60 * D), email_confirmed_at: iso(NOW - 60 * D), last_sign_in_at: iso(NOW - 40 * D) },
  { id: C, email: 'carla@example.invalid', created_at: iso(NOW - 1 * D), email_confirmed_at: null, last_sign_in_at: null },
  { id: ADM, email: 'admin@example.invalid', created_at: iso(NOW - 300 * D), email_confirmed_at: iso(NOW - 300 * D), last_sign_in_at: iso(NOW) },
];
const properties = [{ id: 'p1', name: 'Casa Anna', owner_id: A, is_test: false }, { id: 'p3', name: 'Bruno B&B', owner_id: B, is_test: false }];
const rows = (plans) => U.buildRows({ users, invites: [], admins: [{ email: 'admin@example.invalid' }], properties, events: [{ user_id: A, created_at: iso(NOW - D) }, { user_id: B, created_at: iso(NOW - 45 * D) }], checkins: [{ property_id: 'p1' }, { property_id: 'p1' }], plans, now: NOW });
const payload = plans => { const r = rows(plans); for (const x of r) x.terms = x.user_id === A ? { version: 1, accepted_at: iso(NOW - D), host_kind: 'business' } : null; return { generated_at: iso(NOW), summary: U.summarize(r, NOW), rows: r, plan_error: null, terms_error: null }; };
const prelaunch = payload({ [A]: { state: 'prelaunch' }, [B]: { state: 'prelaunch' }, [C]: { state: 'prelaunch' }, [ADM]: { state: 'prelaunch' } });
const launched = payload({ [A]: { state: 'trial', trial_ends_at: iso(NOW + 5 * D) }, [B]: { state: 'active', paid_until: iso(NOW + 200 * D) }, [C]: { state: 'trial', trial_ends_at: iso(NOW + 29 * D) }, [ADM]: { state: 'free', reason: 'admin' } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = []; let reply = prelaunch, status = 200, calls = 0;
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/admin-host-health') { calls++; assert.deepEqual(JSON.parse(route.request().postData()), { action: 'users_overview' }); return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? reply : { error: 'Host health unavailable. Retry in a moment.' }) }); }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><select id="userFilter"><option value="all">All</option></select><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})},
      from:t=>{const q={_t:t,select:()=>q,eq:(k,v)=>(q._eq=[k,v],q),in:(k,v)=>(q._in=[k,v],Promise.resolve({data:[{id:'doc-1',kind:'host_terms',version:1,specific_clauses:[{ref:'15.2'}]}],error:null})),
        order:()=>Promise.resolve({data:q._eq&&q._eq[1]===${JSON.stringify(A)}?[{id:'acc-1',host_id:${JSON.stringify(A)},document_id:'doc-1',version:1,ip:'192.0.2.1'}]:[],error:null})};return q;}};
      window.__tabs=[];window.setActiveTab=t=>__tabs.push(t);` });
    await page.addScriptTag({ content: ui });
    await page.evaluate(() => UsersAdmin.render());
    await page.waitForSelector('[data-users-table]');
    const tile = k => page.textContent(`[data-tile="${k}"]`);
    assert.match(await tile('hosts'), /Host3/); assert.match(await tile('active'), /1/); assert.match(await tile('inactive'), /1/);
    assert.match(await tile('trial'), /Prova in scadenza0entro 7 gg · 0 in prova · 0 scadute · 0 paganti/);
    assert.match(await page.textContent('[data-users-prelaunch]'), /La prova parte dalla registrazione\. Prima del lancio le date sono solo indicative/, 'before launch: dates indicative, nothing enforced');
    const table = async () => page.$$eval('[data-users-row]', trs => trs.map(tr => ({ id: tr.dataset.usersRow, cells: [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim()) })));
    let t = await table();
    assert.deepEqual(t.map(x => x.id), [C, A, B], 'newest registration first; admin hidden');
    assert.match(t[0].cells[0], /carla@example\.invalid\s*Invitato · non ancora registrato/); assert.match(t[0].cells[1], /^invitato il 16\/11\/2026\s*password non creata$/);
    assert.match(t[1].cells[0], /anna@example\.invalid\s*Casa Anna/); assert.equal(t[1].cells[1], '07/11/2026');
    assert.equal(t[1].cells[2], 'Prova non ancora creata', 'registered, no stored trial in this fixture');
    assert.deepEqual(t[1].cells.slice(3, 7), ['ieri', '1 / 7 · 1 / 30', '2', 'Attivo']);
    assert.deepEqual(t[2].cells.slice(3, 7), ['40 gg fa', '0 / 7 · 0 / 30', '0', 'Inattivo']);
    assert.equal(t[0].cells[6], 'Mai usato');
    // Terms per account: Anna accepted v1 yesterday (evidence downloadable), Bruno not yet, Carla not registered.
    assert.match(await tile('terms'), /Condizioni accettate1/); assert.match(await tile('terms'), /1 registrati devono ancora accettare/);
    const termsCell = id => page.textContent(`[data-users-row="${id}"] [data-terms]`).then(x => x.replace(/\s+/g, ' ').trim());
    assert.equal(await termsCell(A), 'v1 · 16/11/2026 Scarica prova'); assert.equal(await termsCell(B), 'Non accettate'); assert.equal(await termsCell(C), '—');
    {const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-users-row="${A}"] [data-terms-evidence]`)]);
     assert.equal(dl.suggestedFilename(), `welcomebnb-terms-evidence-${A}.json`);
     const ev = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); assert.equal(ev.acceptances[0].id, 'acc-1'); assert.equal(ev.documents[0].specific_clauses[0].ref, '15.2');}
    // Sort by activity; search; show test/admin.
    await page.click('[data-users-sort="activity"]'); t = await table(); assert.deepEqual(t.map(x => x.id), [C, B, A], 'activity sort (desc: never, inactive, active)');
    await page.click('[data-users-sort="activity"]'); t = await table(); assert.deepEqual(t.map(x => x.id), [A, B, C]);
    await page.fill('#usersSearch', 'bruno b&b'); t = await table(); assert.deepEqual(t.map(x => x.id), [B], 'search by property name');
    await page.fill('#usersSearch', ''); await page.check('#usersShowTest'); t = await table(); assert.ok(t.some(x => x.id === ADM), 'admin shown on request');
    assert.match(t.find(x => x.id === ADM).cells[0], /Admin/);
    // Open a host → deep dive with the filter set.
    await page.click(`[data-users-row="${A}"] [data-users-open]`);
    assert.deepEqual(await page.evaluate(() => [window.__tabs.at(-1), document.getElementById('userFilter').value]), ['deepdive', 'anna@example.invalid']);
    // After launch: trial dates, colours and the trial tile.
    reply = launched; await page.evaluate(() => UsersAdmin.reload()); await page.waitForFunction(() => /scade/.test(document.querySelector('[data-users-table]')?.textContent || ''));
    t = await table();
    const anna = t.find(x => x.id === A).cells[2], carla = t.find(x => x.id === C).cells[2], bruno = t.find(x => x.id === B).cells[2];
    assert.equal(anna, 'Prova · scade il 22/11/2026 (5 gg)'); assert.equal(carla, 'Prova · scade il 16/12/2026 (29 gg)'); assert.equal(bruno, 'Pagato fino al 05/06/2027');
    const colour = id => page.$eval(`[data-users-row="${id}"] [data-plan]`, el => getComputedStyle(el).color);
    assert.equal(await colour(A), 'rgb(180, 35, 24)', 'ending within 7 days is red'); assert.equal(await colour(C), 'rgb(2, 122, 72)');
    assert.match(await tile('trial'), /Prova in scadenza1entro 7 gg · 2 in prova · 0 scadute · 1 paganti/);
    await page.click('[data-users-sort="plan"]'); await page.click('[data-users-sort="plan"]'); t = await table();
    assert.equal(t[0].id, A, 'plan sort ascending puts the trial ending first');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal page scroll');
    // Server error.
    status = 503; await page.evaluate(() => UsersAdmin.reload()); await page.waitForSelector('[data-users-error]');
    assert.match(await page.textContent('[data-users-error]'), /Utenti non disponibili: Host health unavailable/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // «Gestisci» on a row: the real per-host subscription box from admin.html,
  // extend the trial from the Utenti table, the list reloads, box stays open;
  // billing settings and «Prepara lancio» sit under the table.
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = []; const calls = [];
    page.on('pageerror', e => errors.push(String(e)));
    const withBilling = JSON.parse(JSON.stringify(launched));
    for (const r of withBilling.rows) if (r.user_id) r.billing = { state: r.plan, chip: r.plan && r.plan.state === 'trial' ? 'Prova' : null, subscription: r.plan && r.plan.trial_ends_at ? { trial_ends_at: r.plan.trial_ends_at } : {}, events: [] };
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(req.postData()); calls.push(b);
        if (b.action === 'users_overview') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(withBilling) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><select id="userFilter"><option value="all">All</option></select><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};
      let activeTab='users'; let hostHealth={ billing_settings: { launch_at: null, annual_price_cents: 6000, bank_transfer_iban: '', bank_transfer_holder: '' } };
      window.__toasts=[]; function adminToast(m,k){ window.__toasts.push([m,k||'ok']); }
      async function loadHostHealth(){ return hostHealth; } function renderView(){ UsersAdmin.render(); }
      ${escapeFn}
      ${billingBlock}` });
    await page.addScriptTag({ content: ui });
    await page.evaluate(() => UsersAdmin.render());
    await page.waitForSelector('[data-users-table]');
    assert.equal(await page.locator('[data-billing-settings]').count(), 1, 'billing settings under the table');
    assert.match(await page.textContent('[data-billing-settings]'), /Lancio: non ancora[\s\S]*Prepara lancio/);
    assert.equal(await page.locator('[data-billing-box]').count(), 0, 'boxes closed by default');
    await page.click(`[data-users-billing-toggle="${A}"]`);
    await page.waitForSelector(`[data-users-billing="${A}"] [data-billing-box="${A}"]`);
    assert.equal(await page.getAttribute(`[data-users-billing-toggle="${A}"]`, 'aria-expanded'), 'true');
    assert.match(await page.textContent(`[data-billing-box="${A}"]`), /Estendi prova[\s\S]*Passa a pagamento[\s\S]*Gratis a vita[\s\S]*Segna pagato/);
    await page.fill(`#bx-reason-${A}`, 'Fiera di novembre');
    const before = calls.filter(c => c.action === 'users_overview').length;
    await page.click(`[data-billing-box="${A}"] button:has-text("+14")`);
    await page.waitForFunction(n => window.__toasts.length > 0, before);
    assert.deepEqual(calls.find(c => c.action === 'billing_extend'), { action: 'billing_extend', user_id: A, days: 14, reason: 'Fiera di novembre' });
    assert.deepEqual(await page.evaluate(() => window.__toasts[0]), ['Fatto', 'success']);
    await page.waitForFunction(() => document.querySelector('[data-users-table]'));
    await page.waitForSelector(`[data-users-billing="${A}"] [data-billing-box="${A}"]`);
    assert.equal(calls.filter(c => c.action === 'users_overview').length, before + 1, 'list reloaded after the change');
    await page.click(`[data-users-billing-toggle="${A}"]`);
    assert.equal(await page.locator('[data-billing-box]').count(), 0, 'closed again');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal page scroll');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS admin users home (browser): «Gestisci» opens the real per-host subscription box under the row, +14 days with a reason extends the trial and reloads the list with the box still open, billing settings and «Prepara lancio» under the table; tiles (hosts, active, inactive, trial — «parte al lancio» before launch, ending/in trial/paying after), table with registration and missing password, trial end date and colour (red ≤ 7 days), paid-until, last activity, active days 7/30, check-ins, activity chip; sort by activity and plan, search by e-mail/property, test/admin on request, row opens the host deep dive, server error shown, no horizontal scroll at 390/1440');
