// The guest check-in form starts from the booking's own dates (and party
// size). When check-in gates entry codes the dates are locked, because the
// server then refuses a check-in whose dates differ from the booking.
// Actual complete guest page; fictional HTTP and data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://stay.example.invalid';
const pid = '44444444-4444-4444-8444-444444444444';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });

async function open(stay, language) {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await context.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origin) return route.fulfill({ contentType: 'application/json', body: '[]' });
    if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
    if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.WELCOME_BNB_CONFIG=${JSON.stringify({ mode: 'production', projectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publicKey: 'fictional', allowedOrigins: [origin], appOrigin: origin })}` });
    if (u.pathname === '/api/guest-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fictional-token', expires_at: '2099-01-01T00:00:00Z' }) });
    if (u.pathname === '/api/guest') {
      const b = route.request().postDataJSON();
      const data = b.action === 'property' ? { property: { id: pid, name: 'Fictional House', region: 'Puglia' }, entry_release: { state: 'locked', allow_entry: false }, ...(stay ? { stay } : {}) }
        : b.action === 'checkin_list' ? { guests: [] } : { messages: [] };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    }
    if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) {
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
    }
    return route.fulfill({ body: '' });
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/?p=' + pid + '&b=FICT-STAY');
  await page.waitForFunction(() => typeof propertyData !== 'undefined' && propertyData && propertyData.id);
  await page.waitForTimeout(300);
  await page.evaluate(l => { setLang(l); goTo('checkin'); }, language);
  return { context, page, errors };
}

try {
  for (const language of ['it', 'en']) {
    // Gated booking: booking dates and party size, dates locked.
    let { context, page, errors } = await open({ arrival_date: '2099-03-10', departure_date: '2099-03-15', guest_count: 8, dates_locked: true }, language);
    assert.equal(await page.inputValue('#arrivalDate'), '2099-03-10', 'arrival from booking');
    assert.equal(await page.inputValue('#departureDate'), '2099-03-15', 'departure from booking, not tomorrow');
    assert.equal(await page.inputValue('#numGuests'), '8', 'party size from booking');
    assert.equal(await page.evaluate(() => document.getElementById('arrivalDate').readOnly && document.getElementById('departureDate').readOnly), true, 'dates locked');
    assert.equal(await page.locator('#stayDatesHint').isVisible(), true);
    assert.match(await page.textContent('#stayDatesHint'), language === 'it' ? /Date della tua prenotazione/ : /Dates from your booking/);
    // Hero subtitle: the booking's dates and party size, in both languages.
    assert.equal((await page.textContent('#heroSub')).trim(), language === 'it' ? '10/03 — 15/03 · 8 ospiti' : '10/03 — 15/03 · 8 guests');
    await page.evaluate(l => setLang(l === 'it' ? 'en' : 'it'), language);
    assert.equal((await page.textContent('#heroSub')).trim(), language === 'it' ? '10/03 — 15/03 · 8 guests' : '10/03 — 15/03 · 8 ospiti');
    assert.deepEqual(errors, []);
    await context.close();

    // Booking without the check-in gate: dates pre-filled but editable.
    ({ context, page, errors } = await open({ arrival_date: '2099-03-10', departure_date: '2099-03-15', guest_count: null, dates_locked: false }, language));
    assert.equal(await page.inputValue('#departureDate'), '2099-03-15');
    assert.equal(await page.evaluate(() => document.getElementById('departureDate').readOnly), false, 'editable when not gated');
    assert.equal(await page.locator('#stayDatesHint').isVisible(), false);
    assert.equal(await page.inputValue('#numGuests'), '2', 'unknown party size keeps the default');
    assert.equal((await page.textContent('#heroSub')).trim(), '10/03 — 15/03', 'dates only when the party size is unknown');
    assert.deepEqual(errors, []);
    await context.close();

    // No booking stay (walk-in link): today/tomorrow defaults, editable.
    ({ context, page, errors } = await open(null, language));
    const today = await page.evaluate(() => new Date().toISOString().split('T')[0]);
    assert.equal(await page.inputValue('#arrivalDate'), today);
    assert.equal(await page.evaluate(() => document.getElementById('arrivalDate').readOnly), false);
    assert.equal((await page.textContent('#heroSub')).trim(), '', 'no invented subtitle without a booking');
    assert.ok(!/heart of the old city|città vecchia/.test(await page.content()), 'old demo subtitle gone');
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS guest-stay-dates: booking dates and party size pre-filled; locked with a hint when check-in gates entry codes; editable otherwise; walk-in keeps today/tomorrow; hero subtitle shows the booking dates and party size, empty without a booking (IT/EN)');
} finally {
  await browser.close();
}
