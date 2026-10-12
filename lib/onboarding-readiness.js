// lib/onboarding-readiness.js
//
// Round 51 Phase 1 — the pure readiness module.
//
// `computeReadiness({property, taxRules, alloggiatiCreds,
// notificationSettings, hasTestCheckin, onboardingState, regionCompliance})`
// returns the five-step status the host-console checklist renders and the
// nudge job uses to decide whether to send an email.
//
// IIFE + module.exports dual pattern so the file loads with
// `<script src="/lib/onboarding-readiness.js">` in the browser and
// `require()`-d in Node from `scripts/onboarding-readiness.test.mjs`
// via `createRequire(import.meta.url)`. No import/export syntax.
//
// Pure: no DB, no network, no `Date.now()`. The caller supplies region
// compliance (resolved from `REGION_COMPLIANCE`) so this module never
// duplicates region tables and never drifts with Round 47 updates.

(function (root) {
  'use strict';

  var STEP_IDS = Object.freeze(['property', 'calendar', 'content', 'test', 'notifications']);
  var BLOCKING_IDS = Object.freeze(['property', 'calendar', 'content', 'notifications']);

  // CIN format per Italian Ministry of Tourism: 'IT' + 8..30 alphanumeric
  // characters. Different published examples vary (14 / 15 / 17 chars after
  // the prefix); we accept the realistic range and reject obviously
  // malformed strings — missing prefix, too short, interior whitespace,
  // or any character outside [A-Z0-9]. We normalize uppercase and strip
  // surrounding whitespace before matching.
  var CIN_RE = /^IT[A-Z0-9]{8,30}$/;

  function _str(v) {
    return (typeof v === 'string') ? v.trim() : '';
  }
  function _nonEmpty(v) {
    return _str(v).length > 0;
  }
  function _isCin(v) {
    if (typeof v !== 'string') return false;
    var s = v.trim().toUpperCase();
    return CIN_RE.test(s);
  }
  function _hasValidICalFeed(ical_feeds) {
    if (!Array.isArray(ical_feeds)) return false;
    for (var i = 0; i < ical_feeds.length; i++) {
      var entry = ical_feeds[i];
      if (!entry) continue;
      var url = (typeof entry === 'string') ? entry : _str(entry.url);
      // Accept http: too? No — we insist on HTTPS to avoid an on-path
      // injection in the ingestion job. Round 46 iCal sync rejects http.
      if (/^https:\/\/[^\s]+$/i.test(url)) return true;
    }
    return false;
  }
  function _hasWelcomeMessage(p) {
    return _nonEmpty(p.welcome_message) || _nonEmpty(p.welcome_message_it) || _nonEmpty(p.welcome_message_en);
  }
  function _hasCheckinInstructions(p) {
    return _nonEmpty(p.checkin_instructions) || _nonEmpty(p.checkin_instructions_it) || _nonEmpty(p.checkin_instructions_en);
  }
  function _notificationOn(settings) {
    if (!settings) return false;
    if (settings.push_enabled === true) return true;
    if (settings.telegram_enabled === true) return true;
    // email_mode of 'off' means no email channel; 'fallback' or 'always'
    // (the two values Round 42 introduced) mean the host wants emails.
    var mode = _str(settings.email_mode).toLowerCase();
    if (mode && mode !== 'off') return true;
    return false;
  }
  function _ross1000ExpectedFor(regionCompliance) {
    if (!regionCompliance) return false;
    return regionCompliance.export === 'ross1000';
  }

  function computeReadiness(input) {
    input = input || {};
    var property = input.property || {};
    var taxRules = Array.isArray(input.taxRules) ? input.taxRules : (Array.isArray(property.tax_rules) ? property.tax_rules : []);
    var alloggiatiCreds = input.alloggiatiCreds || null;
    var notificationSettings = input.notificationSettings || null;
    var hasTestCheckin = !!input.hasTestCheckin;
    var skips = (input.onboardingState && input.onboardingState.skips) || {};
    var regionCompliance = input.regionCompliance || null;

    // ── Step 1: property + codes + tax + Alloggiati ─────────────────
    var missing1 = [];
    if (!_nonEmpty(property.name)) missing1.push('name');
    if (!_nonEmpty(property.city)) missing1.push('city');
    if (!_nonEmpty(property.region)) missing1.push('region');
    if (!_nonEmpty(property.cir_code)) missing1.push('cir_code');
    else if (!_isCin(property.cir_code)) missing1.push('cir_code_format');
    if (_ross1000ExpectedFor(regionCompliance) && !_nonEmpty(property.ross1000_codice)) {
      missing1.push('ross1000_codice');
    }
    var taxSkipped = !!skips.tax_not_applicable;
    if (!taxSkipped && taxRules.length === 0) missing1.push('tax_rules');
    var autofileMode = _str(property.alloggiati_autofile_mode).toLowerCase();
    var credsConfigured = !!(alloggiatiCreds && alloggiatiCreds.configured);
    var alloggiatiPicked = credsConfigured || autofileMode === 'manual';
    if (!alloggiatiPicked) missing1.push('alloggiati');

    var step1 = {
      id: 'property',
      done: missing1.length === 0,
      skipped: false, // tax skip is a partial skip; step as a whole is still "done"
      missing: Object.freeze(missing1.slice()),
    };

    // ── Step 2: calendar ─────────────────────────────────────────────
    var missing2 = [];
    var calendarSkipped = !!skips.direct_only;
    if (!calendarSkipped && !_hasValidICalFeed(property.ical_feeds)) {
      missing2.push('ical_feeds');
    }
    var step2 = {
      id: 'calendar',
      done: missing2.length === 0,
      skipped: calendarSkipped && missing2.length === 0,
      missing: Object.freeze(missing2.slice()),
    };

    // ── Step 3: content ──────────────────────────────────────────────
    var missing3 = [];
    if (!_hasWelcomeMessage(property)) missing3.push('welcome_message');
    if (!_nonEmpty(property.wifi_name)) missing3.push('wifi_name');
    if (!_hasCheckinInstructions(property)) missing3.push('checkin_instructions');
    var step3 = {
      id: 'content',
      done: missing3.length === 0,
      skipped: false,
      missing: Object.freeze(missing3.slice()),
    };

    // ── Step 4: test check-in (not blocking) ────────────────────────
    var testSkipped = !!skips.test_checkin;
    var missing4 = [];
    if (!hasTestCheckin && !testSkipped) missing4.push('test_checkin');
    var step4 = {
      id: 'test',
      done: hasTestCheckin || testSkipped,
      skipped: testSkipped && !hasTestCheckin,
      missing: Object.freeze(missing4.slice()),
    };

    // ── Step 5: notifications ────────────────────────────────────────
    var missing5 = [];
    if (!_notificationOn(notificationSettings)) missing5.push('notification_channel');
    var step5 = {
      id: 'notifications',
      done: missing5.length === 0,
      skipped: false,
      missing: Object.freeze(missing5.slice()),
    };

    var steps = [step1, step2, step3, step4, step5];
    var byId = {};
    for (var i = 0; i < steps.length; i++) byId[steps[i].id] = steps[i];
    var doneCount = 0;
    for (var j = 0; j < steps.length; j++) if (steps[j].done) doneCount++;
    var ready = true;
    for (var k = 0; k < BLOCKING_IDS.length; k++) {
      if (!byId[BLOCKING_IDS[k]].done) { ready = false; break; }
    }
    var firstIncompleteStep = null;
    for (var m = 0; m < steps.length; m++) {
      if (!steps[m].done) { firstIncompleteStep = steps[m].id; break; }
    }

    return Object.freeze({
      steps: Object.freeze(steps.map(Object.freeze)),
      doneCount: doneCount,
      total: steps.length,
      ready: ready,
      firstIncompleteStep: firstIncompleteStep,
    });
  }

  var api = {
    computeReadiness: computeReadiness,
    STEP_IDS: STEP_IDS,
    BLOCKING_IDS: BLOCKING_IDS,
    // Exposed for the host-console UI's field focus and for the unit test.
    _isCin: _isCin,
    _hasValidICalFeed: _hasValidICalFeed,
    _notificationOn: _notificationOn,
  };

  root.OnboardingReadiness = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
