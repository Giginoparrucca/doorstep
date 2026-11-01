// Round 69 Phase 3 — the real console gate: host-console.html's init() and
// the Round 69 terms block, in Chromium (IT/EN × 390/1440), against a
// fictional /api/host-terms and the committed legal texts. No live accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = new URL('../', import.meta.url);
const source = fs.readFileSync(new URL('host-console.html', root), 'utf8');
const terms = fs.readFileSync(new URL('legal/CONDIZIONI_GENERALI_v1.md', root));
const annex = fs.readFileSync(new URL('legal/ALLEGATO_A_DPA_v1.md', root));
const sha = b => createHash('sha256').update(b).digest('hex');
const start = source.indexOf('// ── Round 69 — host terms of service: acceptance gate');
const block = source.slice(start, source.indexOf('async function init() {', start));
const initFn = source.slice(source.indexOf('async function init() {'), source.indexOf('\n}\n', source.indexOf('async function init() {')) + 3);
assert.ok(start > 0 && block.length > 1000 && initFn.includes('ensureHostTerms()'));
// Gate placement: after the admin check, before any property is loaded; never in the admin view.
assert.ok(initFn.indexOf('ensureHostTerms()') > initFn.indexOf('_hostIsAdmin(userId)'));
assert.ok(initFn.indexOf('ensureHostTerms()') < initFn.indexOf("sb.from('properties')"));
assert.match(initFn, /if \(!adminPropId\) \{\n\s+if \(!await ensureHostTerms\(\)\)/);
// Legal text only via textContent: the block never assigns innerHTML.
assert.ok(!/innerHTML/.test(block), 'terms block never uses innerHTML');
// The Settings row exists in the real markup.
assert.ok(source.includes('id="hostTermsSettingsCard"'));
const settingsCard = source.slice(source.indexOf('<div class="form-card" id="hostTermsSettingsCard"'), source.indexOf('<fieldset class="settings-edit-fieldset"', source.indexOf('id="hostTermsSettingsCard"')));

const origin = 'https://console.example.invalid';
const current = { version: 1, sha256: sha(terms), file_path: 'legal/CONDIZIONI_GENERALI_v1.md', annex_file_path: 'legal/ALLEGATO_A_DPA_v1.md',
  annex_sha256: sha(annex), clauses: [{ ref: '10.2 e 10.3', label: 'limitazioni ed esclusioni di responsabilità e massimale' }, { ref: '15.2', label: 'foro competente' }],
  published_at: '2026-11-01T09:00:00Z' };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const server = { enforce: true, accepted: false, statusFail: false, codes: 0, accepts: [], tamper: false };
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) return route.abort();
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>
        <div id="loginOverlay" class="hidden">login</div><div class="main"><div id="dashboard">dashboard</div>${settingsCard}</div></body></html>` });
      if (u.pathname.startsWith('/legal/')) {
        const bytes = fs.readFileSync(new URL('.' + u.pathname, root));
        return route.fulfill({ contentType: 'text/markdown; charset=utf-8', body: server.tamper ? Buffer.concat([bytes, Buffer.from('x')]) : bytes });
      }
      if (u.pathname === '/api/host-terms') {
        const req = route.request(), b = req.postDataJSON();
        assert.equal(req.headers().authorization, 'Bearer fictional-access-token');
        assert.equal(b.lang, lang);
        if (server.statusFail && b.action === 'status') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        if (b.action === 'status') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          enforce: server.enforce, accepted: server.enforce ? server.accepted : true, current,
          accepted_version: server.accepted ? 1 : null, accepted_at: server.accepted ? '2026-11-01T10:00:00Z' : null }) });
        if (b.action === 'request_code') { server.codes++; return route.fulfill({ contentType: 'application/json', body: '{"sent":true,"expires_in":600}' }); }
        if (b.action === 'accept') {
          server.accepts.push(b);
          if (b.code !== '123456') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'code_invalid', message: lang === 'it' ? 'Codice non corretto.' : 'Incorrect code.' }) });
          server.accepted = true;
          return route.fulfill({ contentType: 'application/json', body: '{"accepted":true,"version":1}' });
        }
      }
      return route.fulfill({ status: 404, body: '' });
    });
    const page = await context.newPage(); const errors = []; let signOuts = 0;
    await page.exposeFunction('noteSignOut', () => { signOuts++; });
    page.on('pageerror', e => errors.push(e.message));
    const boot = async (query = '') => {
      await page.goto(origin + '/' + query);
      await page.addStyleTag({ content: '.hidden{display:none!important}' });
      await page.addScriptTag({ content: `
        var hostLang = ${JSON.stringify(lang)}; const HT = { en: {}, it: {} };
        function h(key) { return HT[hostLang][key] || HT.en[key] || key; }
        var _trackUserId = null, _trackEmail = null, _hostUserId = null, allProperties = [], propertyId = null, propertyData = null;
        window.calls = []; window.isAdmin = false;
        async function checkAuth() { return true; }
        function track() {}
        const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'fictional-access-token', user: { id: 'fixture-host', email: 'host@example.invalid' } } } }),
          getUser: async () => ({ data: { user: { email: 'host@example.invalid' } } }), signOut: async () => { await window.noteSignOut(); } },
          from: () => { window.calls.push('properties'); const q = { select: () => q, eq: () => q, is: () => q, order: async () => ({ data: [{ id: 'p1', name: 'Fictional' }] }), maybeSingle: async () => ({ data: { id: 'p1', name: 'Fictional' } }) }; return q; } };
        async function _hostIsAdmin() { return window.isAdmin; }
        function activateAdminView() { window.calls.push('admin-view'); }
        function showImpersonationError() { window.calls.push('impersonation-error'); }
        function setHostLang() {} function fillPropertyForm() {} function renderPropertySwitcher() {}
        async function loadPropertyData() { window.calls.push('load'); }
        async function showPanel(id) { window.calls.push('panel:' + id); }
        async function switchProperty() {}
        document.getElementById('sidebarUserName') || document.body.insertAdjacentHTML('beforeend', '<span id="sidebarUserName"></span><span id="sidebarAvatar"></span>');
        ${block}
        ${initFn}
        window.__init = init();` });
    };
    const overlay = () => page.locator('#hostTermsOverlay');
    const calls = () => page.evaluate(() => window.calls);

    // 1. Existing host with a stored session: window on (re)load, console waits.
    await boot();
    await overlay().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('#hostTermsText h4').length >= 10);
    assert.match(await page.locator('#hostTermsText').textContent(), /Art\. 16 — Approvazione specifica/);
    assert.match(await page.locator('#hostTermsText').textContent(), /Allegato A — Accordo sul trattamento dei dati|Annex A — Data Processing Agreement/);
    assert.match(await page.locator('#hostTermsTitle').textContent(), lang === 'it' ? /^Condizioni Generali di Servizio$/ : /Terms of Service/);
    if (lang === 'en') assert.match(await overlay().textContent(), /The Italian text is the binding version\./);
    assert.deepEqual(await calls(), [], 'no property is loaded while the window is open');
    // Cannot be dismissed.
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);
    assert.equal(await overlay().isVisible(), true, 'Escape and backdrop do nothing');
    assert.equal(await page.locator('#hostTermsOverlay button:has-text("×"), #hostTermsOverlay [aria-label="Close"]').count(), 0, 'no close button');
    // Separate approvals; nothing preselected; send disabled until all three.
    assert.equal(await page.locator('input[name="hostTermsKind"]:checked').count(), 0);
    assert.equal(await page.locator('#hostTermsGeneral').isChecked(), false);
    assert.equal(await page.locator('#hostTermsSpecific').isChecked(), false);
    assert.equal(await page.locator('#hostTermsClauses #hostTermsSpecific').count(), 1, 'specific approval inside the clause box');
    assert.equal(await page.locator('#hostTermsClauses #hostTermsGeneral').count(), 0, 'general acceptance outside it');
    assert.match(await page.locator('#hostTermsClauses').textContent(), /art\. 10\.2 e 10\.3 — limitazioni/);
    assert.equal(await page.locator('#hostTermsSend').isDisabled(), true);
    await page.locator('#hostTermsGeneral').check();
    assert.equal(await page.locator('#hostTermsSend').isDisabled(), true, 'general alone is not enough');
    await page.locator('#hostTermsSpecific').check();
    assert.equal(await page.locator('#hostTermsSend').isDisabled(), true, 'host kind still required');
    await page.locator('#hostTermsKind_private').check();
    assert.equal(await page.locator('#hostTermsSend').isDisabled(), false);
    if (process.env.TERMS_QA_DIR) { fs.mkdirSync(process.env.TERMS_QA_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.TERMS_QA_DIR}/terms-${lang}-${width}.png`, fullPage: true }); }
    await page.locator('#hostTermsSend').click();
    await page.locator('#hostTermsCode').waitFor();
    assert.match(await page.locator('#hostTermsCodeRow').textContent(), /host@example\.invalid/);
    assert.equal(await page.locator('#hostTermsResend').isDisabled(), true, 'resend waits 60 s');
    assert.equal(await page.locator('#hostTermsConfirm').isDisabled(), true);
    await page.locator('#hostTermsCode').fill('000000');
    await page.locator('#hostTermsConfirm').click();
    await page.waitForFunction(() => document.getElementById('hostTermsMessage').textContent.length > 0);
    assert.match(await page.locator('#hostTermsMessage').textContent(), lang === 'it' ? /Codice non corretto/ : /Incorrect code/);
    assert.equal(await overlay().isVisible(), true);
    await page.locator('#hostTermsCode').fill('123456');
    await page.locator('#hostTermsConfirm').click();
    await page.waitForFunction(() => /Fatto|Done/.test(document.getElementById('hostTermsMessage').textContent));
    await page.waitForFunction(() => !document.getElementById('hostTermsOverlay'));
    await page.evaluate(() => window.__init);
    assert.deepEqual(await calls(), ['properties', 'load', 'panel:dashboard'], 'console continues after acceptance');
    const sent = server.accepts.at(-1);
    assert.deepEqual({ v: sent.version, sha: sent.sha256, kind: sent.host_kind, g: sent.general, s: sent.specific },
      { v: 1, sha: sha(terms), kind: 'private', g: true, s: true });
    assert.ok(sent.general_at && sent.specific_at, 'tick times sent');
    // Settings row shows the accepted version.
    await page.evaluate(() => renderHostTermsSettings());
    assert.match(await page.locator('#hostTermsSettingsCard').textContent(), lang === 'it' ? /Versione 1 accettata il 01\/11\/2026/ : /Version 1 accepted on 01\/11\/2026/);
    assert.equal(await page.locator('#hostTermsSettingsCard a').getAttribute('href'), '/legal/CONDIZIONI_GENERALI_v1.md');

    // 2. Accepted host: no window on reload.
    await boot(); await page.evaluate(() => window.__init);
    assert.equal(await overlay().count(), 0); assert.deepEqual(await calls(), ['properties', 'load', 'panel:dashboard']);

    // 3. Flag off: no window even if never accepted.
    server.accepted = false; server.enforce = false;
    await boot(); await page.evaluate(() => window.__init);
    assert.equal(await overlay().count(), 0, 'flag off → no window');

    // 4. Admin ?p= view never asks (and never calls status).
    server.enforce = true;
    const codesBefore = server.codes;
    await boot('?p=fixture-property'); await page.evaluate(() => { window.isAdmin = true; });
    await boot('?p=fixture-property');
    await page.evaluate(() => { window.isAdmin = true; });
    // isAdmin is read inside init; re-run init with admin on.
    await page.evaluate(async () => { window.calls = []; await init(); });
    assert.equal(await overlay().count(), 0, 'admin view never shows the window');
    assert.ok((await calls()).includes('admin-view'));
    assert.equal(server.codes, codesBefore);

    // 5. Status error with the flag possibly on: retry screen, console not loaded.
    await page.evaluate(() => { try { localStorage.removeItem('wbnb_host_terms_enforce'); } catch (_) {} });
    server.statusFail = true;
    await boot();
    await page.locator('#hostTermsRetry').waitFor();
    assert.deepEqual(await calls(), [], 'no console after a failed status');
    server.statusFail = false;
    await page.locator('#hostTermsRetry').click();
    await overlay().waitFor();
    await page.locator('#hostTermsText h4').first().waitFor();
    // A tampered served text blocks sending.
    server.tamper = true;
    await boot(); await overlay().waitFor();
    await page.waitForFunction(() => /non corrisponde|does not match/.test(document.getElementById('hostTermsText').textContent));
    await page.locator('#hostTermsGeneral').check(); await page.locator('#hostTermsSpecific').check(); await page.locator('#hostTermsKind_business').check();
    assert.equal(await page.locator('#hostTermsSend').isDisabled(), true, 'cannot accept a text that does not match the recorded hash');
    server.tamper = false;
    // Esci signs out.
    await Promise.all([page.waitForEvent('framenavigated'), page.locator('#hostTermsLogout').click()]);
    assert.equal(signOuts, 1, 'Esci signs out, then the page reloads');
    // When the requirement is known to be off, a status outage does not lock the host out.
    server.enforce = false; await boot(); await page.evaluate(() => window.__init);
    server.statusFail = true; await boot(); await page.evaluate(() => window.__init);
    assert.equal(await overlay().count(), 0, 'known-off requirement: outage does not block');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS round69-host-terms-browser IT/EN 390/1440: real init() waits for acceptance on any load with a stored session; window cannot be dismissed (Escape, backdrop, no close button); text + Annex A rendered from the hash-checked files; host kind and the two separate approvals required before a code; wrong code message; success continues to the dashboard and sends version/hash/kind/ticks; Settings row; accepted host and flag off → no window; admin ?p= view never asks; status error → retry, no console; tampered text cannot be accepted; Esci signs out; known-off outage does not block');
} finally { await browser.close(); }
