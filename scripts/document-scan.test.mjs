import assert from 'node:assert/strict';
import { fixtureEnvironment, call, json, mockNetwork } from './helpers/offline.mjs';

fixtureEnvironment();
const { signGuestToken } = await import('../api/_guest-token.js');
const handler = (await import('../api/scan-document.js')).default;
const token = signGuestToken({ p: 'property-a', s: 'session-a' }).token;
let daily = 0, hourly = 0, spent = 0, providerText, providerError = false, gateDown = false;
const net = mockNetwork(({ url, method, body }) => {
  if (url.hostname === 'api.anthropic.com') {
    assert.equal(method, 'POST');
    return json(providerError ? { error: { message: 'Fixture provider unavailable' } } : {
      content: [{ type: 'text', text: providerText }],
      usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 8 },
    });
  }
  if (url.pathname === '/rest/v1/properties') return json([{ ai_monthly_token_cap: 100 }]);
  if (url.pathname === '/rest/v1/api_usage') {
    if (method === 'POST') return json({});
    if (gateDown) return json({ error: 'Fixture database unavailable' }, 503);
    if (url.searchParams.get('select') === 'input_tokens,output_tokens') return json([{ input_tokens: spent }]);
    const count = url.searchParams.has('session_id') ? hourly : daily;
    return json([], 200, { 'content-range': '0-0/' + count });
  }
});
const scan = body => call(handler, body, { token });
const payload = { image_base64: 'ZmljdGlvbmFs', media_type: 'image/jpeg' };
try {
  assert.equal((await call(handler, payload)).code, 401);
  assert.equal((await call(handler, payload, { token, headers: { origin: 'https://untrusted.invalid' } })).code, 403);
  assert.equal((await call(handler, payload, { token, method: 'GET' })).code, 405);
  assert.equal((await scan({})).code, 400);
  assert.equal((await scan({ image_base64: {} })).code, 413);
  assert.equal((await scan({ image_base64: 'x'.repeat(14_000_001) })).code, 413);
  assert.equal(net.calls.length, 0, 'validation rejects before network');

  for (const [limit, value, status, reason, retry] of [
    ['daily', 60, 429, 'property_daily', '3600'],
    ['hourly', 15, 429, 'session_hourly', '900'],
    ['spent', 100, 402, 'monthly_budget', '86400'],
  ]) {
    daily = limit === 'daily' ? value : 0;
    hourly = limit === 'hourly' ? value : 0;
    spent = limit === 'spent' ? value : 0;
    const r = await scan(payload);
    assert.equal(r.code, status); assert.equal(r.body.reason, reason);
    assert.equal(r.headers['retry-after'], retry);
  }
  assert.ok(!net.calls.some(c => c.url.hostname === 'api.anthropic.com'), 'limited requests never reach provider');
  daily = 59; hourly = 14; spent = 99;
  providerText = '```json\n{"surname":"FICTIONAL","date_of_birth":"1990-01-01"}\n```';
  const r = await scan({ ...payload, property_id: 'property-b', session_id: 'session-b' });
  assert.equal(r.code, 200); assert.equal(r.body.data.surname, 'FICTIONAL'); assert.deepEqual(r.body.warnings, []);
  const upstream = net.calls.find(c => c.url.hostname === 'api.anthropic.com');
  assert.equal(upstream.body.messages[0].content[0].type, 'image');
  assert.equal(upstream.body.messages[0].content[0].source.data, payload.image_base64);
  assert.deepEqual(net.calls.filter(c => c.method === 'POST' && c.url.pathname.endsWith('/api_usage')).at(-1).body,
    { property_id: 'property-a', session_id: 'session-a', endpoint: 'scan', input_tokens: 15, output_tokens: 8 });

  for (const date of ['2999-01-01', '1990-02-30', 'not-a-date', null]) {
    providerText = JSON.stringify({ date_of_birth: date });
    const badDOB = await scan({ ...payload, is_pdf: true });
    assert.equal(badDOB.body.data.date_of_birth, null);
    assert.deepEqual(badDOB.body.warnings, ['date_of_birth_invalid']);
  }
  const pdf = net.calls.filter(c => c.url.hostname === 'api.anthropic.com').at(-1).body.messages[0].content[0];
  assert.equal(pdf.type, 'document'); assert.equal(pdf.source.media_type, 'application/pdf');
  providerText = 'not JSON'; assert.equal((await scan(payload)).code, 422);
  providerError = true; assert.equal((await scan(payload)).code, 500);
  providerError = false; gateDown = true; providerText = '{"date_of_birth":"1990-01-01"}';
  assert.equal((await scan(payload)).code, 200, 'documented fail-open on database outage');
  assert.ok(net.calls.every(c => !c.url.pathname.includes('/storage/')), 'OCR does not retain photos');
  console.log('PASS real scan handler: auth/size/image/PDF, three quota gates, token identity, DOB warnings, usage, provider/database failure');
} finally { net.restore(); }
