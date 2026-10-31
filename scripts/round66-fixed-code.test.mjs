// Actual property handler + actual loader/policy; all transport is fictional.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadGuestPropertyAccess } from '../api/_entry-release-loader.js';

const source = fs.readFileSync(new URL('../api/guest.js', import.meta.url), 'utf8');
const start = source.indexOf('async function doProperty(');
const handler = source.slice(start, source.indexOf('\n}\n', start) + 2);
const fields = vm.runInNewContext(source.match(/const PROPERTY_PUBLIC_FIELDS = (\[[\s\S]*?\]);/)[1]);
const gated = vm.runInNewContext(source.match(/const PROPERTY_POST_CHECKIN_FIELDS = new Set\((\[[\s\S]*?\])\)/)[1]);
const pid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const code = 'SYNTHETIC-BOOKING';
const past = new Date(Date.now() - 60000).toISOString();
const future = Math.floor(Date.now() / 1000) + 86400;

async function request(options = {}) {
  const property = { id: pid, name: 'Fictional home', deleted_at: null,
    entry_checkin_required: true, keybox_code: 'FIXED-FICTIONAL',
    access_method: 'ACCESS-FICTIONAL', wifi_password: 'WIFI-FICTIONAL',
    show_fixed_lockbox_to_guest: true, ...options.property };
  const checkins = options.checkins || [];
  const state = { booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    property_id: pid, booking_code: code, is_test: false,
    identity_version: 'identity-fictional', roster_version: 'roster-fictional',
    roster_source: 'host', roster_confirmed: true, expected_count: 1,
    arrival_date: '2099-01-01', departure_date: '2099-01-02',
    slots: [{ id: 'slot-1', ordinal: 1 }], submissions: [],
    released_manually: true, manual_audit_id: 'audit-fictional',
    override_audit: { id: 'audit-fictional', actor_id: 'host-fictional', created_at: past },
    ...options.state };
  Object.assign(state, { snapshot_version: 2, property_snapshot: property,
    current_rows: checkins, reservation_snapshot: options.reservations?.[0] || null,
    room_snapshot: { id:'room-fictional', property_id:pid, door_code:'ROOM-FICTIONAL' }, room_resolution: 'unique', resolved_room_id: 'room-fictional' });
  let policyCalls = 0, status, body;
  const pgrestGET = async path => {
    if (path.startsWith('properties?')) {
      assert.ok(path.includes(`id=eq.${pid}`));
      return { ok: true, json: async () => [property] };
    }
    if (path.startsWith('property_rooms?')) return { ok:true, json:async()=>[{ id:'room-fictional', property_id:pid, name:'Fictional room', beds:2 }] };
    assert.ok(path.includes(`property_id=eq.${pid}`));
    assert.ok(path.includes(`booking_code=eq.${code}`));
    assert.ok(path.includes('is_test=eq.false'));
    if (options.readFailure) return { ok: false };
    return { ok: true, json: async () => path.startsWith('checkins?') ? checkins : options.reservations || [] };
  };
  const gateway = vm.createContext({ Date, Number, encodeURIComponent,
    PROPERTY_PUBLIC_FIELDS: fields, PROPERTY_POST_CHECKIN_FIELDS: new Set(gated),
    pgrestGET, callRPC: async (name, args) => {
      assert.equal(name, 'get_entry_access_booking_snapshot');
      assert.deepEqual(args, { p_property_id: pid, p_booking_code: code, p_is_test: false });
      return { ok: true, json: async () => options.noRoster ? null : state };
    },
    loadGuestPropertyAccess: async opts => {
      policyCalls++;
      if (options.policyError) throw Error('fictional read error');
      return loadGuestPropertyAccess(opts);
    },
    // A second independent access decision is forbidden: state and secrets
    // must use the same evaluation even when an override changes mid-request.
    entryReleaseAllows: async () => { throw Error('duplicate decision'); },
  });
  vm.runInContext(handler, gateway);
  await gateway.doProperty({ setHeader() {}, status(n) { status = n; return this; }, json(v) { body = v; } },
    pid, options.noBooking ? null : code, false, options.expired ? 1 : future);
  assert.equal(status, 200);
  assert.equal(policyCalls, options.noBooking ? 0 : 1);
  return JSON.parse(JSON.stringify(body));
}

function denied(response, expectedState) {
  assert.equal(response.checked_in, false);
  if (expectedState) assert.equal(response.entry_release.state, expectedState);
  for (const value of ['FIXED-FICTIONAL', 'ACCESS-FICTIONAL', 'WIFI-FICTIONAL', 'ROOM-FICTIONAL']) {
    assert.ok(!JSON.stringify(response).includes(value), `${value} absent from entire response`);
  }
  assert.equal(response.property.name, 'Fictional home');
}

const manual = await request();
assert.equal(manual.entry_release.state, 'manual');
assert.equal(manual.property.keybox_code, 'FIXED-FICTIONAL');
assert.equal(manual.room.door_code, 'ROOM-FICTIONAL');
assert.equal((await request({ property: { show_fixed_lockbox_to_guest: false } })).property.keybox_code, undefined);
assert.equal((await request({ property: { show_fixed_lockbox_to_guest: undefined } })).property.keybox_code, 'FIXED-FICTIONAL');
denied(await request({ state: { released_manually: false } }), 'locked');
// No stored record and no check-in yet: still denied, but tells the guest to check in.
denied(await request({ noRoster: true }), 'locked');
denied(await request({ expired: true }), 'invalid');
denied(await request({ noBooking: true }));
denied(await request({ readFailure: true }), 'unavailable');
// An active-only reservation query returns [] for cancellation/deletion.
// A saved override tied to that reservation must never become standalone.
denied(await request({ state: { reservation_id: 'old-reservation' } }), 'unavailable');
const reservation = { id: 'reservation-fictional', property_id: pid, booking_code: code,
  is_test: false, status: 'active', entry_type: 'reservation', deleted_at: null,
  checkin_date: '2099-01-01', checkout_date: '2099-01-02' };
assert.equal((await request({ reservations: [reservation],
  state: { reservation_id: reservation.id } })).entry_release.state, 'manual');
denied(await request({ reservations: [reservation], state: { reservation_id: 'replaced-reservation' } }), 'unavailable');
denied(await request({ reservations: [{ ...reservation, checkin_date: '2099-01-02' }],
  state: { reservation_id: reservation.id } }), 'unavailable');
denied(await request({ state: { property_id: 'foreign-property' } }), 'unavailable');
const failure = await request({ policyError: true });
denied(failure, 'unavailable');
assert.equal(failure.entry_release.reason, 'policy_error');
const completed = { checkins: [{ id: 'guest-1', property_id: pid, booking_code: code,
  is_test: false, guest_type: 'single', submitted_at: past,
  surname:'Synthetic',name:'Person',sex:'F',date_of_birth:'2000-01-01',place_of_birth:'London',
  birth_country:'United Kingdom',citizenship:'United Kingdom',document_type:'passport',
  document_number:'FICTIONAL123',doc_issue_place:'London',arrival_date:'2099-01-01',departure_date:'2099-01-02',nights:1 }],
  state: { released_manually: false, submissions: [{ slot_id: 'slot-1', checkin_id: 'guest-1' }] } };
assert.equal((await request(completed)).entry_release.state, 'available');
const scheduled = await request({ ...completed, property: { entry_release_time: '15:00', entry_release_timezone: 'Europe/Rome' } });
denied(scheduled,'scheduled');
assert.equal(scheduled.entry_release.release_timezone,'Europe/Rome');
const legacy = await request({ ...completed, property: { entry_checkin_required: false } });
assert.equal(legacy.entry_release.state, 'legacy_available');
assert.equal(legacy.property.keybox_code, 'FIXED-FICTIONAL');
denied(await request({ property: { entry_checkin_required: false } }), 'locked');
console.log('PASS actual property handler/loader/policy: fixed code and room gate, host visibility, manual/automatic/legacy release, restore, schedule, unknown roster, expired/no booking, read/exception failure, single decision. Fictional transport only.');
