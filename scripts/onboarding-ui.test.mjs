#!/usr/bin/env node
// Round 51 Phase 3 — static sweep for the host-console checklist +
// contact widget. No DOM; verifies the code paths that must exist and
// the strings/absences the spec locks down.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const read = p => readFileSync(new URL('..' + p, import.meta.url), 'utf8');
const hostConsole = read('/host-console.html');
const hostOnboarding = read('/host-onboarding.js');
const indexHtml = read('/index.html');
const adminHtml = read('/admin.html');

// 1. host-console loads both modules
assert.match(hostConsole, /<script src="\/lib\/onboarding-readiness\.js"><\/script>/, 'host-console loads readiness module');
assert.match(hostConsole, /<script src="\/host-onboarding\.js"><\/script>/, 'host-console loads onboarding UI module');
console.log('PASS host-console loads /lib/onboarding-readiness.js and /host-onboarding.js');

// 2. renderDashboard calls renderChecklist
assert.match(hostConsole, /window\.HostOnboarding\s*\)\s*await\s+window\.HostOnboarding\.renderChecklist\(\)/,
             'renderDashboard invokes HostOnboarding.renderChecklist');
console.log('PASS renderDashboard() hooks the checklist render');

// 3. Hash deep-link handler for Phase 5 nudges
assert.match(hostConsole, /\^#onboarding=\(\[a-z\]\+\)\$/, 'hash handler regex is scoped to #onboarding=<step>');
assert.match(hostConsole, /_handleOnboardingHash/, 'hash handler attached to hashchange');
console.log('PASS hash deep-link handler present');

// 4. i18n: every obx_* key exists in BOTH dictionaries and strings are single-line.
const REQUIRED_KEYS = [
  'obx_title', 'obx_intro_todo', 'obx_intro_ready', 'obx_hide', 'obx_skipped',
  'obx_help_link', 'obx_help_open', 'obx_help_fab',
  'obx_help_title', 'obx_help_whatsapp', 'obx_help_email', 'obx_help_calendly',
  'obx_help_none', 'obx_help_pii', 'obx_close', 'obx_ready_badge',
  'obx_step_property_title', 'obx_step_property_cta',
  'obx_step_calendar_title', 'obx_step_calendar_cta',
  'obx_step_content_title', 'obx_step_content_cta',
  'obx_step_test_title', 'obx_step_test_cta',
  'obx_step_notifications_title', 'obx_step_notifications_cta',
];
for (const key of REQUIRED_KEYS) {
  // Match `key: '...'` or `key: "..."` and require the match to be single-line.
  const re = new RegExp('\\b' + key + ":\\s*(['\"])(?:(?!\\1).)*\\1", 'g');
  const hits = hostConsole.match(re) || [];
  assert.ok(hits.length >= 2, `${key}: must appear in both EN and IT dictionaries (got ${hits.length})`);
  for (const h of hits) {
    assert.ok(!/[\n\r]/.test(h), `${key}: single-line (applyLang uses innerHTML)`);
  }
}
console.log(`PASS i18n: all ${REQUIRED_KEYS.length} obx_* keys present in both EN and IT, all single-line`);

// 5. No hard-coded wa.me / Calendly / WhatsApp number literal in HTML files.
for (const [label, text] of [['host-console.html', hostConsole], ['index.html', indexHtml], ['admin.html', adminHtml]]) {
  assert.ok(!/\bwa\.me\b/.test(text), `${label}: wa.me must not be hard-coded`);
  assert.ok(!/calendly\.com/i.test(text), `${label}: calendly.com must not be hard-coded`);
}
console.log('PASS no hard-coded wa.me / calendly.com in any HTML');

// 6. Floating "Aiuto" FAB is only reachable from host-console.
// host-onboarding.js attaches a `.obx-support-fab` to document.body;
// it must not be loaded by index.html or admin.html.
assert.match(hostOnboarding, /obx-support-fab/, 'FAB class exists in the module');
for (const [label, text] of [['index.html', indexHtml], ['admin.html', adminHtml]]) {
  assert.ok(!/host-onboarding\.js/.test(text), `${label}: must not load host-onboarding.js`);
  assert.ok(!/HostOnboarding/.test(text), `${label}: must not reference HostOnboarding`);
}
console.log('PASS FAB module loaded only by host-console');

// 7. Prefill builder: pure, encoding-safe, only three allowed fields.
// Simulate running the module in a bare window-less context so we can
// call buildSupportPrefill directly.
import vm from 'node:vm';
const ctx = {};
vm.runInNewContext(hostOnboarding, { window: ctx, document: undefined });
assert.ok(typeof ctx.HostOnboarding === 'object' && typeof ctx.HostOnboarding.buildSupportPrefill === 'function',
         'HostOnboarding attaches buildSupportPrefill');
const b = ctx.HostOnboarding.buildSupportPrefill;
const sampleIT = b('Daniele', 'Casa Demo', 'Dati e codici della struttura', 'it');
assert.match(sampleIT, /Ciao, sono Daniele, struttura Casa Demo\./);
assert.match(sampleIT, /Dati e codici della struttura/);
const sampleEN = b('Daniele', 'Casa Demo', 'Property data', 'en');
assert.match(sampleEN, /^Hi, I'm Daniele, property Casa Demo\./);
// Prefill with empty inputs falls back to em-dash placeholders — never leaks.
const empty = b('', '', '', 'it');
assert.match(empty, /Ciao, sono —, struttura —\./);
assert.match(empty, /onboarding/);
// Negative: must not contain anything other than the three allowed fields.
const injected = b('Daniele', 'Casa Demo', 'Step', 'it');
assert.ok(!/booking|email|@|checkin|guest|codice/i.test(injected), 'no reserved words leak into prefill');
console.log('PASS buildSupportPrefill: IT/EN, placeholders, no PII leak');

// 8. Support config: `publicConfiguration` carries a `support` object
// with the three channel keys. The environment test owns the shape;
// here we just assert the module reads from WELCOME_BNB_CONFIG.support.
assert.match(hostOnboarding, /WELCOME_BNB_CONFIG && W\.WELCOME_BNB_CONFIG\.support/, 'module reads support config');
console.log('PASS onboarding module reads support config from app-config');

// 9. Analytics event-type coverage.
for (const ev of ['onboarding_checklist_viewed', 'support_opened', 'support_channel_clicked']) {
  assert.ok(hostOnboarding.includes(ev), `event type ${ev} present`);
}
// onboarding_step_completed / _skipped land in Phase 4 wiring; Phase 3
// emits checklist_viewed, support_opened and support_channel_clicked.
console.log('PASS analytics events: viewed/opened/channel_clicked emitted');

// 10. PII-safety line text matches the spec exactly in IT.
assert.ok(hostConsole.includes("Non inviarci documenti o foto degli ospiti: li gestiamo solo dentro WelcomeBnB."),
         'IT PII-safety sentence present verbatim in host-console');
assert.ok(hostConsole.includes('Do not send us guest documents or photos — we handle those only inside WelcomeBnB.'),
         'EN PII-safety sentence present verbatim in host-console');
console.log('PASS PII-safety sentence present in both dictionaries');

console.log('PASS Phase 3 onboarding UI static sweep');
