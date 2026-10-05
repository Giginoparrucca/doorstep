#!/usr/bin/env node
// scripts/autofile-due.test.mjs
//
// Round 49 Phase 1 — unit tests for AllogRecords.autofileDueAt.
//
// Each case says "given this row, this property, and this `now`, the
// due moment MUST equal this ISO instant" (or `null` when the portal
// window has lapsed). Run with `node scripts/autofile-due.test.mjs`
// — exits non-zero on any failure.
//
// All times are Europe/Rome; the lib enforces that via Intl.DateTimeFormat.
// Two DST transitions are explicitly covered (last Sunday of March,
// last Sunday of October) because that's where naive +01/+02 math breaks.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const req = createRequire(pathToFileURL(process.cwd() + '/scripts/').href);
const { autofileDueAt } = req('../lib/alloggiati-records.js');

const PROP_15 = { checkin_time: '15:00-20:00' };

const cases = [
  {
    name: 'multi-night, submitted day-2, now day-1 → arrival+1 03:00 Rome',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-10', submitted_at: '2026-10-03T09:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-04T10:00:00+02:00',
    want: '2026-10-06T01:00:00.000Z',
  },
  {
    name: 'multi-night, check-in completed arrival+1 05:00 → due now',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-10', submitted_at: '2026-10-06T05:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-06T05:30:00+02:00',
    want: '2026-10-06T03:30:00.000Z',
  },
  {
    name: 'one-night, submitted day before, prop checkin_time 15:00 → arrival 15:00',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-06', submitted_at: '2026-10-04T20:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-04T20:05:00+02:00',
    want: '2026-10-05T13:00:00.000Z',
  },
  {
    name: 'one-night, submitted on arrival day → due now',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-06', submitted_at: '2026-10-05T18:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-05T18:05:00+02:00',
    want: '2026-10-05T16:05:00.000Z',
  },
  {
    name: 'arrival+2 (past portal window) → null',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-10', submitted_at: '2026-10-07T10:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-07T10:00:00+02:00',
    want: null,
  },
  // DST — last Sunday of March 2026 (29 Mar, 02:00 → 03:00 Rome).
  // An arrival on 28 Mar (Saturday) + multi-night → due 29 Mar 03:00
  // Rome. 29 Mar 03:00 Rome is the FIRST valid local 03:00 after the
  // skipped hour, so UTC must be 29 Mar 01:00Z (CEST +02).
  {
    name: 'DST spring-forward: multi-night submitted Fri → arrival+1 (Sun) 03:00 Rome CEST',
    row:  { arrival_date: '2026-03-28', departure_date: '2026-04-02', submitted_at: '2026-03-27T12:00:00+01:00' },
    prop: PROP_15,
    now:  '2026-03-28T20:00:00+01:00',
    want: '2026-03-29T01:00:00.000Z',
  },
  // DST — last Sunday of October 2026 (25 Oct, 03:00 → 02:00 Rome).
  // Arrival Sat 24 Oct → due Sun 25 Oct 03:00 Rome. On that day 03:00
  // Rome is the SECOND 03:00 (post-DST, CET +01), so UTC = 02:00Z.
  {
    name: 'DST fall-back: multi-night submitted Fri → arrival+1 (Sun) 03:00 Rome CET',
    row:  { arrival_date: '2026-10-24', departure_date: '2026-10-28', submitted_at: '2026-10-23T12:00:00+02:00' },
    prop: PROP_15,
    now:  '2026-10-24T20:00:00+02:00',
    want: '2026-10-25T02:00:00.000Z',
  },
  // Property with no explicit checkin_time: default 15:00 Rome.
  {
    name: 'one-night, pre-arrival, property without checkin_time → arrival 15:00 Rome',
    row:  { arrival_date: '2026-10-05', departure_date: '2026-10-06', submitted_at: '2026-10-04T20:00:00+02:00' },
    prop: {},
    now:  '2026-10-04T20:05:00+02:00',
    want: '2026-10-05T13:00:00.000Z',
  },
];

let failed = 0;
for (const c of cases) {
  const got = autofileDueAt(c.row, c.prop, new Date(c.now));
  const gotStr = got === null ? null : got.toISOString();
  const ok = gotStr === c.want;
  const mark = ok ? '✓' : '✗';
  console.log(`${mark} ${c.name}`);
  if (!ok) {
    console.log('    want:', c.want);
    console.log('    got: ', gotStr);
    failed++;
  }
}
if (failed > 0) {
  console.log(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
