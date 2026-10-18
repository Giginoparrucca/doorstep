import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureEnvironment, call, json, mockNetwork } from './helpers/offline.mjs';

fixtureEnvironment();
const { default: handler, parseICS, vEventToRow } = await import('../api/ical-sync.js');
const rows = {};
for (const platform of ['airbnb', 'booking', 'vrbo']) {
  const source = readFileSync(new URL('./fixtures/ical/' + platform + '.ics', import.meta.url), 'utf8');
  rows[platform] = parseICS(source).map(e => vEventToRow(e, 'fixture-property', platform));
  assert.ok(rows[platform].every(r => r.property_id === 'fixture-property' && r.platform === platform));
  assert.equal(rows[platform][0].checkin_date, '2099-05-01');
  assert.equal(rows[platform][0].checkout_date, '2099-05-04', 'DTEND stays the checkout day');
}
assert.equal(rows.airbnb[0].guest_name, null, 'Airbnb does not supply a guest name');
assert.equal(rows.airbnb[0].phone_last4, '1234', 'RFC line unfolding precedes description extraction');
assert.equal(rows.airbnb[0].reservation_url, 'https://airbnb.example.invalid/reservation/fixture');
assert.equal(rows.airbnb[1].entry_type, 'block');
assert.equal(rows.booking[0].entry_type, 'reservation', 'Booking generic closed summary is a real stay');
assert.equal(rows.booking[1].status, 'cancelled');
assert.equal(rows.vrbo[0].guest_name, 'Fictional Guest');
assert.equal(rows.vrbo[0].raw.description, 'Fictional, escaped; description\nSecond line');

let owned = true, authOK = true;
const net = mockNetwork(({ url, headers }) => {
  if (url.pathname === '/auth/v1/user') return json({ id: 'fixture-host' }, authOK ? 200 : 401);
  if (url.pathname === '/rest/v1/properties') {
    assert.equal(headers.Authorization, 'Bearer fixture-host-jwt', 'ownership lookup uses caller JWT, not service-role bypass');
    assert.equal(url.searchParams.get('id'), 'eq.fixture-property');
    return json(owned ? [{ id: 'fixture-property', ical_feeds: [] }] : []);
  }
});
try {
  assert.equal((await call(handler, { property_id: 'fixture-property' })).code, 401);
  const invoke = () => call(handler, { property_id: 'fixture-property' }, { token: 'fixture-host-jwt' });
  assert.equal((await invoke()).body.synced, 0);
  owned = false; assert.equal((await invoke()).code, 403);
  authOK = false; assert.equal((await invoke()).code, 401);
  console.log('PASS synthetic Airbnb/Booking/Vrbo fixtures: folded/escaped lines, dates, names, blocks/cancellations; real handler JWT/ownership/no-feeds. Repeat sync/echo/cancel/failure gates remain in calendar-roundtrip.test.mjs.');
} finally { net.restore(); }
