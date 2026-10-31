// Guest analytics skip host devices: a browser where a host or admin has
// signed in records no track_event, while a guest's browser does.
// All network is intercepted and all data is fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const host = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const root = new URL('../', import.meta.url);
const origin = 'https://analytics.example.invalid';
const pid = '44444444-4444-4444-8444-444444444444';

// Signing in marks the device, in both consoles.
const mark = "if (session) { try { localStorage.setItem('wbnb_host_device', '1'); } catch (_) {} }";
assert.ok(host.includes("sb.auth.onAuthStateChange((event, session) => {\n  " + mark), 'host console marks the device on sign-in');
assert.ok(admin.includes('sb.auth.onAuthStateChange((event, session) => { ' + mark + ' });'), 'admin marks the device on sign-in');
// Guest Analytics no longer counts chat messages as sessions.
assert.ok(!/const chatEvents = await _loadGuestChatAsEvents\(propertyId, cutoff\);\n\s+const merged/.test(host));

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const [label, seed, expectTracking] of [
    ['guest browser', null, true],
    ['host marker', ['wbnb_host_device', '1'], false],
    ['signed-in session', ['sb-abcdefghijklmnopqrst-auth-token', '{"access_token":"fictional"}'], false],
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const errors = [], tracked = []; let tokenId = 0;
    await context.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) return route.fulfill({ contentType: 'application/json', body: '[]' });
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.WELCOME_BNB_CONFIG=${JSON.stringify({ mode: 'production', projectRef: 'abcdefghijklmnopqrst', supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', publicKey: 'fictional-public', allowedOrigins: [origin], appOrigin: origin })}` });
      if (u.pathname === '/api/guest-token') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'fictional-token-' + (++tokenId), expires_at: '2099-01-01T00:00:00Z' }) });
      if (u.pathname === '/api/guest') {
        const b = route.request().postDataJSON();
        if (b.action === 'track_event') { tracked.push(b.event_type); return route.fulfill({ status: 204, body: '' }); }
        let data = {};
        if (b.action === 'property') data = { property: { id: pid, name: 'Fictional House' }, entry_release: { state: 'locked', allow_entry: false } };
        if (b.action === 'history' || b.action === 'poll') data = { messages: [] };
        if (b.action === 'checkin_list') data = { guests: [] };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      }
      if (['/app-bootstrap.js', '/lib/cover-layout.js', '/lib/guest-entry-refresh.js', '/lib/codice-fiscale.js', '/vendor/supabase-2.118.0.js'].includes(u.pathname)) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(new URL('.' + u.pathname, root), 'utf8') });
      return route.fulfill({ body: '' });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    if (seed) await page.addInitScript(([k, v]) => localStorage.setItem(k, v), seed);
    await page.goto(origin + '/?p=' + pid + '&b=BOOK-A');
    await page.waitForFunction(() => typeof _entryRefreshReady !== 'undefined' && _entryRefreshReady);
    await page.evaluate(() => { goTo('rules'); goTo('welcome'); return trackGuest('guest_fictional_probe', {}); });
    await page.evaluate(() => trackGuestBeacon('guest_fictional_beacon', {}));
    await page.waitForTimeout(300);
    if (expectTracking) {
      assert.ok(tracked.includes('guest_fictional_probe'), `${label}: events recorded`);
      assert.ok(tracked.includes('guest_fictional_beacon'), `${label}: beacon recorded`);
    } else {
      assert.deepEqual(tracked, [], `${label}: nothing recorded`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('PASS guest analytics skip host devices: a guest browser records events and beacons; a browser marked by a host/admin sign-in, or holding a signed-in session, records none; consoles mark the device on sign-in; Guest Analytics no longer counts chat messages as sessions; fictional HTTP only.');
} finally { await browser.close(); }
