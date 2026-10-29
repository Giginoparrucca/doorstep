// Actual signed-token HTTP handler + actual loader/policy. Fictional transport only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
process.env.GUEST_TOKEN_SECRET = createHash('sha256').update('fictional-room-projection-test').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key';
const { signGuestToken } = await import('../api/_guest-token.js');
const { default: handler } = await import('../api/guest.js');
const pid = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const booking = 'FICTIONAL-ROOM-STAY';
const room = { id:roomA, property_id:pid, deleted_at:null, name:'Fictional Blue', beds:2, door_code:'DOOR-SNAPSHOT' };
const reservation = { id:'fictional-reservation', property_id:pid, booking_code:booking, is_test:false,
  deleted_at:null, status:'active', entry_type:'reservation', room_id:roomA,
  checkin_date:'2099-01-01', checkout_date:'2099-01-02' };
let checks = 0;
async function run(o = {}) {
  const isTest = o.isTest === true;
  const { token } = signGuestToken({ p:pid, s:'fictional-session', b:booking, t:isTest,
    exp:Math.floor(Date.now()/1000)+3600 });
  const prop = { id:pid, name:'Fictional house', entry_checkin_required:o.on === true,
    keybox_code:'FIXED-EARLIER', access_method:'ACCESS-EARLIER', show_fixed_lockbox_to_guest:true };
  const checkins = o.checkins ?? (o.checked === false ? [] : [{ id:'fictional-checkin',
    property_id:pid, booking_code:booking, is_test:isTest, room_id:o.checkinRoom ?? null }]);
  const reservations = o.reservations ?? [{...reservation,is_test:isTest}];
  const snapshotProp = { ...prop, keybox_code:'FIXED-SNAPSHOT', access_method:'ACCESS-SNAPSHOT', ...o.snapshotProp };
  const state = { snapshot_version:2, property_id:pid, booking_code:booking, is_test:isTest,
    property_snapshot:snapshotProp, current_rows:[], reservation_snapshot:reservations[0] || null,
    booking_id:'fictional-booking', reservation_id:reservations[0]?.id || null,
    identity_version:'fictional-identity', roster_version:'fictional-roster', roster_source:'host',
    roster_confirmed:true, expected_count:1, slots:[{id:'fictional-slot',ordinal:1}], submissions:[],
    arrival_date:'2099-01-01', departure_date:'2099-01-02',
    released_manually:true, manual_audit_id:'fictional-audit',
    override_audit:{id:'fictional-audit',actor_id:'fictional-host',created_at:new Date(Date.now()-60000).toISOString()},
    resolved_room_id:roomA,room_snapshot:room,room_resolution:'unique', ...o.state };
  const calls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(url), path = u.pathname.split('/rest/v1/')[1];
    calls.push({ path, params:u.searchParams, init });
    if (path === 'api_usage') return response([]);
    if (path === 'rpc/get_entry_access_booking_snapshot') {
      assert.deepEqual(JSON.parse(init.body),{p_property_id:pid,p_booking_code:booking,p_is_test:isTest});
      if (o.rpcThrows) throw Error('fictional snapshot failure');
      return response(o.noSnapshot ? null : state,o.rpcFailure ? 503 : 200);
    }
    if (path === 'properties') {
      assert.equal(u.searchParams.get('id'),`eq.${pid}`);
      return response([prop]);
    }
    if (['checkins','ota_reservations','property_rooms'].includes(path)) {
      assert.equal(u.searchParams.get('property_id'),`eq.${pid}`);
      assert.equal(u.searchParams.get('deleted_at'),'is.null');
      if (path !== 'property_rooms') {
        assert.equal(u.searchParams.get('booking_code'),`eq.${booking}`);
        assert.equal(u.searchParams.get('is_test'),`eq.${isTest}`);
        if (o.failedTable === path) return response([],503);
        if (o.malformedTable === path) return response({error:'fictional'});
        return response(path === 'checkins' ? checkins : reservations);
      }
      if (o.roomThrows) throw Error('fictional room failure');
      if (o.roomFailure) return response([],503);
      // For ON this response may change after the snapshot. Never use its code.
      return response(o.rooms ?? [ {...room, door_code:o.on ? 'DOOR-LATER-NEVER-RETURN' : room.door_code} ]);
    }
    return response([]);
  };
  let body, status, headers = {};
  await handler({method:'POST', headers:{authorization:`Bearer ${token}`,origin:'https://app.welcomebnb.it'},
    body:{action:'property',property_id:foreign,booking_code:'FORGED',is_test:!isTest,room_id:roomB}},
  {setHeader(k,v){headers[k]=v;},status(v){status=v;return this;},json(v){body=v;return this;},end(){return this;}});
  assert.equal(status,200);
  assert.match(headers['Cache-Control'],/no-store/);
  assert.ok(!JSON.stringify(body).includes('DOOR-LATER-NEVER-RETURN'));
  checks++;
  return {body,calls};
}
function response(data,status=200) { return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}}); }
function noRoom(r) { assert.equal(r.body.room,undefined); }
function closed(r) { assert.equal(r.body.checked_in,false);noRoom(r);assert.equal(r.body.property.keybox_code,undefined);assert.equal(r.body.property.access_method,undefined); }

// OFF: preserve unique OTA/check-in labels and check-in code gate; no first-room rule.
noRoom(await run({reservations:[],checked:false}));
const locked = await run({checked:false});assert.equal(locked.body.room.name,room.name);assert.equal(locked.body.room.door_code,undefined);
assert.equal((await run()).body.room.door_code,'DOOR-SNAPSHOT');
assert.equal((await run({reservations:[],checkinRoom:roomA})).body.room.door_code,'DOOR-SNAPSHOT');
assert.equal((await run({checkinRoom:roomA})).body.room.door_code,'DOOR-SNAPSHOT');
noRoom(await run({checkinRoom:roomB}));
noRoom(await run({reservations:[],checkins:[{id:'a',room_id:roomA},{id:'b',room_id:roomB}]}));
noRoom(await run({rooms:[{...room,property_id:foreign,door_code:'FOREIGN'}]}));
noRoom(await run({rooms:[{...room,id:roomB}]}));
noRoom(await run({rooms:[{...room,deleted_at:'2099-01-01'}]}));
noRoom(await run({rooms:[]}));
closed(await run({roomFailure:true}));
closed(await run({roomThrows:true}));
for(const table of ['checkins','ota_reservations']) {
  closed(await run({failedTable:table}));closed(await run({malformedTable:table}));
}
closed(await run({reservations:[reservation,{...reservation,id:'duplicate'}]}));
closed(await run({checkins:Array.from({length:1000},(_,i)=>({id:`fictional-${i}`,room_id:roomA}))}));
// Companion agreement resolves one room; no truncating first-row query allowed.
const agreed = await run({checkins:[{id:'a',room_id:roomA},{id:'b',room_id:roomA}]});
assert.equal(agreed.body.room.door_code,'DOOR-SNAPSHOT');
assert.ok(!agreed.calls.find(c=>c.path==='checkins').params.has('limit'));

// ON: one coherent snapshot supplies permissions, protected text and exact room code.
const manual = await run({on:true});
assert.equal(manual.body.entry_release.state,'manual');assert.equal(manual.body.room.door_code,'DOOR-SNAPSHOT');
assert.equal(manual.body.property.keybox_code,'FIXED-SNAPSHOT');assert.equal(manual.body.property.access_method,'ACCESS-SNAPSHOT');
const metadata = manual.calls.filter(c=>c.path==='property_rooms');assert.equal(metadata.length,1);
assert.equal(metadata[0].params.get('id'),`eq.${roomA}`);
assert.ok(!metadata[0].params.get('select').includes('door_code'));
closed(await run({on:true,state:{room_resolution:'ambiguous',resolved_room_id:null,room_snapshot:null}}));
closed(await run({on:true,state:{room_snapshot:{...room,id:roomB}}}));
closed(await run({on:true,state:{room_snapshot:{...room,property_id:foreign}}}));
closed(await run({on:true,state:{room_snapshot:{...room,deleted_at:'2099-01-01'}}}));
closed(await run({on:true,rpcFailure:true}));closed(await run({on:true,rpcThrows:true}));closed(await run({on:true,noSnapshot:true}));
closed(await run({on:true,state:{property_id:foreign}}));
closed(await run({on:true,state:{is_test:true}}));
const incomplete = await run({on:true,state:{released_manually:false}});
assert.equal(incomplete.body.entry_release.state,'locked');assert.equal(incomplete.body.room.name,room.name);assert.equal(incomplete.body.room.door_code,undefined);
assert.equal(incomplete.body.property.keybox_code,undefined);
// Metadata cannot replace the chosen room, revive a deleted room, or add a code.
noRoom(await run({on:true,rooms:[{...room,id:roomB}]}));
noRoom(await run({on:true,rooms:[{...room,property_id:foreign}]}));
noRoom(await run({on:true,rooms:[{...room,deleted_at:'2099-01-01'}]}));
noRoom(await run({on:true,rooms:[]}));noRoom(await run({on:true,roomFailure:true}));noRoom(await run({on:true,roomThrows:true}));
const hidden = await run({on:true,snapshotProp:{show_fixed_lockbox_to_guest:false}});assert.equal(hidden.body.property.keybox_code,undefined);
assert.equal((await run({on:true,isTest:true})).body.room.door_code,'DOOR-SNAPSHOT');
console.log(`PASS ${checks} actual signed gateway/loader/policy room cases: coherent ON code/text, metadata-only read, OFF unique parity, conflicts, isolation and read failures. Fictional transport only.`);
