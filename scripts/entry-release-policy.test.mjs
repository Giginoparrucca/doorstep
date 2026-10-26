import assert from 'node:assert/strict';
import { evaluateEntryRelease as evaluate, arrivalReleaseInstant as releaseAt,
  projectEntryInstructions as project } from '../api/_entry-release-policy.js';

const now = Date.parse('2026-10-26T12:00:00Z');
const scope = { property_id: 'property-a', booking_id: 'booking-a', booking_code: 'SYNTHETIC-A',
  is_test: false, session_valid: true, session_valid_until: '2026-10-26T23:00:00Z' };
const binding = { property_id: scope.property_id, booking_id: scope.booking_id, is_test: false };
function fixture() {
  return {
    reads_complete: true, scope: { ...scope }, room_resolution: 'none',
    property: { id: scope.property_id, entry_checkin_required: true,
      access_method: 'Synthetic access instructions', keybox_code: 'FIXED-FICTIONAL',
      rotating_lockbox_enabled: true },
    booking: { ...binding, booking_code: scope.booking_code, status: 'active',
      identity_version: 'identity-v1', expected_count: 3, arrival_date: '2026-10-26',
      valid_until: '2026-10-29T10:00:00Z', keybox_code: 'BOOKING-FICTIONAL' },
    roster: { ...binding, confirmed: true, identity_version: 'identity-v1', version: 'roster-v1',
      source: 'host', slots: [
        { id: 'slot-1', required: true, photo_required: true, guest_type: 'head' },
        { id: 'slot-2', required: true, photo_required: false, guest_type: 'member' },
        { id: 'slot-3', required: true, photo_required: false, guest_type: 'member' },
      ] },
    submissions: ['head', 'member', 'member'].map((guest_type, i) => ({
      ...binding, id: `row-${i + 1}`, slot_id: `slot-${i + 1}`, guest_type,
      validated: true, validation_version: 'entry-v1', source_revision: 'row-rev1',
      validated_revision: 'row-rev1', roster_version: 'roster-v1', identity_version: 'identity-v1',
      submitted_at: '2026-10-26T11:00:00Z', photo_verified: i === 0,
      keybox_code: i === 0 ? 'HEAD-FICTIONAL' : null,
    })),
  };
}
let cases = 0;
function check(label, mutate, state, reason) {
  const s = fixture(); mutate(s);
  const before = JSON.stringify(s);
  const decision = evaluate(s, now);
  assert.equal(decision.state, state, label);
  if (reason) assert.equal(decision.reason, reason, label);
  if (!decision.allow_entry) assert.deepEqual(project(s, now), {}, label + ': no entry values');
  assert.equal(JSON.stringify(s), before, label + ': no snapshot mutations');
  cases++;
  return decision;
}
const ok = () => {};
check('all three valid submissions', ok, 'available');
const partial = check('1 of 3 remains locked', s => s.submissions.splice(1), 'locked');
assert.deepEqual([partial.submitted, partial.expected], [1, 3]);
for (const [label, mutate, state, reason] of [
  ['missing snapshot', s => { s.reads_complete = false; }, 'unavailable', 'incomplete_read'],
  ['expired session boundary', s => { s.scope.session_valid_until = new Date(now).toISOString(); }, 'invalid'],
  ['revoked session', s => { s.scope.session_valid = false; }, 'invalid'],
  ['unbound precheckin session', s => { s.scope.booking_code = null; }, 'invalid'],
  ['expired stay', s => { s.booking.valid_until = '2026-10-26T11:00:00Z'; }, 'invalid'],
  ['foreign property', s => { s.property.id = 'property-b'; }, 'invalid'],
  ['foreign booking', s => { s.booking.booking_id = 'booking-b'; }, 'invalid'],
  ['foreign code', s => { s.booking.booking_code = 'SYNTHETIC-B'; }, 'invalid'],
  ['mixed test scope', s => { s.booking.is_test = true; }, 'invalid'],
  ['cancelled', s => { s.booking.status = 'cancelled'; }, 'invalid'],
  ['deleted booking', s => { s.booking.deleted_at = '2026-10-26T11:00:00Z'; }, 'invalid'],
  ['deleted property', s => { s.property.deleted_at = '2026-10-26T11:00:00Z'; }, 'invalid'],
  ['malformed policy', s => { s.property.entry_checkin_required = 'false'; }, 'unavailable'],
  ['unknown roster', s => { s.roster = null; }, 'unavailable', 'unknown_roster'],
  ['guest count is not authority', s => { s.roster.source = 'guest'; }, 'unavailable'],
  ['unconfirmed roster', s => { s.roster.confirmed = false; }, 'unavailable'],
  ['foreign roster', s => { s.roster.property_id = 'property-b'; }, 'unavailable'],
  ['roster cannot lower known total', s => { s.roster.slots.pop(); }, 'unavailable', 'roster_count_mismatch'],
  ['invalid known total', s => { s.booking.expected_count = '3'; }, 'unavailable'],
  ['no zero-guest completion', s => { s.roster.slots.forEach(r => { r.required = false; }); }, 'unavailable'],
  ['duplicate slot definitions', s => { s.roster.slots[1].id = 'slot-1'; }, 'unavailable'],
  ['invalid guest type', s => { s.roster.slots[1].guest_type = 'optional_minor'; }, 'unavailable'],
  ['deleted required submission', s => { s.submissions[1].deleted_at = '2026-10-26T11:30:00Z'; }, 'locked'],
  ['draft', s => { s.submissions[1].submitted_at = null; }, 'locked'],
  ['future submission', s => { s.submissions[1].submitted_at = '2026-10-27T11:00:00Z'; }, 'locked'],
  ['reopened', s => { s.submissions[1].reopened_at = '2026-10-26T11:30:00Z'; }, 'locked'],
  ['invalid persisted submission', s => { s.submissions[1].validated = false; }, 'locked'],
  ['unversioned validation', s => { s.submissions[1].validation_version = null; }, 'locked'],
  ['stale validation', s => { s.submissions[1].source_revision = 'row-rev2'; }, 'locked'],
  ['new roster invalidates receipts', s => { s.roster.version = 'roster-v2'; }, 'locked'],
  ['different booking identity', s => { s.submissions[1].identity_version = 'identity-v0'; }, 'locked'],
  ['missing required photo', s => { s.submissions[0].photo_verified = false; }, 'locked'],
  ['unknown submission slot', s => { s.submissions[1].slot_id = 'foreign-slot'; }, 'unavailable'],
  ['wrong tenant submission', s => { s.submissions[1].property_id = 'property-b'; }, 'unavailable'],
  ['wrong booking submission', s => { s.submissions[1].booking_id = 'booking-b'; }, 'unavailable'],
  ['duplicate retry cannot inflate count', s => { s.submissions[1].slot_id = 'slot-1'; }, 'unavailable'],
  ['partial read never zero counts', s => { s.submissions = null; }, 'unavailable'],
  ['ambiguous room', s => { s.room_resolution = 'ambiguous'; }, 'unavailable', 'unknown_room'],
  ['room read failure', s => { s.room_resolution = 'read_error'; }, 'unavailable'],
  ['missing assigned room', s => { s.booking.room_id = 'room-a'; }, 'unavailable'],
  ['unknown timezone', s => { s.property.entry_release_time = '15:00'; }, 'unavailable'],
  ['invalid time', s => { s.property.entry_release_time = '24:00'; s.property.entry_timezone = 'Europe/Rome'; }, 'unavailable'],
  ['invalid arrival date', s => { s.booking.arrival_date = '2026-02-30'; s.property.entry_release_time = '15:00'; s.property.entry_timezone = 'Europe/Rome'; }, 'unavailable'],
]) check(label, mutate, state, reason);
check('standalone confirmed contract', s => { s.roster.source = 'server_contract'; s.booking.expected_count = null; }, 'available');
check('provider outage and unpaid tax irrelevant', s => s.submissions.forEach(row => {
  row.alloggiati_status = 'error'; row.receipt_available = false; row.tax_paid = false;
}), 'available');
check('photo-exempt companions include minors', s => { s.submissions[1].photo_verified = false; }, 'available');
check('OFF baseline', s => { s.property.entry_checkin_required = false; s.legacy_has_checkin = true; s.roster = null; }, 'legacy_available');
check('OFF without prior checkin', s => { s.property.entry_checkin_required = false; }, 'locked');
check('missing pre-migration setting preserves OFF', s => { delete s.property.entry_checkin_required; s.legacy_has_checkin = true; }, 'legacy_available');

function manual(s) {
  s.override = { ...binding, identity_version: 'identity-v1', active: true,
    actor_id: 'host-a', audit_id: 'audit-fictional', audit_committed: true,
    created_at: '2026-10-26T11:00:00Z' };
}
check('audited host release bypasses roster/time', s => { manual(s); s.roster = null; s.property.entry_release_time = '23:59'; }, 'manual');
const noRoster = fixture(); manual(noRoster); noRoster.roster = null; noRoster.submissions = null;
assert.equal(project(noRoster, now).rotating_code, 'BOOKING-FICTIONAL'); cases++;
for (const [label, mutate, state] of [
  ['audit failed', s => { s.override.audit_committed = false; }, 'unavailable'],
  ['audit missing', s => { s.override.audit_id = null; }, 'unavailable'],
  ['actor missing', s => { s.override.actor_id = null; }, 'unavailable'],
  ['future override', s => { s.override.created_at = '2026-10-27T11:00:00Z'; }, 'unavailable'],
  ['another tenant override', s => { s.override.property_id = 'property-b'; }, 'unavailable'],
  ['another booking override', s => { s.override.booking_id = 'booking-b'; }, 'unavailable'],
  ['booking dates/link identity changed', s => { s.booking.identity_version = 'identity-v2'; }, 'unavailable'],
  ['manual release never revives cancellation', s => { s.booking.status = 'cancelled'; }, 'invalid'],
  ['manual release never revives expired token', s => { s.scope.session_valid = false; }, 'invalid'],
  ['manual release never bypasses read failure', s => { s.reads_complete = false; }, 'unavailable'],
]) check(label, s => { manual(s); mutate(s); }, state);
check('restore automatic policy relocks partial booking', s => {
  manual(s); s.override.active = false; s.submissions.pop();
}, 'locked');

// Exact timezone/DST expectations: no browser/default timezone dependency.
for (const [day, time, zone, expected] of [
  ['2026-10-26', '15:00', 'Europe/Rome', '2026-10-26T14:00:00.000Z'],
  ['2026-07-01', '15:00', 'Europe/Rome', '2026-07-01T13:00:00.000Z'],
  ['2026-10-26', '15:00', 'Asia/Singapore', '2026-10-26T07:00:00.000Z'],
  ['2026-10-26', '00:00', 'Pacific/Kiritimati', '2026-10-25T10:00:00.000Z'],
  ['2026-10-26', '23:59', 'Pacific/Pago_Pago', '2026-10-27T10:59:00.000Z'],
  ['2026-03-29', '02:30', 'Europe/Rome', '2026-03-29T01:00:00.000Z'],
  ['2026-10-25', '02:30', 'Europe/Rome', '2026-10-25T01:30:00.000Z'],
  ['2026-11-01', '01:30', 'America/New_York', '2026-11-01T06:30:00.000Z'],
  ['2026-10-04', '02:15', 'Australia/Lord_Howe', '2026-10-03T15:30:00.000Z'],
  ['2026-04-05', '01:45', 'Australia/Lord_Howe', '2026-04-04T15:15:00.000Z'],
  ['2028-02-29', '12:00', 'UTC', '2028-02-29T12:00:00.000Z'],
  ['2026-02-29', '12:00', 'UTC', null],
  ['2011-12-30', '12:00', 'Pacific/Apia', null],
  ['2026-10-26', '15:00', 'Unknown/Zone', null],
  ['2026-10-26', '15:00', '+01:00', null],
]) {
  assert.equal(releaseAt(day, time, zone), expected, `${day} ${time} ${zone}`); cases++;
}
const timed = fixture(); timed.property.entry_release_time = '15:00'; timed.property.entry_timezone = 'Europe/Rome';
const boundary = Date.parse('2026-10-26T14:00:00Z');
assert.equal(evaluate(timed, boundary - 1).state, 'scheduled');
assert.deepEqual(project(timed, boundary - 1), {});
assert.equal(evaluate(timed, boundary).state, 'available');
timed.booking.arrival_date = '2026-10-27';
assert.equal(evaluate(timed, boundary).state, 'scheduled');
timed.property.entry_timezone = 'Asia/Singapore';
assert.equal(evaluate(timed, boundary).state, 'scheduled');
cases += 5;

const s = fixture();
assert.deepEqual(project(s, now), { access_method: 'Synthetic access instructions',
  fixed_code: 'FIXED-FICTIONAL', rotating_code: 'BOOKING-FICTIONAL' });
delete s.booking.keybox_code;
assert.equal(project(s, now).rotating_code, 'HEAD-FICTIONAL');
s.property.show_rotating_lockbox_to_guest = false;
s.property.show_fixed_lockbox_to_guest = false;
assert.deepEqual(project(s, now), { access_method: 'Synthetic access instructions' });
s.property.show_fixed_lockbox_to_guest = true; s.property.keybox_code = ' N/A ';
assert.equal(project(s, now).fixed_code, undefined);
s.room_resolution = 'unique'; s.booking.room_id = 'room-a';
s.room = { id: 'room-a', property_id: 'property-a', door_code: 'ROOM-FICTIONAL', internal_secret: 'NEVER' };
assert.deepEqual(project(s, now).room, { id: 'room-a', door_code: 'ROOM-FICTIONAL' });
s.room.property_id = 'property-b';
assert.deepEqual(project(s, now), {});
assert.deepEqual(project(fixture(), { allow_entry: true }), {});
assert.equal(evaluate(undefined, now).allow_entry, false);
assert.equal(evaluate(fixture(), NaN).allow_entry, false);
cases += 9;
console.log(`PASS ${cases} entry-release policy scenarios; all denied states have empty entry projections. Synthetic only; no handler/RPC/live pass claimed.`);
