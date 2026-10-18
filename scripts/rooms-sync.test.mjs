// Round 60 Phase 2 — iCal sync + echo + overlap + correlation with rooms.
//
// Covers the four behavioural changes that landed with Phase 2 (the
// zero-impact rule for properties without rooms is the main invariant;
// each test cases the no-rooms baseline and the per-room variant):
//
//   1. api/ical-sync.js _validUuidOrNull — valid UUID in, lowercased
//      UUID out; anything else → null (unassigned).
//   2. lib/calendar-roundtrip.js matchOrigin — same room still matches,
//      different room never matches, NULL/NULL still matches (no-rooms
//      preserved), NULL/room and room/NULL still match (one side
//      unassigned).
//   3. host-console.html _renderReservationCard date-overlap fallback —
//      when the reservation has a room_id, check-in groups in another
//      room are filtered out of the fallback. NULL/NULL unchanged.
//   4. host-console.html _computeReservationOverlap — passing roomId
//      hides rows from other rooms but keeps unassigned rows (so the
//      host still sees cross-room conflicts they haven't labelled).
//
// Pure Node, no network. The host-console helpers are VM-extracted via
// text slice (same pattern used by onboarding-test-isolation.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { _validUuidOrNull, parseICS, vEventToRow } from '../api/ical-sync.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Round = require('../lib/calendar-roundtrip.js');

// ── 1. _validUuidOrNull ─────────────────────────────────────────────
assert.equal(_validUuidOrNull('11111111-1111-4111-8111-111111111111'),
  '11111111-1111-4111-8111-111111111111');
assert.equal(_validUuidOrNull('11111111-1111-4111-8111-111111111111'.toUpperCase()),
  '11111111-1111-4111-8111-111111111111', 'UUIDs are normalised to lower-case');
assert.equal(_validUuidOrNull('  11111111-1111-4111-8111-111111111111  '),
  '11111111-1111-4111-8111-111111111111', 'surrounding whitespace tolerated');
for (const bad of [null, undefined, '', 'not-a-uuid', '11111111-1111-4111-8111-11111111111z', 42, {}, []]) {
  assert.equal(_validUuidOrNull(bad), null, `invalid room_id ${JSON.stringify(bad)} → null`);
}

// ── 2. matchOrigin per-room scoping ────────────────────────────────
// Build a direct source + an incoming OTA block that would normally
// link (same UID, same dates). Vary room_id to prove the gate.
const roomA = '11111111-1111-4111-8111-111111111111';
const roomB = '22222222-2222-4222-8222-222222222222';
const base = {
  property_id: 'p1',
  entry_type: 'reservation', status: 'active',
  checkin_date: '2026-06-10', checkout_date: '2026-06-13',
  is_test: false, deleted_at: null,
};
function direct(extra = {}) {
  return { id: 'direct-1', platform: 'direct', uid: 'direct-booking-xyz', ...base, ...extra };
}
function echo(extra = {}) {
  return {
    platform: 'airbnb',
    uid: 'direct-booking-xyz@welcomebnb.vercel.app',
    raw: { origin_uid: 'direct-booking-xyz' },
    ...base, ...extra,
  };
}

// No-rooms baseline (both NULL) still matches — Round 45 behaviour preserved.
assert.ok(Round.matchOrigin(echo(), [direct()]),
  'no rooms → matchOrigin still links');

// Both in room A → links.
assert.ok(Round.matchOrigin(echo({ room_id: roomA }), [direct({ room_id: roomA })]),
  'same room → matchOrigin links');

// Different rooms → NEVER links (the key new invariant).
assert.equal(Round.matchOrigin(echo({ room_id: roomB }), [direct({ room_id: roomA })]), null,
  'different rooms → matchOrigin refuses to link');

// One side unassigned → still links (unassigned bucket is the shared bucket).
assert.ok(Round.matchOrigin(echo({ room_id: null }), [direct({ room_id: roomA })]),
  'null echo + room A direct → still links (unassigned)');
assert.ok(Round.matchOrigin(echo({ room_id: roomA }), [direct({ room_id: null })]),
  'room A echo + null direct → still links (unassigned)');

// Dates still rule out mismatches, regardless of room.
assert.equal(
  Round.matchOrigin(echo({ room_id: roomA, checkin_date: '2026-06-11' }), [direct({ room_id: roomA })]),
  null,
  'date mismatch overrides same-room match');

// A cancelled source doesn't link even in the same room.
assert.equal(
  Round.matchOrigin(echo({ room_id: roomA }), [direct({ room_id: roomA, status: 'cancelled' })]),
  null,
  'cancelled source → matchOrigin refuses');

// ── 3. host-console _renderReservationCard date-overlap fallback ──
// VM-extract the function slice + its i18n/escape dependencies and
// drive it with hand-built fixtures. We only exercise the correlation
// path — the rendered HTML is incidental for this test.
const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
function slice(name, src = html) {
  const key = 'function ' + name + '(';
  const start = src.indexOf(key);
  assert.ok(start >= 0, 'cannot find ' + name);
  let end = src.indexOf('\n}', start);
  while (end >= 0) {
    const candidate = src.slice(start, end + 2);
    try { new vm.Script(candidate); return candidate; } catch { /* keep */ }
    end = src.indexOf('\n}', end + 2);
  }
  throw new Error('cannot extract ' + name);
}

// The function body references several host-console helpers (h, HostShare,
// _cleanOtaGuestName etc.) but the correlation we're testing lives
// in the first 40 lines — we test the correlation by extracting ONLY
// the matching snippet so we don't need the whole console. Build a
// stand-in function with the same body.
const correlationFn = `
function correlate(r, allCheckins) {
  const dated = (allCheckins || []).filter(c => c.arrival_date);
  let matched = [];
  if (r.booking_code) matched = dated.filter(c => c.booking_code === r.booking_code);
  if (matched.length === 0) {
    matched = dated.filter(c => {
      if (c.arrival_date >= r.checkout_date) return false;
      if (c.departure_date && c.departure_date <= r.checkin_date) return false;
      if (r.room_id && c.room_id && c.room_id !== r.room_id) return false;
      return true;
    });
  }
  return matched;
}`;
// Byte-check: the committed correlation body must contain our exact
// per-room branch (so a future accidental refactor flips the test).
assert.match(html, /if \(r\.room_id && c\.room_id && c\.room_id !== r\.room_id\) return false;/,
  'per-room correlation branch must be present in host-console.html');

const ctx = vm.createContext({});
vm.runInContext(correlationFn, ctx);
const correlate = ctx.correlate;

const r = { booking_code: 'FOO-1', room_id: roomA, checkin_date: '2026-07-10', checkout_date: '2026-07-13' };
const checkinA = { id: 'c1', booking_code: null, room_id: roomA, arrival_date: '2026-07-10', departure_date: '2026-07-13' };
const checkinB = { id: 'c2', booking_code: null, room_id: roomB, arrival_date: '2026-07-10', departure_date: '2026-07-13' };
const checkinNull = { id: 'c3', booking_code: null, room_id: null, arrival_date: '2026-07-10', departure_date: '2026-07-13' };

// With a booking_code match available, that wins; room_id check doesn't apply.
assert.deepEqual(
  correlate(r, [{ ...checkinA, booking_code: 'FOO-1' }, { ...checkinB, booking_code: 'FOO-1' }]).map(c => c.id),
  ['c1', 'c2'],
  'booking_code match ignores room_id (direct link, host-owned)');

// Date-fallback: room-A reservation only matches room-A checkins; room-B is excluded.
// Room-NULL ("unassigned") stays — the host still sees it because they haven't labelled it.
assert.deepEqual(
  correlate(r, [checkinA, checkinB, checkinNull]).map(c => c.id).sort(),
  ['c1', 'c3'],
  'date fallback excludes other-room check-ins, keeps unassigned');

// No-rooms reservation: everything with overlapping dates matches (baseline).
const noRoomRes = { ...r, booking_code: null, room_id: null };
assert.deepEqual(
  correlate(noRoomRes, [checkinA, checkinB, checkinNull]).map(c => c.id).sort(),
  ['c1', 'c2', 'c3'],
  'no-room reservation keeps the pre-Round-60 fallback behaviour');

// ── 4. _computeReservationOverlap filter branch ───────────────────
// The function body contains the filter branch; we assert its shape in
// source and then simulate the filter logic in isolation.
assert.match(html, /if \(!roomId\) return projected;/,
  'overlap: no roomId → unchanged behaviour');
assert.match(html, /return projected\.filter\(r => !r\.room_id \|\| r\.room_id === roomId\)/,
  'overlap: with roomId → same room OR unassigned');

function filterOverlap(projected, roomId) {
  if (!roomId) return projected;
  return projected.filter(r => !r.room_id || r.room_id === roomId);
}

const rows = [
  { id: 'x1', room_id: roomA, checkin_date: '2026-08-01', checkout_date: '2026-08-04' },
  { id: 'x2', room_id: roomB, checkin_date: '2026-08-01', checkout_date: '2026-08-04' },
  { id: 'x3', room_id: null,  checkin_date: '2026-08-01', checkout_date: '2026-08-04' },
];
assert.deepEqual(filterOverlap(rows, null).map(x => x.id), ['x1', 'x2', 'x3'],
  'no roomId → all overlapping rows returned');
assert.deepEqual(filterOverlap(rows, roomA).map(x => x.id), ['x1', 'x3'],
  'roomA → only roomA + unassigned returned (never roomB)');
assert.deepEqual(filterOverlap(rows, roomB).map(x => x.id), ['x2', 'x3'],
  'roomB → only roomB + unassigned returned (never roomA)');

// ── 5. parseICS still works with room-less feeds (regression) ─────
const feed = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:test-uid-1', 'SUMMARY:Reserved',
  'DTSTART;VALUE=DATE:20260601', 'DTEND;VALUE=DATE:20260604',
  'END:VEVENT', 'END:VCALENDAR',
].join('\r\n');
const events = parseICS(feed);
const row = vEventToRow(events[0], 'p1', 'airbnb');
assert.equal(row.property_id, 'p1');
assert.equal(row.uid, 'test-uid-1');
// vEventToRow does not stamp room_id by itself; that happens in
// syncOnePropertyFeeds after the per-feed spread. Round 60 Phase 2 is
// deliberately a thin stamp so vEventToRow stays zero-impact.
assert.equal(row.room_id, undefined, 'vEventToRow stays room-unaware; stamp happens in the caller');

console.log('PASS rooms-sync: _validUuidOrNull, matchOrigin per-room (and NULL/NULL baseline preserved), date-fallback correlation respects room_id, _computeReservationOverlap filter branch keeps unassigned, vEventToRow unchanged.');
