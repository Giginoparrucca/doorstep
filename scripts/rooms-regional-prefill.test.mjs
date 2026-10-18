// Round 60 Phase 5 — regional review prefills from room data.
//
// Phase 5 touches ONLY host-regional-exports.js (the review dialog).
// The on-disk file formats (Alloggiati .txt, PayTourist CSV, ROSS1000
// XML, Umbria TXT, Trento TXT, PS, summary CSV) are deliberately
// unchanged — the PLAN says "Alloggiati / SPOT / tourist-tax
// unchanged" and the regional file writers in lib/regional-exports.js
// read `d.occupied / d.rooms / d.beds` as-is from the model, so the
// bytes a no-rooms host downloads are byte-identical to pre-Round-60.
//
// This test covers the behavioural piece: given a model built by the
// (room-aware) host dialog logic, the daily prefill values are what
// the PLAN prescribes:
//
//   - No rooms → pre-Round-60 shape: rooms/beds pull from property
//     fields; occupied is '' when guests present else 0.
//   - Rooms →
//       rooms_available defaults to the active room count
//       beds_available defaults to the sum of per-room beds
//       daily `occupied` defaults to the count of DISTINCT rooms with
//       an active stay on that date (NEVER guest counts, per PLAN).
//   - A day with at least one submitted stay whose room_id is null is
//     flagged in the UI (data-unassigned="1"). The occupied count
//     is correct for the assigned stays, but the host needs to label
//     the unassigned one before downloading.
//
// Verifies the actual source byte-matches these invariants by
// grep-matching the committed host-regional-exports.js, plus runs the
// pure defaults logic in isolation to prove the computation.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../host-regional-exports.js', import.meta.url), 'utf8');

// ── Source invariants ─────────────────────────────────────────────
assert.match(src, /const roomList=Array\.isArray\(ctx\.rooms\)\?ctx\.rooms:\[\];/,
  'ctx.rooms is read defensively (empty array when absent)');
assert.match(src, /const hasRooms=roomList\.length>0;/,
  'hasRooms gate on roomList length');
assert.match(src, /const roomsDefault=hasRooms\?roomList\.length:/,
  'rooms_available default = room count when rooms exist');
assert.match(src, /const bedsDefault=hasRooms\?roomList\.reduce\(/,
  'beds_available default = sum of per-room beds when rooms exist');
assert.match(src, /roomList\.reduce\(\(s,r\)=>s\+Math\.max\(1,Number\(r\.beds\)\|\|1\),0\)/,
  'bed sum clamps per-room beds to >= 1');
assert.match(src, /const occupiedForDate=date=>{/,
  'per-day occupied prefill is derived, not static');
assert.match(src, /if\(hasRooms\)\{[\s\S]*?const roomIds=new Set\(\);for\(const r of present\)if\(r\.room_id\)roomIds\.add\(r\.room_id\);/,
  'occupied counts distinct room_ids with an active stay (never guest counts)');
assert.match(src, /return roomIds\.size;/,
  'returns distinct room count');
assert.match(src, /return R\.counts\(relevant,date\)\.present\?'':0;/,
  'no-rooms branch keeps the pre-Round-60 "present → \'\', else 0" default');

// Unassigned-stays flag.
assert.match(src, /const unassigned=hasRooms\?present\.filter\(r=>!r\.room_id\)\.length:0;/,
  'unassigned stays are counted only when the property has rooms');
assert.match(src, /data-unassigned="1"/,
  'day row carries data-unassigned when stays lack room_id');
assert.match(src, /regional-unassigned-flag/,
  'unassigned flag CSS class present');

// The checkins SELECT pulls room_id.
assert.match(src, /\.select\('id,property_id,is_test,deleted_at,submitted_at,booking_code,guest_type,name,surname,sex,date_of_birth,citizenship,birth_country,birth_province,place_of_birth,residence_country,residence_place,arrival_date,departure_date,nights,document_type,document_number,doc_issue_place,room_id'\)/,
  'checkins SELECT now includes room_id');

// applyDaily uses the same room-aware defaults.
assert.match(src, /if\(d\.rooms===''\|\|Number\(d\.rooms\)===0\)d\.rooms=roomsDefault;/,
  'applyDaily uses roomsDefault for 0/empty rooms');
assert.match(src, /if\(d\.beds===''\|\|Number\(d\.beds\)===0\)d\.beds=bedsDefault;/,
  'applyDaily uses bedsDefault for 0/empty beds');

// ── Pure logic: replay the prefill computation in isolation ──────
// Mirror the code paths exactly so a future refactor of the inline
// expressions fails here loudly.
const roomA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function computeDefaults(rooms) {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const hasRooms = roomList.length > 0;
  const roomsDefault = hasRooms ? roomList.length : '';
  const bedsDefault = hasRooms ? roomList.reduce((s, r) => s + Math.max(1, Number(r.beds) || 1), 0) : '';
  return { hasRooms, roomsDefault, bedsDefault };
}

function occupiedForDate(rooms, stays) {
  const roomList = Array.isArray(rooms) ? rooms : [];
  const hasRooms = roomList.length > 0;
  const present = stays.filter(s => s.submitted_at && !s.deleted_at);
  if (hasRooms) {
    const ids = new Set();
    for (const r of present) if (r.room_id) ids.add(r.room_id);
    return ids.size;
  }
  return present.length > 0 ? '' : 0;
}

// 1. No rooms → pre-Round-60 behaviour.
let d = computeDefaults([]);
assert.equal(d.hasRooms, false);
assert.equal(d.roomsDefault, '', 'no rooms → falls through to property field');
assert.equal(d.bedsDefault, '');
assert.equal(occupiedForDate([], [{ submitted_at: '2026-07-10' }]), '',
  'no rooms + guests present → "" (host fills in)');
assert.equal(occupiedForDate([], []), 0,
  'no rooms + no guests → 0');

// 2. 2 rooms, 3 beds total.
const rooms = [{ id: roomA, beds: 1 }, { id: roomB, beds: 2 }];
d = computeDefaults(rooms);
assert.equal(d.hasRooms, true);
assert.equal(d.roomsDefault, 2);
assert.equal(d.bedsDefault, 3);

// 3. Distinct-room occupancy, not guest count.
// Two guests sharing roomA + one in roomB = 2 occupied rooms, not 3.
assert.equal(
  occupiedForDate(rooms, [
    { submitted_at: '2026-07-10', room_id: roomA },
    { submitted_at: '2026-07-10', room_id: roomA },
    { submitted_at: '2026-07-10', room_id: roomB },
  ]),
  2,
  'occupied is distinct room count, not guest headcount');

// 4. Unassigned stays don't bump occupied (host must label before download).
assert.equal(
  occupiedForDate(rooms, [
    { submitted_at: '2026-07-10', room_id: roomA },
    { submitted_at: '2026-07-10', room_id: null },  // unassigned
  ]),
  1,
  'unassigned stay doesn\'t count toward occupied; UI flags the day');

// 5. Beds clamp: a bogus 0 beds becomes 1 so sum stays sane.
assert.equal(computeDefaults([{ id: 'x', beds: 0 }]).bedsDefault, 1,
  'beds clamped to >= 1');
assert.equal(computeDefaults([{ id: 'x', beds: null }, { id: 'y', beds: 'bad' }]).bedsDefault, 2,
  'nullish/non-numeric beds → 1 each');

// 6. Deleted/draft stays never contribute to occupied.
assert.equal(
  occupiedForDate(rooms, [
    { submitted_at: null, room_id: roomA },           // draft
    { submitted_at: '2026-07-10', deleted_at: 'x', room_id: roomB },  // soft-deleted
  ]),
  0,
  'drafts and soft-deleted stays never count');

console.log('PASS rooms-regional-prefill: source invariants (rooms/beds defaults, distinct-room occupied, unassigned flag), pure logic (no-rooms baseline, 2+ rooms distinct count, unassigned excluded, beds clamp, drafts/soft-deleted ignored).');
