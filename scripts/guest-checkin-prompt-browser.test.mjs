// Guest page: a very visible check-in prompt (card under the hero + filled
// nav tab) stays until the whole party has checked in. Covers: nobody
// checked in (future arrival, arrival today, arrival passed), a partial
// party, a complete party, the button, the language switch and the
// completion path. All network is intercepted and all data is fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://prompt.example.invalid';
const pid = '44444444-4444-4444-8444-444444444444';
const romeDay = (offset) => new Date(Date.now() + offset * 86400000).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
const head = { id: 'row-1', guest_type: 'head', surname: 'FICTIONAL', name: 'HEAD', sex: 'M',
  date_of_birth: '1990-01-01', place_of_birth: 'Bari', birth_province: 'BA', citizenship: 'Italia',
  arrival_date: '2099-03-10', departure_date: '2099-03-14', editable: true };

const cases = [
  { label: 'future arrival, nobody checked in', arrival: '2099-03-10', guests: [], count: 2,
    visible: true, urgent: false, it: /prima di arrivare/, en: /before you arrive/, btn: /Inizia il check-in/ },
  { label: 'arrival today, nobody checked in', arrival: romeDay(0), guests: [], count: 1,
    visible: true, urgent: true, it: /Arrivi oggi/, en: /arrive today/, btn: /Inizia il check-in/ },
  { label: 'arrival passed, nobody checked in', arrival: romeDay(-1), guests: [], count: 1,
    visible: true, urgent: true, it: /non è ancora stato fatto/, en: /still to do/, btn: /Inizia il check-in/ },
  { label: '1 of 2 checked in', arrival: '2099-03-10', guests: [head], count: 2,
    visible: true, urgent: false, it: /1 di 2 ospiti/, en: /1 of 2 guests/, btn: /Aggiungi gli ospiti mancanti/ },
  { label: 'complete party', arrival: '2099-03-10', guests: [{ ...head, guest_type: 'single' }], count: 1, visible: false },
];

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const c of cases) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const errors = []; let tokenId = 0;
    const departure = '2099-12-31';
    const reply = { property: { id: pid, name: 'Fictional House', host_names: 'Fictional Host' },
      stay: { arrival_date: c.arrival, departure_date: departure, guest_count: c.count, dates_locked: true } };
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
        if (b.action === 'checkin_list') data = { guests: structuredClone(c.guests) };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
      return route.fulfill({ body: '' });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?p=' + pid + '&b=BOOK-P');
    await page.waitForFunction(() => _checkinPromptState != null, null, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('loadingOverlay')?.style.display === 'none' || getComputedStyle(document.getElementById('loadingOverlay')).opacity === '0', null, { timeout: 30000 }).catch(() => {});
    const cta = page.locator('#checkinCta');
    const navDue = () => page.evaluate(() => document.getElementById('navCheckin').classList.contains('nav-checkin-due'));
    if (!c.visible) {
      assert.equal(await cta.isVisible(), false, c.label + ': prompt hidden');
      assert.equal(await navDue(), false, c.label + ': nav tab not highlighted');
      assert.equal(await page.locator('#welcomeBackPanel').evaluate(el => el.style.display), 'block');
    } else {
      assert.equal(await cta.isVisible(), true, c.label + ': prompt visible');
      assert.equal(await navDue(), true, c.label + ': nav tab highlighted');
      assert.equal(await page.evaluate(() => lang), 'it');
      assert.match(await page.locator('#checkinCtaTitle').textContent(), c.it, c.label + ' IT title');
      assert.match(await page.locator('#checkinCtaBtn').textContent(), c.btn, c.label + ' IT button');
      assert.equal(await cta.evaluate(el => el.classList.contains('urgent')), c.urgent, c.label + ': urgency');
      // Above the fold on a phone, big enough to tap, and above the host message.
      const box = await page.locator('#checkinCtaBtn').boundingBox();
      assert.ok(box && box.y + box.height <= 844 - 64, c.label + ': button in the first screen');
      assert.ok(box.height >= 48, c.label + ': button at least 48 px tall');
      const hostBox = await page.locator('#hostMessageCard').boundingBox();
      assert.ok((await cta.boundingBox()).y < hostBox.y, c.label + ': prompt above the host message');
      await page.evaluate(() => setLang('en'));
      assert.match(await page.locator('#checkinCtaTitle').textContent(), c.en, c.label + ' EN title');
      await page.locator('#checkinCtaBtn').click();
      assert.equal(await page.locator('#page-checkin').evaluate(el => el.classList.contains('active')), true, c.label + ': button opens check-in');
      // Still due while the guest is on the form; gone once complete.
      assert.equal(await navDue(), true);
      await page.evaluate(() => setCheckinPromptState('done'));
      assert.equal(await cta.isVisible(), false, c.label + ': hidden after completion');
      assert.equal(await navDue(), false, c.label + ': nav back to normal after completion');
    }
    assert.deepEqual(errors, [], c.label + ': no page errors');
    await context.close();
  }
  // Both completion paths end the prompt.
  assert.ok(/getElementById\('checkinBadge'\)\.style\.display = 'none';\s*setCheckinPromptState\('done'\);/.test(html), 'submit success hides the prompt');
  assert.ok(/setCheckinPromptState\('done'\);\s*\/\/ 6\. Default to welcome tab/.test(html), 'welcome-back state hides the prompt');
  console.log('PASS guest check-in prompt: card under the hero + highlighted nav tab until the party is complete (future / today / passed arrival, partial party), hidden for a complete party and after completion, button opens check-in, IT/EN; fictional HTTP only.');
} finally { await browser.close(); }
