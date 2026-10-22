// Round 60 Phase 3c — direct-booking room selector + calendar filter.
//
// Static sweep that locks in the shape of Phase 3c changes:
//
//   - direct-booking modal: `rfRoom` select is painted only when
//     allRooms.length >= 2; the save payload picks it up; the overlap
//     check receives the roomId.
//   - calendar panel: `_calendarRoomFilter` state exists, is reset on
//     property switch, the chip row renders at 2+ rooms, and the SELECT
//     now pulls `room_id`.
//   - bar labels: when 2+ rooms AND no single-room filter, the bar is
//     prefixed with the room name so hosts can see the room at a glance.
//   - i18n: all four new keys present in both IT and EN dicts.
//
// Pure Node, no browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');

// ── Direct-booking modal: rfRoom select ───────────────────────────
assert.match(html, /const showRoomSel = rooms\.length >= 2;/,
  'room selector only renders at 2+ rooms');
assert.match(html, /<select id="rfRoom"/, 'rfRoom select element present');
assert.match(html, /onchange="_reservationFormOverlapCheck\(\)"/,
  'overlap check re-runs when room changes');
assert.match(html, /\$\{roomBlock\}/, 'roomBlock inserted into form markup');

// Save payload includes room_id.
assert.match(html, /room_id:\s+roomId,/,
  'saveDirectReservation payload carries room_id');
// Overlap check passes roomId.
assert.match(html, /_computeReservationOverlap\(propertyId, ci, co, excludeId, roomId\)/,
  'overlap check receives roomId');

// ── Calendar: filter state + chip row ─────────────────────────────
assert.match(html, /let _calendarRoomFilter = null;/,
  '_calendarRoomFilter state declared');
assert.match(html, /_calendarRoomFilter = null;/,
  'filter reset on property switch');
assert.match(html, /async function _setCalendarRoomFilter\(/,
  '_setCalendarRoomFilter handler defined');
assert.match(html, /if \(_calendarRoomFilter\)/,
  'calendar fetch filters rows by _calendarRoomFilter');
assert.match(html, /'__unassigned__'/,
  'unassigned-only sentinel defined');

// Room selection is exclusive: unassigned bookings must not leak into
// room-specific results (otherwise most OTA calendars seem unchanged).
assert.match(html, /rows\.filter\(r => r\.room_id === _calendarRoomFilter\)/,
  'individual room filter includes only that room');
assert.doesNotMatch(html, /r\.room_id === _calendarRoomFilter \|\| !r\.room_id/,
  'individual room filter does not include unassigned bookings');

// Inline handler must use single-quoted HTML attribute; JSON.stringify emits
// double-quoted JavaScript string literals, so double-quoted HTML breaks clicks.
assert.match(html, /onclick='_setCalendarRoomFilter\(\$\{JSON\.stringify\(value\)\}\)'/,
  'room chips preserve their JavaScript argument inside the onclick attribute');
assert.doesNotMatch(html, /onclick="_setCalendarRoomFilter\(\$\{JSON\.stringify\(value\)\}\)"/,
  'broken double-quoted inline handler must not return');

// SELECT pulls room_id so the filter + bar prefix have it.
assert.match(html, /from\('ota_reservations'\)[\s\S]{0,400}room_id/,
  'calendar SELECT includes room_id');

// ── Bar label prefix ──────────────────────────────────────────────
assert.match(html, /roomsForLabels\.length >= 2 && !_calendarRoomFilter && r\.room_id/,
  'bar label prefix only when 2+ rooms AND no single-room filter AND row has a room');

// ── i18n: new keys in both dicts ──────────────────────────────────
const KEYS = ['rf_room_lbl', 'rf_room_unassigned', 'cal_room_filter_all', 'cal_room_filter_unassigned'];
for (const key of KEYS) {
  const re = new RegExp('^\\s{4}' + key + ':', 'gm');
  const hits = (html.match(re) || []).length;
  assert.equal(hits, 2, `${key} must appear in both IT and EN dicts (got ${hits})`);
}

console.log(`PASS rooms-calendar-static: rfRoom selector gated at 2+ rooms, save payload + overlap wiring, calendar filter state + chip row + reset-on-switch, bar label prefix, ${KEYS.length} new i18n keys in IT+EN.`);
