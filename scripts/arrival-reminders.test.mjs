import assert from 'node:assert/strict';
import { fixtureEnvironment, call, json, mockNetwork, filterRows } from './helpers/offline.mjs';

fixtureEnvironment();
const RealDate = Date;
let now = '2026-10-24T05:00:00Z'; // 07:00 Rome before DST ends.
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return RealDate.parse(now); }
};
const { default: handler, runStoragePurgePass, runTestCleanup } = await import('../api/send-arrival-reminders.js');
let props, reservations, checkins, queue, emails, emailStatus, storageStatus, purgeStatus;
const property = (id, extra = {}) => ({ id, name: 'Fictional ' + id, reminder_email: id + '@example.invalid',
  timezone: 'Europe/Rome', host_language: 'it', deleted_at: null, ...extra });
const booking = (id, extra = {}) => ({ id, property_id: 'p1', platform: 'airbnb', guest_name: 'Fictional Guest',
  entry_type: 'reservation', status: 'active', is_test: false, deleted_at: null,
  covered_by_reservation_id: null, arrival_reminder_sent_at: null, booking_code: 'BOOK-' + id,
  checkin_date: '2026-10-25', checkout_date: '2026-10-28', ...extra });
function reset() {
  props = [property('p1')]; reservations = [booking('eligible')]; checkins = []; queue = []; emails = [];
  emailStatus = 200; storageStatus = 200; purgeStatus = 200;
}
reset();
const net = mockNetwork(({ url, method, body }) => {
  if (url.hostname === 'api.resend.com') { emails.push(body); return json({}, emailStatus); }
  if (url.pathname === '/storage/v1/object/documents') return json({}, storageStatus);
  if (url.pathname === '/rest/v1/rpc/purge_onboarding_tests') return json({ queued: 1 }, purgeStatus);
  const table = url.pathname.split('/').at(-1);
  const rows = ({ properties: props, ota_reservations: reservations, checkins, storage_purge_queue: queue })[table];
  if (rows) {
    const matching = filterRows(rows, url.searchParams);
    if (method === 'GET') return json(matching);
    if (method === 'PATCH') { matching.forEach(r => Object.assign(r, body)); return json({}); }
    if (method === 'DELETE' && table === 'storage_purge_queue') { queue = queue.filter(r => !matching.includes(r)); return json({}); }
  }
});
const invoke = (query = '?pass=arrival') => call(handler, undefined,
  { method: 'GET', url: query, headers: { authorization: 'Bearer fixture-cron' } });
try {
  assert.equal((await call(handler, undefined, { method: 'GET' })).code, 401);
  assert.equal(net.calls.length, 0);
  reservations.push(...[
    ['checked'], ['cancelled', { status: 'cancelled' }], ['block', { entry_type: 'block' }],
    ['test', { is_test: true }], ['gone', { deleted_at: now }], ['covered', { covered_by_reservation_id: 'direct' }],
    ['sent', { arrival_reminder_sent_at: now }], ['other-day', { checkin_date: '2026-10-26' }],
    ['other-property', { property_id: 'p2' }],
  ].map(([id, extra]) => booking(id, extra)));
  checkins = [{ booking_code: 'BOOK-checked', property_id: 'p1', is_test: false, deleted_at: null }];
  const first = await invoke();
  assert.equal(first.code, 200); assert.equal(first.body.total_arrival_sent, 1);
  assert.equal(emails.length, 1); assert.match(emails[0].subject, /Arrivi domani/);
  assert.ok(emails[0].html.includes('BOOK-eligible')); assert.ok(!emails[0].html.includes('BOOK-checked'));
  assert.equal(reservations.find(r => r.id === 'eligible').arrival_reminder_sent_at, new Date(now).toISOString());
  assert.equal((await invoke()).body.total_arrival_sent, 0); assert.equal(emails.length, 1, 'same-hour rerun deduplicates');

  reset(); emailStatus = 503;
  assert.equal((await invoke()).body.total_arrival_sent, 0);
  assert.equal(reservations[0].arrival_reminder_sent_at, null, 'failed mail does not consume dedup marker');
  emailStatus = 200; assert.equal((await invoke()).body.total_arrival_sent, 1);
  reset();
  assert.equal((await invoke('?pass=arrival&dry=1')).body.total_arrival_sent, 0);
  assert.equal(emails.length, 0); assert.equal(reservations[0].arrival_reminder_sent_at, null);
  now = '2026-10-24T20:00:00Z';
  assert.match((await invoke()).body.per_property[0].skipped, /local_hour=22/);
  assert.equal((await invoke('?pass=arrival&force=1')).body.total_arrival_sent, 1);

  for (const [instant, tomorrow] of [
    ['2026-10-25T05:00:00Z', '2026-10-26'], // DST end: Rome 06:00.
    ['2026-12-31T23:30:00Z', '2027-01-02'], // Rome Jan 1; force hour gate.
    ['2024-02-28T06:00:00Z', '2024-02-29'],
  ]) {
    reset(); now = instant; reservations[0].checkin_date = tomorrow;
    props[0].host_language = 'en';
    const r = await invoke('?pass=arrival&force=1');
    assert.equal(r.body.total_arrival_sent, 1); assert.match(emails[0].subject, /Arriving tomorrow/);
  }
  reset(); now = '2026-10-24T05:00:00Z';
  checkins = [
    { id: 'pending', property_id: 'p1', is_test: false, deleted_at: null, alloggiati_status: 'pending', arrival_date: '2026-10-23', filing_reminder_sent_at: null, surname: 'PRIVATE-SURNAME', document_number: 'PRIVATE-DOCUMENT' },
  ];
  const filing = await invoke('?pass=filing');
  assert.equal(filing.body.total_filing_sent, 1); assert.match(emails[0].subject, /Promemoria invio Alloggiati/);
  assert.ok(!JSON.stringify(emails).match(/PRIVATE-SURNAME|PRIVATE-DOCUMENT/));
  assert.equal((await invoke('?pass=filing')).body.total_filing_sent, 0);

  reset();
  queue = [
    { id: 'photo', bucket: 'documents', path: 'id-photos/fictional.png', attempts: 0 },
    { id: 'retry', bucket: 'documents', path: 'id-photos/retry.png', attempts: 2 },
    { id: 'receipt', bucket: 'receipts', path: 'fictional.pdf', attempts: 0 },
    { id: 'exhausted', bucket: 'documents', path: 'id-photos/failed.png', attempts: 5 },
  ];
  assert.deepEqual(await runStoragePurgePass(true), { queued: 2, deleted: 0, failed: 0, dry: true });
  storageStatus = 503;
  const failed = await runStoragePurgePass(false);
  assert.equal(failed.failed, 2); assert.equal(queue[0].attempts, 1); assert.equal(queue[1].attempts, 3);
  assert.equal(queue[2].attempts, 0); assert.equal(queue[3].attempts, 5);
  storageStatus = 200; purgeStatus = 503;
  const recovered = await runTestCleanup(false);
  assert.equal(recovered.deleted, 2); assert.match(recovered.test_error, /503/);
  assert.deepEqual(queue.map(r => r.id), ['receipt', 'exhausted']);
  const deletes = net.calls.filter(c => c.url.pathname === '/storage/v1/object/documents');
  assert.ok(deletes.every(c => c.method === 'DELETE' && c.body.prefixes.every(p => p.startsWith('id-photos/'))));
  assert.equal((await runStoragePurgePass(false)).queued, 0, 'drained queue is idempotent');
  console.log('PASS real reminder handler: eligibility, repeat/failure dedup, dry/force, IT/EN, DST/year/leap dates, count-only filing; private document queue retries and isolated storage cleanup');
} finally { globalThis.Date = RealDate; net.restore(); }
