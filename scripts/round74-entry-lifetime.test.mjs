// Round 74 Phase 3 — audit WBNB-R003: entry information only during the
// stay. Actual loader + policy + projector (OFF and ON properties) with
// mocked reads and an injected clock. Decision D2: until the latest checkout
// time on the departure day + 2 hours (property time zone). Fictional data.
import assert from 'node:assert/strict';
import { loadEntryReleaseSnapshot, latestCheckoutTime, entryEntitlementEnd, ENTRY_GRACE_AFTER_CHECKOUT_MS } from '../api/_entry-release-loader.js';
import { evaluateEntryRelease, projectEntryInstructions } from '../api/_entry-release-policy.js';

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', CODE = 'HMOLD123';
const prop = (x = {}) => ({ id: P, deleted_at: null, access_method: 'Lockbox', keybox_code: 'FIXED-NOW', show_fixed_lockbox_to_guest: true,
  rotating_lockbox_enabled: true, use_per_guest_lockbox: false, show_rotating_lockbox_to_guest: true,
  entry_checkin_required: false, timezone: 'Europe/Rome', checkout_time: '08:00-10:30', ...x });
const res = (x = {}) => ({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', property_id: P, booking_code: CODE, is_test: false, status: 'active', deleted_at: null,
  entry_type: 'reservation', room_id: null, keybox_code: 'ROT-1', checkin_date: '2026-12-10', checkout_date: '2026-12-13', ...x });
const ci = (x = {}) => ({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', property_id: P, booking_code: CODE, is_test: false, deleted_at: null, guest_type: 'head',
  keybox_code: null, submitted_at: '2020-01-01T10:00:00Z', room_id: null, arrival_date: '2026-12-10', departure_date: '2026-12-13', ...x });
function pg({ property = prop(), active = [], any = active, checkins = [ci()] } = {}) {
  return async path => {
    let rows = [];
    if (path.startsWith('properties?')) rows = [property];
    else if (path.startsWith('ota_reservations?')) rows = /status=eq\.active/.test(path) ? active : any;
    else if (path.startsWith('checkins?')) rows = checkins;
    return { ok: true, json: async () => rows };
  };
}
const FAR_SESSION = '2099-01-01T00:00:00Z'; // a freshly renewed link: session far in the future
const at = iso => Date.parse(iso);
async function view(opts, nowIso, session = FAR_SESSION) {
  const snap = await loadEntryReleaseSnapshot({ pgrestGET: pg(opts), propertyId: P, bookingCode: CODE, isTest: false, sessionValidUntil: session });
  assert.ok(snap, 'snapshot loads');
  return { decision: evaluateEntryRelease(snap, at(nowIso)), entry: projectEntryInstructions(snap, at(nowIso)) };
}

// Free-text checkout times (as stored in production) → latest time.
for (const [t, want] of [['08:00-10:30', '10:30'], ['10:00:00-10:15', '10:15'], ['00:00-11:00', '11:00'], ['10:00:00', '10:00'], ['', '11:00'], [null, '11:00'], ['entro le 9:30', '09:30']])
  assert.equal(latestCheckoutTime(t), want, String(t));
assert.equal(ENTRY_GRACE_AFTER_CHECKOUT_MS, 2 * 3600 * 1000);
assert.equal(entryEntitlementEnd('2026-12-13', '08:00-10:30', 'Europe/Rome'), '2026-12-13T11:30:00.000Z', '10:30 CET + 2 h');
assert.equal(entryEntitlementEnd('2027-03-28', '11:00', 'Europe/Rome'), '2027-03-28T11:00:00.000Z', 'DST day: 11:00 CEST + 2 h = 13:00 CEST');
assert.equal(entryEntitlementEnd('2027-03-27', '11:00', 'Europe/Rome'), '2027-03-27T12:00:00.000Z', 'day before DST: 13:00 CET');
assert.equal(entryEntitlementEnd(null, '11:00', 'Europe/Rome'), null);

// The audit case: no active reservation, a check-in from 2020 → nothing, even with a fresh link.
{ const v = await view({ active: [], any: [], checkins: [ci({ arrival_date: '2020-02-01', departure_date: '2020-02-03' })] }, '2026-11-16T10:00:00Z');
  assert.equal(v.decision.allow_entry, false); assert.equal(v.decision.reason, 'invalid_booking'); assert.deepEqual(v.entry, {}, 'no fixed code from a 2020 link'); }
// Active stay: visible; checkout + grace boundary; after → nothing (fixed, rotating, room).
{ const o = { active: [res()] };
  let v = await view(o, '2026-12-11T09:00:00Z'); assert.equal(v.entry.fixed_code, 'FIXED-NOW'); assert.equal(v.entry.rotating_code, 'ROT-1');
  v = await view(o, '2026-12-13T11:29:59Z'); assert.equal(v.entry.fixed_code, 'FIXED-NOW', 'checkout 10:30 + 2 h − 1 s');
  v = await view(o, '2026-12-13T11:30:00Z'); assert.deepEqual(v.entry, {}, 'checkout + 2 h: gone'); assert.equal(v.decision.reason, 'invalid_booking');
  // Host changes the fixed code after the stay: still nothing.
  v = await view({ ...o, property: prop({ keybox_code: 'CHANGED-LATER' }) }, '2026-12-20T10:00:00Z'); assert.deepEqual(v.entry, {}); }
// Session renewal never extends the stay; a short session still limits.
{ const v1 = await view({ active: [res()] }, '2026-12-14T09:00:00Z', '2099-01-01T00:00:00Z'); assert.deepEqual(v1.entry, {}, 'renewed link after the stay');
  const v2 = await view({ active: [res()] }, '2026-12-11T12:00:00Z', '2026-12-11T11:00:00Z'); assert.equal(v2.decision.reason, 'invalid_session', 'expired session still refused'); }
// Cancelled or soft-deleted reservation: revoked, not a new standalone stay.
for (const gone of [res({ status: 'cancelled' }), res({ deleted_at: '2026-12-09T10:00:00Z' })]) {
  const v = await view({ active: [], any: [gone], checkins: [ci()] }, '2026-12-11T09:00:00Z');
  assert.equal(v.decision.allow_entry, false); assert.deepEqual(v.entry, {}, 'cancelled/deleted booking reveals nothing during its dates');
}
// Explicit walk-in (code never had a reservation): its own stay dates apply.
{ let v = await view({ active: [], any: [], checkins: [ci({ arrival_date: '2026-12-10', departure_date: '2026-12-12' })] }, '2026-12-11T09:00:00Z');
  assert.equal(v.entry.fixed_code, 'FIXED-NOW', 'walk-in inside its stay');
  v = await view({ active: [], any: [], checkins: [ci({ arrival_date: '2026-12-10', departure_date: '2026-12-12' })] }, '2026-12-12T11:30:00Z');
  assert.deepEqual(v.entry, {}, 'walk-in after its checkout + grace'); }
// Party with several departures: the latest one counts.
{ const v = await view({ active: [], any: [], checkins: [ci({ departure_date: '2026-12-12' }), ci({ id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', guest_type: 'member', departure_date: '2026-12-14' })] }, '2026-12-13T15:00:00Z');
  assert.equal(v.entry.fixed_code, 'FIXED-NOW'); }
// Fresh link with nothing saved yet: still the usual "check in first" (locked), nothing revealed.
{ const v = await view({ active: [], any: [], checkins: [] }, '2026-12-11T09:00:00Z');
  assert.equal(v.decision.state, 'locked'); assert.deepEqual(v.entry, {}); }
// Time zone: a property in another zone uses its own clock.
{ const v = await view({ active: [res({ checkout_date: '2026-12-13' })], property: prop({ timezone: 'America/New_York', checkout_time: '11:00' }) }, '2026-12-13T17:59:00Z');
  assert.equal(v.entry.fixed_code, 'FIXED-NOW', '11:00 New York + 2 h = 18:00Z');
  const w = await view({ active: [res({ checkout_date: '2026-12-13' })], property: prop({ timezone: 'America/New_York', checkout_time: '11:00' }) }, '2026-12-13T18:00:00Z');
  assert.deepEqual(w.entry, {}); }
// Room door codes follow the same lifetime.
{ const room = { id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4', property_id: P, deleted_at: null, door_code: 'ROOM-7', name: 'Room', beds: 2 };
  const roomPg = opts => { const base = pg(opts); return async path => path.startsWith('property_rooms?') ? { ok: true, json: async () => [room] } : base(path); };
  const load = async now => { const s = await loadEntryReleaseSnapshot({ pgrestGET: roomPg({ active: [res({ room_id: room.id })] }), propertyId: P, bookingCode: CODE, isTest: false, sessionValidUntil: FAR_SESSION });
    return projectEntryInstructions(s, at(now)); };
  assert.equal((await load('2026-12-11T09:00:00Z')).room.door_code, 'ROOM-7');
  assert.deepEqual(await load('2026-12-13T12:00:00Z'), {}, 'room code gone after checkout + grace'); }
console.log('PASS round74 entry lifetime (WBNB-R003): free-text checkout times → latest time (default 11:00), + 2 h grace in the property time zone (DST and other zones); the audit case (no active reservation + 2020 check-in, fresh link) reveals nothing; active stay visible until checkout + 2 h then fixed, rotating and room codes all gone, also after the host changes the code; renewed links never extend; cancelled or deleted reservations are revoked, not standalone; explicit walk-ins use their own (latest) departure; fresh links with nothing saved stay "check in first"');
