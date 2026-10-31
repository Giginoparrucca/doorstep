// Guest page: host texts follow the language switch; before check-in the
// Wi-Fi card and entry card say "check in first" (no Retry button).
// All network is intercepted and all data is fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://language.example.invalid';
const pid = '22222222-2222-4222-8222-222222222222';
const base = { id: pid, name: 'Fictional House', host_names: 'Fictional Host',
  transport_info: 'TRASPORTO-IT', transport_info_it: 'TRASPORTO-IT', transport_info_en: 'TRANSPORT-EN',
  checkout_instructions: 'PARTENZA-IT', checkout_instructions_it: 'PARTENZA-IT', checkout_instructions_en: 'CHECKOUT-EN',
  welcome_message_it: 'BENVENUTO-IT', welcome_message_en: 'WELCOME-EN' };
const locked = () => ({ property: { ...base }, entry_release: { state: 'locked', allow_entry: false }, rotating_code: null });
const released = () => ({ property: { ...base, wifi_name: 'WIFI-NAME-FICTIONAL', wifi_password: 'WIFI-PASS-FICTIONAL' },
  entry_release: { state: 'available', allow_entry: true }, rotating_code: null });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const errors = []; let reply = locked(); let tokenId = 0;
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.WELCOME_BNB_CONFIG=${JSON.stringify({ mode: 'production', projectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publicKey: 'fictional-public', allowedOrigins: [origin], appOrigin: origin })}` });
      if (u.pathname === '/api/guest-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fictional-token-' + (++tokenId), expires_at: '2099-01-01T00:00:00Z' }) });
      if (u.pathname === '/api/guest') {
        const b = route.request().postDataJSON();
        let data = {};
        if (b.action === 'property') data = structuredClone(reply);
        if (b.action === 'history' || b.action === 'poll') data = { messages: [] };
        if (b.action === 'checkin_list') data = { guests: [] };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
      return route.fulfill({ body: '' });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?p=' + pid + '&b=BOOK-A');
    await page.waitForFunction(() => typeof _entryRefreshReady !== 'undefined' && _entryRefreshReady && _entryLastResponse?.data.entry_release.state === 'locked');
    const text = id => page.locator('#' + id).textContent();
    const shown = id => page.locator('#' + id).isVisible();

    // Page opens in English; switching to Italian re-renders every host text.
    await page.evaluate(() => { setLang('en'); goTo('welcome'); });
    assert.match(await text('transportInfoText'), /TRANSPORT-EN/);
    assert.match(await text('checkoutInstructionsText'), /CHECKOUT-EN/);
    await page.evaluate(() => setLang('it'));
    assert.match(await text('transportInfoText'), /TRASPORTO-IT/, 'transport follows Italian');
    assert.match(await text('checkoutInstructionsText'), /PARTENZA-IT/, 'check-out follows Italian');
    assert.match(await text('hostMsg'), /BENVENUTO-IT/, 'welcome follows Italian');
    // Before check-in: clear instructions, no Retry, clear Wi-Fi message.
    assert.match(await text('accessMethod'), /Completa il check-in online/);
    assert.equal(await shown('entryRetry'), false, 'no Retry before check-in');
    assert.match(await text('wifiName'), /Disponibile dopo il check-in online/);
    assert.equal((await text('wifiPass')).trim(), '', 'no empty password line');
    await page.evaluate(() => setLang('en'));
    assert.match(await text('transportInfoText'), /TRANSPORT-EN/, 'transport follows English');
    assert.match(await text('checkoutInstructionsText'), /CHECKOUT-EN/);
    assert.match(await text('wifiName'), /Available after online check-in/);
    assert.ok(!(await page.content()).includes('WIFI-PASS-FICTIONAL'), 'no Wi-Fi password before release');

    // After release the Wi-Fi details appear and survive a language switch.
    reply = released(); await page.evaluate(() => refreshEntryAfterSave());
    await page.evaluate(() => setLang('it'));
    assert.match(await text('wifiName'), /WIFI-NAME-FICTIONAL/);
    assert.match(await text('wifiPass'), /WIFI-PASS-FICTIONAL/);
    assert.match(await text('transportInfoText'), /TRASPORTO-IT/);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS guest language and Wi-Fi (390/1440): transport, check-out and welcome texts follow IT/EN switches; before check-in the entry card asks for check-in with no Retry and Wi-Fi says "available after online check-in"; Wi-Fi shown after release; fictional HTTP only.');
} finally { await browser.close(); }
