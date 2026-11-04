// Round 51 Phase 6 — admin Onboarding section (funnel + Bloccati) and the
// readiness-based Setup column, actual admin.html code in Chromium at
// 390/1440. Fictional properties and events.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const fn = name => { let i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name); if (html.slice(i - 6, i) === 'async ') i -= 6; return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const constLine = name => { const i = html.indexOf('const ' + name + ' = '); assert.ok(i >= 0, name); return html.slice(i, html.indexOf('\n', i) + 1); };
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const table = fs.readFileSync(new URL('../admin-ops-table.js', import.meta.url), 'utf8');
const metrics = fs.readFileSync(new URL('../admin-ops-metrics.js', import.meta.url), 'utf8');

const NOW = Date.parse('2026-11-04T10:00:00Z');
const step = (id, done, missing = [], skipped = false) => ({ id, done, skipped, missing });
const rd = (pid, owner, done, ready, first, firstSeen, extra = {}) => ({ property_id: pid, owner_id: owner, ready, done, total: 5, first_incomplete: first, first_seen_at: firstSeen, completed_at: null, checklist_dismissed_at: null, nudge_24h_sent_at: null, nudge_72h_sent_at: null, nudges_opted_out: false,
  steps: [step('property', done >= 1), step('calendar', done >= 2, done >= 2 ? [] : ['ical_feeds']), step('content', done >= 3, done >= 3 ? [] : ['wifi_name']), step('test', done >= 4), step('notifications', done >= 5, done >= 5 ? [] : ['notification_channel'])], ...extra });
const readiness = [
  rd('ready', 'o1', 5, true, null, '2026-10-01T10:00:00Z'),
  rd('old', 'o2', 1, false, 'calendar', '2026-10-10T10:00:00Z', { nudge_24h_sent_at: '2026-10-11T10:00:00Z', nudge_72h_sent_at: '2026-10-13T10:00:00Z' }),
  rd('mid', 'o3', 3, false, 'test', '2026-10-30T10:00:00Z', { nudges_opted_out: true }),
  rd('fresh', 'o4', 2, false, 'content', '2026-11-03T20:00:00Z'),   // 14 h: not stuck yet
];
const props = readiness.map(r => ({ id: r.property_id, owner_id: r.owner_id, name: 'Casa ' + r.property_id, city: 'Bari', _checkin_count: 0 }));
const ev = (pid, type, step, channel) => ({ id: pid + type + step + channel, property_id: pid, event_type: type, event_data: { step, channel }, created_at: '2026-11-01T10:00:00Z' });
const events = [ev('old', 'support_opened', 'calendar'), ev('old', 'support_channel_clicked', 'calendar', 'whatsapp'), ev('mid', 'support_opened', 'calendar'), ev('mid', 'support_opened', null), ev('mid', 'support_channel_clicked', 'test', 'email')];

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 950 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.clock.install({ time: NOW });
    await page.setContent(`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="content"></div></body></html>`);
    await page.addScriptTag({ content: metrics });
    await page.addScriptTag({ content: table });
    await page.addScriptTag({ content: `
      let allProperties = ${JSON.stringify(props)}, allEvents = ${JSON.stringify(events)};
      let readinessByProperty = new Map(${JSON.stringify(readiness.map(r => [r.property_id, r]))});
      const APP_CONFIG = { appOrigin: 'https://app.welcomebnb.it' };
      let allogConnections = null, opsMetricsData = null, hostTermsByHost = null, legalDocsById = null;
      function adminRowClass(){return '';} function copyableId(id){return id;} function adminRowActions(){return '';}
      function viewAsHost(id){ window.consoleOpened = id; }
      ${fn('escapeHtml')}
      ${constLine('ONBOARDING_STEPS')}${constLine('ONBOARDING_MISSING')}
      ${fn('onboardingStepLabel')}${fn('onboardingDays')}${fn('onboardingHelpStats')}
      let onboardingSort = { key: 'days', dir: 'desc' };
      ${fn('sortOnboarding')}${fn('renderOnboardingSection')}
      ${fn('allogConnectionState')}${fn('allogConnectionCell')}${fn('hostTermsCell')}${fn('renderHostsPropertiesTable')}
      const emails = { o1: 'one@example.invalid', o2: 'two@example.invalid', o3: 'three@example.invalid', o4: 'four@example.invalid' };
      document.getElementById('content').innerHTML = renderHostsPropertiesTable({}, emails) + renderOnboardingSection(emails, ${NOW});
      AdminOpsTable.mount(document.getElementById('content'));` });

    // Funnel: properties done per step and help per step.
    const funnel = await page.locator('[data-onb-funnel] tbody tr[data-step]').evaluateAll(rows => rows.map(r => [r.dataset.step, r.children[1].textContent.replace(/\s+/g, ' ').trim(), r.children[2].textContent.trim()]));
    assert.deepEqual(funnel.map(f => f[1]), ['4 / 4', '3 / 4', '2 / 4', '1 / 4', '1 / 4']);
    assert.match(funnel[1][2], /^2 · 1 — most help asked$/, 'calendar: 2 opens, 1 click, the most');
    assert.match(funnel[3][2], /^0 · 1$/);
    assert.match(await page.locator('#opsOnboarding .section-title').first().textContent(), /1 of 4 ready/);

    // Bloccati: not ready and > 48 h, oldest first; ready and fresh excluded.
    const ids = () => page.locator('[data-onb-row]').evaluateAll(rows => rows.map(r => r.dataset.onbRow));
    assert.deepEqual(await ids(), ['old', 'mid']);
    const oldRow = page.locator('[data-onb-row="old"]');
    const oldText = (await oldRow.textContent()).replace(/\s+/g, ' ');
    assert.match(oldText, /25 days ago/); assert.match(oldText, /1\/5/); assert.match(oldText, /Calendar/); assert.match(oldText, /Missing: iCal feed/);
    assert.match(oldText, /24h ✓ 11\/10\/2026 · 72h ✓ 13\/10\/2026/); assert.match(oldText, /1 opened · 1 clicked/); assert.match(oldText, /whatsapp 1/); assert.match(oldText, /two@example\.invalid/);
    assert.match(await page.locator('[data-onb-row="mid"]').textContent(), /Stopped by host/);
    // Sorting.
    await page.locator('[data-onb-sort="done"]').click(); assert.deepEqual(await ids(), ['old', 'mid'], 'readiness ascending');
    await page.locator('[data-onb-sort="done"]').click(); assert.deepEqual(await ids(), ['mid', 'old'], 'readiness descending');
    await page.locator('[data-onb-sort="clicks"]').click(); assert.deepEqual(await ids(), ['mid', 'old'], 'most help first (3 vs 2)');
    assert.equal(await page.locator('[data-onb-sort="clicks"]').locator('..').getAttribute('aria-sort'), 'descending');
    await page.locator('[data-onb-row="old"]').getByRole('button', { name: 'Console' }).click();
    assert.equal(await page.evaluate(() => window.consoleOpened), 'old');

    // Ops table Setup column = readiness, and the filter uses "not ready".
    const setupCell = async name => (await page.locator('tbody tr').filter({ hasText: name }).first().locator('td').nth(9).textContent()).replace(/\s+/g, ' ').trim();
    assert.match(await setupCell('Casa ready'), /^5\/5 ✓ ?Ready$/);
    assert.match(await setupCell('Casa old'), /^1\/5 ?Calendar · 25d$/);
    await page.getByLabel('Show', { exact: true }).selectOption('setup');
    const visible = await page.locator('[data-ops-row]:visible').evaluateAll(rows => rows.map(r => JSON.parse(r.dataset.opsRow).propertyId));
    assert.deepEqual(visible.sort(), ['fresh', 'mid', 'old']);

    // Unavailable readiness: a dash and a notice, never "not ready".
    await page.evaluate(() => { readinessByProperty = null; document.getElementById('content').innerHTML = renderOnboardingSection({}); });
    assert.match(await page.locator('#opsOnboarding [role=status]').textContent(), /could not be loaded/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, 'no page-level horizontal scroll');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS round51 admin readiness 390/1440: funnel (done per step, help opened/clicked per step, most-help step flagged), Bloccati (not ready > 48 h, oldest first; ready/fresh excluded; missing fields, reminders, opt-out, help by channel, host email, console), sortable by start/readiness/help, Setup column = readiness with first missing step and days, «Setup not ready» filter, unavailable readiness shown as a notice');
} finally { await browser.close(); }
