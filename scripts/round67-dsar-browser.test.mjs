// Round 67 Phase 4 — admin «Privacy» tab (admin-dsar.js) in Chromium at
// 390/1440 against a fictional /api/admin-host-health: search → summary with
// counts → JSON download; erase preview changes nothing and needs CANCELLA;
// server errors explained; no horizontal scroll. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ui = read('admin-dsar.js');
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const exportBody = { format: 'welcomebnb-dsar-v1', generated_at: '2026-11-16T12:00:00.000Z', properties: [{ id: P, name: 'Casa Fittizia' }],
  checkins: [{ id: 'c1', property_id: P, arrival_date: '2026-11-01', filed_at: '2026-11-01T12:00:00Z' }], reservations: [{ id: 'r1', property_id: P, checkin_date: '2026-11-01', platform: 'airbnb' }],
  marketing_consents: [{ id: 'm1', consent_given_at: '2026-11-01T10:00:00Z', withdrawn_at: null }], chat_messages: [{ id: 'h1' }, { id: 'h2' }], documents: [{ checkin_id: 'c1', kind: 'id_document', stored: true }],
  information: { recipients: [] }, counts: { checkins: 1, reservations: 1, marketing_consents: 1, chat_messages: 2, documents: 1, bookings: 1 } };
const eraseBody = dry => ({ dry_run: dry, checkins_erased: 0, checkins_retained: [{ id: 'c1', reason: 'filed_alloggiati_legal_retention' }], photos_queued: 1, consents_withdrawn: 1, reservations_redacted: 1, chat_messages_erased: 2, found: { checkins: 1, reservations: 1, marketing_consents: 1, bookings: 1 } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    const page = await context.newPage(); const errors = []; const calls = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(req.postData()); calls.push(b);
        assert.equal(req.headers().authorization, 'Bearer fictional-admin-jwt');
        if (b.email === 'limit@example.invalid') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited' }) });
        if (b.action === 'dsar_export') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(exportBody) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(eraseBody(b.dry_run !== false)) });
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};window.__toasts=[];window.adminToast=(m,k)=>__toasts.push([m,k||'ok']);window.print=()=>{window.__printed=(window.__printed||0)+1};` });
    await page.addScriptTag({ content: ui });
    await page.evaluate(() => DsarAdmin.render());
    // Export.
    await page.fill('#dsarValue', 'guest@example.invalid');
    await page.click('[data-dsar-export]');
    await page.waitForSelector('[data-dsar-summary]');
    assert.deepEqual(calls.at(-1), { action: 'dsar_export', email: 'guest@example.invalid', document_links: false });
    const count = label => page.textContent(`[data-dsar-count="${label}"]`);
    assert.equal(await count('Check-in'), '1'); assert.equal(await count('Messaggi chat'), '2'); assert.equal(await count('Foto documenti'), '1');
    assert.match(await page.textContent('[data-dsar-summary]'), /Casa Fittizia · 01\/11\/2026 · inviato alla Polizia/);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-dsar-download]')]);
    assert.match(dl.suggestedFilename(), /^welcomebnb-dati-personali-2026-11-16\.json$/);
    const saved = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); assert.equal(saved.format, 'welcomebnb-dsar-v1');
    await page.click('[data-dsar-print]'); assert.equal(await page.evaluate(() => window.__printed), 1);
    // Phone + document links option.
    await page.selectOption('#dsarKind', 'phone'); await page.fill('#dsarValue', '+39 333 000 0000'); await page.check('#dsarLinks');
    await page.click('[data-dsar-export]'); await page.waitForTimeout(100);
    assert.deepEqual(calls.at(-1), { action: 'dsar_export', phone: '+39 333 000 0000', document_links: true });
    // Erase: preview, refusal without CANCELLA, then confirmed.
    await page.click('[data-dsar-preview]');
    await page.waitForSelector('[data-dsar-erase="preview"]');
    assert.deepEqual(calls.at(-1), { action: 'dsar_erase', phone: '+39 333 000 0000', dry_run: true });
    assert.equal(await page.textContent('[data-dsar-n="checkins_retained"]'), '1');
    assert.match(await page.textContent('[data-dsar-erase]'), /non è stato modificato nulla[\s\S]*conservati per legge: 1 — già inviati ad Alloggiati/);
    const before = calls.length;
    await page.fill('#dsarConfirm', 'cancella'); await page.click('[data-dsar-erase-go]');
    assert.equal(calls.length, before, 'nothing sent without the exact word');
    assert.match(await page.textContent('#dsarStatus'), /scrivi CANCELLA/);
    await page.fill('#dsarConfirm', 'CANCELLA'); await page.click('[data-dsar-erase-go]');
    await page.waitForSelector('[data-dsar-erase="done"]');
    assert.deepEqual(calls.at(-1), { action: 'dsar_erase', phone: '+39 333 000 0000', dry_run: false, confirm: 'CANCELLA' });
    assert.equal(await page.locator('[data-dsar-erase-go]').count(), 0, 'no second erase button after the run');
    // Server refusal explained.
    await page.selectOption('#dsarKind', 'email'); await page.fill('#dsarValue', 'limit@example.invalid'); await page.click('[data-dsar-export]');
    await page.waitForFunction(() => /Limite raggiunto/.test(document.getElementById('dsarStatus').textContent));
    // Layout.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal scroll');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
console.log('PASS round67 DSAR admin tab (Phase 4): search by email/phone sends one identifier with the admin session, summary counts and stays, JSON download, print summary, document links only when ticked, erase preview then refusal without the exact word CANCELLA, confirmed erase shown once, rate-limit message, no horizontal scroll at 390/1440');
