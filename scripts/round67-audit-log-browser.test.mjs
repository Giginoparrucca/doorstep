// Round 67 Phase 5 — admin audit log view (Privacy tab, admin-dsar.js) in
// Chromium at 390/1440 against a fictional /api/admin-host-health: rows in
// plain Italian, filter sent to the server, integrity state shown (verified /
// altered / unavailable), no horizontal scroll. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const ui = fs.readFileSync(new URL('../admin-dsar.js', import.meta.url), 'utf8');
const events = [
  { id: 4, occurred_at: '2026-11-16T12:05:00Z', actor_email: 'admin@example.invalid', action: 'dsar_erase', outcome: 'ok', target_table: 'data_subject', target_id: null, metadata: {} },
  { id: 3, occurred_at: '2026-11-16T12:04:00Z', actor_email: 'admin@example.invalid', action: 'billing_free_forever', outcome: 'refused', target_table: 'auth_users', target_id: '00000000-0000-4000-8000-0000000000bb', metadata: {} },
  { id: 2, occurred_at: '2026-11-16T12:03:00Z', actor_email: 'admin@example.invalid', action: 'impersonation_view', outcome: 'ok', target_table: 'properties', target_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', metadata: {} },
];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = []; const calls = [];
    let chain = { ok: true, checked: 3 };
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(req.postData()); calls.push(b);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ events: b.action_prefix === 'dsar_' ? events.slice(0, 1) : events, chain }) });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};window.adminToast=()=>{};` });
    await page.addScriptTag({ content: ui });
    await page.evaluate(() => DsarAdmin.render());
    assert.equal(await page.locator('[data-audit-panel]').count(), 1);
    await page.click('[data-audit-load]');
    await page.waitForSelector('[data-audit-chain="ok"]');
    assert.deepEqual(calls.at(-1), { action: 'audit_list', action_prefix: '', limit: 200 });
    assert.match(await page.textContent('[data-audit-chain]'), /Integrità verificata \(3 voci\)/);
    const rows = await page.$$eval('[data-audit-row]', trs => trs.map(tr => [...tr.cells].map(td => td.textContent.trim())));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => [r[2], r[3]]), [['Privacy: cancellazione', 'ok'], ['Abbonamento: free_forever', 'rifiutato'], ['Vista come host', 'ok']]);
    assert.match(rows[1][4], /^auth_users · 00000000-000$/, 'IDs shortened');
    await page.selectOption('#auditFilter', 'dsar_');
    await page.click('[data-audit-load]');
    await page.waitForFunction(() => document.querySelectorAll('[data-audit-row]').length === 1);
    assert.equal(calls.at(-1).action_prefix, 'dsar_');
    assert.equal(await page.inputValue('#auditFilter'), 'dsar_', 'filter kept after reload');
    chain = { ok: false, broken_at: 3, reason: 'content', checked: 2 };
    await page.click('[data-audit-load]');
    await page.waitForSelector('[data-audit-chain="broken"]');
    assert.match(await page.textContent('[data-audit-chain]'), /Registro alterato alla voce 3 — avvisa subito/);
    chain = null;
    await page.click('[data-audit-load]');
    await page.waitForSelector('[data-audit-chain="unknown"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal scroll');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS round67 admin audit log view (Phase 5): entries in plain Italian with outcome and shortened target IDs, filter sent and kept, integrity verified / altered (alarm) / unavailable shown, no horizontal scroll at 390/1440');
