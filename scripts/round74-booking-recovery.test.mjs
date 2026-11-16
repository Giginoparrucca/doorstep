// Round 74 Phase 1 — audit WBNB-R001: booking recovery. The real migration
// in PGlite (wildcards literal, D1 proof, exactly one booking), the actual
// api/guest.js checkin_lookup handler wired to it (generic answers, trusted
// limits, fail closed), and the guest form in Chromium IT/EN × 390/1440.
// Fictional guests only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
process.env.GUEST_TOKEN_SECRET = 'fictional-round74-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { PGlite } = await import('@electric-sql/pglite');
const { signGuestToken } = await import('../api/_guest-token.js');
const guestMod = await import('../api/guest.js');
const guest = guestMod.default;

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.checkins(id serial primary key, property_id uuid, booking_code text, surname text, name text, document_number text,
    arrival_date date, is_test boolean default false, deleted_at timestamptz);`);
const mig = read('supabase/migrations/20261116090000_round74_booking_recovery.sql');
await db.exec(mig); await db.exec(mig);
const add = (code, surname, doc, x = {}) => db.query(`insert into public.checkins(property_id,booking_code,surname,name,document_number,arrival_date,is_test,deleted_at)
  values ($1,$2,$3,'Guest',$4,$5,$6,$7)`, [x.p || P, code, surname, doc, x.date || '2026-12-10', x.test || false, x.deleted || null]);
await add('BOOK-A', 'ROSSI', 'AB1234567'); await add('BOOK-A', 'ROSSI', 'CD7654321');         // party of two, same surname
await add('BOOK-B', 'BIANCHI', 'YA 99-12 34');                                                 // spaces/dashes in the number
await add('BOOK-C', 'VERDI', 'ZZ0001111'); await add('BOOK-D', 'VERDI', 'QQ0001111');          // same surname + same last 4, two bookings
await add('BOOK-E', 'DE LUCA', 'XX0004321');
await add('BOOK-F', 'NERI', 'TT0005555', { test: true });
await add('BOOK-G', 'GALLI', 'GG0006666', { deleted: '2026-11-01' });
await add('BOOK-H', 'ROSSI', 'AB1234567', { p: P2 });
await add('BOOK-I', 'A_C', 'KK0007777');
const rec = async (surname, doc, x = {}) => (await db.query('select public.guest_recover_booking($1,$2,$3,$4,$5) r', [x.p || P, x.date || '2026-12-10', surname, doc, x.test || false])).rows[0].r;

// ── Database function ──
assert.deepEqual(await rec('ROSSI', '4567'), { found: true, booking_code: 'BOOK-A', guests: 2 });
assert.deepEqual(await rec('rossi ', '4321'), { found: true, booking_code: 'BOOK-A', guests: 2 }, 'case/space-insensitive, any party member');
assert.equal((await rec('ROSSI', '9999')).found, false, 'wrong document proof');
assert.equal((await rec('ROSSI', '4567', { date: '2026-12-11' })).found, false, 'wrong date');
assert.equal((await rec('BIANCHI', '1234')).found, true, 'separators in the stored number ignored');
assert.equal((await rec('de  luca', '4321')).found, true, 'inner spaces collapsed');
for (const w of ['*', '%', '_', 'R*', 'ROSS_', 'R%', '%%', '*ROSSI*', 'ROSS\\I', 'A\\_C'])
  assert.deepEqual(await rec(w, '4567'), { found: false }, 'wildcard is literal: ' + w);
assert.equal((await rec('A_C', '7777')).found, true, 'an underscore that is really in the surname matches only literally');
assert.equal((await rec('AXC', '7777')).found, false, '_ is not a single-character wildcard');
assert.deepEqual(await rec('VERDI', '1111'), { found: false }, 'two bookings match: ambiguous → nothing');
assert.equal((await rec('NERI', '5555')).found, false, 'test rows not found from a real session');
assert.equal((await rec('NERI', '5555', { test: true })).found, true, 'test session finds test rows');
assert.equal((await rec('GALLI', '6666')).found, false, 'deleted rows never');
assert.deepEqual(await rec('ROSSI', '4567', { p: P2 }), { found: true, booking_code: 'BOOK-H', guests: 1 }, 'scoped to the property');
for (const bad of ['', '45', '45678', '45-6', '45 67']) assert.equal((await rec('ROSSI', bad)).found, false, 'malformed proof: ' + JSON.stringify(bad));
assert.equal((await rec('x'.repeat(81), '4567')).found, false);
for (const role of ['anon', 'authenticated']) assert.equal((await db.query(`select has_function_privilege('${role}','public.guest_recover_booking(uuid,date,text,text,boolean)','EXECUTE') a`)).rows[0].a, false, role);

// ── Actual handler ──
const usage = []; let limiterFails = false, rpcCalls = 0;
const originalFetch = global.fetch; const rateHits = new Map();
global.fetch = async (url, init = {}) => {
  url = String(url);
  // Round 74 Phase 5: atomic counter (rpc rate_take) emulated per scope/key.
  if (url.includes('/rpc/rate_take')) {
    if (limiterFails ?? false) return new Response('down', { status: 503 });
    const a = JSON.parse(init.body); const k = a.p_scope + '|' + a.p_key; rateHits.set(k, (rateHits.get(k) || 0) + 1);
    return Response.json({ allowed: rateHits.get(k) <= a.p_limit, hits: rateHits.get(k), limit: a.p_limit, retry_after: 600 });
  }
  if (url.includes('/rpc/guest_recover_booking')) { rpcCalls++; const a = JSON.parse(init.body); return Response.json(await rec(a.p_surname, a.p_doc_last4, { p: a.p_property, date: a.p_arrival, test: a.p_is_test })); }
  if (url.includes('/rest/v1/api_usage') && init.method === 'POST') { usage.push({ ...JSON.parse(init.body), at: Date.now() }); return new Response(null, { status: 201 }); }
  if (url.includes('/rest/v1/api_usage?')) {
    if (limiterFails) return new Response('down', { status: 503 });
    const u = new URL(url); const sid = (u.searchParams.get('session_id') || '').replace(/^eq\./, ''), pid = (u.searchParams.get('property_id') || '').replace(/^eq\./, '');
    const n = usage.filter(r => r.endpoint === 'checkin_lookup' && (!sid || r.session_id === sid) && (!pid || r.property_id === pid)).length;
    return new Response('[]', { headers: { 'content-range': `0-0/${n}` } });
  }
  return Response.json([]);
};
const token = (b, sid = 'client-chosen') => signGuestToken({ p: P, s: sid, ...(b ? { b } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }).token;
const lookup = async (body, { ip = '203.0.113.7', sid, headers } = {}) => {
  let status = 200, out; const h = {};
  await guest({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer ' + token(null, sid), ...(ip ? { 'x-real-ip': ip } : {}), ...(headers || {}) }, body: { action: 'checkin_lookup', ...body } },
    { setHeader(k, v) { h[k] = v; }, status(n) { status = n; return this; }, json(v) { out = v; return this; }, end() { return this; }, write() {} });
  return { status, body: out };
};
try {
  let r = await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '4567' });
  assert.equal(r.status, 200); assert.deepEqual(r.body, { found: true, property_id: P, booking_code: 'BOOK-A', guests: 2 });
  r = await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10' }); assert.equal(r.status, 400, 'D1 proof required'); assert.equal(r.body.error, 'doc_last4 required');
  const calls = rpcCalls;
  for (const w of ['*', '%', 'R*', 'ROSS_', 'A\\C', 'RO\u0000SSI']) { r = await lookup({ surname: w, arrival_date: '2026-12-10', doc_last4: '4567' }, { ip: '198.51.100.' + w.length }); assert.deepEqual(r.body, { found: false }, w); }
  assert.equal(rpcCalls, calls, 'wildcards never reach the database');
  const generic = [await lookup({ surname: 'NOBODY', arrival_date: '2026-12-10', doc_last4: '0000' }, { ip: '198.51.100.20' }),
    await lookup({ surname: 'VERDI', arrival_date: '2026-12-10', doc_last4: '1111' }, { ip: '198.51.100.21' }),
    await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '0000' }, { ip: '198.51.100.22' })];
  for (const g of generic) { assert.equal(g.status, 200); assert.deepEqual(g.body, { found: false }, 'not found / ambiguous / wrong proof look the same'); }
  // Client-chosen session IDs do not reset the limit: 10 per address per hour.
  usage.length = 0; rateHits.clear();
  for (let i = 0; i < 10; i++) assert.equal((await lookup({ surname: 'X' + i, arrival_date: '2026-12-10', doc_last4: '0000' }, { ip: '192.0.2.50', sid: 'sess-' + i })).status, 200);
  r = await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '4567' }, { ip: '192.0.2.50', sid: 'brand-new-session' });
  assert.equal(r.status, 429, 'new session id, same address: still limited');
  assert.ok(usage.every(u => /^ip:[0-9a-f]{32}$/.test(u.session_id)), 'usage keyed on a hashed address, never the raw IP');
  assert.ok([...rateHits.keys()].every(k => /^lookup_(address\|ip:[0-9a-f]{32}|property\|[0-9a-f-]{36})$/.test(k)), 'counters keyed on hashed address / property only');
  assert.ok(!JSON.stringify(usage).includes('192.0.2.50'));
  // Property cap: 30 per hour across addresses.
  usage.length = 0; rateHits.clear();
  for (let i = 0; i < 30; i++) await lookup({ surname: 'Y' + i, arrival_date: '2026-12-10', doc_last4: '0000' }, { ip: '192.0.2.' + (100 + i) });
  assert.equal((await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '4567' }, { ip: '192.0.2.250' })).status, 429, 'property cap');
  usage.length = 0; rateHits.clear();
  assert.equal((await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '4567' }, { ip: null })).status, 429, 'no trusted address: refused');
  limiterFails = true;
  assert.equal((await lookup({ surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: '4567' })).status, 429, 'limiter unreadable: fail closed');
  limiterFails = false;
  // x-forwarded-for first entry used when x-real-ip is absent.
  assert.equal(guestMod.clientKey({ headers: { 'x-forwarded-for': '192.0.2.9, 10.0.0.1' } }), guestMod.clientKey({ headers: { 'x-real-ip': '192.0.2.9' } }));
} finally { global.fetch = originalFetch; }
// No pattern filter left in the handler.
const src = read('api/guest.js');
const handlerSrc = src.slice(src.indexOf('async function doCheckinLookup('), src.indexOf('async function checkLookupRateLimit('));
assert.ok(!/ilike|like\./i.test(handlerSrc), 'no LIKE/ILIKE in the recovery path');

// ── Guest form ──
const index = read('index.html');
const fnSrc = (() => { const i = index.indexOf('async function lookupCheckin('); return index.slice(i, index.indexOf('\n}\n', i) + 2); })();
const form = index.slice(index.indexOf('<div id="lookupForm"'), index.indexOf('<!-- Welcome Back panel'));
const T = {}; for (const l of ['en', 'it']) { T[l] = {}; const block = index.slice(index.indexOf(`  ${l}: {`, index.indexOf('const T = {'))); for (const k of ['lookup_err_surname', 'lookup_err_date', 'lookup_err_doc', 'lookup_not_found', 'lookup_doc']) { const m = new RegExp(k + ":\\s*'((?:[^'\\\\]|\\\\.)*)'").exec(block); assert.ok(m, l + ' ' + k); T[l][k] = m[1].replace(/\\'/g, "'"); } }
assert.match(T.it.lookup_not_found, /chiedi il link del check-in al tuo host/);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } }); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.setContent(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${form.replace('style="display:none;margin-top:10px', 'style="display:block;margin-top:10px')}</div></body></html>`);
    await page.addScriptTag({ content: `const T = ${JSON.stringify(T)}; let lang = '${lang}'; const IS_TEST_SESSION = false; window.calls = [];
      async function _guestCall(a, args) { calls.push([a, args]); return { ok: true, status: 200, data: { found: false } }; }
      function trackGuest() {} ${fnSrc}` });
    await page.fill('#lookupSurname', 'Rossi'); await page.fill('#lookupDate', '2026-12-10');
    await page.click('#lookupBtn');
    assert.equal(await page.textContent('#lookupError'), T[lang].lookup_err_doc, 'document characters required');
    assert.equal((await page.evaluate(() => calls)).length, 0);
    await page.fill('#lookupDoc', '45-6'); await page.click('#lookupBtn');
    assert.equal(await page.textContent('#lookupError'), T[lang].lookup_err_doc, '3 characters after cleaning: refused');
    await page.fill('#lookupDoc', 'ab67'); await page.click('#lookupBtn'); await page.waitForFunction(() => calls.length === 1);
    assert.deepEqual((await page.evaluate(() => calls))[0], ['checkin_lookup', { surname: 'ROSSI', arrival_date: '2026-12-10', doc_last4: 'AB67' }]);
    assert.equal(await page.textContent('#lookupError'), T[lang].lookup_not_found);
    assert.equal(await page.getAttribute('label[for="lookupDoc"]', 'data-i18n'), 'lookup_doc');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false);
    assert.deepEqual(errors, []); await page.close();
  }
} finally { await browser.close(); }
console.log('PASS round74 booking recovery (WBNB-R001): literal match only — *, %, _, backslash and control characters never act as patterns (refused before the database, literal in it); D1 proof (last 4 document characters, separators ignored) required; exactly one booking or nothing (ambiguous, wrong proof, wrong date, test/real, deleted, other property all → found:false); identical generic answer; limits keyed on a hashed client address and the property, not the client session ID (10/address, 30/property per hour), no address or unreadable limiter → refused; function service_role only; guest form IT/EN 390/1440 asks for the 4 characters and sends them');
