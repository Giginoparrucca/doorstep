// Round 66 Phase 1 foundation. SERVER ONLY; not yet connected to a route.
// Inputs must be assembled from verified session + authoritative database reads,
// never req.body, JWT user_metadata, analytics, or the browser's guest count.
// See docs/entry-release/INTEGRATION.md for the persistence/validation contract.

const MINUTE = 60000;
const text = value => typeof value === 'string' && value.trim().length > 0;
const instant = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const scoped = (row, scope) => row && row.property_id === scope.property_id
  && row.booking_id === scope.booking_id && row.is_test === scope.is_test;

function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d\d-\d\d$/.test(day)
    && Number.isFinite(Date.parse(day))
    && new Date(day).toISOString().slice(0, 10) === day;
}

// A repeated local time uses its LATER occurrence (conservative disclosure).
// A nonexistent spring-forward time advances to the first real local minute.
// Skipped calendar days and gaps over three hours require host review.
export function arrivalReleaseInstant(day, time, timezone) {
  if (!validDay(day) || typeof time !== 'string'
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
      || !text(timezone) || /^[+-]/.test(timezone)) return null;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
  } catch { return null; }
  const wall = ms => {
    const p = Object.fromEntries(formatter.formatToParts(ms).map(p => [p.type, p.value]));
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  };
  const wanted = Date.parse(`${day}T${time}:00Z`);
  const offsets = new Set();
  // Samples span both sides of date-line and DST transitions. Modern IANA
  // offsets are <= 14h; the larger span also observes adjacent-day changes.
  for (let h = -36; h <= 36; h += 3) {
    const sample = wanted + h * 3600000;
    offsets.add(wall(sample) - sample);
  }
  for (let m = 0; m <= 180; m++) {
    const target = wanted + m * MINUTE;
    if (new Date(target).toISOString().slice(0, 10) !== day) return null;
    const candidates = [...offsets].map(offset => target - offset)
      .filter(candidate => wall(candidate) === target);
    if (candidates.length) return new Date(Math.max(...candidates)).toISOString();
  }
  return null;
}

function result(state, reason, counts = {}, releaseAt = null) {
  return Object.freeze({ state, reason,
    allow_entry: ['available', 'manual', 'legacy_available'].includes(state),
    submitted: counts.submitted ?? null, expected: counts.expected ?? null,
    release_at: releaseAt });
}

// This is a decision over a consistent, validated snapshot, NOT authentication.
// The caller must enforce the session's existing validity window before loading
// it. Explicit validity and read acknowledgements make missing data fail closed.
export function evaluateEntryRelease(snapshot, now = Date.now()) {
  const { scope, property, booking, roster, submissions, override } = snapshot || {};
  if (!Number.isFinite(now)) return result('unavailable', 'invalid_clock');
  if (!scope || scope.session_valid !== true || !text(scope.property_id)
      || !text(scope.booking_id) || !text(scope.booking_code)
      || typeof scope.is_test !== 'boolean'
      || !(instant(scope.session_valid_until) > now)) return result('invalid', 'invalid_session');
  if (snapshot.reads_complete !== true) return result('unavailable', 'incomplete_read');
  if (!property || property.id !== scope.property_id || property.deleted_at != null
      || !scoped(booking, scope) || booking.booking_code !== scope.booking_code
      || booking.deleted_at != null || booking.status !== 'active'
      || !text(booking.identity_version)
      || !(instant(booking.valid_until) > now)) return result('invalid', 'invalid_booking');
  // Missing column is the deliberate pre-migration OFF baseline. An invalid
  // value must never silently turn a configured restriction off.
  if (property.entry_checkin_required == null || property.entry_checkin_required === false) {
    return snapshot.legacy_has_checkin === true
      ? result('legacy_available', 'policy_off') : result('locked', 'legacy_checkin_required');
  }
  if (property.entry_checkin_required !== true) return result('unavailable', 'invalid_policy');
  if (!['unique', 'none'].includes(snapshot.room_resolution)
      || (snapshot.room_resolution === 'none' && (booking.room_id != null || snapshot.room != null))
      || (snapshot.room_resolution === 'unique' && (!snapshot.room
        || snapshot.room.property_id !== property.id || snapshot.room.id !== booking.room_id
        || snapshot.room.deleted_at != null))) return result('unavailable', 'unknown_room');

  // A manual release can bypass unknown/incomplete roster and time, but cannot
  // bypass invalid/expired bookings, failed reads, or identity/version changes.
  if (override != null) {
    if (!scoped(override, scope) || override.identity_version !== booking.identity_version) {
      return result('unavailable', 'override_identity_mismatch');
    }
    if (override.active === true) {
      if (!text(override.actor_id) || !text(override.audit_id)
          || !(instant(override.created_at) <= now)
          || override.audit_committed !== true) return result('unavailable', 'unaudited_override');
      return result('manual', 'host_release');
    }
    if (override.active !== false) return result('unavailable', 'invalid_override');
  }
  // Nothing persisted yet and no guest has checked in: the booking simply
  // has not started online check-in. Tell the guest to check in rather
  // than reporting a fault. Any check-in without a roster stays unavailable.
  if (roster == null && override == null && snapshot.legacy_has_checkin === false) {
    return result('locked', 'checkin_not_started');
  }
  if (!scoped(roster, scope) || roster.confirmed !== true
      || roster.identity_version !== booking.identity_version
      || !text(roster.version) || !['host', 'reservation', 'server_contract'].includes(roster.source)
      || !Array.isArray(roster.slots) || roster.slots.length === 0
      || roster.slots.length > 50) return result('unavailable', 'unknown_roster');
  const required = new Map();
  const allIds = new Set();
  const kinds = new Set(['single', 'head', 'group', 'member', 'group_member']);
  for (const slot of roster.slots) {
    if (!slot || !text(slot.id) || allIds.has(slot.id)
        || typeof slot.required !== 'boolean' || typeof slot.photo_required !== 'boolean'
        || !kinds.has(slot.guest_type)) return result('unavailable', 'invalid_roster');
    allIds.add(slot.id);
    if (slot.required) required.set(slot.id, slot);
  }
  const expected = required.size;
  // A trusted reservation count is a floor. Guest-declared party size and
  // inserted-row counts cannot lower it; absent knowledge is not "one guest".
  if (!expected || (booking.expected_count != null
      && (!Number.isInteger(booking.expected_count) || booking.expected_count < 1
          || booking.expected_count > 50 || expected < booking.expected_count))) {
    return result('unavailable', 'roster_count_mismatch');
  }
  if (!Array.isArray(submissions)) return result('unavailable', 'incomplete_read');
  const bySlot = new Map();
  for (const row of submissions) {
    if (!scoped(row, scope) || !allIds.has(row.slot_id) || !text(row.id)) {
      return result('unavailable', 'submission_scope_mismatch');
    }
    if (row.deleted_at != null) continue;
    // A DB UNIQUE constraint will make retries idempotent on (booking, slot).
    // Conflicting live rows must never count as two guests or "first wins".
    if (bySlot.has(row.slot_id)) return result('unavailable', 'duplicate_slot');
    bySlot.set(row.slot_id, row);
  }
  let submitted = 0;
  for (const [id, slot] of required) {
    const row = bySlot.get(id);
    // Evidence is recomputed server-side from the CURRENT persisted row.
    // A stale validation receipt, reopened draft, or missing required photo
    // cannot qualify. Police/receipt/tax status intentionally plays no part.
    if (row && row.validated === true && row.validation_version === 'entry-v1'
        && text(row.source_revision) && row.validated_revision === row.source_revision
        && row.roster_version === roster.version && row.guest_type === slot.guest_type
        && row.identity_version === booking.identity_version
        && row.reopened_at == null && instant(row.submitted_at) <= now
        && (!slot.photo_required || row.photo_verified === true)) submitted++;
  }
  const counts = { submitted, expected };
  if (submitted !== expected) return result('locked', 'checkin_incomplete', counts);
  if (property.entry_release_time != null) {
    const releaseAt = arrivalReleaseInstant(booking.arrival_date,
      property.entry_release_time, property.entry_timezone);
    if (!releaseAt) return result('unavailable', 'invalid_release_time', counts);
    if (now < Date.parse(releaseAt)) return result('scheduled', 'arrival_time', counts, releaseAt);
    return result('available', 'checkin_complete', counts, releaseAt);
  }
  return result('available', 'checkin_complete', counts);
}

const code = value => text(value)
  && !['n/a', 'na', '-', '—', 'none', 'nessuno'].includes(value.trim().toLowerCase())
  ? value.trim() : null;

// Positive projection of ENTRY fields only. All inputs are authoritative server
// rows. Nothing here is a guest response envelope or a public-property projector.
// Callers must not spread raw rows beside this return value.
export function projectEntryInstructions(snapshot, now = Date.now()) {
  // Do not accept a caller-supplied allow_entry boolean as permission.
  // Re-evaluate for this exact snapshot/request. `now` is a server clock/test
  // injection only, never an HTTP parameter.
  const current = evaluateEntryRelease(snapshot, now);
  if (!current.allow_entry) return {};
  const { property, booking, room, submissions = [] } = snapshot;
  const out = {};
  if (text(property.access_method)) out.access_method = property.access_method;
  if (property.show_fixed_lockbox_to_guest !== false && code(property.keybox_code)) {
    out.fixed_code = code(property.keybox_code);
  }
  if ((property.rotating_lockbox_enabled === true || property.use_per_guest_lockbox === true)
      && property.show_rotating_lockbox_to_guest !== false) {
    const leaders = (Array.isArray(submissions) ? submissions : []).filter(row => scoped(row, snapshot.scope) && row.deleted_at == null
      && row.identity_version === booking.identity_version
      && ['single', 'head', 'group'].includes(row.guest_type));
    // Reservation wins; conflicting/multiple leaders have no fallback code.
    const rotating = code(booking.keybox_code)
      || (leaders.length === 1 ? code(leaders[0].keybox_code) : null);
    if (rotating) out.rotating_code = rotating;
  }
  if (room && room.property_id === property.id && room.id === booking.room_id
      && room.deleted_at == null && snapshot.room_resolution === 'unique'
      && code(room.door_code)) out.room = { id: room.id, door_code: code(room.door_code) };
  return out;
}
