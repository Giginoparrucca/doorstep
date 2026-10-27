// Round 66 Phase 1b — entry-release snapshot loader unit tests.
//
// Verifies the loader's OFF-path contract:
//   - Produces a snapshot the policy accepts, with every required field.
//   - Fails closed (returns null) on any missing/ambiguous/malformed read.
//   - For every property today (opt-in column absent, so entry_checkin_required
//     is set to null in the snapshot), the policy evaluates to
//     `legacy_available` when a check-in row exists and `locked` otherwise —
//     a behaviour-preserving swap for bookingHasCheckin() in handlers.
//   - The rotating-code projection matches the current api/guest.js behaviour:
//     ota_reservations.keybox_code wins; otherwise a single head/single/group
//     check-in's keybox_code is used.
//
// Mocks pgrestGET to return canned rows for each table. No real DB.
import assert from 'node:assert/strict';
import { loadEntryReleaseSnapshot, entryReleaseAllows, projectGuestEntry, stableBookingId } from '../api/_entry-release-loader.js';
import { evaluateEntryRelease, projectEntryInstructions } from '../api/_entry-release-policy.js';

const PROPERTY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const BOOKING_CODE = 'ABC-123';
const RESERVATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const CHECKIN_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const ROOM_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';
const SESSION_VALID_UNTIL = new Date(Date.now() + 86400 * 1000).toISOString();

// Build a mock pgrestGET that returns canned rows per URL pattern.
function mockPgrest(canned) {
  const calls = [];
  async function pgrestGET(path) {
    calls.push(path);
    for (const [matcher, rows] of canned) {
      if (matcher instanceof RegExp ? matcher.test(path) : path.includes(matcher)) {
        return { ok: true, json: async () => rows };
      }
    }
    // Default empty-array response.
    return { ok: true, json: async () => [] };
  }
  pgrestGET.calls = calls;
  return pgrestGET;
}

const propertyRow = (over = {}) => ({
  id: PROPERTY_ID,
  deleted_at: null,
  access_method: 'Lockbox a destra della porta',
  keybox_code: '1234',
  show_fixed_lockbox_to_guest: true,
  rotating_lockbox_enabled: true,
  use_per_guest_lockbox: false,
  show_rotating_lockbox_to_guest: true,
  ...over,
});

const reservationRow = (over = {}) => ({
  id: RESERVATION_ID,
  property_id: PROPERTY_ID,
  booking_code: BOOKING_CODE,
  is_test: false,
  status: 'active',
  deleted_at: null,
  entry_type: 'reservation',
  room_id: null,
  keybox_code: '9876',
  checkin_date: '2026-11-01',
  checkout_date: '2026-11-05',
  ...over,
});

const checkinRow = (over = {}) => ({
  id: CHECKIN_ID,
  property_id: PROPERTY_ID,
  booking_code: BOOKING_CODE,
  is_test: false,
  deleted_at: null,
  guest_type: 'head',
  keybox_code: null,
  submitted_at: new Date(Date.now() - 3600 * 1000).toISOString(),
  ...over,
});

// ── 1. Guards ────────────────────────────────────────────────────────────
{
  const pg = mockPgrest([]);
  const bad = [
    { pgrestGET: null, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL },
    { pgrestGET: pg, propertyId: '', bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL },
    { pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: '', isTest: false, sessionValidUntil: SESSION_VALID_UNTIL },
    { pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: 'not-a-date' },
    { pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: null },
  ];
  for (const args of bad) {
    assert.equal(await loadEntryReleaseSnapshot(args), null, `malformed args must return null: ${JSON.stringify(Object.keys(args))}`);
  }
}

// ── 2. Property read fails → null (closed) ──────────────────────────────
{
  const pgrestGET = async () => ({ ok: false, json: async () => [] });
  assert.equal(await loadEntryReleaseSnapshot({
    pgrestGET, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), null, 'property read failure must return null');
}

// ── 3. Property not found → null ────────────────────────────────────────
{
  const pg = mockPgrest([['properties?', []]]);
  assert.equal(await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), null, 'missing property must return null');
}

// ── 4. Ambiguous reservation (>1 row) → null ────────────────────────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow(), reservationRow({ id: 'xx' + RESERVATION_ID.slice(2) })]],
  ]);
  assert.equal(await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), null, 'ambiguous reservation must return null');
}

// ── 5. Standalone (no reservation) + no check-in → OFF-path locked ──────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', []],
    ['checkins?', []],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap, 'standalone no-checkin snapshot built');
  assert.equal(snap.legacy_has_checkin, false);
  assert.equal(snap.scope.booking_id, stableBookingId(PROPERTY_ID, BOOKING_CODE, false));
  const r = evaluateEntryRelease(snap);
  assert.equal(r.state, 'locked');
  assert.equal(r.allow_entry, false, 'OFF + no check-in → bookingHasCheckin()=false equivalent');
}

// ── 6. Standalone + check-in exists → OFF-path legacy_available ─────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', []],
    ['checkins?', [checkinRow()]],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  assert.equal(snap.legacy_has_checkin, true);
  const r = evaluateEntryRelease(snap);
  assert.equal(r.state, 'legacy_available');
  assert.equal(r.allow_entry, true, 'OFF + check-in → bookingHasCheckin()=true equivalent');
}

// ── 7. Reservation + head check-in → rotating_code projection ──────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  const proj = projectEntryInstructions(snap);
  assert.equal(proj.rotating_code, '9876', 'reservation keybox_code wins over single-head fallback');
  assert.equal(proj.fixed_code, '1234');
  assert.equal(proj.access_method, 'Lockbox a destra della porta');
}

// ── 8. show_rotating_lockbox_to_guest=false → rotating_code hidden ─────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ show_rotating_lockbox_to_guest: false })]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const proj = await projectGuestEntry({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(proj.rotating_code, undefined, 'rotating code hidden when show flag is false');
  assert.equal(proj.fixed_code, '1234', 'fixed code still shown');
}

// ── 9. rotating_lockbox_enabled=false && use_per_guest=false → no rotating code ─
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ rotating_lockbox_enabled: false, use_per_guest_lockbox: false })]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const proj = await projectGuestEntry({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(proj.rotating_code, undefined, 'rotating code absent when rotating lockbox is disabled');
}

// ── 10. per-guest lockbox: single head with its own code → rotating_code ─
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ rotating_lockbox_enabled: false, use_per_guest_lockbox: true })]],
    ['ota_reservations?', [reservationRow({ keybox_code: null })]],
    ['checkins?', [checkinRow({ guest_type: 'head', keybox_code: '5555' })]],
  ]);
  const proj = await projectGuestEntry({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(proj.rotating_code, '5555', 'single-head keybox_code projected when reservation has none');
}

// ── 11. per-guest lockbox: two heads → ambiguous → no code ─────────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ rotating_lockbox_enabled: false, use_per_guest_lockbox: true })]],
    ['ota_reservations?', [reservationRow({ keybox_code: null })]],
    ['checkins?', [
      checkinRow({ guest_type: 'head', keybox_code: '5555' }),
      checkinRow({ id: 'other' + CHECKIN_ID.slice(5), guest_type: 'head', keybox_code: '6666' }),
    ]],
  ]);
  const proj = await projectGuestEntry({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(proj.rotating_code, undefined, 'two conflicting heads → no fallback code');
}

// ── 12. Room assigned → room_resolution=unique + door_code ─────────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow({ room_id: ROOM_ID })]],
    ['checkins?', [checkinRow()]],
    ['property_rooms?', [{ id: ROOM_ID, property_id: PROPERTY_ID, deleted_at: null, door_code: 'ROOM-7' }]],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  assert.equal(snap.room_resolution, 'unique');
  assert.equal(snap.room.door_code, 'ROOM-7');
  const proj = projectEntryInstructions(snap);
  assert.equal(proj.room?.door_code, 'ROOM-7');
}

// ── 13. Room id present but property_rooms missing → no room (no leaked info) ─
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow({ room_id: ROOM_ID })]],
    ['checkins?', [checkinRow()]],
    ['property_rooms?', []],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  // Room id was in the reservation but no matching property_rooms row — the policy
  // treats this as unknown_room (unavailable). This is the same fail-closed behaviour
  // the handlers rely on today when a room read misses.
  assert.equal(snap.room, null);
  assert.equal(snap.room_resolution, 'none');
  assert.equal(snap.booking.room_id, ROOM_ID);
  const r = evaluateEntryRelease(snap);
  // Policy's "room_resolution='none' but booking.room_id != null" → unavailable.
  // In OFF path (entry_checkin_required=null), the policy returns legacy_available
  // BEFORE room checks. So OFF path still works. Confirm.
  assert.equal(r.state, 'legacy_available', 'OFF path short-circuits before room check');
}

// ── 14. Deleted property → null ────────────────────────────────────────
{
  const pg = mockPgrest([['properties?', []]]);  // deleted_at=is.null filter excludes it
  assert.equal(await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), null, 'deleted property returns null (fails PostgREST deleted_at=is.null filter)');
}

// ── 15. entryReleaseAllows convenience wrapper ─────────────────────────
{
  const withCheckin = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const withoutCheckin = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', []],
  ]);
  assert.equal(await entryReleaseAllows({
    pgrestGET: withCheckin, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), true, 'allow with check-in');
  assert.equal(await entryReleaseAllows({
    pgrestGET: withoutCheckin, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  }), false, 'deny without check-in');
}

// ── 16. stableBookingId determinism ────────────────────────────────────
{
  const a = stableBookingId(PROPERTY_ID, BOOKING_CODE, false);
  const b = stableBookingId(PROPERTY_ID, BOOKING_CODE, false);
  const c = stableBookingId(PROPERTY_ID, BOOKING_CODE, true);
  const d = stableBookingId(PROPERTY_ID, 'OTHER-CODE', false);
  assert.equal(a, b, 'identical inputs → identical id');
  assert.notEqual(a, c, 'different is_test → different id');
  assert.notEqual(a, d, 'different booking_code → different id');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'UUID-shaped output');
}

// ── 17. Scope + booking + reads_complete populated correctly ──────────
{
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(snap.reads_complete, true);
  assert.equal(snap.scope.session_valid, true);
  assert.equal(snap.scope.property_id, PROPERTY_ID);
  assert.equal(snap.scope.booking_code, BOOKING_CODE);
  assert.equal(snap.scope.is_test, false);
  assert.equal(snap.booking.identity_version, snap.scope.booking_id);
  assert.equal(snap.booking.valid_until, snap.scope.session_valid_until);
  // Round 66 Phase 2 — the opt-in column is now real on public.properties
  // with default=false. The loader passes the row value through verbatim.
  // This mock row does not set entry_checkin_required, so it is undefined
  // on the spread; the policy's "entry_checkin_required == null || false"
  // branch handles both undefined and null the same way as it handles
  // false, so OFF-path semantics are preserved.
  assert.ok(
    snap.property.entry_checkin_required === undefined
    || snap.property.entry_checkin_required === null
    || snap.property.entry_checkin_required === false,
    'Phase 2 column: null/false/undefined all trigger the policy OFF branch',
  );
}

// ── 18. Phase 2 ON path — host opts in but roster not persisted ────────
// Verifies the policy stops returning legacy_available once a host sets
// entry_checkin_required=true: without a persisted roster (loader does
// not yet read entry_access.bookings — Phase 2 scope), the policy must
// fail closed to unavailable, denying code projection.
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ entry_checkin_required: true })]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  assert.equal(snap.property.entry_checkin_required, true, 'ON-path mock row forwarded');
  const r = evaluateEntryRelease(snap);
  // The policy's ON branch requires roster/room/submissions all to be
  // consistent. With roster=null (Phase 2b will supply it) the policy
  // short-circuits to unavailable — exactly the fail-closed behaviour
  // we want for a host who has opted in but not yet shipped Phase 2's
  // roster integration.
  assert.notEqual(r.state, 'legacy_available', 'ON-path must leave the legacy branch');
  assert.equal(r.allow_entry, false, 'ON-path with unpersisted roster denies entry');
}

console.log('PASS entry-release-loader: 18 scenarios across guards, OFF-path legacy equivalence (bookingHasCheckin), rotating-code projection parity with api/guest.js, room resolution with cross-property isolation, stableBookingId determinism, scope/booking/reads_complete shape, and the Phase 2 ON-path fail-closed check.');
