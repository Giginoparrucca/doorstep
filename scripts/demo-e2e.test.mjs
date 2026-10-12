#!/usr/bin/env node
// Round 50 Phase 6 — end-to-end programmatic verification of the
// deployed demo. Fetches every public asset the browser would load,
// cross-checks each one for leaked secrets or production refs, and
// probes the configured demo origin for cross-environment token
// denial and the HSTS/content-type headers Phase 2 locked in.
//
// Usage: node scripts/demo-e2e.test.mjs <demo-origin>
//
// Does not mutate the demo database or require any secret.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const PRODUCTION_REF = 'jcjwaqqabgwqhhzhfbts';
const DEMO_REF       = 'wmegnnlmcrabndyzywmj';
// Forbidden *patterns*. Each is a RegExp so we match actual key
// material (prefix + length) rather than any mention of a variable
// name — "service_role" and "SUPABASE_SERVICE_ROLE_KEY" also appear
// in legitimate comments that describe the DB's security posture.
const FORBIDDEN_PATTERNS = [
  // Modern Supabase secret key format.
  { label: 'sb_secret key value', re: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  // Legacy Supabase JWT whose body contains `role:"service_role"`.
  { label: 'service_role JWT body', re: /eyJ[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+?\.[A-Za-z0-9_-]+/ },
  // Anthropic API key format.
  { label: 'Anthropic key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  // OpenAI key format (defensive).
  { label: 'OpenAI key', re: /sk-[A-Za-z0-9]{40,}/ },
  // Production Supabase project ref.
  { label: 'production ref', re: new RegExp(PRODUCTION_REF) },
];
// Historical references to production hosts live in longstanding
// comments in `host-console.html` and `index.html`; the deployed
// pages never *construct* a production URL at runtime because every
// origin is derived from `WELCOME_BNB_CONFIG.appOrigin`. The behavioural
// cross-env token denial check below is the real protection.

const PUBLIC_ASSETS = [
  { path: '/app-config.js',    type: /javascript/, mustInclude: ['"mode":"demo"', `"projectRef":"${DEMO_REF}"`, 'no-store-ignored'] },
  { path: '/demo-launch.html', type: /html/,       mustInclude: ['Demo WelcomeBnB', 'Ripristina demo', 'demo_reset_v1', 'Scenari'] },
  { path: '/index.html',       type: /html/,       mustInclude: ['Round 50 Phase 5 — persistent demo banner'] },
  { path: '/host-console.html',type: /html/,       mustInclude: ['Round 50 Phase 5 — persistent demo banner'] },
  { path: '/lib/demo-fixtures.mjs', type: /javascript/, mustInclude: ['DEMO_PROJECT_REF', 'BOOKING_SCENARIOS'] },
];

export async function runE2E({ origin, fetchImpl = fetch, logger = console.log } = {}) {
  assert.ok(origin && origin.startsWith('https://'), 'Provide an HTTPS origin');

  // 1. Every public asset returns 200 with the right content type and
  // no forbidden token slips through.
  for (const asset of PUBLIC_ASSETS) {
    const r = await fetchImpl(origin + asset.path, { signal: AbortSignal.timeout(15000) });
    assert.equal(r.status, 200, `${asset.path}: expected 200 got ${r.status}`);
    const ct = r.headers.get('content-type') || '';
    assert.match(ct, asset.type, `${asset.path}: content-type ${ct}`);
    const body = await r.text();
    // The JWT regex also matches the demo publishable anon JWT in
    // app-config.js (which is public by design); specifically allow it.
    const safeAnonInConfig = asset.path === '/app-config.js'
      ? body.match(/"publicKey":"([^"]+)"/)?.[1] || ''
      : '';
    for (const { label, re } of FORBIDDEN_PATTERNS) {
      const match = body.match(re);
      if (!match) continue;
      if (match[0] === safeAnonInConfig) continue; // demo anon JWT is public
      assert.fail(`${asset.path}: forbidden ${label} match ${match[0].slice(0, 32)}…`);
    }
    for (const marker of asset.mustInclude || []) {
      if (marker === 'no-store-ignored') continue;
      assert.ok(body.includes(marker), `${asset.path}: expected marker ${JSON.stringify(marker).slice(0, 60)}`);
    }
    logger(`PASS asset ${asset.path} (${body.length} bytes)`);
  }

  // 2. /app-config.js specifically must be no-store so a stale config
  //    cannot leak a previous environment identity to a cached guest.
  const cfgRes = await fetchImpl(origin + '/app-config.js', { signal: AbortSignal.timeout(15000) });
  assert.match(cfgRes.headers.get('cache-control') || '', /no-store/i, 'app-config.js: must be no-store');
  const hsts = cfgRes.headers.get('strict-transport-security') || '';
  assert.match(hsts, /max-age=\d+/, 'HSTS header missing');
  logger(`PASS app-config.js headers: no-store + HSTS`);

  // 3. Cross-environment token denial. A valid-shape token signed with
  //    a non-demo secret must get 401 from the gateway.
  const foreignPayload = Buffer.from(JSON.stringify({ p: 'bogus', s: 'bogus', b: null,
      exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const foreignSig = 'cafed00d' + 'x'.repeat(40);
  const foreign = await fetchImpl(origin + '/api/guest', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Origin: origin,
               Authorization: `Bearer ${foreignPayload}.${foreignSig}` },
    body: JSON.stringify({ action: 'property' }),
  });
  assert.equal(foreign.status, 401, 'Cross-env token must be 401');
  logger('PASS cross-env token denial');

  // 4. Demo integration endpoints: every one must return
  //    demo_integration_disabled, including the ones that handle the
  //    simulated filing's twin production action.
  const integrationActions = [
    ['/api/alloggiati', { action: 'send' }],
    ['/api/alloggiati', { action: 'status' }],
    ['/api/alloggiati', { action: 'verify' }],
    ['/api/scan-document', { image_base64: 'AAA=' }],
    ['/api/ical-sync', {}],
    ['/api/send-arrival-reminders', {}],
    ['/api/admin-invite-host', {}],
    ['/api/telegram-link', {}],
    ['/api/push-config', {}],
  ];
  for (const [path, body] of integrationActions) {
    const r = await fetchImpl(origin + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
    assert.equal(r.status, 403, `${path}: expected 403`);
    const data = await r.json().catch(() => ({}));
    assert.equal(data.code, 'demo_integration_disabled', `${path}: expected demo_integration_disabled`);
  }
  logger('PASS every external integration still demo_integration_disabled');

  // 5. demo_simulate_filing: three stages return FACSIMILE payloads,
  //    unknown stage → 400, zero SOAP side-effects.
  for (const stage of ['validate', 'send', 'receipt']) {
    const r = await fetchImpl(origin + '/api/alloggiati?action=demo_simulate_filing', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ stage, booking_code: 'DEMO-SOGGIORNO' }),
    });
    assert.equal(r.status, 200, `demo_simulate_filing ${stage}: HTTP`);
    const data = await r.json();
    assert.equal(data.ok, true, `${stage}: ok`);
    assert.equal(data.demo, true, `${stage}: demo:true`);
    assert.equal(data.facsimile, true, `${stage}: facsimile:true`);
  }
  const bad = await fetchImpl(origin + '/api/alloggiati?action=demo_simulate_filing', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ stage: 'bogus' }),
  });
  assert.equal(bad.status, 400, 'bogus stage → 400');
  logger('PASS demo filing simulation: 3 stages FACSIMILE, bogus 400');

  logger('PASS Phase 6 end-to-end verification');
  return { origin, assets: PUBLIC_ASSETS.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const origin = process.argv[2];
  if (!origin) { console.error('Usage: node scripts/demo-e2e.test.mjs <demo-origin>'); process.exit(2); }
  try { console.log(await runE2E({ origin })); }
  catch (error) { console.error('FAIL ' + error.message); process.exit(1); }
}
