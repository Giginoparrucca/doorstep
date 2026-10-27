// Round 66 Phase 1b — snapshot loader for the entry-release policy.
//
// Reads a coherent snapshot of the authoritative state the policy needs:
//   - property row (visibility flags, access_method, keybox_code; the new
//     Phase 2 columns entry_checkin_required/entry_release_time/entry_timezone
//     are explicitly set to null here because the column migration has not
//     landed yet)
//   - matched OTA reservation row (if any — may be absent for standalone
//     guest-link bookings)
//   - all live check-in rows for the booking (used to compute
//     legacy_has_checkin + supply the rotating-code projection with its
//     "single head" leader row)
//   - the room row if the booking's resolved room is unambiguous
//
// For every property today (opt-in UI unavailable; column absent)
// evaluateEntryRelease(snapshot) returns `legacy_available` when a check-in
// exists and `locked` when none exists — the same binary gate the raw
// bookingHasCheckin() call provides. Replacing bookingHasCheckin() with
// entryReleaseAllows() in handlers is therefore a behaviour-preserving
// change. Phase 2 adds the opt-in column and surfaces the policy's roster/
// time logic to properties that flip it ON.
//
// The loader does NOT read the Phase 1a entry_access.* tables yet. That
// integration lands in Phase 2 together with the opt-in UI, so no code path
// here reads data the host has not asked for.
//
// Design: pgrestGET is injected so this module stays test-friendly and does
// not duplicate api/guest.js's REST wiring. Callers pass the same pgrestGET
// they already use for their own queries.

import { createHash } from 'node:crypto';
import { evaluateEntryRelease, projectEntryInstructions } from './_entry-release-policy.js';

const PROPERTY_FIELDS = [
  'id', 'deleted_at', 'access_method', 'keybox_code',
  'show_fixed_lockbox_to_guest',
  'rotating_lockbox_enabled', 'use_per_guest_lockbox',
  'show_rotating_lockbox_to_guest',
].join(',');

const RESERVATION_FIELDS = [
  'id', 'property_id', 'booking_code', 'is_test', 'status', 'deleted_at',
  'entry_type', 'room_id', 'keybox_code', 'checkin_date', 'checkout_date',
].join(',');

const CHECKIN_FIELDS = [
  'id', 'property_id', 'booking_code', 'is_test', 'deleted_at',
  'guest_type', 'keybox_code', 'submitted_at',
].join(',');

const ROOM_FIELDS = ['id', 'property_id', 'deleted_at', 'door_code'].join(',');

// Derive a stable, UUID-shaped identifier for a standalone (no-reservation)
// booking. The policy requires booking.booking_id to be a non-empty string;
// using a deterministic hash keeps the identifier the same across repeated
// loads of the same booking and distinct across different bookings.
export function stableBookingId(propertyId, bookingCode, isTest) {
  const key = `${propertyId}|${bookingCode}|${isTest === true}`;
  const h = createHash('sha256').update(key).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const isTestLiteral = v => v === true ? 'true' : 'false';
const enc = encodeURIComponent;

// Read a single PostgREST path and parse the body. Returns null on any
// non-OK status, non-array body, or more than max rows. The caller treats
// a null here as a failed read and the policy fails closed.
async function readRows(pgrestGET, path, maxRows) {
  let res;
  try { res = await pgrestGET(path); } catch (_) { return null; }
  if (!res || !res.ok) return null;
  let rows;
  try { rows = await res.json(); } catch (_) { return null; }
  if (!Array.isArray(rows)) return null;
  if (typeof maxRows === 'number' && rows.length > maxRows) return null;
  return rows;
}

/**
 * Load a snapshot ready to feed to evaluateEntryRelease/projectEntryInstructions.
 *
 * @param {Object}   opts
 * @param {Function} opts.pgrestGET          Reads from PostgREST (same shape as api/guest.js's).
 * @param {string}   opts.propertyId         Verified property id from the signed guest token.
 * @param {string}   opts.bookingCode        Verified booking code from the signed guest token.
 * @param {boolean}  opts.isTest             Verified is_test flag from the signed guest token.
 * @param {string}   opts.sessionValidUntil  Absolute UTC ISO instant; must be in the future.
 * @returns {Promise<Object|null>}           Snapshot or null if any required read failed.
 */
export async function loadEntryReleaseSnapshot(opts) {
  const { pgrestGET, propertyId, bookingCode, isTest, sessionValidUntil } = opts || {};
  if (typeof pgrestGET !== 'function') return null;
  if (typeof propertyId !== 'string' || propertyId.length === 0) return null;
  if (typeof bookingCode !== 'string' || bookingCode.length === 0) return null;
  if (typeof sessionValidUntil !== 'string') return null;
  const sessionIso = (() => {
    const ms = Date.parse(sessionValidUntil);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
  })();
  if (!sessionIso) return null;

  // 1. Property row — the policy fails closed if this read misses.
  const propRows = await readRows(
    pgrestGET,
    `properties?id=eq.${enc(propertyId)}&deleted_at=is.null&select=${PROPERTY_FIELDS}&limit=1`,
    1,
  );
  if (!propRows || propRows.length !== 1) return null;
  const propertyRow = propRows[0];
  const property = {
    ...propertyRow,
    // Phase 2 adds these columns; they are explicitly null here so the policy
    // enters its "entry_checkin_required == null" branch and returns the
    // legacy-behaviour result based on snapshot.legacy_has_checkin.
    entry_checkin_required: null,
    entry_release_time: null,
    entry_timezone: null,
  };

  // 2. OTA reservation (0 or 1 row expected; >1 is ambiguous and fails closed).
  const resRows = await readRows(
    pgrestGET,
    `ota_reservations?property_id=eq.${enc(propertyId)}` +
      `&booking_code=eq.${enc(bookingCode)}&is_test=eq.${isTestLiteral(isTest)}` +
      `&deleted_at=is.null&status=eq.active&entry_type=eq.reservation` +
      `&select=${RESERVATION_FIELDS}&limit=2`,
    2,
  );
  if (resRows === null) return null;
  if (resRows.length > 1) return null;
  const reservation = resRows[0] || null;

  // 3. Check-ins for the booking — used for legacy_has_checkin AND for the
  //    rotating-code "single leader" projection path.
  const checkinRows = await readRows(
    pgrestGET,
    `checkins?property_id=eq.${enc(propertyId)}` +
      `&booking_code=eq.${enc(bookingCode)}&is_test=eq.${isTestLiteral(isTest)}` +
      `&deleted_at=is.null&select=${CHECKIN_FIELDS}`,
  );
  if (checkinRows === null) return null;
  const legacyHasCheckin = checkinRows.length > 0;

  // 4. Room (only if the reservation names one and it exists for THIS property).
  let room = null;
  if (reservation && reservation.room_id) {
    const roomRows = await readRows(
      pgrestGET,
      `property_rooms?id=eq.${enc(reservation.room_id)}` +
        `&property_id=eq.${enc(propertyId)}&deleted_at=is.null` +
        `&select=${ROOM_FIELDS}&limit=1`,
      1,
    );
    if (roomRows && roomRows.length === 1) room = roomRows[0];
  }

  // Synthesize a stable booking_id/identity_version for the OFF-path.
  // Phase 2 switches these over to entry_access.bookings.{id,identity_version}
  // once the host opts in.
  const bookingId = reservation?.id || stableBookingId(propertyId, bookingCode, isTest);
  const identityVersion = bookingId;

  const scope = Object.freeze({
    session_valid: true,
    session_valid_until: sessionIso,
    property_id: propertyId,
    booking_id: bookingId,
    booking_code: bookingCode,
    is_test: isTest === true,
  });

  const booking = {
    property_id: propertyId,
    booking_id: bookingId,
    is_test: isTest === true,
    booking_code: bookingCode,
    deleted_at: null,
    status: 'active',
    identity_version: identityVersion,
    valid_until: sessionIso,
    room_id: reservation?.room_id || null,
    expected_count: null,
    arrival_date: reservation?.checkin_date || null,
    keybox_code: reservation?.keybox_code || null,
  };

  // Submissions scoped and identity-tagged so the policy's leader filter
  // (guest_type in {single, head, group}) finds the right rows.
  const submissions = checkinRows.map(row => ({
    id: row.id,
    property_id: row.property_id,
    booking_id: bookingId,
    is_test: row.is_test,
    slot_id: row.id,
    deleted_at: row.deleted_at,
    guest_type: row.guest_type,
    keybox_code: row.keybox_code || null,
    submitted_at: row.submitted_at,
    identity_version: identityVersion,
  }));

  return {
    scope,
    reads_complete: true,
    legacy_has_checkin: legacyHasCheckin,
    property,
    booking,
    roster: null,
    submissions,
    override: null,
    room_resolution: reservation?.room_id && room ? 'unique' : 'none',
    room: reservation?.room_id && room ? room : null,
  };
}

/**
 * Thin convenience wrapper for handlers that want the single "may entry
 * codes be released?" boolean. Equivalent to today's bookingHasCheckin()
 * for every OFF-by-default property.
 */
export async function entryReleaseAllows(opts) {
  const snapshot = await loadEntryReleaseSnapshot(opts);
  if (!snapshot) return false;
  return evaluateEntryRelease(snapshot).allow_entry === true;
}

/**
 * Return the policy's positive entry projection (fixed_code / rotating_code
 * / room.door_code / access_method) for the current snapshot, or {} if the
 * policy denies entry. The projection respects every property-level
 * visibility flag already enforced by the policy module.
 */
export async function projectGuestEntry(opts) {
  const snapshot = await loadEntryReleaseSnapshot(opts);
  if (!snapshot) return {};
  return projectEntryInstructions(snapshot);
}
