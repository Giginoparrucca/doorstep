// Round 74 Phase 6 — audit WBNB-Y004 (decision D3): the full resource policy
// is enforced only after every guest/host/admin flow runs under it without a
// violation. The real pages, served with the real lib/security-headers.mjs
// headers, real local modules/SDK and fictional network replies, in Chromium
// IT/EN × 390/1440. A deliberately disallowed script and connection must be
// blocked. No account or real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { securityHeaders, resourcePolicy } from '../lib/security-headers.mjs';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const sdk = fs.readFileSync(new URL('vendor/supabase-2.118.0.js', root), 'utf8');
const headers = Object.fromEntries(securityHeaders.map(h => [h.key, h.value]));
assert.equal(headers['Content-Security-Policy'], resourcePolicy, 'the full policy is the enforced header');
assert.equal(headers['Content-Security-Policy-Report-Only'], undefined);
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
const flows = [
  { name: 'guest home', path: `/?p=${P}&b=HMFICTION1`, ready: 'body', act: async page => { await page.waitForTimeout(600); } },
  { name: 'guest check-in form', path: `/?p=${P}&b=HMFICTION1`, ready: 'body', act: async page => {
      await page.waitForTimeout(400);
      await page.evaluate(() => { try { if (typeof showSection === 'function') showSection('checkin'); } catch (_) {} try { if (typeof toggleLookup === 'function') toggleLookup(); } catch (_) {} });
      await page.waitForTimeout(300); } },
  { name: 'host login', path: '/host-console.html', ready: '#loginOverlay', act: async page => { await page.waitForTimeout(400); } },
  { name: 'admin', path: '/admin.html', ready: 'body', act: async page => { await page.waitForTimeout(500); } },
];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
let runs = 0;
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) for (const flow of flows) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === 'it' ? 'it-IT' : 'en-GB' });
    const page = await context.newPage(); const reports = [];
    await page.addInitScript(() => { window.__violations = []; document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.effectiveDirective + ' ' + e.blockedURI)); });
    await page.route('**/*', async route => {
      const req = route.request(), u = new URL(req.url());
      if (u.pathname === '/api/csp-report') { reports.push(req.postData()); return route.fulfill({ status: 204 }); }
      if (u.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      if (u.hostname === 'fonts.gstatic.com') return route.fulfill({ status: 204 });
      if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.includes('qrcode-generator')) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(require.resolve('qrcode-generator')) });
      if (u.hostname === 'cdn.jsdelivr.net' && u.pathname.includes('jszip')) return route.fulfill({ contentType: 'text/javascript', body: 'window.JSZip=function(){};' });
      if (u.hostname.endsWith('.supabase.co')) return route.fulfill({ status: 200, contentType: 'application/json', body: u.pathname.includes('/auth/') ? '{}' : '[]' });
      if (u.origin === 'https://app.welcomebnb.it') {
        if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
        const file = new URL(rel, root);
        if (!file.href.startsWith(root.href)) throw new Error('bad fixture path');
        if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', headers, body: `window.APP_CONFIG={appOrigin:'https://app.welcomebnb.it',supabaseUrl:'https://fictional.supabase.co',supabaseAnonKey:'fictional-anon',environment:'production'};` });
        if (fs.existsSync(file) && fs.statSync(file).isFile()) {
          const ext = rel.slice(rel.lastIndexOf('.'));
          return route.fulfill({ headers: { ...headers, 'content-type': types[ext] || 'application/octet-stream' }, body: fs.readFileSync(file) });
        }
        return route.fulfill({ status: 404, headers, body: '' });
      }
      return route.fulfill({ status: 200, body: '' }); // anything else would be blocked by CSP before reaching here
    });
    await page.goto('https://app.welcomebnb.it' + flow.path, { waitUntil: 'domcontentloaded' });
    await page.locator(flow.ready).first().waitFor({ state: 'attached' });
    await flow.act(page);
    const v = await page.evaluate(() => window.__violations);
    assert.deepEqual(v, [], `${flow.name} ${lang} ${width}: no CSP violation`);
    assert.deepEqual(reports, [], `${flow.name} ${lang} ${width}: no CSP report`);
    if (flow.name === 'host login') assert.ok((await page.locator('#authBtn').textContent()).trim().length > 0, 'host login rendered');
    // Controlled disallowed resources are blocked (once per page type).
    if (lang === 'it' && width === 390) {
      await page.evaluate(() => { window.__evil = false; const s = document.createElement('script'); s.src = 'https://evil.invalid/x.js'; document.head.appendChild(s); });
      const fetched = await page.evaluate(() => fetch('https://evil.invalid/collect').then(() => 'fetched', () => 'blocked'));
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => window.__violations);
      assert.ok(after.some(x => /^script-src(-elem)? https:\/\/evil\.invalid/.test(x)), flow.name + ': foreign script blocked');
      assert.equal(fetched, 'blocked'); assert.ok(after.some(x => /^connect-src https:\/\/evil\.invalid/.test(x)), flow.name + ': foreign connection blocked');
      assert.equal(await page.evaluate(() => window.__evil), false);
      // The Vercel Toolbar (owner-only) is deliberately not allowed.
      await page.evaluate(() => { const s = document.createElement('script'); s.src = 'https://vercel.live/_next-live/feedback/feedback.js'; document.head.appendChild(s); });
      await page.waitForTimeout(150);
      assert.ok((await page.evaluate(() => window.__violations)).some(x => x.includes('vercel.live')), 'toolbar blocked');
    }
    runs++;
    await context.close();
  }
} finally { await browser.close(); }
assert.equal(runs, 16);
console.log('PASS round74 enforced CSP (WBNB-Y004): guest home, guest check-in form, host login and admin load with the enforced full resource policy in IT/EN × 390/1440 with zero violations and zero reports (real pages, local modules, vendored SDK, jsdelivr QR/ZIP, Google Fonts, Supabase); a foreign script and a foreign connection are blocked on every page type, as is the owner-only Vercel Toolbar; no separate report-only header');
