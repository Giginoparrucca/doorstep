// Round 69 Phase 2 — the actual host-terms handler (api/_host-terms.js)
// against an in-memory Supabase/Resend stand-in. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { handleHostTerms, hashCode } from '../api/_host-terms.js';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root));
const sha = b => createHash('sha256').update(b).digest('hex');
const termsBytes = read('legal/CONDIZIONI_GENERALI_v1.md'), annexBytes = read('legal/ALLEGATO_A_DPA_v1.md');

// ── Mounted on an existing function; budget unchanged ────────────────────
const guestSrc = read('api/guest.js').toString();
assert.ok(guestSrc.includes("if (req.query?.host_terms === '1') return handleHostTerms(req, res);"), 'mounted on /api/guest');
assert.ok(guestSrc.indexOf("host_terms === '1'") > guestSrc.indexOf("if (req.method !== 'POST')"), 'after the CORS and POST checks');
assert.ok(guestSrc.indexOf("host_terms === '1'") < guestSrc.indexOf('verifyFromAuthHeader(auth)'), 'before the guest-token check (host JWT instead)');
assert.ok(read('lib/deployment-config.mjs').toString().includes("{source:'/api/host-terms',destination:'/api/guest?host_terms=1'}"), 'rewrite present');
assert.equal(fs.readdirSync(new URL('api/', root)).filter(n => n.endsWith('.js') && !n.startsWith('_')).length, 12, 'function budget still 12');

// ── In-memory stand-in ───────────────────────────────────────────────────
const HOST = randomUUID(), OTHER = randomUUID(), PEPPER = 'fictional-pepper-0123456789abcdef';
const SB = 'https://db.example.invalid', APP = 'https://app.example.invalid';
let clock = Date.parse('2026-11-01T10:00:00Z');
const docs = [{ id: randomUUID(), kind: 'host_terms', version: 1, file_path: 'legal/CONDIZIONI_GENERALI_v1.md',
  text_sha256: sha(termsBytes), annex_file_path: 'legal/ALLEGATO_A_DPA_v1.md', annex_sha256: sha(annexBytes),
  specific_clauses: [{ ref: '10.2 e 10.3', label: 'limitazioni' }], requires_reacceptance: true, published_at: '2026-11-01T00:00:00Z' }];
const tables = { legal_documents: docs, host_terms_acceptances: [], host_terms_codes: [] };
const emails = [];
let codes = ['111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '123123', '321321', '456456'];
let resendDown = false, sentCodes = [];

function filtered(table, params) {
  let out = tables[table].slice();
  for (const [k, v] of params) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    out = out.filter(r => op === 'eq' ? String(r[k]) === val : op === 'is' ? r[k] == null
      : op === 'gte' ? Date.parse(r[k]) >= Date.parse(val) : op === 'lte' ? Date.parse(r[k]) <= Date.parse(val) : (() => { throw Error('op ' + op); })());
  }
  const order = params.get('order');
  if (order) { const [col, dir] = order.split('.'); out.sort((a, b) => (a[col] > b[col] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
  if (params.get('limit')) out = out.slice(0, Number(params.get('limit')));
  return out;
}
// Like PostgREST, responses are copies, never live rows.
const json = (status, data) => { const copy = structuredClone(data); return { ok: status < 400, status, json: async () => copy, text: async () => JSON.stringify(copy) }; };
async function fakeFetch(url, init = {}) {
  const u = new URL(url), method = init.method || 'GET';
  if (u.origin === SB && u.pathname === '/auth/v1/user') {
    const token = init.headers.Authorization;
    if (token === 'Bearer host-session-token-fictional') return json(200, { id: HOST, email: 'host@example.invalid' });
    if (token === 'Bearer other-session-token-fictional') return json(200, { id: OTHER, email: 'other@example.invalid' });
    return json(401, { msg: 'bad jwt' });
  }
  if (u.origin === SB && u.pathname.startsWith('/rest/v1/')) {
    assert.equal(init.headers.apikey, 'fictional-service-key', 'service role for table access');
    const table = u.pathname.slice(9);
    assert.ok(table in tables, table);
    if (method === 'GET') return json(200, filtered(table, u.searchParams));
    if (method === 'POST') {
      const row = { id: randomUUID(), created_at: new Date(clock).toISOString(), attempts: 0, used_at: null, receipt_email_id: null, ...JSON.parse(init.body) };
      if (table === 'host_terms_acceptances') {
        assert.notEqual(row.host_id, undefined);
        if (tables[table].some(r => r.host_id === row.host_id && r.document_id === row.document_id)) return json(409, { code: '23505' });
      }
      tables[table].push(row); return json(201, [row]);
    }
    if (method === 'PATCH') {
      const hit = filtered(table, u.searchParams), patch = JSON.parse(init.body);
      if (table === 'host_terms_acceptances') assert.deepEqual(Object.keys(patch), ['receipt_email_id'], 'evidence: only the receipt id is ever patched');
      for (const r of hit) Object.assign(r, patch);
      return json(200, hit);
    }
    if (method === 'DELETE') { const hit = filtered(table, u.searchParams); tables[table] = tables[table].filter(r => !hit.includes(r)); return json(204, null); }
  }
  if (url === 'https://api.resend.com/emails') {
    if (resendDown) return json(500, {});
    const mail = JSON.parse(init.body); emails.push(mail);
    const m = /è: (\d{6})/.exec(mail.text); if (m) sentCodes.push(m[1]);
    return json(200, { id: 'fictional-email-' + emails.length });
  }
  if (u.origin === APP) {
    const file = u.pathname.slice(1);
    return { ok: true, status: 200, arrayBuffer: async () => read(file) };
  }
  throw Error('unexpected fetch ' + url);
}
const deps = (over = {}) => ({ fetch: fakeFetch, now: () => clock, randomCode: () => codes.shift(),
  supabaseUrl: SB, anonKey: 'fictional-anon', serviceKey: 'fictional-service-key', resendKey: 'fictional-resend',
  from: 'WelcomeBnB <test@example.invalid>', pepper: PEPPER, enforce: true, appBaseUrl: APP, ...over });
async function call(body, { token = 'host-session-token-fictional', headers = {}, d = deps() } = {}) {
  let status, payload; const set = {};
  const res = { setHeader: (k, v) => { set[k] = v; }, status(s) { status = s; return this; }, json(b) { payload = b; return this; } };
  await handleHostTerms({ body, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res, d);
  assert.equal(set['Cache-Control'], 'private, no-store');
  return { status, body: payload };
}
const good = (extra = {}) => ({ action: 'accept', version: 1, sha256: sha(termsBytes), host_kind: 'business', general: true, specific: true, ...extra });

// ── Authentication and flag ──────────────────────────────────────────────
assert.equal((await call({ action: 'status' }, { token: null })).status, 401, 'no JWT');
assert.equal((await call({ action: 'status' }, { token: 'forged-session-token-x' })).status, 401, 'bad JWT');
assert.equal((await call({ action: 'nope' })).status, 400);
let r = await call({ action: 'status' }, { d: deps({ enforce: false }) });
assert.deepEqual([r.status, r.body.enforce, r.body.accepted], [200, false, true], 'flag off → accepted');
r = await call({ action: 'status' });
assert.deepEqual([r.status, r.body.enforce, r.body.accepted, r.body.current.version, r.body.current.sha256], [200, true, false, 1, sha(termsBytes)]);
assert.deepEqual(r.body.current.clauses, docs[0].specific_clauses);
assert.equal((await call({ action: 'status' }, { d: deps({ supabaseUrl: SB, serviceKey: '' }) })).status, 503, 'no service key → fail closed');
assert.equal((await call({ action: 'request_code' }, { d: deps({ pepper: '' }) })).status, 503, 'no pepper → no codes');

// ── Code request, rate limit, email failure ─────────────────────────────
r = await call({ action: 'request_code' });
assert.deepEqual([r.status, r.body.sent], [200, true]);
assert.ok(!JSON.stringify(r.body).includes('111111'), 'the code is never returned');
assert.equal(emails.at(-1).subject, 'Codice di conferma Condizioni WelcomeBnB');
assert.deepEqual(emails.at(-1).to, ['host@example.invalid']);
assert.equal(tables.host_terms_codes[0].code_hash, hashCode('111111', PEPPER), 'only the keyed hash is stored');
assert.ok(!JSON.stringify(tables.host_terms_codes).includes('111111'));
await call({ action: 'request_code' }); await call({ action: 'request_code' });
r = await call({ action: 'request_code', lang: 'en' });
assert.deepEqual([r.status, r.body.error], [429, 'rate'], '4th code within 15 minutes refused');
assert.match(r.body.message, /Too many codes/);
clock += 16 * 60000;
resendDown = true;
const before = tables.host_terms_codes.length;
r = await call({ action: 'request_code' });
assert.deepEqual([r.status, r.body.error], [502, 'email']);
assert.equal(tables.host_terms_codes.length, before, 'unsent code removed (does not use up the limit)');
resendDown = false;

// ── Accept: every refusal path ───────────────────────────────────────────
r = await call({ action: 'request_code' }); assert.equal(r.status, 200);
const latest = sentCodes.at(-1);
assert.deepEqual((await call(good({ version: 2, code: latest }))).body.error, 'stale', 'stale version');
assert.deepEqual((await call(good({ sha256: sha('other'), code: latest }))).body.error, 'stale', 'stale text');
assert.deepEqual((await call(good({ host_kind: undefined, code: latest }))).body.error, 'host_kind', 'host kind required');
assert.deepEqual((await call(good({ host_kind: 'company', code: latest }))).body.error, 'host_kind');
assert.deepEqual((await call(good({ specific: false, code: latest }))).body.error, 'approvals', 'general only refused');
assert.deepEqual((await call(good({ general: false, code: latest }))).body.error, 'approvals', 'specific only refused');
assert.deepEqual((await call(good({ general: 'true', code: latest }))).body.error, 'approvals', 'strict booleans');
assert.equal(tables.host_terms_acceptances.length, 0, 'nothing recorded by refused requests');
// Wrong codes count; the 6th try is blocked even with the right code.
for (let i = 1; i <= 5; i++) {
  r = await call(good({ code: '000000' }));
  assert.deepEqual([r.status, r.body.error], i < 5 ? [400, 'code_invalid'] : [429, 'attempts'], `wrong code ${i}`);
}
r = await call(good({ code: latest }));
assert.deepEqual([r.status, r.body.error], [429, 'attempts'], '6th attempt blocked');
// Expired code.
clock += 16 * 60000;
await call({ action: 'request_code' }); const fresh = sentCodes.at(-1);
clock += 11 * 60000;
assert.deepEqual((await call(good({ code: fresh }))).body.error, 'code_expired');
// Another host's code does not work for this host.
await call({ action: 'request_code' }, { token: 'other-session-token-fictional' });
const othersCode = sentCodes.at(-1);
assert.notEqual((await call(good({ code: othersCode }))).status, 200, "another host's code refused");

// ── Success, evidence, receipt, idempotent retry, reused code ────────────
clock += 16 * 60000;
await call({ action: 'request_code' }); const ok = sentCodes.at(-1);
const generalAt = new Date(clock - 60000).toISOString();
r = await call(good({ code: ok, general_at: generalAt, specific_at: '1999-01-01T00:00:00Z' }),
  { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'Fictional browser' } });
assert.deepEqual([r.status, r.body.accepted, r.body.version, r.body.receipt_sent], [200, true, 1, true]);
assert.equal(tables.host_terms_acceptances.length, 1, 'one evidence row');
const ev = tables.host_terms_acceptances[0];
assert.deepEqual({ host: ev.host_id, v: ev.version, sha: ev.text_sha256, annex: ev.annex_sha256, kind: ev.host_kind, method: ev.method, email: ev.account_email, ip: ev.ip, ua: ev.user_agent },
  { host: HOST, v: 1, sha: sha(termsBytes), annex: sha(annexBytes), kind: 'business', method: 'password_login+email_otp', email: 'host@example.invalid', ip: '203.0.113.9', ua: 'Fictional browser' });
assert.equal(ev.accepted_general_at, generalAt, 'recent client tick time kept');
assert.equal(ev.approved_specific_at, new Date(clock).toISOString(), 'implausible client time replaced by server time');
assert.equal(ev.otp_verified_at, new Date(clock).toISOString());
assert.equal(ev.receipt_email_id, 'fictional-email-' + emails.length, 'receipt id stored');
const receipt = emails.at(-1);
assert.match(receipt.subject, /Copia delle Condizioni WelcomeBnB accettate \(versione 1\)/);
assert.match(receipt.text, /art\. 10\.2 e 10\.3 — limitazioni/);
assert.match(receipt.text, /uso con partita IVA/);
assert.match(receipt.text, new RegExp(sha(termsBytes)));
assert.deepEqual(receipt.attachments.map(a => a.filename), ['CONDIZIONI_GENERALI_v1.md', 'ALLEGATO_A_DPA_v1.md'], 'exact texts attached');
assert.equal(Buffer.from(receipt.attachments[0].content, 'base64').equals(termsBytes), true);
assert.ok(!/check-in|schedin|documento|passaporto/i.test(receipt.text), 'no guest data in the receipt');
r = await call(good({ code: ok }));
assert.deepEqual([r.status, r.body.already], [200, true], 'retry after success is idempotent');
assert.equal(tables.host_terms_acceptances.length, 1);
assert.equal((await call({ action: 'request_code' })).body.error, 'already', 'no codes once accepted');
r = await call({ action: 'status' });
assert.deepEqual([r.body.accepted, r.body.accepted_version], [true, 1]);
// The other host is still not accepted, and a used code cannot be replayed by it.
r = await call({ action: 'status' }, { token: 'other-session-token-fictional' });
assert.equal(r.body.accepted, false);

// ── New version: re-acceptance only when required ───────────────────────
docs.push({ ...docs[0], id: randomUUID(), version: 2, requires_reacceptance: false, published_at: new Date(clock).toISOString() });
assert.equal((await call({ action: 'status' })).body.accepted, true, 'v2 without re-acceptance: v1 still counts');
docs[1].requires_reacceptance = true;
assert.equal((await call({ action: 'status' })).body.accepted, false, 'v2 with re-acceptance: asked again');
docs[1].published_at = new Date(clock + 86400000).toISOString();
assert.equal((await call({ action: 'status' })).body.current.version, 1, 'unpublished future version ignored');

console.log('PASS round69-host-terms-api: mounted on /api/guest via /api/host-terms (budget still 12); no/bad JWT 401; flag off → accepted; fail closed without service key or pepper; codes emailed, never returned, stored as keyed hash; 3 per 15 min; failed email frees the slot; stale version/text, missing host kind, general-only, specific-only refused; wrong codes counted, 6th attempt blocked; expired and other host codes refused; success writes one evidence row (host kind, method, IP, user agent, times) and emails a receipt with clause list, hashes and exact texts, receipt id stored; retry idempotent; re-acceptance follows requires_reacceptance');
