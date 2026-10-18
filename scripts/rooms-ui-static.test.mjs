// Round 60 Phase 3b — Rooms card + per-feed room selector static sweep.
//
// Byte-level checks that the committed host-console.html carries the
// pieces Phase 3b wires together:
//
//   - Rooms card markup (id="roomsCard" + roomsListBody + Add room button)
//   - Rooms limit constant and i18n keys
//   - Per-feed room selector is painted only when allRooms.length >= 2
//     (zero/one room → identical UI to pre-Round-60)
//   - Rooms CRUD helpers (addRoom, saveRoomField, deleteRoom)
//   - allRooms state declared and loaded in loadPropertyData
//   - Both i18n dicts carry every new string (IT + EN)
//
// Pure Node, no browser. Belt-and-braces for the full browser suite
// which exercises the actual DOM in unsaved-forms-browser.test.mjs
// (that test already covers the Round 59 unsaved-form guard; Round
// 60's new Rooms card lives in Property Details which is covered by
// property-edit-browser.test.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');

// ── Markup ─────────────────────────────────────────────────────────
assert.match(html, /id="roomsCard"/, 'Rooms card container present');
assert.match(html, /id="roomsListBody"/, 'Rooms list body container present');
assert.match(html, /onclick="addRoom\(\)"/, 'Add-room button wired to addRoom()');
assert.match(html, /id="roomsLimitHint"/, 'limit hint element present');
assert.match(html, /data-h="rooms_card_title"/, 'card title hooked to i18n');
assert.match(html, /data-h="rooms_card_desc"/, 'card description hooked to i18n');
assert.match(html, /data-h="btn_add_room"/, 'Add room button hooked to i18n');

// ── allRooms state + loader ───────────────────────────────────────
assert.match(html, /let allRooms = \[\];/, 'allRooms state declared');
assert.match(html, /\.from\('property_rooms'\)/, 'property_rooms loader present');
assert.match(html, /renderRoomsCard\(\);/, 'renderRoomsCard called from loadPropertyData');

// ── CRUD helpers ──────────────────────────────────────────────────
assert.match(html, /\nasync function addRoom\(\)/, 'addRoom() defined');
assert.match(html, /\nasync function saveRoomField\(/, 'saveRoomField() defined');
assert.match(html, /\nasync function deleteRoom\(/, 'deleteRoom() defined');
assert.match(html, /\nfunction renderRoomsCard\(\)/, 'renderRoomsCard() defined');
assert.match(html, /const ROOMS_LIMIT = 6;/, 'hard cap of 6 rooms');
assert.match(html, /\.update\(\{ deleted_at: new Date\(\)\.toISOString\(\) \}\)/,
  'delete is a soft delete, not a hard delete');

// ── Feed room selector only when allRooms.length >= 2 ─────────────
assert.match(html, /const showRoom = rooms\.length >= 2;/,
  'per-feed room selector only renders at 2+ rooms');
assert.match(html, /class="form-select ical-room"/, 'room select class present');
assert.match(html, /_icalEscape\(h\('feed_room_unassigned'\)\)/,
  'unassigned option renders from i18n');

// ── collectIcalFeeds includes room_id ─────────────────────────────
assert.match(html, /if \(roomId\) entry\.room_id = roomId;/,
  'collectIcalFeeds attaches room_id when set');

// ── i18n: every new key present in both dicts ─────────────────────
const KEYS = [
  'rooms_card_title', 'rooms_card_desc', 'btn_add_room', 'rooms_limit_hint',
  'rooms_empty', 'rooms_name_label', 'rooms_beds_label', 'rooms_door_code_label',
  'rooms_delete_btn', 'rooms_delete_confirm', 'rooms_default_name',
  'rooms_save_ok', 'rooms_save_fail', 'rooms_limit_reached', 'rooms_duplicate_name',
  'feed_room_label', 'feed_room_unassigned',
];
for (const key of KEYS) {
  const re = new RegExp('^\\s{4}' + key + ':', 'gm');
  const hits = (html.match(re) || []).length;
  assert.equal(hits, 2, `${key} must appear in both IT and EN dicts (got ${hits})`);
}

console.log(`PASS rooms-ui-static: Rooms card markup, allRooms state + loader, CRUD helpers, feed room selector gated at 2+ rooms, ${KEYS.length} i18n keys in IT+EN.`);
