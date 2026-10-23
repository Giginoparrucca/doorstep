// Synthetic regression for the 7contrade incident: labels are not room IDs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { feedIdentity, sourceFeedIdentity, roomFeedUid } from '../api/ical-sync.js';

const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const collect = html.slice(html.indexOf('function collectIcalFeeds()'), html.indexOf('\nfunction addIcalFeed()'));
const room = '11111111-1111-4111-8111-111111111111';
let selected = '';
const fields = { '.ical-platform': 'other', '.ical-url': 'https://example.test/feed.ics', '.ical-label': 'Blue' };
const ctx = vm.createContext({ document: { getElementById: () => ({
  querySelectorAll: () => [{ querySelector: s => ({ value: s === '.ical-room' ? selected : fields[s] }) }],
}) } });
vm.runInContext(collect, ctx);
const read = () => JSON.parse(JSON.stringify(vm.runInContext('collectIcalFeeds()', ctx)))[0];
const unassigned = read();
assert.equal(unassigned.label, 'Blue');
assert.equal(unassigned.room_id, undefined, 'room label alone must not guess assignment');
selected = room;
const assigned = read();
assert.equal(assigned.room_id, room, 'Settings must persist the explicit selector');
assert.equal(sourceFeedIdentity(unassigned), sourceFeedIdentity(assigned), 'adoption preserves source provenance');
assert.notEqual(feedIdentity(unassigned), feedIdentity(assigned));
assert.equal(roomFeedUid(feedIdentity(assigned), 'synthetic-IRES'), `wbnb-feed:${feedIdentity(assigned)}:synthetic-IRES`);

const start = html.indexOf('  if (_calendarRoomFilter) {', html.indexOf('async function renderCalendar'));
assert.ok(start >= 0);
const filter = html.slice(start, html.indexOf('\n  }', start) + 4);
function visible(value) {
  return vm.runInNewContext(`let rows = [{id:'assigned',room_id:${JSON.stringify(room)}},{id:'unassigned',room_id:null}];
    const _calendarRoomFilter=${JSON.stringify(value)}; ${filter}; rows.map(r=>r.id).join(',')`);
}
assert.equal(visible(null), 'assigned,unassigned');
assert.equal(visible(room), 'assigned');
assert.equal(visible('__unassigned__'), 'unassigned');
assert.equal(visible('another-room'), '');
console.log('PASS calendar-feed-assignment: explicit Settings assignment, stable provenance, scoped UID and exclusive All/room/Unassigned filters');
