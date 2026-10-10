#!/usr/bin/env node
// Partial hosted configuration/guest-gateway smoke test, not the full Phase 2 gate.
// Auth, private storage, cross-owner access and clean rebuild need separate evidence.
// Run with a disposable Phase 2 property: DEMO_SMOKE_PROPERTY_ID=<uuid> node scripts/demo-live-smoke.mjs <demo-origin>
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const DEMO_REF = 'wmegnnlmcrabndyzywmj';
export function validateTarget(origin) {
  const u = new URL(origin);
  assert.equal(u.origin, origin, 'Use an exact origin without paths or credentials');
  assert.equal(u.protocol, 'https:');
  assert.ok(u.hostname === 'demo.welcomebnb.it' || /^welcomebnb-demo(?:-[a-z0-9-]+)?\.vercel\.app$/.test(u.hostname), 'Only the dedicated demo hostname is allowed');
}
export function validateConfig(body, origin, cacheControl) {
  const match = body.match(/window\.WELCOME_BNB_CONFIG\s*=\s*Object\.freeze\((\{[^]*\})\);/);
  assert.ok(match, 'Expected generated JSON configuration');
  const cfg = JSON.parse(match[1]); // Never execute downloaded JavaScript.
  assert.equal(cfg.mode, 'demo');
  assert.equal(cfg.projectRef, DEMO_REF);
  assert.equal(cfg.supabaseUrl, `https://${DEMO_REF}.supabase.co`);
  assert.ok(cfg.allowedOrigins?.includes(origin));
  assert.match(cacheControl || '', /no-store/i);
  assert.ok(!body.includes('sb_secret_') && !body.includes('service_role'), 'Server credential exposed');
  assert.ok(!body.includes('jcjwaqqabgwqhhzhfbts'), 'Production ref exposed');
  return cfg;
}
export async function runSmoke({ origin, propertyId, fetchImpl = fetch, report = console.log }) {
  validateTarget(origin); // Before any network request.
  const request = async (path, body, token) => {
    const response = await fetchImpl(origin + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const cfgResponse = await fetchImpl(origin + '/app-config.js', { redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(cfgResponse.status, 200, 'Configuration unavailable');
  validateConfig(await cfgResponse.text(), origin, cfgResponse.headers.get('cache-control'));
  report('PASS generated configuration: demo identity and no-store');
  // All mutating probes occur only after the dedicated origin AND demo config pass.
  for (const [path, body] of [
    ['/api/alloggiati', { action: 'status' }], ['/api/alloggiati', { action: 'send' }],
    ['/api/admin-invite-host', {}], ['/api/telegram-link', {}], ['/api/push-config', {}],
    ['/api/scan-document', { image_base64: 'AAA=' }], ['/api/ical-sync', {}], ['/api/send-arrival-reminders', {}],
  ]) {
    const r = await request(path, body);
    assert.equal(r.status, 403, `${path}: expected explicit demo denial`);
    assert.equal(r.body.code, 'demo_integration_disabled', `${path}: missing demo guard`);
  }
  report('PASS explicit demo integration denial responses');
  const absent = await request('/api/guest', { action: 'property' });
  assert.equal(absent.status, 401);
  assert.equal(absent.body.error, 'Invalid or missing guest token');
  assert.match(propertyId || '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i, 'Set DEMO_SMOKE_PROPERTY_ID to an existing disposable demo property; token mint success is mandatory');
  const mint = await request('/api/guest-token', { property_id: propertyId, session_id: 'phase2-smoke-' + Date.now() });
  assert.equal(mint.status, 200, 'Token mint must succeed, not merely reach the handler');
  assert.ok(typeof mint.body.token === 'string' && mint.body.token.length > 30);
  const property = await request('/api/guest', { action: 'property' }, mint.body.token);
  assert.equal(property.status, 200, 'Minted token must reach the demo gateway');
  const invalid = await request('/api/guest', { action: 'property' }, 'invalid.token');
  assert.equal(invalid.status, 401);
  report('PASS real token mint, gateway access and invalid-token denial');
  report('Partial hosted smoke passed. Full Phase 2 Auth/Storage/ownership/rebuild gates are still required.');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runSmoke({ origin: process.argv[2], propertyId: process.env.DEMO_SMOKE_PROPERTY_ID }); }
  catch (error) { console.error('FAIL ' + error.message); process.exitCode = 1; }
}
