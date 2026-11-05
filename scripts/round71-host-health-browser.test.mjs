// Round 71 — admin host health UI: Action needed, hosts by health and the
// per-host deep dive, actual admin.html code fed with real lib/host-health.js
// output, Chromium 390/1440. Fictional properties.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const H = require('../lib/host-health.js');
const html = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const fn = name => { let i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); if (html.slice(i - 6, i) === 'async ') i -= 6; return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const constLine = name => { const i = html.indexOf('const ' + name + ' = '); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n', i) + 1); };
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

const NOW = '2026-11-05T09:00:00Z';
const okCreds = id => ({ property_id: id, verified_at: '2026-10-01T10:00:00Z', wskey_expires_at: '2027-06-01T00:00:00Z', last_error: null });
const prop = (id, name, owner, x = {}) => ({ id, name, owner_id: owner, timezone: 'Europe/Rome', cir_code: 'IT000000C2', tax_rate_eur: 2, ical_feeds: ['x'], welcome_message_it: 'Ciao', alloggiati_autofile_mode: 'live', ...x });
const res = (pid, code, d) => ({ id: pid + code, property_id: pid, booking_code: code, checkin_date: d, platform: 'airbnb', entry_type: 'reservation', status: 'active' });
const ci = (pid, code, d, x = {}) => ({ id: pid + code + d + (x.n || ''), property_id: pid, booking_code: code, surname: 'Rossi', arrival_date: d, filed_at: null, ...x });
const cases = [
  { p: prop('red', 'Casa Rossa', 'o1'), reservations: [res('red', 'A', '2026-11-01'), res('red', 'B', '2026-11-02')], checkins: [ci('red', 'A', '2026-11-01'), ci('red', 'A', '2026-11-01', { n: 2, surname: 'Bianchi' })], creds: okCreds('red'), recos: 12 },
  { p: prop('amber', 'Borgo Ambra', 'o2', { cir_code: '' }), reservations: [res('amber', 'C', '2026-11-03'), res('amber', 'D', '2026-11-06')], checkins: [ci('amber', 'C', '2026-11-03', { filed_at: '2026-11-03T12:00:00Z' })], creds: okCreds('amber'), recos: 4, codes: ['C'] },
  { p: prop('green', 'Villa Verde', 'o3'), reservations: [res('green', 'E', '2026-11-01')], checkins: [ci('green', 'E', '2026-11-01', { filed_at: '2026-11-01T12:00:00Z' })], creds: okCreds('green'), recos: 15, codes: ['E'] },
  { p: prop('grey', 'Casa Grigia', 'o4'), reservations: [], checkins: [], creds: okCreds('grey'), recos: 15 },
];
const results = H.sortByHealth(cases.map(c => Object.assign(H.computeHostHealth({ property: c.p, now: NOW, reservations: c.reservations, checkins: c.checkins, filingLog: [], credentials: c.creds, onboarding: { skips: {} },
  recommendationCount: c.recos, guestEventCodes: c.codes || [], lastActivityAt: '2026-11-04T10:00:00Z', regionCompliance: null }), { owner_email: c.p.owner_id + '@example.invalid' })));
const payload = { generated_at: NOW, properties: results, action_needed: H.actionNeeded(results) };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setContent(`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><select id="userFilter"><option value="all">All</option></select><div id="content"></div></body></html>`);
    await page.addScriptTag({ content: `
      let hostHealth = ${JSON.stringify(payload)};
      function setActiveTab(t){ window.tab = t; document.getElementById('content').innerHTML = renderHostHealthDetail(document.getElementById('userFilter').value); }
      function viewAsHost(id){ window.console_ = id; }
      ${fn('escapeHtml')}${constLine('HH_DOT')}${constLine('HH_COLOR')}${constLine('HostHealthHints')}
      ${fn('hhDate')}${fn('openHostHealth')}${fn('renderHealthOverview')}${fn('hhTile')}${fn('renderHostHealthDetail')}
      document.getElementById('content').innerHTML = renderHealthOverview();` });

    // Action needed: red first; green and grey not listed.
    const lines = await page.locator('[data-hh-actions] li').allTextContents();
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^🔴 Casa Rossa · 2 filings overdue \(arr\. 1 Nov\)/);
    assert.match(lines[1], /^🟠 Borgo Ambra · /);
    // Hosts by health: red → amber → green → grey, each with its top reason.
    const cards = await page.locator('[data-hh-card]').evaluateAll(els => els.map(e => e.dataset.hhCard));
    assert.deepEqual(cards, ['red', 'amber', 'green', 'grey']);
    assert.match(await page.locator('[data-hh-card="grey"]').textContent(), /no reservations in the last or next 30 days/);
    assert.match(await page.locator('[data-hh-card="green"]').textContent(), /All good/);

    if (process.env.HH_QA_DIR) { fs.mkdirSync(process.env.HH_QA_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.HH_QA_DIR}/overview-${width}.png`, fullPage: true }); }
    // A line opens that host's deep dive.
    await page.locator('[data-hh-open="red"]').click();
    assert.equal(await page.evaluate(() => window.tab), 'deepdive');
    assert.equal(await page.locator('#userFilter').inputValue(), 'o1@example.invalid', 'host added to the filter and selected');
    if (process.env.HH_QA_DIR) await page.screenshot({ path: `${process.env.HH_QA_DIR}/deepdive-${width}.png`, fullPage: true });
    const tiles = page.locator('[data-hh-property="red"] [data-hh-tile]');
    assert.equal(await tiles.count(), 3);
    const t = await tiles.allTextContents();
    assert.match(t[0], /Check-in coverage.*50% \(1\/2\).*target ≥ 85%/s); assert.match(t[0], /Link reached guest: 0%/);
    assert.match(t[1], /Filed on time.*target 100%/s);
    assert.match(t[2], /Overdue now\s*2\s*target 0/); assert.match(t[2], /must file today or send a PEC/);
    const detail = await page.locator('[data-hh-property="red"]').textContent();
    assert.match(detail, /R\. · arr\. 1 Nov/); assert.ok(!/Rossi|Bianchi/.test(detail), 'surname initial only');
    assert.match(detail, /Upcoming arrivals without check-in/); assert.match(detail, /Automatic filing and Alloggiati connection/); assert.match(detail, /Setup gaps/); assert.match(detail, /Activity/);
    // Green tile shows no hint; amber property shows its gaps and console link.
    await page.evaluate(() => { document.getElementById('userFilter').add(new Option('o3', 'o3@example.invalid')); document.getElementById('content').innerHTML = renderHostHealthDetail('o3@example.invalid') + renderHostHealthDetail('o2@example.invalid'); });
    assert.equal(await page.locator('[data-hh-property="green"] [data-hh-hint]').count(), 0, 'no hint when every tile is green');
    const amber = await page.locator('[data-hh-property="amber"]').textContent();
    assert.match(amber, /CIN missing/); assert.match(amber, /Only 4 recommendations/); assert.match(amber, /link not opened yet/);
    await page.locator('[data-hh-property="amber"]').getByRole('button', { name: 'Open host console' }).click();
    assert.equal(await page.evaluate(() => window.console_), 'amber');
    // Tiles stack on a phone, sit in a row on desktop.
    await page.evaluate(() => { document.getElementById('content').innerHTML = renderHostHealthDetail('o1@example.invalid'); });
    const ys = await page.locator('[data-hh-tile]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
    if (width === 390) assert.ok(ys[0] < ys[1] && ys[1] < ys[2], 'tiles stacked'); else assert.equal(new Set(ys).size, 1, 'tiles in one row');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal page scroll');
    // Unavailable: a notice, never an empty "nothing needs attention".
    await page.evaluate(() => { hostHealth = { error: 'Host health unavailable. Retry in a moment.' }; document.getElementById('content').innerHTML = renderHealthOverview(); });
    assert.match(await page.locator('#hhOverview [role=status]').textContent(), /unavailable/);
    assert.equal(await page.getByText('Nothing needs attention').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS round71 host health UI 390/1440: Action needed red-first (green/grey not listed), hosts sorted red→amber→green→grey with top reason, line opens the host deep dive (host added to the filter), 3 tiles with value/target/colour and hint only when not green, overdue list with surname initial only, sections upcoming/autofile/gaps/activity, console link, tiles stack on phone, no horizontal scroll, unavailable notice');
} finally { await browser.close(); }
