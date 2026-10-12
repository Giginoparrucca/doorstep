#!/usr/bin/env node
// Round 50 Phase 5 — static checks for the demo UX layer.
//
// Covers (in-process, no network):
//   1. The demo banner lives on both index.html and host-console.html,
//      is gated on `WELCOME_BNB_CONFIG.mode === 'demo'`, and carries
//      the Italian FACSIMILE copy.
//   2. demo-launch.html renders the ten scenarios, loads
//      `/lib/demo-fixtures.mjs` as an ES module, derives link origins
//      from `WELCOME_BNB_CONFIG.appOrigin` and exposes a Ripristina-demo
//      button that calls `supabase.rpc('demo_reset_v1', ...)`.
//   3. The Alloggiati demo simulation (`action: 'demo_simulate_filing'`)
//      lives behind `IS_DEMO`, uses no SOAP symbol, and returns the
//      three documented stages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('..' + p, import.meta.url), 'utf8');

// 1. Banner on both pages.
for (const page of ['/index.html', '/host-console.html']) {
  const src = read(page);
  const bannerBlock = src.match(/Round 50 Phase 5 — persistent demo banner[\s\S]*?insertBefore\(el, document\.body\.firstChild\)/);
  assert.ok(bannerBlock, `${page}: banner block missing`);
  assert.match(src, /cfg\.mode !== 'demo'/, `${page}: banner must early-return outside demo mode`);
  assert.match(src, /Demo WelcomeBnB · dati FACSIMILE/, `${page}: Italian banner copy missing`);
  assert.match(src, /document\.body\.classList\.add\('demo-r50-pad'\)/, `${page}: padding helper missing`);
  assert.match(src, /aria-label[^>]*Ambiente dimostrativo/i, `${page}: aria-label missing`);
}
console.log('PASS banner present on both pages, demo-gated and labelled');

// 2. Launch page.
const launch = read('/demo-launch.html');
assert.match(launch, /\bRipristina demo\b/, 'launch: reset button labelled');
assert.match(launch, /import \{[^}]*buildManifest[^}]*\} from '\/lib\/demo-fixtures\.mjs'/, 'launch: imports fixture manifest');
assert.match(launch, /cfg\.appOrigin/, 'launch: link origin derives from appOrigin');
assert.match(launch, /cfg\.mode !== 'demo'/, 'launch: refuses to render in non-demo mode');
assert.match(launch, /sb\.rpc\('demo_reset_v1'/, 'launch: calls demo_reset_v1 RPC');
assert.match(launch, /qrcode-generator@1\.4\.4/, 'launch: pinned QR library version');
assert.match(launch, /@supabase\/supabase-js@2\.47\.10/, 'launch: pinned Supabase client version');
assert.ok(!/\.jpg|\.png|real-receipt/i.test(launch), 'launch: no production imagery');
// Scenario list is rendered dynamically; verify the HTML carries the
// container row and the Italian "Scenari" heading.
assert.match(launch, /<tbody id="scenarios"><\/tbody>/, 'launch: scenario tbody present');
assert.match(launch, /<h2>Scenari<\/h2>/, 'launch: scenario section heading');
assert.match(launch, /Non inseriamo orari né recensioni inventate/, 'launch: honest recommendations caveat');
console.log('PASS demo-launch.html: scenarios, QR, reset button, demo-origin links');

// 3. Alloggiati simulation action.
const alloggiati = read('/api/alloggiati.js');
assert.match(alloggiati, /IS_DEMO\s*}/, 'alloggiati.js imports IS_DEMO');
assert.match(alloggiati, /action === 'demo_simulate_filing' && IS_DEMO/, 'demo_simulate_filing is demo-gated');
assert.match(alloggiati, /async function runDemoFilingSimulation/, 'simulation function defined');
assert.match(alloggiati, /FACSIMILE/, 'simulation payload labels FACSIMILE');
// The simulation body must not reference any SOAP symbol. The imports
// at the top of the file do — the regex scopes to the function body.
const simBodyMatch = alloggiati.match(/async function runDemoFilingSimulation\(req, res\) \{[\s\S]*?\n\}/);
assert.ok(simBodyMatch, 'simulation body matched');
const simBody = simBodyMatch[0];
for (const soapName of ['generateToken', 'authenticationTest', 'soapTest', 'soapSend', 'soapRicevuta']) {
  assert.ok(!simBody.includes(soapName), `simulation body must not reference ${soapName}`);
}
for (const stage of ['validate', 'send', 'receipt']) {
  assert.match(simBody, new RegExp(`stage === '${stage}'`), `simulation covers stage ${stage}`);
}
console.log('PASS Alloggiati demo simulation: demo-gated, zero SOAP symbols, three stages');

// 4. Nothing in the demo UX layer references the production project ref.
for (const file of ['/demo-launch.html', '/api/alloggiati.js', '/index.html', '/host-console.html']) {
  const src = read(file);
  // index.html already has a long history; filter to the Phase 5 block only.
  if (file === '/index.html' || file === '/host-console.html') {
    const block = src.match(/Round 50 Phase 5[\s\S]*?demo-r50-pad[\s\S]*?\}\)\(\);/);
    assert.ok(block && !block[0].includes('jcjwaqqabgwqhhzhfbts'), `${file}: Phase 5 block has no production ref`);
  } else {
    assert.ok(!src.includes('jcjwaqqabgwqhhzhfbts'), `${file} must not reference production ref`);
  }
}
console.log('PASS Phase 5 UX layer: no production project ref');

console.log('PASS Phase 5 demo UX: all static checks');
