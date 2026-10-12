#!/usr/bin/env node
// Round 50 Phase 4 — pure helpers in lib/demo-reset.mjs.
// Verifies the presenter allowlist, the demo-property allowlist, the
// advisory-lock key, the fixture-id table, and the summary-shape
// builder. No database connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RESET_ADVISORY_LOCK_KEY, PRESENTER_USER_IDS, DEMO_PROPERTY_IDS,
  isPresenter, isDemoProjectRef, fixtureIdsByTable, buildResetSummary,
} from '../lib/demo-reset.mjs';
import { PRESENTERS, PROPERTIES, DEMO_PROJECT_REF } from '../lib/demo-fixtures.mjs';

// Advisory-lock key is a bigint and non-zero (zero would collide with
// Postgres defaults in some tooling).
assert.equal(typeof RESET_ADVISORY_LOCK_KEY, 'bigint');
assert.ok(RESET_ADVISORY_LOCK_KEY > 0n);
console.log('PASS advisory-lock key: non-zero bigint');

// Presenter allowlist matches the manifest.
assert.deepEqual([...PRESENTER_USER_IDS].sort(), PRESENTERS.map(p => p.userId).sort());
console.log('PASS presenter allowlist matches manifest');

// Demo-property allowlist contains exactly the two fixture properties.
assert.deepEqual([...DEMO_PROPERTY_IDS].sort(), PROPERTIES.map(p => p.id).sort());
console.log('PASS demo-property allowlist matches manifest');

// isPresenter: positive, negative, bad input types.
for (const presenter of PRESENTERS) assert.equal(isPresenter(presenter.userId), true, `isPresenter(${presenter.userId}) must be true`);
assert.equal(isPresenter(''), false);
assert.equal(isPresenter(null), false);
assert.equal(isPresenter('00000000-0000-0000-0000-000000000000'), false);
assert.equal(isPresenter('edcf2a10-a59b-4565-8721-7dafd7567418'), false, 'one-char-off presenter uuid rejected');
console.log('PASS isPresenter: accepts presenters only');

// isDemoProjectRef: positive, negative.
assert.equal(isDemoProjectRef('wmegnnlmcrabndyzywmj'), true);
assert.equal(isDemoProjectRef('jcjwaqqabgwqhhzhfbts'), false, 'production ref rejected');
assert.equal(isDemoProjectRef(''), false);
console.log('PASS isDemoProjectRef: demo only');

// fixtureIdsByTable returns valid UUIDs + the expected counts for the
// Phase 3 manifest.
const ids = fixtureIdsByTable('2026-10-11');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (const [table, list] of Object.entries(ids)) {
  if (table === 'scenarios') continue;
  for (const id of list) assert.match(id, UUID_RE, `${table}: ${id} must be a UUID`);
}
assert.equal(ids.properties.length, 2);
assert.equal(ids.recommendations.length, 6);
assert.equal(ids.rules.length, 2);
assert.equal(ids.ota_reservations.length, 10);
assert.equal(ids.checkins.length, 9); // 7 single/lead + 2 group members
assert.equal(ids.chat_messages.length, 6);
assert.equal(ids.analytics_events.length, 7);
assert.equal(ids.scenarios.length, 10);
console.log('PASS fixtureIdsByTable: counts match Phase 3 manifest');

// buildResetSummary produces a serializable payload with the expected keys.
const summary = buildResetSummary({ today: '2026-10-11', counts: { checkins: 2 } });
assert.equal(summary.reset_day, '2026-10-11');
assert.equal(summary.scenarios, 10);
assert.deepEqual(summary.counts, { checkins: 2 });
assert.ok(summary.reset_at && !Number.isNaN(Date.parse(summary.reset_at)));
console.log('PASS buildResetSummary: valid shape');

// Rome DST boundary check: the manifest date math and the fixture
// listing both have to work on the day DST ends (Oct 25 2026, 03:00
// Rome). The SQL function uses reset_day as a plain date so DST only
// affects whether chat/analytics timestamps round correctly — covered
// by the hosted gate.
const dstResetIds = fixtureIdsByTable('2026-10-25');
assert.equal(dstResetIds.scenarios[0].checkin_date, '2026-10-26');
console.log('PASS Rome DST boundary: reset_day arithmetic works');

// Migration body hasn't drifted and still enforces the presenter
// allowlist + advisory lock in-process.
const migSql = readFileSync(new URL('../migration_round50_phase4_demo_reset.sql', import.meta.url), 'utf8');
for (const presenter of PRESENTERS) {
  assert.ok(migSql.includes(presenter.userId), `migration must list ${presenter.userId}`);
}
assert.ok(migSql.includes('pg_try_advisory_xact_lock(505050004)'), 'advisory lock key must match RESET_ADVISORY_LOCK_KEY');
assert.ok(migSql.includes('RAISE EXCEPTION'), 'migration must raise on non-presenter');
assert.ok(migSql.includes("SECURITY DEFINER"), 'migration must declare SECURITY DEFINER');
assert.ok(migSql.includes('GRANT  EXECUTE ON FUNCTION public.demo_reset_v1(date) TO authenticated;')
      || migSql.includes('GRANT EXECUTE ON FUNCTION public.demo_reset_v1(date) TO authenticated;'),
    'migration must grant authenticated');
assert.ok(!migSql.includes(" TO anon"), 'migration must not grant anon');
console.log('PASS migration body: lists presenters, uses advisory lock, raises, SECURITY DEFINER, authenticated only');

// Alloggiati immutability: migration must never DELETE/UPDATE the
// filing log or the host-credentials table.
assert.ok(!/\balloggiati_filing_log\b/.test(migSql), 'migration must not reference alloggiati_filing_log');
assert.ok(!/host_alloggiati_credentials/.test(migSql), 'migration must not reference host_alloggiati_credentials');
console.log('PASS migration body: Alloggiati audit log untouched');

// Production ref must never appear in the migration body (even inside
// a comment).
assert.ok(!migSql.includes('jcjwaqqabgwqhhzhfbts'), 'production ref must not appear in migration');
// The demo project ref should appear via lib references, not inside
// the SQL body — the function uses property UUIDs instead.
assert.ok(DEMO_PROJECT_REF === 'wmegnnlmcrabndyzywmj');
console.log('PASS migration body: no production ref');

console.log('PASS demo-reset: all helper and migration-sanity checks');
