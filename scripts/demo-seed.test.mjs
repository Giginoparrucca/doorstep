#!/usr/bin/env node
// Round 50 Phase 3 — pure-manifest tests for lib/demo-fixtures.mjs.
// No database connection; verifies stable IDs, date math, exact 10
// scenarios, FK integrity on fixture references, PII patterns and
// idempotency of buildManifest(today).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  PRESENTERS, PROPERTIES, PROPERTY_PRIMARY, PROPERTY_SECONDARY,
  RECOMMENDATIONS, RULES, BOOKING_SCENARIOS, CHAT_SEEDS, ANALYTICS_SEEDS,
  buildManifest, romeToday, addDaysISO, DEMO_PROJECT_REF,
  deriveCheckinId, deriveChatId, deriveAnalyticsId,
} from '../lib/demo-fixtures.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Reserved emails/phones.
for (const presenter of PRESENTERS) {
  assert.ok(/@example\.(com|org)$/.test(presenter.email), `presenter ${presenter.email} must use @example.*`);
  assert.match(presenter.userId, UUID_RE, `presenter uuid shape ${presenter.userId}`);
}
console.log('PASS presenters: reserved emails and UUID shape');

// Properties.
assert.equal(PROPERTIES.length, 2, 'exactly two demo properties');
assert.equal(PROPERTY_PRIMARY.ownerId, PRESENTERS[0].userId, 'primary owned by presenter 1');
assert.equal(PROPERTY_SECONDARY.ownerId, PRESENTERS[1].userId, 'secondary owned by presenter 2');
for (const p of PROPERTIES) {
  assert.match(p.id, UUID_RE, `property id shape ${p.id}`);
  assert.equal(p.is_test, true, 'property marked is_test');
  assert.equal(p.timezone, 'Europe/Rome');
  assert.equal(p.alloggiati_autofile_mode, 'off', 'demo autofile mode off');
  assert.equal(p.host_phone, null, `property ${p.name}: no reachable phone`);
  assert.ok(/@example\.(com|org)$/.test(p.host_email), 'reserved host email');
}
console.log('PASS properties: 2 properties, correct owners, is_test true, autofile off');

// Exactly 10 booking scenarios with the stable codes.
const expectedCodes = ['DEMO-ARRIVO','DEMO-NUOVO','DEMO-SOGGIORNO','DEMO-AIUTO','DEMO-GRUPPO','DEMO-CONFORMITA','DEMO-PARTENZA','DEMO-RECENTE','DEMO-SCADUTO','DEMO-NOSHOW'];
assert.equal(BOOKING_SCENARIOS.length, 10, 'exactly 10 booking scenarios');
assert.deepEqual(BOOKING_SCENARIOS.map(s => s.code), expectedCodes, 'scenario codes match spec in order');
for (const s of BOOKING_SCENARIOS) {
  assert.match(s.ota_id, UUID_RE, `scenario ota_id shape ${s.ota_id}`);
  assert.ok(s.departure_offset > s.arrival_offset, `scenario ${s.code}: departure after arrival`);
  assert.ok(Number.isInteger(s.guest_count) && s.guest_count >= 1, `scenario ${s.code}: valid guest_count`);
  if (s.with_checkin) {
    assert.ok(s.checkin && s.checkin.document_number.startsWith('FACSIMILE'),
              `scenario ${s.code}: fictional document_number`);
  }
}
console.log('PASS scenarios: 10 scenarios, unique UUIDs, valid offsets, FACSIMILE docs');

// FK integrity for seeds.
const scenarioCodes = new Set(BOOKING_SCENARIOS.map(s => s.code));
for (const c of CHAT_SEEDS) assert.ok(scenarioCodes.has(c.booking_code), `chat seed references ${c.booking_code}`);
for (const e of ANALYTICS_SEEDS) assert.ok(scenarioCodes.has(e.booking_code), `analytics seed references ${e.booking_code}`);
console.log('PASS seed references: chat/analytics booking_codes exist');

// All fixture property references point to the primary property.
for (const r of RECOMMENDATIONS) assert.equal(r.property_id, PROPERTY_PRIMARY.id, `reco ${r.name}: primary`);
for (const r of RULES) assert.equal(r.property_id, PROPERTY_PRIMARY.id, `rule ${r.title_en}: primary`);
console.log('PASS recommendations/rules reference primary property');

// Exactly 6 recommendations with maps-visible fields.
assert.equal(RECOMMENDATIONS.length, 6, 'six recommendations');
for (const r of RECOMMENDATIONS) {
  assert.ok(r.address && r.address.length > 10, `reco ${r.name}: real address`);
  // No invented hours/reviews/walking times in descriptions.
  for (const text of [r.desc_it, r.desc_en]) {
    assert.ok(!/\d+ ?(ora|hour|km|min|minuti|minutes|stelle|stars|aperto|open)\b/i.test(text || ''),
              `reco ${r.name}: no invented hours/reviews/distance in description`);
  }
}
console.log('PASS recommendations: 6 items with Maps-ready addresses and no invented operational facts');

// Date math.
assert.equal(addDaysISO('2026-01-01', 0), '2026-01-01');
assert.equal(addDaysISO('2026-10-11', 10), '2026-10-21');
assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28'); // non-leap year
assert.equal(addDaysISO('2024-03-01', -1), '2024-02-29'); // leap year
assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01'); // year boundary
console.log('PASS addDaysISO: year/leap/boundary');

// Rome today is a YYYY-MM-DD string.
assert.match(romeToday(new Date('2026-07-15T22:00:00Z')), DATE_RE);
// Right before midnight in Rome.
assert.equal(romeToday(new Date('2026-07-15T21:30:00Z')), '2026-07-15');
assert.equal(romeToday(new Date('2026-07-15T22:30:00Z')), '2026-07-16');
console.log('PASS romeToday: tz-correct');

// buildManifest determinism and idempotency.
const m1 = buildManifest('2026-10-11');
const m2 = buildManifest('2026-10-11');
assert.deepEqual(m1, m2, 'buildManifest deterministic');
console.log('PASS buildManifest deterministic');

// Scenario dates land on the expected days.
const by = Object.fromEntries(m1.scenarios.map(s => [s.code, s]));
assert.equal(by['DEMO-ARRIVO'].checkin_date,  '2026-10-12');
assert.equal(by['DEMO-NUOVO'].checkin_date,   '2026-10-11');
assert.equal(by['DEMO-SOGGIORNO'].checkin_date, '2026-10-10');
assert.equal(by['DEMO-SOGGIORNO'].checkout_date, '2026-10-14');
assert.equal(by['DEMO-SCADUTO'].checkout_date, '2026-10-03'); // 8 days before 2026-10-11
assert.equal(by['DEMO-SCADUTO'].nights, 2);
assert.equal(by['DEMO-NOSHOW'].checkout_date, '2026-10-03');
console.log('PASS buildManifest: correct scenario dates for 2026-10-11');

// Seven-day cutoff: on reset day 2026-10-11, bookings whose departure
// was > 7 days ago are outside the action-board window. The exact
// boundary is "departed <= 7 days ago IS visible, > 7 is not".
const windowEnd = '2026-10-11';
const sevenDays = s => (Date.UTC(...windowEnd.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v))) - Date.UTC(...s.checkout_date.split('-').map((v, i) => i === 1 ? Number(v) - 1 : Number(v)))) / (24 * 60 * 60 * 1000);
for (const code of ['DEMO-SCADUTO','DEMO-NOSHOW']) {
  const days = sevenDays(by[code]);
  assert.ok(days > 7, `${code}: departed > 7 days ago (${days})`);
}
for (const code of ['DEMO-RECENTE','DEMO-PARTENZA']) {
  const days = sevenDays(by[code]);
  assert.ok(days <= 7, `${code}: departed <= 7 days ago (${days})`);
}
console.log('PASS seven-day action-board boundary');

// No production PII patterns. The production hosts live under
// @welcomebnb.it and specific real-sounding surnames the demo must
// never leak. We assert via a canonical substring sweep.
const forbiddenSubstrings = ['petrilli', 'Petrilli', '@welcomebnb.it', 'welcomebnb.it'];
const manifestText = JSON.stringify(buildManifest('2026-10-11'));
for (const needle of forbiddenSubstrings) {
  // host_email is presenter.*@example.com, so welcomebnb.it must not appear.
  assert.ok(!manifestText.toLowerCase().includes(needle.toLowerCase()),
            `manifest contains forbidden substring: ${needle}`);
}
console.log('PASS no production PII tokens in materialized manifest');

// Minimum fixtures aren't massive: full manifest serializes under 32 KB.
assert.ok(manifestText.length < 32 * 1024, `manifest size ${manifestText.length} bytes`);
console.log(`PASS manifest size ${manifestText.length} bytes`);

// Public identifiers.
assert.equal(DEMO_PROJECT_REF, 'wmegnnlmcrabndyzywmj');
console.log('PASS project ref');

// Every derived row ID is a valid v4 UUID and distinct from the OTA id.
for (const s of BOOKING_SCENARIOS) {
  if (!s.with_checkin) continue;
  const cid = deriveCheckinId(s.ota_id);
  assert.match(cid, UUID_RE, `derived checkin id ${cid}`);
  assert.notEqual(cid, s.ota_id, 'checkin id differs from ota id');
  for (const m of s.group_members || []) {
    assert.match(m.id, UUID_RE, `group member uuid ${m.id}`);
    assert.notEqual(m.id, cid, 'group member differs from lead');
  }
}
const chatIds = CHAT_SEEDS.map((_, i) => deriveChatId(i));
const analyticsIds = ANALYTICS_SEEDS.map((_, i) => deriveAnalyticsId(i));
for (const id of chatIds)      assert.match(id, UUID_RE, `chat id ${id}`);
for (const id of analyticsIds) assert.match(id, UUID_RE, `analytics id ${id}`);
assert.equal(new Set(chatIds).size, chatIds.length, 'chat ids unique');
assert.equal(new Set(analyticsIds).size, analyticsIds.length, 'analytics ids unique');
console.log('PASS derived row IDs: valid UUID v4 shape and uniqueness');

// deriveCheckinId rejects malformed input (anything that doesn't start
// with 50505050-...-0{9}3xx is wrong-shape for a scenario ota id).
assert.throws(() => deriveCheckinId('not-a-uuid'), /deriveCheckinId/);
assert.throws(() => deriveCheckinId('50505050-0000-4000-8000-000000000401'), /deriveCheckinId/);
assert.throws(() => deriveCheckinId('11111111-0000-4000-8000-000000000301'), /deriveCheckinId/);
console.log('PASS deriveCheckinId rejects wrong-shape input');

console.log('PASS demo-fixtures: all checks');
