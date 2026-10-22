// Round 60 Phase 3a — backend room-aware defenses.
//
// Covers the helpers and gates ported from GPT-6.1's
// codex/round60-phase2 branch:
//
//   - _validFeedKeyOrNull: valid feed_key passes through; invalid shape
//     returns `undefined` (sentinel the caller throws on); null/absent
//     returns null (optional).
//   - feedIdentity: stable 32-char hex derived from
//     platform + (feed_key || room_id || url). Changing room_id of an
//     otherwise-identical feed changes the identity.
//   - sourceFeedIdentity: derived from platform + url only — stays
//     stable across room assignment, which is why it's what the
//     legacy-adoption pass matches on.
//   - roomFeedUid: `wbnb-feed:<key>:<uid>` prefix shape; never includes
//     the raw URL or any guest data.
//   - CalendarRoundtrip.sameRoom: NULL/NULL true (no-rooms baseline),
//     NULL/room true (unassigned treated as shared bucket), room/room
//     true iff equal.
//
// Pure Node, no network, no DB. The behavioural pre-flight gates in
// syncOnePropertyFeeds (room FK validation, one-URL-one-room) are
// exercised against the hosted demo DB in the Phase 3a PR body (not
// here) because they require a real property_rooms table and a real
// pgrestGET round-trip.
import assert from 'node:assert/strict';
import { _validFeedKeyOrNull, feedIdentity, sourceFeedIdentity, roomFeedUid } from '../api/ical-sync.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Round = require('../lib/calendar-roundtrip.js');

// Regression: legacy iReservation adoption uses room-category IDs from
// UID/feed URLs only when the match is unique across configured feeds.
import fs from 'node:fs';
const syncSource = fs.readFileSync(new URL('../api/ical-sync.js', import.meta.url), 'utf8');
assert.match(syncSource, /const matchingFeeds = feeds\.filter\(/);
assert.match(syncSource, /String\(originalUid\)\.split\('-'\)\.includes\(category\)/);
assert.match(syncSource, /matchingFeeds\.length === 1 && matchingFeeds\[0\] === feed/);
assert.match(syncSource, /samePlatformFeeds !== 1 && !uniqueIresMatch/);

const roomA = '11111111-1111-4111-8111-111111111111';
const roomB = '22222222-2222-4222-8222-222222222222';

// ── _validFeedKeyOrNull ────────────────────────────────────────────
assert.equal(_validFeedKeyOrNull(null), null, 'absent → null (optional)');
assert.equal(_validFeedKeyOrNull(undefined), null, 'undefined → null');
assert.equal(_validFeedKeyOrNull('camera-blu'), 'camera-blu');
assert.equal(_validFeedKeyOrNull('AbC_123-xyz'), 'AbC_123-xyz');
assert.equal(_validFeedKeyOrNull('a'.repeat(80)), 'a'.repeat(80), '80-char limit allowed');
assert.equal(_validFeedKeyOrNull('a'.repeat(81)), undefined, '81 chars → invalid sentinel');
assert.equal(_validFeedKeyOrNull('with spaces'), undefined, 'spaces not allowed');
assert.equal(_validFeedKeyOrNull('with/slash'), undefined, 'slash not allowed');
assert.equal(_validFeedKeyOrNull(42), undefined, 'non-string → invalid sentinel');
assert.equal(_validFeedKeyOrNull(''), undefined, 'empty string → invalid sentinel');

// ── feedIdentity: deterministic + changes with room assignment ────
const unassigned = { platform: 'airbnb', url: 'https://airbnb.com/calendar/ical/abc.ics' };
const assignedA = { ...unassigned, room_id: roomA };
const assignedB = { ...unassigned, room_id: roomB };
const explicit = { ...unassigned, room_id: roomA, feed_key: 'blu-ical' };

const idUnassigned = feedIdentity(unassigned);
const idA = feedIdentity(assignedA);
const idB = feedIdentity(assignedB);
const idExplicit = feedIdentity(explicit);

assert.equal(idUnassigned.length, 32, '32-char hex');
assert.match(idUnassigned, /^[0-9a-f]{32}$/);
assert.equal(feedIdentity(unassigned), idUnassigned, 'deterministic');
assert.notEqual(idA, idUnassigned, 'adding a room changes the identity');
assert.notEqual(idA, idB, 'different rooms → different identities');
assert.notEqual(idExplicit, idA, 'explicit feed_key overrides room_id in the identity');

// Platform change splits identity even when everything else matches.
assert.notEqual(feedIdentity(unassigned), feedIdentity({ ...unassigned, platform: 'booking' }));

// Identity never includes raw URL characters.
const url = 'https://airbnb.com/calendar/ical/supersecret.ics';
assert.ok(!feedIdentity({ platform: 'airbnb', url }).includes('airbnb'),
  'feedIdentity output is hashed — no URL leakage');

// ── sourceFeedIdentity: stable across room assignment ─────────────
// This is what the legacy-adoption pass uses to recognize "the same
// source URL now has a room_id" — so it MUST stay stable when room_id
// is added later.
assert.equal(sourceFeedIdentity(unassigned), sourceFeedIdentity(assignedA),
  'sourceFeedIdentity ignores room_id');
assert.equal(sourceFeedIdentity(unassigned), sourceFeedIdentity(explicit),
  'sourceFeedIdentity ignores feed_key too');
assert.notEqual(sourceFeedIdentity(unassigned),
  sourceFeedIdentity({ ...unassigned, platform: 'booking' }),
  'sourceFeedIdentity still splits on platform');
assert.notEqual(sourceFeedIdentity(unassigned),
  sourceFeedIdentity({ ...unassigned, url: 'https://other.example/ical.ics' }),
  'sourceFeedIdentity splits on URL');

// ── roomFeedUid ───────────────────────────────────────────────────
assert.equal(roomFeedUid('fkey123', 'uid-abc'), 'wbnb-feed:fkey123:uid-abc');
// The prefix carries no guest data — only the derived feed_key +
// whatever UID the OTA already published. "wbnb-feed:" marker makes
// it grep-able for the legacy-adoption pass.
assert.match(roomFeedUid(idA, 'any-uid'), /^wbnb-feed:[0-9a-f]{32}:any-uid$/);

// ── CalendarRoundtrip.sameRoom ────────────────────────────────────
assert.equal(Round.sameRoom({ room_id: null }, { room_id: null }), true,
  'NULL/NULL → true (no-rooms baseline)');
assert.equal(Round.sameRoom({}, {}), true,
  'absent/absent → true (treated as null)');
assert.equal(Round.sameRoom({ room_id: roomA }, { room_id: null }), true,
  'room/NULL → true (unassigned = shared bucket)');
assert.equal(Round.sameRoom({ room_id: null }, { room_id: roomA }), true,
  'NULL/room → true');
assert.equal(Round.sameRoom({ room_id: roomA }, { room_id: roomA }), true,
  'same room → true');
assert.equal(Round.sameRoom({ room_id: roomA }, { room_id: roomB }), false,
  'different rooms → false');

console.log('PASS rooms-sync-defenses: _validFeedKeyOrNull sentinel, feedIdentity determinism + per-room split, sourceFeedIdentity stability, roomFeedUid shape, sameRoom NULL/NULL baseline + unassigned bucket + strict-equal mismatch.');
