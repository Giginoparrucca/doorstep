// Guest page: a booking for 2 where only 1 guest has checked in is NOT
// "complete" — the page asks for the missing guest and the entry card shows
// the count. All network is intercepted and all data is fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://party.example.invalid';
const pid = '33333333-3333-4333-8333-333333333333';
const head = { id: 'row-1', guest_type: 'head', surname: 'FICTIONAL', name: 'HEAD', sex: 'M',
  date_of_birth: '1990-01-01', place_of_birth: 'Bari', birth_province: 'BA', citizenship: 'Italia',
  arrival_date: '2099-03-10', departure_date: '2099-03-14', editable: true };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const [label, guestCount, guests, expectBanner] of [
    ['1 of 2', 2, [head], true],
    ['complete party', 1, [{ ...head, guest_type: 'single' }], false],
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const errors = []; let tokenId = 0;
    const complete = !expectBanner;
    const reply = { property: { id: pid, name: 'Fictional House', host_names: 'Fictional Host' },
      stay: { arrival_date: '2099-03-10', departure_date: '2099-03-14', guest_count: guestCount, dates_locked: true },
      entry_release: complete ? { state: 'available', allow_entry: true, submitted: 1, expected: 1 }
        : { state: 'locked', reason: 'checkin_incomplete', allow_entry: false, submitted: 1, expected: 2 } };
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
        if (b.action === 'checkin_list') data = { guests: structuredClone(guests) };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
      return route.fulfill({ body: '' });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?p=' + pid + '&b=BOOK-A');
    await page.waitForFunction(() => typeof existingCheckins !== 'undefined' && existingCheckins.length === 1);
    await page.waitForFunction(() => _entryLastResponse != null);
    if (expectBanner) {
      await page.waitForSelector('#checkinReopenBanner', { state: 'attached' });
      assert.match(await page.locator('#checkinReopenBanner').textContent(), /1 of 2/, label);
      assert.equal(await page.evaluate(() => isReopenedCheckin), true, 'form open for the missing guest');
      assert.equal(await page.evaluate(() => selectedGuestType), 'single', 'one guest to add');
      assert.equal(await page.locator('#welcomeBackPanel').isVisible(), false, 'no "check-in complete" panel');
      assert.ok(!/Check-in complete/.test(await page.locator('#heroSub').textContent()), 'hero is not "complete"');
      assert.match(await page.locator('#accessMethod').textContent(), /1 of 2 guests have checked in/);
      await page.evaluate(() => setLang('it'));
      assert.match(await page.locator('#accessMethod').textContent(), /Check-in completato da 1 ospiti su 2/);
      // Success screen: the added guest is labelled a companion, the
      // count includes guests saved earlier, and the banner goes away.
      await page.evaluate(() => { setLang('en'); savedGuests = [{ guest_type: 'member', surname: 'FICTIONAL', name: 'ADDED', sex: 'M' }]; renderReviewCards(); });
      const card = await page.locator('#reviewCard0').textContent();
      assert.ok(!/Main guest/i.test(card), 'added guest is not the main guest');
      assert.ok(/partyCount = \(isReopenedCheckin \? \(existingCheckins\?\.length \|\| 0\) : 0\) \+ savedGuests\.length/.test(html), 'count includes earlier guests');
      assert.ok(html.includes("document.getElementById('checkinReopenBanner')?.remove();"), 'banner removed on completion');
      // The added guest is a family member of the existing head.
      assert.ok(/head\?\.guest_type === 'group' \? 'group_member' : 'member'/.test(html));
    } else {
      await page.waitForFunction(() => document.getElementById('welcomeBackPanel').style.display === 'block');
      assert.equal(await page.locator('#checkinReopenBanner').count(), 0, label);
      assert.equal(await page.evaluate(() => isReopenedCheckin), false);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS guest partial party: a 2-guest booking with 1 check-in opens the form for the missing guest with "1 of 2", no "complete" state, and the entry card shows the count (EN/IT); a complete party keeps the welcome-back panel; fictional HTTP only.');
} finally { await browser.close(); }
