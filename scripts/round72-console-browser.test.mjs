// Round 72 Phase 3 — host console trial banner, end-of-trial window,
// read-only mode and Settings → Abbonamento. The actual Round 72 block of
// host-console.html in Chromium (IT/EN × 390/1440) with a fictional
// Supabase client. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const source = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const start = source.indexOf('// Round 72 Phase 3 — trial banner');
const block = source.slice(source.lastIndexOf('// ═══', start), source.indexOf('async function init() {', start));
assert.ok(start > 0 && block.includes('function initHostBilling('));
assert.ok(!/innerHTML/.test(block), 'Round 72 block never uses innerHTML');
const initFn = source.slice(source.indexOf('async function init() {'), source.indexOf('\n}\n', source.indexOf('async function init() {')));
assert.ok(initFn.indexOf('initHostBilling()') > initFn.indexOf('ensureHostTerms()'), 'after the terms window');
assert.match(initFn, /if \(!adminPropId && typeof initHostBilling === 'function'\) initHostBilling\(\);/, 'never in the admin ?p= view');
assert.ok(source.includes('<div id="hostBillingBanner" role="status" style="display:none;"></div>'));
assert.ok(source.includes('<div class="form-card" id="hostBillingSettingsCard" style="display:none;"></div>'));
const fn = name => { const i = source.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return source.slice(i, source.indexOf('\n}\n', i) + 2); };
const hBody = fn('h');
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

const base = { price_eur: 60, vat_rate: 22, grace_days: 7, bank_transfer_iban: 'IT00X0000000000000000000000', bank_transfer_holder: 'Fictional SRLS' };
const STATES = {
  prelaunch: { ...base, state: 'prelaunch' },
  trial8: { ...base, state: 'trial', days_left: 8, trial_ends_at: '2027-01-30T23:00:00Z' },
  trial7: { ...base, state: 'trial', days_left: 7, trial_ends_at: '2027-01-30T23:00:00Z' },
  trial1: { ...base, state: 'trial', days_left: 1, trial_ends_at: '2027-01-30T23:00:00Z' },
  grace: { ...base, state: 'grace', grace_days_left: 5, ended_at: '2027-01-30T23:00:00Z', grace_ends_at: '2027-02-06T23:00:00Z' },
  read_only: { ...base, state: 'read_only', ended_at: '2027-01-30T23:00:00Z', since: '2027-02-06T23:00:00Z' },
  active: { ...base, state: 'active', paid_until: '2027-11-14T23:00:00Z' },
  free: { ...base, state: 'free', reason: 'free_forever' },
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) {
    const it = lang === 'it';
    const load = async (stateKey, { admin = false, rpcFails = false } = {}) => {
      const page = await browser.newPage({ viewport: { width, height: 900 } }); const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.setContent(`<html><head><meta charset="utf-8"><style>${styles}</style></head><body>
        <div class="main"><div class="content"><div id="hostBillingBanner" role="status" style="display:none;"></div>
          <button id="editSettings" onclick="startSettingsEdit()">edit</button>
          <button id="addRes" onclick="openReservationForm()">add</button>
          <button id="exportBtn" onclick="exportAlloggiati()">export</button>
          <button id="fileBtn" onclick="sendToAlloggiati()">file</button>
          <div id="later"></div>
          <div class="form-card" id="hostBillingSettingsCard" style="display:none;"></div></div></div></body></html>`);
      await page.addScriptTag({ content: `
        const HT = { en: {}, it: {} }; let hostLang = ${JSON.stringify(lang)}; let _trackEmail = 'host@example.invalid';
        let _hostTermsStatus = { support_whatsapp_url: 'https://wa.me/390000000000?text=Ciao' };
        window.calls = []; window.toasts = []; window.panel = null; window.signedOut = 0;
        function toast(t) { window.toasts.push(t); } async function showPanel(p) { window.panel = p; }
        function startSettingsEdit() { calls.push('edit'); } function openReservationForm() { calls.push('add'); }
        function exportAlloggiati() { calls.push('export'); } function sendToAlloggiati() { calls.push('file'); }
        function _isAdminView() { return ${admin ? "'prop-1'" : 'null'}; }
        const sb = { rpc: async name => { calls.push('rpc:' + name); return ${rpcFails ? "{ data: null, error: { message: 'down' } }" : `{ data: ${JSON.stringify(STATES[stateKey])}, error: null }`}; },
          auth: { signOut: async () => { window.signedOut++; } } };
        ${hBody}
        ${block}
        window.ready = initHostBilling();` });
      await page.evaluate(() => window.ready);
      return { page, errors };
    };
    const text = async (page, sel) => (await page.locator(sel).count()) ? (await page.locator(sel).textContent()) : '';
    const visible = async (page, sel) => page.locator(sel).isVisible().catch(() => false);

    // Prelaunch (and an unreadable state): nothing at all.
    for (const [k, o] of [['prelaunch', {}], ['trial7', { rpcFails: true }]]) {
      const { page, errors } = await load(k, o);
      assert.equal(await visible(page, '#hostBillingBanner'), false, k + ': no banner');
      assert.equal(await page.locator('#hostBillingOverlay').count(), 0, k + ': no window');
      assert.equal(await visible(page, '#hostBillingSettingsCard'), false, k + ': no Abbonamento card');
      await page.click('#editSettings'); assert.deepEqual(await page.evaluate(() => calls.filter(c => c === 'edit')), ['edit'], k + ': editing works');
      assert.deepEqual(errors, []); await page.close();
    }
    // Admin ?p= view: never asks, never shows.
    { const { page } = await load('read_only', { admin: true });
      assert.deepEqual(await page.evaluate(() => calls), [], 'admin view: no state call'); assert.equal(await page.locator('#hostBillingOverlay').count(), 0);
      assert.equal(await visible(page, '#hostBillingBanner'), false); await page.close(); }
    // Banner from 7 days left, not at 8.
    { const { page } = await load('trial8'); assert.equal(await visible(page, '#hostBillingBanner'), false, '8 days: no banner');
      assert.match(await text(page, '#hostBillingSettingsCard'), it ? /Prova gratuita fino al 30 gennaio 2027/ : /Free trial until 30 January 2027/);
      await page.close(); }
    { const { page, errors } = await load('trial7');
      assert.equal(await visible(page, '#hostBillingBanner'), true);
      assert.match(await text(page, '#hostBillingBanner'), it ? /Prova gratuita: mancano 7 giorni/ : /Free trial: 7 days left/);
      assert.equal(await page.locator('#hostBillingOverlay').count(), 0, 'no window during the trial');
      await page.click('[data-billing-subscribe]'); assert.equal(await page.evaluate(() => window.panel), 'settings', 'Abbonati opens Settings');
      const card = await text(page, '#hostBillingSettingsCard');
      assert.match(card, it ? /60 € l’anno, IVA inclusa/ : /€60 per year, VAT included/);
      assert.match(card, /IT00X0000000000000000000000/); assert.match(card, /Fictional SRLS/); assert.match(card, /WelcomeBnB host@example\.invalid/);
      assert.match(card, it ? /Causale/ : /Payment reference/);
      assert.equal(await page.locator('#hostBillingSettingsCard a[href^="https://wa.me/390000000000"]').count(), 1, 'WhatsApp contact');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, 'no horizontal scroll');
      if (process.env.R72_QA_DIR) await page.screenshot({ path: `${process.env.R72_QA_DIR}/trial-${lang}-${width}.png`, fullPage: true });
      assert.deepEqual(errors, []); await page.close(); }
    { const { page } = await load('trial1'); assert.match(await text(page, '#hostBillingBanner'), it ? /ultimo giorno/ : /last day/); await page.close(); }
    // Grace: window at login, Continua closes it, editing still works.
    { const { page, errors } = await load('grace');
      assert.equal(await page.locator('#hostBillingOverlay').count(), 1);
      const o = await text(page, '#hostBillingOverlay');
      assert.match(o, it ? /La prova è terminata/ : /Your free trial has ended/); assert.match(o, it ? /ancora accesso completo per 5 giorni/ : /full access for 5 more days/);
      assert.match(o, /Alloggiati/);
      for (const id of ['billingPwSubscribe', 'billingPwContact', 'billingPwDownload', 'billingPwContinue', 'billingPwLogout']) assert.equal(await page.locator('#' + id).count(), 1, id);
      assert.equal(await page.locator('#hostBillingOverlay [data-billing-pay]').isVisible(), false);
      await page.click('#billingPwSubscribe'); assert.equal(await page.locator('#hostBillingOverlay [data-billing-pay]').isVisible(), true, 'Abbonati shows bank details');
      assert.match(await text(page, '#hostBillingOverlay [data-billing-iban]'), /IT00X0000000000000000000000/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
      if (process.env.R72_QA_DIR) await page.screenshot({ path: `${process.env.R72_QA_DIR}/grace-${lang}-${width}.png`, fullPage: true });
      await page.click('#billingPwContinue'); assert.equal(await page.locator('#hostBillingOverlay').count(), 0, 'Continua closes it');
      assert.match(await text(page, '#hostBillingBanner'), it ? /accesso completo ancora per 5 giorni/ : /full access for 5 more days/);
      await page.click('#editSettings'); assert.ok((await page.evaluate(() => calls)).includes('edit'), 'grace: editing works');
      assert.deepEqual(errors, []); await page.close(); }
    // Read-only: no Continua; edit controls disabled with a tooltip; exports, filing, data download and sign out work.
    { const { page, errors } = await load('read_only');
      assert.equal(await page.locator('#billingPwContinue').count(), 0, 'no Continua in read-only');
      assert.match(await text(page, '#hostBillingOverlay'), it ? /sola lettura/ : /read-only/);
      if (process.env.R72_QA_DIR) await page.screenshot({ path: `${process.env.R72_QA_DIR}/readonly-${lang}-${width}.png`, fullPage: true });
      await page.click('#billingPwDownload'); assert.equal(await page.locator('#hostBillingOverlay').count(), 0); assert.equal(await page.evaluate(() => window.panel), 'export', 'Scarica i miei dati → Export');
      assert.equal(await page.getAttribute('#editSettings', 'aria-disabled'), 'true');
      assert.equal(await page.getAttribute('#editSettings', 'title'), it ? 'Account in sola lettura: abbonati per modificare' : 'Read-only account: subscribe to make changes');
      await page.click('#editSettings', { force: true }); await page.click('#addRes', { force: true });
      const calls = await page.evaluate(() => calls);
      assert.ok(!calls.includes('edit') && !calls.includes('add'), 'edit actions blocked');
      assert.ok((await page.evaluate(() => toasts)).length >= 2, 'tooltip toast on a blocked click');
      await page.click('#exportBtn'); await page.click('#fileBtn');
      assert.ok((await page.evaluate(() => calls)).includes('export') && (await page.evaluate(() => calls)).includes('file'), 'exports and filing work');
      // Controls rendered later are disabled too.
      await page.evaluate(() => { document.getElementById('later').insertAdjacentHTML('beforeend', '<button id="lateBtn" onclick="openReservationForm()">x</button>'); });
      await page.waitForFunction(() => document.getElementById('lateBtn').getAttribute('aria-disabled') === 'true');
      assert.match(await text(page, '#hostBillingBanner'), it ? /sola lettura/ : /Read-only/);
      await page.click('[data-billing-subscribe]'); assert.equal(await page.locator('#hostBillingOverlay').count(), 1, 'banner reopens the window');
      assert.equal(await page.locator('#hostBillingOverlay [data-billing-pay]').isVisible(), true);
      await page.click('#billingPwLogout'); await page.waitForFunction(() => window.signedOut === 1).catch(() => {});
      assert.deepEqual(errors.filter(e => !/reload/i.test(e)), []); await page.close(); }
    // Active and free: card only.
    { const { page } = await load('active'); assert.equal(await visible(page, '#hostBillingBanner'), false); assert.equal(await page.locator('#hostBillingOverlay').count(), 0);
      assert.match(await text(page, '#hostBillingSettingsCard'), it ? /Abbonamento attivo fino al 14 novembre 2027/ : /Subscription active until 14 November 2027/); await page.close(); }
    { const { page } = await load('free'); assert.match(await text(page, '#hostBillingSettingsCard'), it ? /Uso gratuito concesso/ : /Free use granted/);
      assert.ok(!/IBAN/.test(await text(page, '#hostBillingSettingsCard'))); await page.close(); }
  }
  console.log('PASS round72 console IT/EN × 390/1440: prelaunch and unreadable state show nothing and never block; admin ?p= view never asks; runs after the terms window; banner at 7 days not 8, last day; Abbonati → Settings card with price, IBAN, holder, causale, WhatsApp; grace window at login with Abbonati/Contattaci/Scarica/Continua/Esci, Continua closes, editing works; read-only window without Continua, data download → Export, edit controls disabled with tooltip (also rendered later), blocked clicks, exports and filing work, banner reopens the window, sign out; active/free card; no innerHTML; no horizontal scroll');
} finally { await browser.close(); }
assert.match(fs.readFileSync(new URL('../api/_host-terms.js', import.meta.url), 'utf8'), /support_whatsapp_url: \(SUPPORT_CONTACTS && SUPPORT_CONTACTS\.whatsapp\) \? whatsappLink\(/, 'WhatsApp link built on the server');
