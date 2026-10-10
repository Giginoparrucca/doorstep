import assert from 'node:assert/strict';
import { runSmoke, validateTarget, validateConfig } from './demo-live-smoke.mjs';
const origin = 'https://demo.welcomebnb.it';
const config = { mode: 'demo', projectRef: 'wmegnnlmcrabndyzywmj', supabaseUrl: 'https://wmegnnlmcrabndyzywmj.supabase.co', allowedOrigins: [origin], publicKey: 'sb_publishable_example' };
const js = cfg => `window.WELCOME_BNB_CONFIG = Object.freeze(${JSON.stringify(cfg)});`;
for (const target of ['https://app.welcomebnb.it', 'https://welcomebnb.vercel.app', origin + '/path', 'http://demo.welcomebnb.it']) assert.throws(() => validateTarget(target));
assert.throws(() => validateConfig(js({ ...config, mode: 'production' }), origin, 'no-store'));
assert.throws(() => validateConfig(js(config), origin, null));
let calls = [];
const propertyId = '11111111-1111-4111-8111-111111111111';
function transport({ cfg = config, guardStatus = 403, guardCode = 'demo_integration_disabled', mintStatus = 200 } = {}) {
  return async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET' });
    if (url.endsWith('/app-config.js')) return new Response(js(cfg), { status: 200, headers: { 'cache-control': 'no-store' } });
    if (url.endsWith('/api/guest-token')) return Response.json({ token: 't'.repeat(40) }, { status: mintStatus });
    if (url.endsWith('/api/guest')) {
      const bearer = options.headers.Authorization;
      return bearer === 'Bearer ' + 't'.repeat(40) ? Response.json({ property: {} }) : Response.json({ error: 'Invalid or missing guest token' }, { status: 401 });
    }
    return Response.json({ code: guardCode }, { status: guardStatus });
  };
}
await assert.rejects(runSmoke({ origin: 'https://app.welcomebnb.it', fetchImpl: transport(), report() {} }));
assert.equal(calls.length, 0, 'Production target must trigger no network calls');
await assert.rejects(runSmoke({ origin, propertyId, fetchImpl: transport({ cfg: { ...config, mode: 'production' } }), report() {} }));
assert.equal(calls.length, 1, 'Wrong environment must trigger no POSTs');
for (const params of [{ guardStatus: 404 }, { guardStatus: 503 }, { guardCode: 'unrelated_error' }, { mintStatus: 404 }]) {
  await assert.rejects(runSmoke({ origin, propertyId, fetchImpl: transport(params), report() {} }));
}
await assert.rejects(runSmoke({ origin, fetchImpl: transport(), report() {} }), /DEMO_SMOKE_PROPERTY_ID/);
await runSmoke({ origin, propertyId, fetchImpl: transport(), report() {} });
console.log('PASS smoke harness: unsafe targets never mutate; unrelated errors and failed mint cannot pass.');
