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
const payload = plans => { const r = rows(plans); return { generated_at: iso(NOW), summary: U.summarize(r, NOW), rows: r, plan_error: null }; };
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
    await page.addScriptTag({ content: `window.sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};window.__tabs=[];window.setActiveTab=t=>__tabs.push(t);` });
    await page.addScriptTag({ content: ui });
    await page.evaluate(() => UsersAdmin.render());
    await page.waitForSelector('[data-users-table]');
    const tile = k => page.textContent(`[data-tile="${k}"]`);
    assert.match(await tile('hosts'), /Host3/); assert.match(await tile('active'), /1/); assert.match(await tile('inactive'), /1/);
    assert.match(await tile('trial'), /non ancora iniziata: parte al lancio/, 'before launch the trial tile says so');
    const table = async () => page.$$eval('[data-users-row]', trs => trs.map(tr => ({ id: tr.dataset.usersRow, cells: [...tr.cells].map(td => td.textContent.replace(/\s+/g, ' ').trim()) })));
    let t = await table();
    assert.deepEqual(t.map(x => x.id), [C, A, B], 'newest registration first; admin hidden');
    assert.match(t[0].cells[0], /carla@example\.invalid\s*Invitato · non ancora registrato/); assert.match(t[0].cells[1], /^invitato il 16\/11\/2026\s*password non creata$/);
    assert.match(t[1].cells[0], /anna@example\.invalid\s*Casa Anna/); assert.equal(t[1].cells[1], '07/11/2026');
    assert.equal(t[1].cells[2], 'Prova non iniziata · parte al lancio');
    assert.deepEqual(t[1].cells.slice(3), ['ieri', '1 / 7 · 1 / 30', '2', 'Attivo']);
    assert.deepEqual(t[2].cells.slice(3), ['40 gg fa', '0 / 7 · 0 / 30', '0', 'Inattivo']);
    assert.equal(t[0].cells[6], 'Mai usato');
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
    assert.match(await tile('trial'), /Prova in scadenza1entro 7 gg · 2 in prova · 1 paganti/);
    await page.click('[data-users-sort="plan"]'); await page.click('[data-users-sort="plan"]'); t = await table();
    assert.equal(t[0].id, A, 'plan sort ascending puts the trial ending first');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal page scroll');
    // Server error.
    status = 503; await page.evaluate(() => UsersAdmin.reload()); await page.waitForSelector('[data-users-error]');
    assert.match(await page.textContent('[data-users-error]'), /Utenti non disponibili: Host health unavailable/);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS admin users home (browser): tiles (hosts, active, inactive, trial — «parte al lancio» before launch, ending/in trial/paying after), table with registration and missing password, trial end date and colour (red ≤ 7 days), paid-until, last activity, active days 7/30, check-ins, activity chip; sort by activity and plan, search by e-mail/property, test/admin on request, row opens the host deep dive, server error shown, no horizontal scroll at 390/1440');
