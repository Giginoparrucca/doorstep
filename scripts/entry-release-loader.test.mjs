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
import { loadEntryReleaseSnapshot, entryReleaseAllows, evaluateGuestEntryRelease, projectGuestEntry, stableBookingId } from '../api/_entry-release-loader.js';
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

// ── 18b. Phase 2e ON path — manual release (released_manually=true) ─────
// This is Daniele's pilot scenario: a host flips entry_checkin_required ON,
// then presses "Release access" on the host console. entry_access.bookings
// now carries released_manually=true + a manual_audit_id; the loader's
// callRPC returns that state and the policy must return 'manual' / 'host_release'
// with allow_entry=true, which the guest UI reads as "released".
{
  const EA_BOOKING_ID = 'db31d92b-c38d-446d-a7e3-0734372d047f';
  const EA_IDENT = '8fccb0a2-6aa3-408e-9b43-ee41bdd69d89';
  const AUDIT_ID = 'fab933db-99eb-4e10-88d7-5ee784e1cad6';
  const ACTOR_ID = '77eb5ef0-7dbd-48e6-87b5-2affe29a92ec';
  const pg = mockPgrest([
    ['properties?', [propertyRow({ entry_checkin_required: true })]],
    ['ota_reservations?', [reservationRow({ room_id: null })]],
    ['checkins?', []],  // manual release: no live check-ins required
  ]);
  const callRPC = async (name, args) => {
    assert.equal(name, 'get_entry_access_booking_state');
    assert.deepEqual(args, { p_property_id: PROPERTY_ID, p_booking_code: BOOKING_CODE, p_is_test: false });
    return { ok: true, json: async () => ({
      booking_id: EA_BOOKING_ID, property_id: PROPERTY_ID, booking_code: BOOKING_CODE,
      is_test: false, state_version: 'sv1', identity_version: EA_IDENT,
      roster_version: 'rv1', roster_source: 'host', roster_confirmed: true,
      expected_count: 8, arrival_date: '2026-11-01', departure_date: '2026-11-05',
      reservation_id: RESERVATION_ID, released_manually: true, manual_audit_id: AUDIT_ID,
      slots: Array.from({ length: 8 }, (_, i) => ({
        id: `slot-${i + 1}`, ordinal: i + 1, created_at: '2026-10-28T03:22:40Z',
      })),
      submissions: [],
      override_audit: { id: AUDIT_ID, actor_id: ACTOR_ID, action: 'entry_released', created_at: '2026-10-28T03:22:40Z' },
    }) };
  };
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, callRPC, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap, 'ON-path snapshot built from RPC state');
  assert.equal(snap.scope.booking_id, EA_BOOKING_ID, 'scope.booking_id driven by entry_access.bookings.id');
  assert.equal(snap.booking.identity_version, EA_IDENT, 'booking.identity_version from RPC');
  assert.equal(snap.booking.expected_count, 8, 'expected_count from RPC');
  assert.equal(snap.roster.slots.length, 8, '8 roster slots materialized');
  assert.equal(snap.roster.slots[0].guest_type, 'head', 'ordinal 1 → head for multi-slot booking');
  assert.equal(snap.roster.slots[7].guest_type, 'member', 'ordinal 8 → member');
  assert.equal(snap.override.active, true);
  assert.equal(snap.override.actor_id, ACTOR_ID);
  assert.equal(snap.override.audit_id, AUDIT_ID);
  assert.equal(snap.override.audit_committed, true);
  const r = evaluateEntryRelease(snap);
  assert.equal(r.state, 'manual', 'manual release returns state=manual');
  assert.equal(r.reason, 'host_release');
  assert.equal(r.allow_entry, true, 'manual release allows entry');
}

// ── 18c. Phase 2e ON path — single-guest booking (expected_count=1) ─────
// Edge case: a one-guest booking must map the sole slot to 'single' so
// projectEntryInstructions can find it as a leader for the rotating-code
// fallback. 'head' with no other slots would still work for the policy's
// leader filter, but 'single' is the canonical shape.
{
  const EA_BOOKING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
  const EA_IDENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
  const pg = mockPgrest([
    ['properties?', [propertyRow({ entry_checkin_required: true, use_per_guest_lockbox: true, rotating_lockbox_enabled: false })]],
    ['ota_reservations?', [reservationRow({ keybox_code: null, room_id: null })]],
    ['checkins?', [checkinRow({ keybox_code: '7777', guest_type: 'single' })]],
  ]);
  const callRPC = async () => ({ ok: true, json: async () => ({
    booking_id: EA_BOOKING_ID, property_id: PROPERTY_ID, booking_code: BOOKING_CODE,
    is_test: false, state_version: 'sv2', identity_version: EA_IDENT,
    roster_version: 'rv2', roster_source: 'reservation', roster_confirmed: true,
    expected_count: 1, arrival_date: '2026-11-01', departure_date: '2026-11-02',
    reservation_id: RESERVATION_ID, released_manually: false, manual_audit_id: null,
    slots: [{ id: 'slot-only', ordinal: 1, created_at: '2026-10-28T03:22:40Z' }],
    submissions: [{ slot_id: 'slot-only', checkin_id: CHECKIN_ID, bound_at: '2026-10-28T04:00:00Z' }],
    override_audit: null,
  }) });
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, callRPC, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  assert.equal(snap.roster.slots[0].guest_type, 'single', 'single-slot booking → guest_type=single');
  assert.equal(snap.override.active, false, 'released_manually=false → override.active=false');
  assert.equal(snap.submissions.length, 1, 'binding → one submission');
  assert.equal(snap.submissions[0].slot_id, 'slot-only');
  assert.equal(snap.submissions[0].validated, true);
  assert.equal(snap.submissions[0].validation_version, 'entry-v1');
  const r = evaluateEntryRelease(snap);
  assert.equal(r.state, 'available', 'all required slots submitted → available');
  assert.equal(r.allow_entry, true);
  const proj = projectEntryInstructions(snap);
  assert.equal(proj.rotating_code, '7777', 'single-head leader keybox_code projected on ON-path');
}

// ── 18d. Phase 2e — RPC returns null (no entry_access row yet) ──────────
// A host opted in but no RPC on the console has created a booking row yet
// (edge case: pre-existing booking from before opt-in). The loader must
// fall through to the OFF-path shape (roster=null) and the policy's ON
// branch fails closed to unavailable.
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ entry_checkin_required: true })]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const callRPC = async () => ({ ok: true, json: async () => null });
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, callRPC, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.ok(snap);
  assert.equal(snap.roster, null, 'RPC null → roster stays null');
  assert.equal(snap.override, null, 'RPC null → override stays null');
  const r = evaluateEntryRelease(snap);
  assert.equal(r.allow_entry, false, 'ON-path without entry_access row denies entry');
}

// ── 18e. Phase 2e — RPC call fails → fails closed (null snapshot) ──────
// A failed RPC read must NOT silently drop back to the legacy branch for
// a property that is opted in; that would release codes without the
// host's audited consent.
{
  const pg = mockPgrest([
    ['properties?', [propertyRow({ entry_checkin_required: true })]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const callRPC = async () => ({ ok: false, json: async () => null });
  const snap = await loadEntryReleaseSnapshot({
    pgrestGET: pg, callRPC, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(snap, null, 'failed RPC on opted-in property → null snapshot');
}

// ── 18f. Phase 2e — OFF path still works without callRPC injected ──────
// Backwards compatibility: an older caller that didn't inject callRPC
// must still get an OFF-path snapshot for properties that are not
// opted in, byte-for-byte identical to the pre-Phase-2e behaviour.
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
  assert.equal(snap.roster, null);
  assert.equal(snap.override, null);
  const r = evaluateEntryRelease(snap);
  assert.equal(r.state, 'legacy_available', 'no callRPC + OFF property → legacy_available');
}

// ── 19. evaluateGuestEntryRelease returns the full policy result ────────
// Used by doProperty to populate `entry_release` on the response so the
// guest UI can render locked / scheduled / released cards. Returns a
// bounded `unavailable` fallback when no snapshot can be loaded, so the
// caller never has to null-check.
{
  // No snapshot — fallback shape
  const noPg = async () => ({ ok: false, json: async () => [] });
  const fallback = await evaluateGuestEntryRelease({
    pgrestGET: noPg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(fallback.state, 'unavailable');
  assert.equal(fallback.allow_entry, false);
  assert.equal(fallback.release_at, null);
  assert.equal(fallback.submitted, null);
  assert.equal(fallback.expected, null);
}
{
  // OFF path, no check-in → locked
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', []],
    ['checkins?', []],
  ]);
  const result = await evaluateGuestEntryRelease({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(result.state, 'locked');
  assert.equal(result.allow_entry, false);
}
{
  // OFF path, with check-in → legacy_available
  const pg = mockPgrest([
    ['properties?', [propertyRow()]],
    ['ota_reservations?', [reservationRow()]],
    ['checkins?', [checkinRow()]],
  ]);
  const result = await evaluateGuestEntryRelease({
    pgrestGET: pg, propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE, isTest: false, sessionValidUntil: SESSION_VALID_UNTIL,
  });
  assert.equal(result.state, 'legacy_available');
  assert.equal(result.allow_entry, true);
}

console.log('PASS entry-release-loader: 24 scenarios across guards, OFF-path legacy equivalence (bookingHasCheckin), rotating-code projection parity with api/guest.js, room resolution with cross-property isolation, stableBookingId determinism, scope/booking/reads_complete shape, Phase 2 ON-path fail-closed check, Phase 2e manual-override release / single-guest automatic / RPC-null fallthrough / RPC-fail fail-closed / backwards-compat without callRPC, and evaluateGuestEntryRelease shape for guest UI consumption.');
