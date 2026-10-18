// Round 60 Phase 4 — guest-app room resolution.
//
// Exercises api/guest.js `property` action's new `room` field with
// mocked fetch. Verifies:
//
//   1. No room linked at all → response omits `room` entirely
//      (whole-property guest UI stays identical to pre-Round-60).
//   2. ota_reservations.room_id resolves and name shows up pre-check-in;
//      door_code DOES NOT ship pre-check-in.
//   3. Once the booking has a check-in row, door_code appears.
//   4. checkins.room_id wins over ota_reservations.room_id when both set.
//   5. Cross-property isolation: a stale room_id that references another
//      property's room never leaks name/door_code (property_rooms query
//      is scoped by both id AND property_id).
//   6. token property_id drives every REST call — body.property_id is
//      logged but ignored (regression lock on Round 60a Phase 2 contract).
//
// All transport is mocked (global.fetch). No live Supabase.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET
  || createHash('sha256').update('round60-phase4-fixture-secret-guest-room').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';

const { signGuestToken } = await import('../api/_guest-token.js');

const propA = '11111111-1111-4111-8111-111111111111';
const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const booking = 'ROUND60-STAY-1';
const session = 'guest-room-fixture';

const { token } = signGuestToken({
  p: propA, s: session, b: booking, exp: Math.floor(Date.now() / 1000) + 3600,
});

function mockRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(x) { this.body = x; return this; },
    end() { return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
function mockReq(body = {}) {
  return {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      origin: 'https://app.welcomebnb.it',
      'content-type': 'application/json',
    },
    body,
  };
}

// Scenario state the mock reads from.
let scenario = null;
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
  const u = String(url);

  if (u.includes('/rest/v1/properties')) {
    return json([{ id: propA, name: 'Trullo di Prova', region: 'Puglia',
      hero_image_url: null, host_names: 'Daniele' }]);
  }
  if (u.includes('/rest/v1/checkins')) {
    const url = new URL(u);
    if (url.searchParams.get('room_id') === 'not.is.null') {
      return json(scenario?.checkinRoom ? [{ room_id: scenario.checkinRoom }] : []);
    }
    // bookingHasCheckin probe: returns a 1-row array when the booking
    // has at least one check-in row.
    return json(scenario?.hasCheckin ? [{ id: 'c1' }] : []);
  }
  if (u.includes('/rest/v1/ota_reservations')) {
    return json(scenario?.otaRoom ? [{ room_id: scenario.otaRoom }] : []);
  }
  if (u.includes('/rest/v1/property_rooms')) {
    const url = new URL(u);
    const id = (url.searchParams.get('id') || '').replace('eq.', '');
    const pid = (url.searchParams.get('property_id') || '').replace('eq.', '');
    const row = (scenario?.rooms || []).find(r => r.id === id && r.property_id === pid);
    return json(row ? [row] : []);
  }
  return json([]);
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json', 'content-range': '0-0/0' },
  });
}

const { default: handler } = await import('../api/guest.js');
async function run(body) {
  const res = mockRes();
  calls.length = 0;
  await handler(mockReq(body), res);
  return { res, calls: calls.slice() };
}

// ── 1. No room linked → response omits `room` ─────────────────────
scenario = { hasCheckin: false, rooms: [] };
{
  const { res } = await run({ action: 'property' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.property, 'property returned');
  assert.equal(res.body.room, undefined, 'no room linked → no room field');
}

// ── 2. ota_reservations.room_id resolves; door_code hidden pre-check-in
scenario = {
  hasCheckin: false,
  checkinRoom: null,
  otaRoom: roomA,
  rooms: [{ id: roomA, property_id: propA, name: 'Camera Blu', beds: 2, door_code: '1234' }],
};
{
  const { res } = await run({ action: 'property' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.room, 'room present when ota row carries one');
  assert.equal(res.body.room.name, 'Camera Blu');
  assert.equal(res.body.room.beds, 2);
  assert.equal(res.body.room.door_code, undefined,
    'door_code must stay hidden pre-check-in (same gating as wifi/access)');
}

// ── 3. Once checked in → door_code appears ────────────────────────
scenario = {
  hasCheckin: true,
  checkinRoom: null,
  otaRoom: roomA,
  rooms: [{ id: roomA, property_id: propA, name: 'Camera Blu', beds: 2, door_code: '1234' }],
};
{
  const { res } = await run({ action: 'property' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.room.name, 'Camera Blu');
  assert.equal(res.body.room.door_code, '1234',
    'door_code revealed after check-in');
}

// ── 4. checkins.room_id wins over ota_reservations.room_id ───────
scenario = {
  hasCheckin: true,
  checkinRoom: roomB,
  otaRoom: roomA,
  rooms: [
    { id: roomA, property_id: propA, name: 'Camera Blu', beds: 2, door_code: '1234' },
    { id: roomB, property_id: propA, name: 'Camera Rossa', beds: 3, door_code: '9999' },
  ],
};
{
  const { res } = await run({ action: 'property' });
  assert.equal(res.body.room.name, 'Camera Rossa',
    'checkins.room_id overrides ota_reservations.room_id');
  assert.equal(res.body.room.door_code, '9999');
}

// ── 5. Cross-property isolation ───────────────────────────────────
// Scenario: the stay somehow references a room that belongs to a
// different property (e.g. an old demo seed, or a stale JSONB edit).
// The property_rooms query scopes by both id AND property_id, so the
// lookup returns no row and `room` is omitted from the response.
scenario = {
  hasCheckin: true,
  otaRoom: roomA,
  rooms: [
    // roomA belongs to a different property, not propA.
    { id: roomA, property_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      name: 'SECRET OTHER PROPERTY ROOM', beds: 1, door_code: 'LEAK' },
  ],
};
{
  const { res, calls: c } = await run({ action: 'property' });
  assert.equal(res.body.room, undefined,
    'cross-property room must never leak into the response');
  const roomCall = c.find(x => x.url.includes('/rest/v1/property_rooms'));
  assert.ok(roomCall, 'property_rooms query happened');
  assert.ok(roomCall.url.includes('property_id=eq.' + propA),
    'property_rooms query scopes by this property');
}

// ── 6. token drives scope — body.property_id ignored ─────────────
scenario = { hasCheckin: false, rooms: [] };
{
  const propB = '22222222-2222-4222-8222-222222222222';
  const { res, calls: c } = await run({ action: 'property', property_id: propB });
  assert.equal(res.statusCode, 200);
  for (const call of c) {
    if (call.url.includes('/rest/v1/')) {
      assert.ok(call.url.includes(propA) || !call.url.includes(propB),
        `token property must drive scope: ${call.url}`);
      assert.ok(!call.url.includes(propB),
        `body property_id must never leak into REST: ${call.url}`);
    }
  }
}

console.log('PASS guest-room: no room → omitted, ota resolves, door_code gated behind check-in, checkins wins over ota, cross-property isolation holds, body.property_id ignored.');
