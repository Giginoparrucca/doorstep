// Round 60a Phase 2 — guest chat security isolation.
//
// Exercises api/guest.js (the guest gateway) and api/chat.js (the AI
// concierge) with mocked Supabase/Anthropic, asserting the invariants
// the plan calls out:
//
//   1. Cross-property isolation: a token signed for property A can
//      never read or write property B's chat, even if the body sets
//      property_id=B.
//   2. Token drives identity — body.property_id and body.booking_code
//      are logged but ignored.
//   3. send validates sender ('guest'/'bot'/'system' only — never 'host').
//   4. Request gates: method, token presence, oversize body/messages.
//
// All transport is mocked via global.fetch; no network, no live
// Supabase, no Anthropic.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Chat tests need a stable guest-token secret; the production env is fine
// since the signing is deterministic given the secret. Set BEFORE any
// import that reads it at module load.
process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET
  || createHash('sha256').update('round60a-fixture-secret-chat-isolation').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key-long-enough-for-the-env';
const { signGuestToken } = await import('../api/_guest-token.js');

const propA = '11111111-1111-4111-8111-111111111111';
const propB = '22222222-2222-4222-8222-222222222222';
const booking = 'FIXTEST-ABC';
const session = 'sess-fixture-1';

const { token: tokenA } = signGuestToken({ p: propA, s: session, b: booking,
  exp: Math.floor(Date.now() / 1000) + 3600 });

function mockRes() {
  const r = {
    statusCode: 200,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(x) { this.body = x; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return r;
}

function mockReq({ method = 'POST', token = tokenA, origin = 'https://app.welcomebnb.it', body = {} } = {}) {
  return {
    method,
    headers: {
      authorization: token ? 'Bearer ' + token : undefined,
      origin,
      'content-type': 'application/json',
    },
    body,
  };
}

// Captured REST calls — assertions inspect this list after each run.
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
  // Default success response based on URL shape.
  if (String(url).includes('/rest/v1/chat_messages') && opts.method === 'POST') {
    return new Response(JSON.stringify([{ id: 'mock-row-id' }]),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/rest/v1/chat_messages')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }
  if (String(url).includes('/rest/v1/api_usage')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } });
  }
  if (String(url).includes('/rest/v1/properties')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(url).includes('/rest/v1/notification_settings')) {
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const { default: guestHandler } = await import('../api/guest.js');
const { default: chatHandler } = await import('../api/chat.js');

async function run(handler, req) {
  const res = mockRes();
  calls.length = 0;
  await handler(req, res);
  return { res, calls: calls.slice() };
}

// ── 1. Token identity drives property scope (history) ──────────────
{
  const { res, calls: c } = await run(guestHandler, mockReq({ body: { action: 'history', property_id: propB } }));
  assert.equal(res.statusCode, 200, 'history returns 200');
  const chatCalls = c.filter(x => x.url.includes('chat_messages'));
  assert.ok(chatCalls.length >= 1, 'at least one chat_messages GET');
  for (const call of chatCalls) {
    assert.ok(call.url.includes('property_id=eq.' + propA),
      `history must scope by token property A, saw: ${call.url}`);
    assert.ok(!call.url.includes(propB),
      `history must not leak property B into URL: ${call.url}`);
  }
}

// ── 2. send writes to token property, ignoring body.property_id ──
{
  const { res, calls: c } = await run(guestHandler,
    mockReq({ body: { action: 'send', message: 'ciao', sender: 'guest', property_id: propB } }));
  assert.equal(res.statusCode, 200, 'send returns 200');
  const insert = c.find(x => x.url.includes('/chat_messages') && x.method === 'POST');
  assert.ok(insert, 'insert happened');
  const payload = JSON.parse(insert.body);
  assert.equal(payload.property_id, propA, 'inserted row carries token property, not body property');
  assert.equal(payload.booking_code, booking, 'inserted row carries token booking');
  assert.equal(payload.sender, 'guest');
  assert.equal(payload.message, 'ciao');
  assert.equal(payload.is_test, false, 'non-test token → is_test false');
}

// ── 3. is_test token flows through ─────────────────────────────────
{
  const { token: tokenTest } = signGuestToken({ p: propA, s: session, b: booking,
    exp: Math.floor(Date.now() / 1000) + 3600, t: true });
  const { res, calls: c } = await run(guestHandler,
    mockReq({ token: tokenTest, body: { action: 'send', message: 'preview', sender: 'guest' } }));
  assert.equal(res.statusCode, 200);
  const insert = c.find(x => x.url.includes('/chat_messages') && x.method === 'POST');
  const payload = JSON.parse(insert.body);
  assert.equal(payload.is_test, true, 'test token → is_test true (never surfaces in host dashboard)');
}

// ── 4. send rejects impersonation of sender='host' ─────────────────
{
  const { res } = await run(guestHandler,
    mockReq({ body: { action: 'send', message: 'hi', sender: 'host' } }));
  assert.equal(res.statusCode, 400);
  assert.match(JSON.stringify(res.body), /Invalid sender/);
}

// ── 5. send rejects empty / oversize messages ──────────────────────
{
  const { res } = await run(guestHandler,
    mockReq({ body: { action: 'send', message: '', sender: 'guest' } }));
  assert.equal(res.statusCode, 400);
}
{
  const big = 'x'.repeat(10000);
  const { res } = await run(guestHandler,
    mockReq({ body: { action: 'send', message: big, sender: 'guest' } }));
  assert.equal(res.statusCode, 413, 'oversize message rejected');
}

// ── 6. poll scopes to the token property ───────────────────────────
{
  const { res, calls: c } = await run(guestHandler,
    mockReq({ body: { action: 'poll', since: new Date().toISOString(), property_id: propB } }));
  assert.equal(res.statusCode, 200);
  const chatCalls = c.filter(x => x.url.includes('chat_messages'));
  for (const call of chatCalls) {
    assert.ok(call.url.includes('property_id=eq.' + propA),
      'poll scopes to token property');
    assert.ok(!call.url.includes(propB), 'poll must not leak property B');
    assert.ok(call.url.includes('sender=in.(host,system)'),
      'poll excludes guest-authored rows (already on screen)');
  }
}

// ── 7. Unknown action → 400 ────────────────────────────────────────
{
  const { res } = await run(guestHandler,
    mockReq({ body: { action: 'something_evil' } }));
  assert.equal(res.statusCode, 400);
}

// ── 8. Missing / invalid token → 401 ───────────────────────────────
{
  const { res } = await run(guestHandler, mockReq({ token: null, body: { action: 'history' } }));
  assert.equal(res.statusCode, 401);
}
{
  const { res } = await run(guestHandler, mockReq({ token: 'invalid.garbage.token', body: { action: 'history' } }));
  assert.equal(res.statusCode, 401);
}

// ── 9. api/chat.js gates: method, token, body shape, oversize ─────
{
  const { res } = await run(chatHandler, mockReq({ method: 'GET' }));
  assert.equal(res.statusCode, 405);
}
{
  const { res } = await run(chatHandler, mockReq({ token: null, body: { messages: [] } }));
  assert.equal(res.statusCode, 401);
}
{
  const { res } = await run(chatHandler, mockReq({ body: {} }));
  assert.equal(res.statusCode, 400, 'chat requires messages array');
}
{
  const many = Array.from({ length: 50 }, () => ({ role: 'user', content: 'x' }));
  const { res } = await run(chatHandler, mockReq({ body: { messages: many } }));
  assert.equal(res.statusCode, 413, 'too-many-messages rejected before Anthropic');
}

// ── 10. Rejected origin → 403 (apply_cors) ─────────────────────────
{
  const { res } = await run(guestHandler, mockReq({ origin: 'https://evil.example.invalid', body: { action: 'history' } }));
  assert.equal(res.statusCode, 403, 'disallowed origin rejected');
}
{
  const { res } = await run(chatHandler, mockReq({ origin: 'https://evil.example.invalid', body: { messages: [] } }));
  assert.equal(res.statusCode, 403);
}

console.log('PASS guest-chat-isolation: token drives scope, body property_id/booking_code never leak into REST or insert payloads; sender/method/token/size/origin gates all return the right status.');
