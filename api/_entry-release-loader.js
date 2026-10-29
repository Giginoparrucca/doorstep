// Shared entry policy loader. ON properties use the versioned service-only
// RPC for a coherent property/reservation/roster/submission/room snapshot.
// OFF keeps the legacy check-in gate but reconciles all room assignments.
// Callers inject scoped REST/RPC transports; failures withhold entry data.

import { createHash } from 'node:crypto';
import { validatePersistedEntrySubmission } from './_entry-submission-validation.js';
import { evaluateEntryRelease, projectEntryInstructions } from './_entry-release-policy.js';

const PROPERTY_FIELDS = [
  'id', 'deleted_at', 'access_method', 'keybox_code',
  'show_fixed_lockbox_to_guest',
  'rotating_lockbox_enabled', 'use_per_guest_lockbox',
  'show_rotating_lockbox_to_guest',
  // Round 66 Phase 2 — opt-in column + optional release-time pair.
  // Default is false, so every property today still hits the policy's
  // "entry_checkin_required == null || === false" legacy branch and the
  // response stays byte-equivalent to the prior bookingHasCheckin() path.
  'entry_checkin_required',
  'entry_release_time', 'entry_release_timezone',
].join(',');

const RESERVATION_FIELDS = [
  'id', 'property_id', 'booking_code', 'is_test', 'status', 'deleted_at',
  'entry_type', 'room_id', 'keybox_code', 'checkin_date', 'checkout_date',
].join(',');

const CHECKIN_FIELDS = [
  'id', 'property_id', 'booking_code', 'is_test', 'deleted_at',
  'guest_type', 'keybox_code', 'submitted_at', 'room_id',
].join(',');

const ROOM_FIELDS = ['id', 'property_id', 'deleted_at', 'door_code', 'name', 'beds'].join(',');

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
 * @param {Function} [opts.callRPC]          Posts to /rest/v1/rpc/<name>; required for the Phase 2 ON path.
 * @param {string}   opts.propertyId         Verified property id from the signed guest token.
 * @param {string}   opts.bookingCode        Verified booking code from the signed guest token.
 * @param {boolean}  opts.isTest             Verified is_test flag from the signed guest token.
 * @param {string}   opts.sessionValidUntil  Absolute UTC ISO instant; must be in the future.
 * @returns {Promise<Object|null>}           Snapshot or null if any required read failed.
 */
export async function loadEntryReleaseSnapshot(opts) {
  const { pgrestGET, callRPC, propertyId, bookingCode, isTest, sessionValidUntil } = opts || {};
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
  // Round 66 Phase 2 — the opt-in columns are now real on public.properties
  // with a default of false. The policy's "entry_checkin_required == null
  // || === false" branch continues to return legacy_available/locked
  // identically to the prior bookingHasCheckin() path for every property
  // today, since no host console surface yet lets a host set the column
  // to true. When Phase 2 ships that UI, flipping the toggle fires the
  // policy's roster/time path automatically — no further handler change.
  //
  // The policy expects `entry_timezone` on the snapshot, but the column
  // is named `entry_release_timezone` on the properties row so the two
  // sides don't collide with any pre-existing `properties.timezone` and
  // because the column name itself describes what it does. Map it here.
  const property = {
    ...propertyRow,
    entry_timezone: propertyRow.entry_release_timezone ?? null,
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
  let reservation = resRows[0] || null;

  // 3. Check-ins for the booking — used for legacy_has_checkin AND for the
  //    rotating-code "single leader" projection path.
  let checkinRows = await readRows(
    pgrestGET,
    `checkins?property_id=eq.${enc(propertyId)}` +
      `&booking_code=eq.${enc(bookingCode)}&is_test=eq.${isTestLiteral(isTest)}` +
      `&deleted_at=is.null&select=${CHECKIN_FIELDS}`,
  );
  if (checkinRows === null) return null;
  // PostgREST can cap an unpaginated result at 1000 rows. Never infer a
  // unique assignment from a possibly truncated party.
  if (checkinRows.length >= 1000) return null;
  let legacyHasCheckin = checkinRows.length > 0;

  // ON rooms come only from the coherent RPC below. OFF must reconcile all
  // current assignments too: a first-row/check-in precedence can select the
  // wrong room when companions or the reservation disagree.
  let room = null;
  let roomResolution = 'none', resolvedRoomId = null;

  // Round 66 Phase 2e — when the host has opted in AND a callRPC is
  // injected, fetch the entry_access state for this booking. If the
  // RPC returns a row we drive booking_id/identity_version from it and
  // synthesize roster/submissions/override; if it returns null the host
  // opted in but no roster has been persisted yet, so we fall through
  // to the OFF-path snapshot and let the policy's ON-branch fail closed
  // to unavailable (unknown_roster) — the same fail-closed behaviour
  // Phase 2 shipped with when the loader hadn't integrated yet.
  let eaState = null;
  if (property.entry_checkin_required === true && typeof callRPC === 'function') {
    try {
      const rpcRes = await callRPC('get_entry_access_booking_snapshot', {
        p_property_id: propertyId,
        p_booking_code: bookingCode,
        p_is_test: isTest === true,
      });
      if (!rpcRes || !rpcRes.ok) return null;
      let parsed;
      try { parsed = await rpcRes.json(); } catch (_) { return null; }
      // The RPC returns the jsonb object itself (or null) wrapped in an
      // array by PostgREST's "unnamed function" convention. Normalize.
      if (Array.isArray(parsed)) parsed = parsed[0] ?? null;
      if (parsed && typeof parsed === 'object') eaState = parsed;
    } catch (_) {
      // A failed RPC read fails closed — do not silently drop back to
      // the legacy branch for a property that is opted in.
      return null;
    }
  }

  // Versioned RPC reads the ON property, reservation, bindings, current guest
  // rows and storage evidence under one database snapshot. Never fabricate
  // validation or photo evidence from a binding or from earlier REST reads.
  if (eaState) {
    if (eaState.snapshot_version !== 2 || !eaState.property_snapshot
      || eaState.property_snapshot.id !== propertyId
      || eaState.property_snapshot.entry_checkin_required !== true
      || !Array.isArray(eaState.current_rows)) return null;
    Object.assign(property, eaState.property_snapshot, {
      entry_timezone: eaState.property_snapshot.entry_release_timezone ?? null,
    });
    reservation = eaState.reservation_snapshot || null;
    checkinRows = eaState.current_rows;
    legacyHasCheckin = checkinRows.some(row => row.deleted_at == null);
    room = eaState.room_snapshot || null;
  }

  if (property.entry_checkin_required !== true) {
    const roomIds = new Set([reservation?.room_id, ...checkinRows.map(row => row.room_id)].filter(Boolean));
    roomResolution = roomIds.size > 1 ? 'ambiguous' : roomIds.size === 1 ? 'unique' : 'none';
    if (roomIds.size === 1) {
      resolvedRoomId = [...roomIds][0];
      const rows = await readRows(pgrestGET,
        `property_rooms?id=eq.${enc(resolvedRoomId)}&property_id=eq.${enc(propertyId)}` +
        `&deleted_at=is.null&select=${ROOM_FIELDS}&limit=1`, 1);
      if (rows === null) return null;
      room = rows[0] || null;
      if (!room || room.id !== resolvedRoomId || room.property_id !== propertyId || room.deleted_at != null) {
        room = null;
        roomResolution = 'ambiguous';
      }
    }
  }

  // A saved release must still refer to the current active reservation.
  // The active-only query returns no row after cancellation/deletion; do
  // not reinterpret its persisted override as a standalone booking. Date
  // edits and replacement reservations likewise require a fresh contract.
  if (eaState) {
    if (eaState.property_id !== propertyId || eaState.booking_code !== bookingCode
      || eaState.is_test !== (isTest === true)) return null;
    if ((eaState.reservation_id ?? null) !== (reservation?.id ?? null)) return null;
    if (reservation && (eaState.arrival_date !== reservation.checkin_date
      || eaState.departure_date !== reservation.checkout_date)) return null;
  }

  const bookingId = eaState?.booking_id
    || reservation?.id
    || stableBookingId(propertyId, bookingCode, isTest);
  const identityVersion = eaState?.identity_version || bookingId;

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
    status: eaState?.status || 'active',
    identity_version: identityVersion,
    valid_until: sessionIso,
    room_id: eaState ? eaState.resolved_room_id ?? null : resolvedRoomId,
    expected_count: eaState?.expected_count ?? null,
    arrival_date: eaState?.arrival_date || reservation?.checkin_date || null,
    departure_date: eaState?.departure_date || reservation?.checkout_date || null,
    keybox_code: reservation?.keybox_code || null,
  };

  // Build roster + submissions + override on the ON path. The policy's
  // scoped() helper requires property_id/booking_id/is_test to match
  // the scope exactly, so stamp every synthesized row with those.
  let roster = null;
  let override = null;
  let submissions;
  if (eaState) {
    const slotList = Array.isArray(eaState.slots) ? eaState.slots : [];
    // guest_type per slot — the policy accepts single/head/group/member/
    // group_member. For a party of 1, use 'single' (one guest, no leader
    // concept). For a party of 2+, slot 1 is the 'head' and the rest are
    // 'member'. These match the categories the manual-override confirm
    // path persists for the audit trail.
    const guestTypeFor = (ordinal, total) => {
      if (total === 1) return 'single';
      if (ordinal === 1) return 'head';
      return 'member';
    };
    const rosterSlots = slotList.map(s => ({
      id: s.id,
      required: true,
      photo_required: s.photo_required === true,
      guest_type: s.guest_type || guestTypeFor(s.ordinal, slotList.length),
    }));
    roster = {
      property_id: propertyId,
      booking_id: bookingId,
      is_test: isTest === true,
      confirmed: eaState.roster_confirmed === true,
      identity_version: identityVersion,
      version: eaState.roster_version || null,
      source: eaState.roster_source || null,
      slots: rosterSlots,
    };

    // Submissions: entry_access.submissions binds a slot to a check-in
    // row. Translate each binding into the policy's submission shape
    // using the live check-in row for its id/submitted_at/keybox_code.
    const checkinById = new Map(checkinRows.map(row => [row.id, row]));
    const slotById = new Map(rosterSlots.map(slot => [slot.id, slot]));
    const subBindings = Array.isArray(eaState.submissions) ? eaState.submissions : [];
    submissions = [];
    for (const binding of subBindings) {
      const checkin = checkinById.get(binding.checkin_id);
      const slot = slotById.get(binding.slot_id);
      if (!slot) return null; // stale/foreign slot cannot silently disappear
      if (!checkin || checkin.deleted_at != null) continue;
      const validated = validatePersistedEntrySubmission(checkin, {
        booking, roster, slot,
        binding: { ...binding, booking_id: bookingId, property_id: propertyId },
        photo: { verified: checkin.entry_photo_verified === true,
          checkin_id: checkin.id, path: checkin.id_photo_path },
      });
      if (validated.submission) submissions.push({
        ...validated.submission, keybox_code: checkin.keybox_code || null,
      });
    }

    const audit = eaState.override_audit;
    override = {
      property_id: propertyId,
      booking_id: bookingId,
      is_test: isTest === true,
      identity_version: identityVersion,
      active: eaState.released_manually === true,
      actor_id: audit?.actor_id || null,
      audit_id: audit?.id || eaState.manual_audit_id || null,
      created_at: audit?.created_at || null,
      audit_committed: audit?.id != null,
    };
  } else {
    // OFF-path (unchanged): one synthesized "submission" per legacy
    // check-in row, keyed by the check-in id. The policy's OFF branch
    // short-circuits before touching these fields; they stay here so
    // projectEntryInstructions can still find the single-head leader
    // for the rotating-code fallback.
    submissions = checkinRows.map(row => ({
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
  }

  return {
    scope,
    reads_complete: true,
    legacy_has_checkin: legacyHasCheckin,
    property,
    booking,
    roster,
    submissions,
    override,
    room_resolution: eaState?.room_resolution || roomResolution,
    room,
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

/**
 * Return the full policy result ({ state, reason, allow_entry, submitted,
 * expected, release_at }) for the current snapshot. The guest app uses
 * this to render locked / scheduled / released cards without needing to
 * duplicate the policy's logic client-side.
 *
 * Returns a minimal unavailable result when the loader cannot assemble a
 * snapshot (missing booking, failed read, etc.) so the caller can key off
 * `state` without null-checking.
 */
export async function evaluateGuestEntryRelease(opts) {
  const snapshot = await loadEntryReleaseSnapshot(opts);
  if (!snapshot) {
    return Object.freeze({
      state: 'unavailable',
      reason: 'no_snapshot',
      allow_entry: false,
      submitted: null,
      expected: null,
      release_at: null,
    });
  }
  return evaluateEntryRelease(snapshot);
}

// One snapshot/decision for the property response, including its room code.
// The ON RPC intentionally carries no room display metadata. A later scoped
// read may supply a label, never a different assignment or a fresh door code.
export async function loadGuestPropertyAccess(opts) {
  const snapshot = await loadEntryReleaseSnapshot(opts);
  const now = Date.now();
  const policy = snapshot ? evaluateEntryRelease(snapshot, now) : {
    state: 'unavailable', reason: 'no_snapshot', allow_entry: false,
    submitted: null, expected: null, release_at: null,
  };
  let room = null;
  const source = snapshot?.room;
  if (snapshot && !['invalid', 'unavailable'].includes(policy.state)
    && snapshot.room_resolution === 'unique' && source
    && source.id === snapshot.booking.room_id && source.property_id === opts.propertyId
    && source.deleted_at == null) {
    let display = source;
    if (snapshot.property.entry_checkin_required === true) {
      const rows = await readRows(opts.pgrestGET,
        `property_rooms?id=eq.${enc(source.id)}&property_id=eq.${enc(opts.propertyId)}` +
        '&deleted_at=is.null&select=id,property_id,deleted_at,name,beds&limit=1', 1);
      display = rows?.length === 1 ? rows[0] : null;
    }
    if (display && display.id === source.id && display.property_id === opts.propertyId
      && display.deleted_at == null) {
      room = { id: source.id, name: display.name, beds: display.beds };
      if (policy.allow_entry === true && typeof source.door_code === 'string'
        && source.door_code.trim()) room.door_code = source.door_code.trim();
    }
  }
  return { policy, entryProperty: snapshot?.property || {}, room,
    rotatingCode: snapshot ? projectEntryInstructions(snapshot, now).rotating_code || null : null };
}
