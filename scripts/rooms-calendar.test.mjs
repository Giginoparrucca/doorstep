// Round 60 Phase 2: actual sync handlers and actual host functions; fictional
// records only. The fake implements filters so missing room predicates leak
// data into assertions instead of being hidden by pre-filtered canned replies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const C = createRequire(import.meta.url)('../lib/calendar-roundtrip.js');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-room-service';
const { syncOnePropertyFeeds: sync, feedIdentity, roomFeedUid, sourceFeedIdentity } = await import('../api/ical-sync.js');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const stay = (id, room_id, extra = {}) => ({ id, property_id: 'p1', room_id, platform: 'direct', uid: 'direct_' + id,
  entry_type: 'reservation', status: 'active', is_test: false, deleted_at: null, covered_by_reservation_id: null,
  checkin_date: '2099-05-01', checkout_date: '2099-05-04', booking_code: 'BOOK-' + id, ...extra });
const direct = stay('direct', A);
const echo = stay('echo', B, { platform: 'airbnb', entry_type: 'block', booking_code: null, uid: C.outboundUid(direct) });
assert.equal(C.matchOrigin(echo, [direct]), null);
assert.equal(C.matchOrigin({ ...echo, room_id: A }, [direct]).id, direct.id);
assert.equal(C.projectRows([direct, echo]).length, 2, 'occupancy of room A cannot hide room B');
assert.equal(C.projectRows([direct, { ...echo, room_id: A }]).length, 1);
assert.equal(C.visibleRows([direct, { ...echo, covered_by_reservation_id: direct.id }]).length, 2, 'stale cross-room manual link is not hidden');
const checkins = [
  { property_id: 'p1', room_id: A, booking_code: 'ROOM-A', arrival_date: '2099-05-01', departure_date: '2099-05-04', name: 'Alfa' },
  { property_id: 'p1', room_id: B, booking_code: 'ROOM-B', arrival_date: '2099-05-01', departure_date: '2099-05-04', name: 'Beta' },
  { property_id: 'p2', room_id: A, booking_code: 'ROOM-A', arrival_date: '2099-05-01', name: 'Other property' },
];
assert.deepEqual(C.matchingCheckins({ ...direct, booking_code: 'ROOM-B' }, checkins, true).map(c => c.name), ['Beta'], 'booking code takes precedence');
assert.deepEqual(C.matchingCheckins(direct, checkins, true).map(c => c.name), ['Alfa']);
assert.deepEqual(C.matchingCheckins({ ...direct, room_id: null }, checkins, true), [], 'unassigned dates do not guess a room');
assert.equal(C.matchingCheckins({ ...direct, room_id: null }, checkins, false).length, 2, 'legacy no-room fallback retained');

let db = [], feeds = new Map(), calls = [], errors = [];
const originalFetch = globalThis.fetch;
const matches = (row, q) => [...q].every(([key, value]) => {
  if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true;
  if (key === 'or') return row.entry_type === 'block' || row.checkin_date >= /checkin_date.gte.([^,)]+)/.exec(value)[1];
  const actual = key.startsWith('raw->>') ? row.raw?.[key.slice(6)] : row[key];
  if (value === 'is.null') return actual == null;
  if (value.startsWith('in.(')) return value.slice(4, -1).replaceAll('"', '').split(',').includes(String(actual));
  const i = value.indexOf('.'), op = value.slice(0, i), wanted = value.slice(i + 1);
  if (op === 'eq') return String(actual) === wanted;
  if (op === 'neq') return String(actual) !== wanted;
  if (op === 'gte') return String(actual) >= wanted;
  throw Error('Unsupported fixture filter ' + key + '=' + value);
});
const reply = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
globalThis.fetch = async (url, options = {}) => {
  const u = new URL(url), method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({ u, method, body });
  if (feeds.has(url)) return reply(feeds.get(url), feeds.get(url) === 'FAIL' ? 503 : 200);
  if (u.pathname === '/rest/v1/property_rooms') return reply([{ id: A, property_id: 'p1' }, { id: B, property_id: 'p1' }].filter(r => matches(r, u.searchParams)));
  if (u.pathname === '/rest/v1/properties' && method === 'PATCH') return reply([]);
  if (u.pathname !== '/rest/v1/ota_reservations') { errors.push(url); throw Error('Unexpected network: ' + url); }
  if (method === 'GET') {
    const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 1000);
    return reply(db.filter(r => matches(r, u.searchParams)).slice(offset, offset + limit));
  }
  if (method === 'POST') {
    for (const row of body) {
      let old = db.find(r => r.property_id === row.property_id && r.platform === row.platform && r.uid === row.uid);
      if (old) Object.assign(old, row);
      else db.push({ id: 'import-' + db.length, is_test: false, deleted_at: null, ...row });
    }
    return reply([]);
  }
  if (method === 'PATCH') {
    const targets = db.filter(r => matches(r, u.searchParams)); targets.forEach(r => Object.assign(r, body));
    return reply(targets);
  }
  errors.push(method + ' ' + url); throw Error('Unsupported network');
};
const feed = (platform, room_id, suffix = '') => ({ platform, room_id, url: 'https://fixture.invalid/' + platform + '/' + room_id + suffix });
const fa = feed('booking', A), fb = feed('booking', B);
const ics = (uid = 'SHARED-UID', start = '20990501', end = '20990504', extra = '') =>
  'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:' + uid + '\r\nDTSTART;VALUE=DATE:' + start + '\r\nDTEND;VALUE=DATE:' + end + '\r\nSUMMARY:Reserved\r\n' + extra + 'END:VEVENT\r\nEND:VCALENDAR\r\n';
const empty = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
try {
  feeds.set(fa.url, ics()); feeds.set(fb.url, ics());
  assert.deepEqual((await sync('p1', [fa, fb], 'fixture', 'fixture')).errors, []);
  assert.equal(db.length, 2); assert.notEqual(db[0].uid, db[1].uid);
  assert.deepEqual(db.map(r => r.room_id), [A, B]);
  db[0].booking_code = 'KEEP-A'; db[1].booking_code = 'KEEP-B';
  await sync('p1', [fa, fb], 'fixture', 'fixture');
  assert.equal(db.length, 2); assert.deepEqual(db.map(r => r.booking_code), ['KEEP-A', 'KEEP-B']);
  feeds.set(fa.url, ics('ROTATED', '20990502'));
  await sync('p1', [fa, fb], 'fixture', 'fixture');
  assert.equal(db.length, 2); assert.equal(db[0].checkin_date, '2099-05-01'); assert.equal(db[0].booking_code, 'KEEP-A');
  assert.ok(db[0].uid.endsWith(':ROTATED'));
  assert.ok(db[1].uid.endsWith(':SHARED-UID'));
  const rotatedURL = { ...fa, url: fa.url + '?new-token=fictional' };
  assert.equal(feedIdentity(rotatedURL), feedIdentity(fa), 'URL/token rotation must not rotate room identity');
  feeds.set(rotatedURL.url, ics('ROTATED'));
  await sync('p1', [rotatedURL, fb], 'fixture', 'fixture'); assert.equal(db.length, 2);
  feeds.set(fb.url, 'FAIL'); feeds.set(rotatedURL.url, empty);
  await sync('p1', [rotatedURL, fb], 'fixture', 'fixture');
  assert.ok(db.every(r => r.status === 'active'), 'failed sibling suppresses destructive cancellation');
  feeds.set(fb.url, ics());
  await sync('p1', [rotatedURL], 'fixture', 'fixture');
  assert.equal(db[0].status, 'cancelled'); assert.equal(db[1].status, 'active', 'sync room A must not cancel room B');
  const before = JSON.stringify(db), count = calls.length;
  await assert.rejects(sync('p2', [fa], 'fixture', 'fixture'), /not active/);
  assert.equal(JSON.stringify(db), before); assert.ok(calls.slice(count).every(c => c.method === 'GET'));
  const air = feed('airbnb', A), wrong = feed('airbnb', B);
  db = [direct]; feeds.set(air.url, ics(C.outboundUid(direct))); feeds.set(wrong.url, ics(C.outboundUid(direct)));
  await sync('p1', [air, wrong], 'fixture', 'fixture');
  const importedA = db.find(r => r.platform === 'airbnb' && r.room_id === A);
  const importedB = db.find(r => r.platform === 'airbnb' && r.room_id === B);
  assert.equal(importedA.covered_by_reservation_id, direct.id);
  assert.equal(importedB.covered_by_reservation_id, undefined);
  assert.equal(C.identifyOrigin(importedB, [direct]), null);
  db = [stay('assigned', A, { platform: 'airbnb', uid: roomFeedUid(feedIdentity(air), 'MOVE'), booking_code: 'KEEP-ROOM-MOVE',
    raw: { welcomebnb_feed_uid: 'MOVE', welcomebnb_feed_key: feedIdentity(air), welcomebnb_feed_source: sourceFeedIdentity(air) } })];
  feeds.set(air.url, ics('MOVE'));
  await sync('p1', [{ ...air, room_id: B }], 'fixture', 'fixture');
  assert.equal(db.length, 1); assert.equal(db[0].room_id, B); assert.equal(db[0].booking_code, 'KEEP-ROOM-MOVE');
  await sync('p1', [{ ...air, room_id: null }], 'fixture', 'fixture');
  assert.equal(db.length, 1); assert.equal(db[0].room_id, null); assert.equal(db[0].booking_code, 'KEEP-ROOM-MOVE');
  await assert.rejects(sync('p1', [air, { ...air, room_id: B }], 'fixture', 'fixture'), /different rooms/);
  db = [stay('legacy', null, { platform: 'airbnb', uid: 'OLD', booking_code: 'KEEP-LEGACY' })];
  feeds.set(air.url, ics('OLD'));
  await sync('p1', [air], 'fixture', 'fixture');
  assert.equal(db.length, 1); assert.equal(db[0].room_id, A); assert.equal(db[0].booking_code, 'KEEP-LEGACY');
  assert.equal(db[0].uid, roomFeedUid(feedIdentity(air), 'OLD'));
  db = [stay('ambiguous', null, { platform: 'airbnb', uid: 'OLD' })];
  feeds.set(wrong.url, ics('OLD'));
  const ambiguousBefore = JSON.stringify(db);
  const ambiguous = await sync('p1', [air, wrong], 'fixture', 'fixture');
  assert.equal(ambiguous.errors.length, 2); assert.equal(JSON.stringify(db), ambiguousBefore);
  await assert.rejects(sync('p1', [air, { ...air, url: air.url + '/another' }], 'fixture', 'fixture'), /distinct stable feed keys/);
  const writesBefore = calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(sync('p1', [{ ...air, room_id: 'invalid' }], 'fixture', 'fixture'), /Invalid feed room/);
  await assert.rejects(sync('p1', [{ ...air, room_id: '33333333-3333-4333-8333-333333333333' }], 'fixture', 'fixture'), /not active/);
  assert.equal(calls.filter(c => c.method !== 'GET').length, writesBefore, 'invalid/deleted/foreign room cannot cause a write');
  console.log('PASS actual room sync: duplicate OTA UIDs, room-specific rotations/cancellations, failure preservation, validated ownership, echo isolation, safe legacy adoption/ambiguity and stable URL changes');
} finally { globalThis.fetch = originalFetch; assert.deepEqual(errors, []); }

// Actual host code and DOM: no copied matching/overlap implementation.
const source = readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '('); assert.ok(start >= 0, name);
  for (let end = source.indexOf('\n}', start); end >= 0; end = source.indexOf('\n}', end + 2)) {
    const candidate = (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, end + 2);
    try { new vm.Script(candidate); } catch { continue; }
    return candidate;
  }
  throw Error('Cannot parse ' + name);
}
const { document } = parseHTML('<html><body><div id="icalFeedsList"></div></body></html>');
let overlapRows = [stay('a', A), stay('b', B), stay('unknown', null)];
const q = new Proxy({}, { get(_, key) { return key === 'then' ? resolve => resolve({ data: overlapRows }) : () => q; } });
const ctx = vm.createContext({ CalendarRoundtrip: C, Date, document, console, propertyId: 'p1', propertyData: {}, propertyRooms: [{ id: A }, { id: B }],
  allCheckins: checkins, hostLang: 'en', APP_CONFIG: { mode: 'production' }, APP_ORIGIN: 'https://fixture.invalid', sb: { from: () => q },
  h: k => k, _cleanOtaGuestName: n => n, _icalEscape: s => s });
for (const name of ['_computeReservationOverlap', '_confirmCoverage', '_renderReservationCard', 'icalFeedRowHtml', 'collectIcalFeeds', 'collectDomIcalFeedsIncludingBlank']) vm.runInContext(fn(name), ctx);
assert.deepEqual(Array.from(await ctx._computeReservationOverlap('p1', '2099-05-01', '2099-05-04', null, A), r => r.id), ['a', 'unknown']);
assert.equal((await ctx._computeReservationOverlap('p1', '2099-05-01', '2099-05-04', null, null)).length, 3, 'unassigned booking gives advisory warnings across rooms');
for (const lang of ['it', 'en']) {
  ctx.hostLang = lang;
  const card = ctx._renderReservationCard(stay('calendar', B), '2099-04-01');
  assert.ok(card.html.includes('Beta')); assert.ok(!card.html.includes('Alfa'));
}
ctx.propertyRooms = [];
assert.ok(ctx._renderReservationCard(stay('legacy', null), '2099-04-01').html.includes('Alfa'), 'no-room date fallback remains');
ctx.propertyRooms = null;
assert.ok(!ctx._renderReservationCard(stay('unknown', null), '2099-04-01').html.includes('Alfa'), 'failed room metadata cannot guess a name');
assert.ok(ctx._renderReservationCard(stay('exact', null, { booking_code: 'ROOM-B' }), '2099-04-01').html.includes('Beta'), 'known booking code works while metadata is unavailable');
document.getElementById('icalFeedsList').innerHTML = ctx.icalFeedRowHtml({ ...fa, label: 'Room A', feed_key: 'stable-A' }, 0);
const collected = ctx.collectIcalFeeds(); assert.equal(collected[0].room_id, A); assert.equal(collected[0].feed_key, 'stable-A');
assert.equal(ctx.collectDomIcalFeedsIncludingBlank()[0].room_id, A);
console.log('PASS actual host overlap and IT/EN reservation cards: room-scoped names and warnings, unassigned advisory; room/feed settings survive save/re-render');

let confirmations = 0, notices = [];
ctx.confirm = () => { confirmations++; return true; }; ctx.toast = message => notices.push(message);
ctx._upcomingRowsById = { ota: stay('ota', B, { platform: 'airbnb' }), direct: stay('direct', A) };
await ctx._confirmCoverage('ota', 'direct');
assert.equal(confirmations, 0); assert.equal(notices.length, 1, 'cross-room link refused before confirmation or write');
ctx._upcomingRowsById.ota = stay('ota', A, { platform: 'airbnb', property_id: 'p2' });
await ctx._confirmCoverage('ota', 'direct'); assert.equal(confirmations, 0, 'stale property cache cannot link another property');
