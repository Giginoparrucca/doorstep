// Round 60a Phase 2 — document scanning handler (api/scan-document.js).
//
// Covers the request/response gates that run BEFORE and AFTER the
// Anthropic call so none of them hit the real API:
//
//   - method / origin / token (401, 403, 405)
//   - missing or oversize document (400, 413)
//   - propertyId derives from the token, not the request body
//   - successful parse round-trip: Anthropic JSON reply is passed
//     through as `data`
//   - date_of_birth validation: a future DOB is NULLed and a
//     'date_of_birth_invalid' warning is attached
//   - unparseable Anthropic reply → 422
//   - Anthropic error → 500 with its message
//
// All transport is mocked (global.fetch). No live Anthropic, no live
// Supabase.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET
  || createHash('sha256').update('round60a-fixture-secret-scan-document').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-fixture-key';

const { signGuestToken } = await import('../api/_guest-token.js');

const propA = '11111111-1111-4111-8111-111111111111';
const propB = '22222222-2222-4222-8222-222222222222';
const session = 'sess-scan-fixture';
const { token: tokenA } = signGuestToken({
  p: propA, s: session, exp: Math.floor(Date.now() / 1000) + 3600,
});

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(x) { this.body = x; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
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

// Anthropic reply shape — the handler expects data.content[0].text to
// hold a JSON blob. We let the test drive what the "model" returns.
let nextAnthropicReply = null;
let nextAnthropicError = null;
const fetchCalls = [];
global.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url: String(url), method: opts.method, body: opts.body });
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    if (nextAnthropicError) return json({ error: { message: nextAnthropicError } });
    return json({
      content: [{ type: 'text', text: JSON.stringify(nextAnthropicReply) }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });
  }
  // api_usage insert + rate-limit check — any Supabase REST → empty list OK.
  return json([]);
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
  });
}

const { default: handler } = await import('../api/scan-document.js');

async function run(req) {
  const res = mockRes();
  fetchCalls.length = 0;
  await handler(req, res);
  return { res, calls: fetchCalls.slice() };
}

// Small valid PNG-ish base64 (shape matters, not pixels — we mock Anthropic).
const sampleB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// ── 1. Rejected origin → 403 ────────────────────────────────────────
{
  const { res } = await run(mockReq({ origin: 'https://evil.example.invalid', body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 403);
}

// ── 2. Wrong method → 405 ───────────────────────────────────────────
{
  const { res } = await run(mockReq({ method: 'GET' }));
  assert.equal(res.statusCode, 405);
}

// ── 3. Missing / invalid token → 401 ────────────────────────────────
{
  const { res } = await run(mockReq({ token: null, body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 401);
}
{
  const { res } = await run(mockReq({ token: 'invalid.garbage.token', body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 401);
}

// ── 4. Missing image_base64 → 400 ───────────────────────────────────
{
  const { res } = await run(mockReq({ body: {} }));
  assert.equal(res.statusCode, 400);
}

// ── 5. Oversize body → 413 (before Anthropic is called) ─────────────
{
  const big = 'A'.repeat(14_000_001);
  const { res, calls } = await run(mockReq({ body: { image_base64: big } }));
  assert.equal(res.statusCode, 413);
  assert.ok(res.body.max_base64_length, 'response names the cap for client UX');
  assert.ok(!calls.some(c => c.url.includes('api.anthropic.com')),
    'Anthropic must never be called for an oversize body');
}

// ── 6. Successful scan round-trip ──────────────────────────────────
{
  nextAnthropicReply = {
    surname: 'ROSSI', name: 'MARIO', sex: 'M',
    date_of_birth: '1980-01-15',
    place_of_birth: 'ROMA', birth_province: 'RM',
    birth_country: 'Italy', citizenship: 'Italy',
    document_type: 'passport', document_number: 'AA1234567',
    expiry_date: '2030-01-01', issuing_country: 'Italy',
    confidence: 'high',
  };
  nextAnthropicError = null;
  const { res, calls } = await run(mockReq({ body: { image_base64: sampleB64, media_type: 'image/png' } }));
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.surname, 'ROSSI');
  assert.equal(res.body.data.date_of_birth, '1980-01-15',
    'past DOB passes validation unchanged');
  assert.deepEqual(res.body.warnings, [], 'no warnings for a well-formed reply');
  // Anthropic was called once with the sample image.
  const call = calls.find(c => c.url.includes('api.anthropic.com'));
  assert.ok(call, 'Anthropic was invoked');
  const payload = JSON.parse(call.body);
  assert.equal(payload.model, 'claude-sonnet-4-5');
  assert.equal(payload.messages[0].content[0].type, 'image');
  assert.equal(payload.messages[0].content[0].source.data, sampleB64,
    'image_base64 flows unchanged to Anthropic (and nowhere else)');
}

// ── 7. PDF path → document block, not image ────────────────────────
{
  nextAnthropicReply = { surname: 'X', name: 'Y', sex: 'M', date_of_birth: '1980-01-01',
    place_of_birth: '', birth_country: '', birth_province: '', citizenship: '',
    document_type: 'passport', document_number: '', expiry_date: '', issuing_country: '',
    confidence: 'low' };
  const { calls } = await run(mockReq({ body: { image_base64: sampleB64, is_pdf: true } }));
  const call = calls.find(c => c.url.includes('api.anthropic.com'));
  const payload = JSON.parse(call.body);
  assert.equal(payload.messages[0].content[0].type, 'document');
  assert.equal(payload.messages[0].content[0].source.media_type, 'application/pdf');
}

// ── 8. Future DOB → NULLed and warning attached ─────────────────────
{
  nextAnthropicReply = {
    surname: 'TEST', name: 'FUTURE', sex: 'M',
    date_of_birth: '2099-01-01',       // future
    place_of_birth: 'ROMA', birth_province: 'RM',
    birth_country: 'Italy', citizenship: 'Italy',
    document_type: 'passport', document_number: 'FUT1',
    expiry_date: '2099-12-31', issuing_country: 'Italy',
    confidence: 'high',
  };
  const { res } = await run(mockReq({ body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.date_of_birth, null, 'future DOB → null');
  assert.deepEqual(res.body.warnings, ['date_of_birth_invalid']);
}

// ── 9. Unparseable Anthropic reply → 422 ───────────────────────────
{
  nextAnthropicReply = null;  // Will be null-stringified to "null"
  // Override the fetch to return something that isn't JSON at all.
  const prev = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'not json at all' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return json([]);
  };
  const { res } = await run(mockReq({ body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.raw, 'not json at all');
  global.fetch = prev;
}

// ── 10. Anthropic returns an error → 500 with its message ─────────
{
  nextAnthropicError = 'rate_limit_error: too many requests';
  const { res } = await run(mockReq({ body: { image_base64: sampleB64 } }));
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /rate_limit_error/);
  nextAnthropicError = null;
}

// ── 11. Token-derived propertyId, not body ────────────────────────
// Any body-provided property_id is ignored — identity flows from the
// signed token (same contract as api/chat.js and api/guest.js).
{
  nextAnthropicReply = { surname: 'X', name: 'Y', sex: 'M', date_of_birth: '1980-01-01',
    place_of_birth: '', birth_country: '', birth_province: '', citizenship: '',
    document_type: 'passport', document_number: '', expiry_date: '', issuing_country: '',
    confidence: 'low' };
  const { res, calls } = await run(mockReq({
    body: { image_base64: sampleB64, property_id: propB },
  }));
  assert.equal(res.statusCode, 200);
  // api_usage INSERTs the token's propertyId. Any body property_id must not
  // appear in a REST path or payload directed at Supabase.
  for (const c of calls) {
    if (!c.url.includes('api.anthropic.com')) {
      assert.ok(!c.url.includes(propB) && !(c.body || '').includes(propB),
        `body property_id must never leak into Supabase traffic: ${c.url} / ${c.body}`);
    }
  }
}

console.log('PASS scan-document: method/origin/token/missing/oversize gates, image & PDF content blocks, happy-path reply round-trip, future-DOB null+warning, unparseable 422, Anthropic error 500, token-driven propertyId.');
