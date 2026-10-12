#!/usr/bin/env node
// Round 50 Phase 5 — in-process Alloggiati simulation test.
//
// Boots `api/alloggiati.js` under APP_ENV=demo with `fetch` monkey-
// patched to throw. The handler must return the three documented
// FACSIMILE stages without issuing a single network call. Any
// accidental SOAP import would also throw (lib/_alloggiati-soap.js
// uses fetch internally). This complements the static regex sweep
// in scripts/demo-ux.test.mjs.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.APP_ENV = 'demo';
process.env.DEMO_SUPABASE_PROJECT_REF = 'wmegnnlmcrabndyzywmj';
process.env.SUPABASE_URL = 'https://wmegnnlmcrabndyzywmj.supabase.co';
process.env.SUPABASE_ANON_KEY = 'sb_publishable_nurPgCGPzRI-0beU3iUZHg_Wb1plxMy';
process.env.APP_BASE_URL = 'https://demo.welcomebnb.it';
process.env.HOST_CONSOLE_URL = 'https://demo.welcomebnb.it/host-console.html';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_' + 'x'.repeat(40);
process.env.GUEST_TOKEN_SECRET = createHmac('sha256', 'demo-fixture-only')
  .update('phase5-sim-test').digest('base64url');

let networkCalls = 0;
globalThis.fetch = async () => {
  networkCalls++;
  throw new Error('Unexpected network call during demo simulation');
};

const makeRes = () => ({
  statusCode: 200,
  status(s) { this.statusCode = s; return this; },
  json(v) { this.body = v; return this; },
  setHeader() {}, end() { return this; },
});
const makeReq = (body) => ({
  method: 'POST',
  headers: { origin: 'https://demo.welcomebnb.it' },
  query: { action: 'demo_simulate_filing' },
  body,
});

const { default: handler } = await import('../api/alloggiati.js');

for (const stage of ['validate', 'send', 'receipt']) {
  const res = makeRes();
  await handler(makeReq({ stage, booking_code: 'DEMO-SOGGIORNO' }), res);
  assert.equal(res.statusCode, 200, `${stage}: status 200`);
  assert.equal(res.body.ok, true, `${stage}: ok:true`);
  assert.equal(res.body.demo, true, `${stage}: demo:true`);
  assert.equal(res.body.facsimile, true, `${stage}: facsimile:true`);
  assert.equal(res.body.stage, stage);
  assert.ok(res.body.disclaimer, `${stage}: disclaimer present`);
  assert.match(res.body.disclaimer, /SOAP|FACSIMILE|simul/i, `${stage}: disclaimer mentions sim/SOAP/FACSIMILE`);
  console.log(`PASS stage=${stage} returns FACSIMILE payload`);
}

// Content checks per stage.
const validate = makeRes();
await handler(makeReq({ stage: 'validate' }), validate);
assert.ok(Array.isArray(validate.body.per_row) && validate.body.per_row[0].errors?.length >= 1,
         'validate: at least one correctable error');

const send = makeRes();
await handler(makeReq({ stage: 'send', booking_code: 'DEMO-CONFORMITA' }), send);
assert.ok(send.body.receipt_path?.startsWith('receipts/demo/'),
         'send: receipt path is in receipts/demo/');
assert.match(send.body.receipt_path, /DEMO-CONFORMITA/, 'send: receipt tagged by booking');

const receipt = makeRes();
await handler(makeReq({ stage: 'receipt' }), receipt);
assert.ok(receipt.body.receipt_body?.righe?.[0]?.cognome === 'FACSIMILE',
         'receipt: righe contains the FACSIMILE guest');
console.log('PASS per-stage content: correctable error, receipt path, righe[]');

// Unknown stage → 400.
const bad = makeRes();
await handler(makeReq({ stage: 'bogus' }), bad);
assert.equal(bad.statusCode, 400);
assert.equal(bad.body.error, 'Unknown demo_simulate_filing stage');
console.log('PASS unknown stage returns 400');

// `send` action (non-sim) must still return the demo integration denial.
const nonSim = makeRes();
await handler({ ...makeReq({}), query: { action: 'send' } }, nonSim);
assert.equal(nonSim.statusCode, 403);
assert.equal(nonSim.body.code, 'demo_integration_disabled');
console.log('PASS non-sim actions still demo_integration_disabled');

assert.equal(networkCalls, 0, `expected zero network calls, got ${networkCalls}`);
console.log('PASS zero network calls across every simulation path');
console.log('PASS Phase 5 Alloggiati sim: all in-process checks');
