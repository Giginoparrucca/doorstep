// Round 50 Phase 4 — reset-mechanism primitives.
//
// The actual reset runs inside PostgreSQL as `public.demo_reset_v1`.
// Keeping it in the database avoids adding a 13th Vercel function
// (Hobby cap is 12) and gives us ACID semantics + an advisory lock in
// one transaction. The function is defined by
// `migration_round50_phase4_demo_reset.sql` and called from
// scripts/demo-reset-live.mjs (via Supabase REST `/rpc/`) and, in
// Phase 5, from a host-console button through
// `supabase.rpc('demo_reset_v1', ...)`.
//
// This module exports pure helpers that the SQL body and the live
// tests both rely on: the presenter allowlist, the demo-property
// allowlist, the advisory lock key, and a canonical fixture-id
// listing derived from the Phase 3 manifest.

import {
  PRESENTERS, PROPERTIES, PROPERTY_PRIMARY, PROPERTY_SECONDARY,
  RECOMMENDATIONS, RULES, BOOKING_SCENARIOS, CHAT_SEEDS, ANALYTICS_SEEDS,
  buildManifest, deriveCheckinId, deriveChatId, deriveAnalyticsId,
  DEMO_PROJECT_REF,
} from './demo-fixtures.mjs';

// Advisory-lock key held by the SQL body for the entire reset tx.
// Any other reset running in parallel sees pg_try_advisory_xact_lock
// return false and reports `locked` rather than deleting anything.
export const RESET_ADVISORY_LOCK_KEY = 505050004n;

export const PRESENTER_USER_IDS = Object.freeze(PRESENTERS.map(p => p.userId));
export const DEMO_PROPERTY_IDS = Object.freeze([PROPERTY_PRIMARY.id, PROPERTY_SECONDARY.id]);

export function isPresenter(userId) {
  return typeof userId === 'string' && PRESENTER_USER_IDS.includes(userId);
}
export function isDemoProjectRef(ref) {
  return ref === DEMO_PROJECT_REF;
}

// Collect every stable fixture ID the Phase 3 manifest produces for a
// given reset day. The SQL body uses these as the DELETE allowlists.
export function fixtureIdsByTable(today) {
  const manifest = buildManifest(today);
  const checkinIds = [];
  for (const s of manifest.scenarios) {
    if (!s.with_checkin) continue;
    checkinIds.push(deriveCheckinId(s.ota_id));
    for (const m of s.group_members || []) checkinIds.push(m.id);
  }
  return {
    properties: PROPERTIES.map(p => p.id),
    recommendations: RECOMMENDATIONS.map(r => r.id),
    rules: RULES.map(r => r.id),
    ota_reservations: manifest.scenarios.map(s => s.ota_id),
    checkins: checkinIds,
    chat_messages: CHAT_SEEDS.map((_, i) => deriveChatId(i)),
    analytics_events: ANALYTICS_SEEDS.map((_, i) => deriveAnalyticsId(i)),
    scenarios: manifest.scenarios,
  };
}

// Build an evidence payload shape for the live-reset test. The handler
// returns the same shape so a caller can diff before/after.
export function buildResetSummary({ today, counts, resetAt = new Date().toISOString() } = {}) {
  return Object.freeze({
    reset_at: resetAt, reset_day: today, counts: counts || null,
    scenarios: BOOKING_SCENARIOS.length,
  });
}
