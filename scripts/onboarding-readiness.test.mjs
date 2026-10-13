#!/usr/bin/env node
// Round 51 Phase 1 — unit tests for lib/onboarding-readiness.js.
//
// Mandatory cases per PLAN_round51_host_onboarding.md:
//   - empty property
//   - fully ready Veneto property
//   - Veneto property missing ross1000_codice
//   - Puglia property without ROSS1000 still ready
//   - malformed CIN
//   - tax "not applicable" skip
//   - "direct bookings only" skip (iCal not required)
//   - region blank (step 1 incomplete; region in missing)
//   - notifications all off
//   - step 4 skipped is still ready (step 4 is not blocking)

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { computeReadiness, STEP_IDS, BLOCKING_IDS, _isCin, _hasValidICalFeed, _notificationOn } =
  require('../lib/onboarding-readiness.js');

const VENETO = { system: 'ROSS1000', portal: 'https://flussituristici.regione.veneto.it/', export: 'ross1000', verified: true };
const PUGLIA = { system: 'SPOT Easy (Puglia DMS)', portal: 'https://dms.puglia.it/', export: 'alloggiati_txt', verified: true };

function baseReadyVeneto() {
  return {
    property: {
      name: 'Casa Daniele', city: 'Venezia', region: 'Veneto',
      cir_code: 'IT048017B4VKMD9QX6', ross1000_codice: 'ROSS-123',
      wifi_name: 'CasaWifi',
      welcome_message_it: 'Benvenuti!', checkin_instructions_it: 'La chiave è nel keybox.',
      ical_feeds: [{ url: 'https://airbnb.com/calendar/ical/XYZ.ics', label: 'Airbnb' }],
      tax_rules: [{ rate_eur: 2.5, max_nights: 5 }],
      alloggiati_autofile_mode: 'off',
    },
    taxRules: [{ rate_eur: 2.5, max_nights: 5 }],
    alloggiatiCreds: { configured: true, verified_at: '2026-10-01T10:00:00Z' },
    notificationSettings: { push_enabled: true, telegram_enabled: false, email_mode: 'fallback' },
    hasTestCheckin: true,
    onboardingState: { skips: {} },
    regionCompliance: VENETO,
  };
}

// 1. Empty property — nothing filled; every blocking step incomplete.
(function emptyProperty() {
  const r = computeReadiness({ property: {}, regionCompliance: null });
  assert.equal(r.total, 5);
  assert.equal(r.doneCount, 0);
  assert.equal(r.ready, false);
  assert.equal(r.firstIncompleteStep, 'property');
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  for (const key of ['name', 'city', 'region', 'cir_code', 'tax_rules', 'alloggiati']) {
    assert.ok(byId.property.missing.includes(key), `property.missing must include ${key}`);
  }
  assert.ok(!byId.property.missing.includes('ross1000_codice'), 'no ROSS1000 required without region');
  assert.ok(byId.calendar.missing.includes('ical_feeds'));
  assert.ok(byId.content.missing.includes('welcome_message'));
  assert.ok(byId.content.missing.includes('wifi_name'));
  assert.ok(byId.content.missing.includes('checkin_instructions'));
  assert.ok(byId.notifications.missing.includes('notification_channel'));
  console.log('PASS empty property: every blocking step is incomplete, firstIncompleteStep=property');
})();

// 2. Fully ready Veneto property.
(function readyVeneto() {
  const r = computeReadiness(baseReadyVeneto());
  assert.equal(r.ready, true);
  assert.equal(r.doneCount, 5);
  assert.equal(r.firstIncompleteStep, null);
  for (const s of r.steps) assert.deepEqual(s.missing, [], `${s.id} missing must be empty`);
  console.log('PASS fully ready Veneto: 5/5 done, firstIncompleteStep=null');
})();

// 3. Veneto missing ross1000_codice.
(function venetoWithoutRoss1000() {
  const inp = baseReadyVeneto();
  inp.property.ross1000_codice = '';
  const r = computeReadiness(inp);
  assert.equal(r.ready, false);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.equal(byId.property.done, false);
  assert.ok(byId.property.missing.includes('ross1000_codice'));
  assert.equal(r.firstIncompleteStep, 'property');
  console.log('PASS Veneto missing ross1000_codice: property incomplete');
})();

// 4. Puglia property without ross1000_codice is still ready.
(function pugliaReady() {
  const inp = baseReadyVeneto();
  inp.property.region = 'Puglia';
  inp.property.city = 'Ostuni';
  inp.property.ross1000_codice = '';
  inp.regionCompliance = PUGLIA;
  const r = computeReadiness(inp);
  assert.equal(r.ready, true);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.deepEqual(byId.property.missing, []);
  console.log('PASS Puglia without ross1000_codice is ready');
})();

// 5. Malformed CIN — "cir_code_format" is listed, not "cir_code".
(function malformedCin() {
  const inp = baseReadyVeneto();
  inp.property.cir_code = 'ABC-123'; // no IT prefix, too short
  const r = computeReadiness(inp);
  assert.equal(r.ready, false);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(byId.property.missing.includes('cir_code_format'), 'cir_code_format must be the key');
  assert.ok(!byId.property.missing.includes('cir_code'), 'cir_code should NOT be reported when it is present but malformed');
  console.log('PASS malformed CIN: cir_code_format in missing');
})();

// 6. Tax "not applicable" skip removes tax_rules from missing.
(function taxSkip() {
  const inp = baseReadyVeneto();
  inp.property.tax_rules = [];
  inp.taxRules = [];
  inp.onboardingState.skips = { tax_not_applicable: true };
  const r = computeReadiness(inp);
  assert.equal(r.ready, true);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(!byId.property.missing.includes('tax_rules'));
  console.log('PASS tax_not_applicable skip: tax_rules absent from missing');
})();

// 7. "Direct bookings only" skip removes ical_feeds from missing.
(function directOnlySkip() {
  const inp = baseReadyVeneto();
  inp.property.ical_feeds = [];
  inp.onboardingState.skips = { direct_only: true };
  const r = computeReadiness(inp);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.equal(byId.calendar.done, true);
  assert.equal(byId.calendar.skipped, true, 'calendar step is marked skipped');
  assert.deepEqual(byId.calendar.missing, []);
  assert.equal(r.ready, true);
  console.log('PASS direct_only skip: calendar done+skipped, iCal not required');
})();

// 8. Region blank — step 1 incomplete, region in missing.
(function regionBlank() {
  const inp = baseReadyVeneto();
  inp.property.region = '';
  inp.regionCompliance = null;
  const r = computeReadiness(inp);
  assert.equal(r.ready, false);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(byId.property.missing.includes('region'));
  console.log('PASS region blank: property.missing includes region');
})();

// 9. Notifications all off.
(function notificationsAllOff() {
  const inp = baseReadyVeneto();
  inp.notificationSettings = { push_enabled: false, telegram_enabled: false, email_mode: 'off' };
  const r = computeReadiness(inp);
  assert.equal(r.ready, false);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(byId.notifications.missing.includes('notification_channel'));
  console.log('PASS all notifications off: notifications step incomplete');
})();

// 10. Step 4 skipped is still ready (step 4 is not blocking).
(function step4Skipped() {
  const inp = baseReadyVeneto();
  inp.hasTestCheckin = false;
  inp.onboardingState.skips = { test_checkin: true };
  const r = computeReadiness(inp);
  assert.equal(r.ready, true);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.equal(byId.test.done, true);
  assert.equal(byId.test.skipped, true);
  console.log('PASS step 4 skipped: ready stays true (step 4 is not blocking)');
})();

// 11. Step 4 not skipped and no test check-in → test incomplete, but
// the property is still "ready" because step 4 is not blocking.
(function step4IncompleteStillReady() {
  const inp = baseReadyVeneto();
  inp.hasTestCheckin = false;
  inp.onboardingState.skips = {};
  const r = computeReadiness(inp);
  assert.equal(r.ready, true, 'ready depends on blocking steps only');
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.equal(byId.test.done, false);
  assert.ok(byId.test.missing.includes('test_checkin'));
  // firstIncompleteStep should still be `test` because readiness-order
  // enumerates all steps, not only blocking ones.
  assert.equal(r.firstIncompleteStep, 'test');
  console.log('PASS step 4 incomplete but readiness holds (test is not blocking)');
})();

// 12. Alloggiati: autofile_mode === 'manual' satisfies the sub-step
// without credentials.
(function alloggiatiManualMode() {
  const inp = baseReadyVeneto();
  inp.alloggiatiCreds = null;
  inp.property.alloggiati_autofile_mode = 'manual';
  const r = computeReadiness(inp);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(!byId.property.missing.includes('alloggiati'));
  assert.equal(r.ready, true);
  console.log('PASS alloggiati manual mode satisfies the sub-step');
})();

// 13. Alloggiati: neither credentials nor manual mode → missing.
(function alloggiatiNeitherSet() {
  const inp = baseReadyVeneto();
  inp.alloggiatiCreds = null;
  inp.property.alloggiati_autofile_mode = 'off';
  const r = computeReadiness(inp);
  const byId = Object.fromEntries(r.steps.map(s => [s.id, s]));
  assert.ok(byId.property.missing.includes('alloggiati'));
  assert.equal(r.ready, false);
  console.log('PASS alloggiati off + no credentials: missing');
})();

// 14. Determinism: same inputs produce same output structure.
(function determinism() {
  const inp = baseReadyVeneto();
  const r1 = computeReadiness(inp);
  const r2 = computeReadiness(inp);
  assert.deepEqual(JSON.parse(JSON.stringify(r1)), JSON.parse(JSON.stringify(r2)));
  console.log('PASS determinism across identical inputs');
})();

// 15. Internal helper spot checks.
(function helpers() {
  assert.equal(_isCin('IT048017B4VKMD9QX6'), true);
  assert.equal(_isCin('it048017b4vkmd9qx6'), true, 'case-insensitive');
  assert.equal(_isCin(' IT048017B4VKMD9QX6 '), true, 'whitespace trimmed');
  assert.equal(_isCin('ITABC'), false, 'too short');
  assert.equal(_isCin('XX048017B4VKMD9QX6'), false, 'wrong prefix');
  assert.equal(_isCin('IT048017B4VKMD 9QX6'), false, 'interior whitespace');
  assert.equal(_isCin(''), false);
  assert.equal(_isCin(null), false);

  assert.equal(_hasValidICalFeed([{ url: 'https://ical.me/x.ics' }]), true);
  assert.equal(_hasValidICalFeed(['https://ical.me/x.ics']), true);
  assert.equal(_hasValidICalFeed([{ url: 'http://ical.me/x.ics' }]), false, 'http rejected');
  assert.equal(_hasValidICalFeed([]), false);
  assert.equal(_hasValidICalFeed(null), false);

  assert.equal(_notificationOn({ push_enabled: true }), true);
  assert.equal(_notificationOn({ telegram_enabled: true }), true);
  assert.equal(_notificationOn({ email_mode: 'fallback' }), true);
  assert.equal(_notificationOn({ email_mode: 'off' }), false);
  assert.equal(_notificationOn({ email_mode: '' }), false);
  assert.equal(_notificationOn(null), false);
  console.log('PASS helpers: _isCin, _hasValidICalFeed, _notificationOn');
})();

// 16. Exported shape constants.
assert.deepEqual([...STEP_IDS], ['property', 'calendar', 'content', 'test', 'notifications']);
assert.deepEqual([...BLOCKING_IDS], ['property', 'calendar', 'content', 'notifications']);
console.log('PASS STEP_IDS and BLOCKING_IDS constants');

console.log('PASS onboarding-readiness: all mandatory cases');

// Base tax configuration and explicit host choices are distinct from empty rules.
for (const rate of [0,2.5,'2.50']) {const x=baseReadyVeneto();x.taxRules=[];x.property.tax_rules=[];x.property.tax_rate_eur=rate;assert.ok(!computeReadiness(x).steps[0].missing.includes('tax_rules'));}
for (const rate of [null,undefined,'',-1,'invalid']) {const x=baseReadyVeneto();x.taxRules=[];x.property.tax_rules=[];x.property.tax_rate_eur=rate;assert.ok(computeReadiness(x).steps[0].missing.includes('tax_rules'));}
const overrides=computeReadiness({property:{},onboardingState:{skips:{step_decisions:{property:'done',calendar:'dismissed',content:'done',notifications:'dismissed',test:'unrecognised'}}}});
assert.equal(overrides.ready,true);assert.equal(overrides.steps[0].manual,true);assert.equal(overrides.steps[1].skipped,true);assert.equal(overrides.steps[0].derivedDone,false);assert.equal(overrides.steps[4].done,true);assert.equal(overrides.steps[3].done,false);
assert.equal(computeReadiness({property:{},onboardingState:{skips:{step_decisions:{property:true}}}}).steps[0].done,false);
console.log('PASS base tax rates, explicit zero, invalid/missing values and distinct host-confirmed/dismissed decisions');
