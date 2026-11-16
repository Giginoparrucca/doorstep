// 16 Nov 2026 — invite links valid 24 hours (Supabase's own link lasts 1 h):
// the email carries a signed WelcomeBnB link; opening it shows a page whose
// button asks for a fresh Supabase link (email scanners never trigger it).
// Expired/replaced links explain themselves in the host console. Actual
// handler + real host-console.html in Chromium with fictional transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const M = await import('../api/admin-invite-host.js');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EMAIL = 'host@example.invalid';

// ── Token ──
const t = M.signInviteToken('Host@Example.invalid');
assert.equal(M.INVITE_LINK_TTL_SECONDS, 24 * 3600);
assert.deepEqual(M.verifyInviteToken(t), { ok: true, email: EMAIL, expired: false });
assert.equal(M.verifyInviteToken(t, Date.now() + 23.9 * 3600e3).expired, false, 'valid for 24 hours');
assert.equal(M.verifyInviteToken(t, Date.now() + 24.1 * 3600e3).expired, true);
assert.equal(M.verifyInviteToken(t.replace(/.$/, c => c === 'A' ? 'B' : 'A')).ok, false, 'tampered signature');
const [p, sig] = t.split('.'); const forged = Buffer.from(JSON.stringify({ e: 'other@example.invalid', x: 9e9 })).toString('base64url') + '.' + sig;
assert.equal(M.verifyInviteToken(forged).ok, false, 'other email with a copied signature');
assert.equal(M.verifyInviteToken('').ok, false); assert.equal(M.verifyInviteToken('a.b.c').ok, false);
assert.match(M.inviteOpenUrl(EMAIL), /\/api\/admin-invite-host\?open=[A-Za-z0-9_\-.%]+$/);

// ── GET page: no side effects ──
const resStub = () => ({ code: 200, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
let calls = 0; const originalFetch = global.fetch; global.fetch = async () => { calls++; return new Response('{}'); };
let r = resStub(); await M.default({ method: 'GET', query: { open: t }, headers: {}, url: '/api/admin-invite-host?open=' + t }, r);
assert.equal(r.code, 200); assert.match(r.body, /Crea la mia password/); assert.equal(r.headers['Cache-Control'], 'no-store');
assert.equal(calls, 0, 'opening the page creates nothing (email scanners are harmless)');
r = resStub(); await M.default({ method: 'GET', query: { open: M.signInviteToken(EMAIL, Date.now() - 25 * 3600e3) }, headers: {}, url: '/x' }, r);
assert.equal(r.code, 410); assert.match(r.body, /Link non più valido/); assert.match(r.body, /invite=expired&amp;email=host%40example\.invalid/);
r = resStub(); await M.default({ method: 'GET', query: { open: 'garbage' }, headers: {}, url: '/x' }, r);
assert.equal(r.code, 410); assert.ok(!/email=/.test(r.body), 'no email leaked for a forged link');
global.fetch = originalFetch;

// ── POST open: outcomes ──
const open = async (token, { status = 'invited', limited = false, linkOk = true } = {}) => {
  const out = resStub(); let generated = 0;
  await M.handleOpen({ body: { action: 'open', token } }, out, {
    take: async () => ({ ok: !limited }), pgrestGET: async () => status ? [{ status }] : [],
    generateLink: async e => { generated++; assert.equal(e, EMAIL); return linkOk ? { ok: true, url: 'https://fictional.supabase.co/auth/v1/verify?token=fresh&type=invite' } : { ok: false }; },
  });
  return { ...out, generated };
};
let o = await open(t); assert.equal(o.code, 200); assert.match(o.body.url, /token=fresh/); assert.equal(o.generated, 1, 'a fresh Supabase link at click time');
o = await open(M.signInviteToken(EMAIL, Date.now() - 25 * 3600e3)); assert.equal(o.code, 410); assert.match(o.body.redirect, /invite=expired&email=host%40example\.invalid/); assert.equal(o.generated, 0);
o = await open('garbage'); assert.equal(o.code, 400); assert.equal(o.generated, 0);
o = await open(t, { status: 'revoked' }); assert.equal(o.body.error, 'revoked'); assert.equal(o.generated, 0);
o = await open(t, { status: null }); assert.equal(o.body.error, 'revoked', 'no invite row');
o = await open(t, { status: 'accepted' }); assert.match(o.body.redirect, /invite=already/); assert.equal(o.generated, 0, 'already registered: sign-in page, no new link');
o = await open(t, { limited: true }); assert.equal(o.code, 429);
o = await open(t, { linkOk: false }); assert.equal(o.code, 503);
// Emails carry our link and say 24 hours.
const src = read('api/admin-invite-host.js');
assert.equal((src.match(/const link = inviteOpenUrl\(email\);\n  const sent = await _sendInviteEmail\(email, link\);/g) || []).length, 2, 'invite and resend email our link');
assert.ok(!/_sendInviteEmail\(email, linkRes\.url\)/.test(src), 'never the 1-hour Supabase link');
assert.match(src, /Il link è valido 24 ore/); assert.match(src, /The link is valid for 24 hours/);

// ── Host console: expired/replaced link explained ──
const html = read('host-console.html');
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); return html.slice(i, html.indexOf('\n}\n', i) + 2); };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const [url, kind, emailWant] of [
    ['https://app.welcomebnb.it/host-console.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', 'expired', ''],
    ['https://app.welcomebnb.it/host-console.html?invite=expired&email=host%40example.invalid', 'expired', EMAIL],
    ['https://app.welcomebnb.it/host-console.html?invite=already&email=host%40example.invalid', 'already', EMAIL],
    ['https://app.welcomebnb.it/host-console.html?invite=revoked', 'revoked', ''],
    ['https://app.welcomebnb.it/host-console.html', null, '']]) {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="loginOverlay" class="hidden"><div class="login-error" id="loginError"></div><input id="loginEmail"></div></body></html>` }));
    await page.goto(url);
    await page.addScriptTag({ content: `let hostLang=${JSON.stringify(lang)};${fnSrc('_authLinkNotice')}${fnSrc('showAuthLinkNotice')}${fnSrc('_authEmailErrorText')} showAuthLinkNotice();` });
    const notice = await page.getAttribute('#loginError', 'data-link-notice');
    assert.equal(notice, kind, url);
    if (kind) {
      const text = await page.textContent('#loginError');
      assert.match(text, kind === 'expired' ? (lang === 'it' ? /non è più valido.*una sola volta.*l’ultima email/ : /no longer valid.*once.*newest email/) : kind === 'already' ? (lang === 'it' ? /già creato la tua password/ : /already created your password/) : /info@welcomebnb\.it/);
      assert.equal(await page.inputValue('#loginEmail'), emailWant, 'email prefilled when known');
      assert.equal(await page.evaluate(() => document.getElementById('loginOverlay').classList.contains('hidden')), false);
      assert.equal(await page.evaluate(() => location.search + location.hash), '', 'address cleaned');
    }
    const rate = await page.evaluate(() => [_authEmailErrorText({ status: 429, message: 'For security purposes, you can only request this after 13 seconds.' }), _authEmailErrorText({ message: 'Other' })]);
    assert.match(rate[0], lang === 'it' ? /attendi un minuto e apri solo l’ultima email/ : /wait a minute and open only the newest email/); assert.equal(rate[1], 'Other');
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
assert.match(html, /try \{ showAuthLinkNotice\(\); \} catch \(_\) \{\}\ninit\(\);/);
assert.equal((html.match(/errEl\.textContent = _authEmailErrorText\(error\);/g) || []).length, 2, 'both «Password dimenticata?» and «Prima volta?» use the friendly message');
console.log('PASS invite links: signed 24-hour token (tamper/copy/garbage refused), email carries our link and says 24 hours; opening the page creates nothing; the button gets a fresh Supabase link at click time; expired → sign-in with email prefilled, revoked/no invite → contact, already accepted → sign-in, rate-limited, link failure handled; host console explains expired/replaced links (Supabase otp_expired and our ?invite=) in IT/EN, prefills the email, cleans the address, and turns Supabase\'s "after N seconds" into plain guidance');
