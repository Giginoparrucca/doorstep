// Round 60a Phase 2 — iCal sync parsing (api/ical-sync.js).
//
// Covers the pure parser surface exported from api/ical-sync.js:
//   parseICS(text)  — VEVENT folder-aware parser
//   vEventToRow(ev, propertyId, platform) — projection to the
//                      ota_reservations shape stored in the DB
//   icsDateToISO(field) — DATE / DATETIME → ISO date
//   normalizePlatform(p) — airbnb/booking/vrbo bucketing
//
// Representative samples from each OTA that currently matters:
//   - Airbnb reservation + Airbnb host-set block
//   - Booking.com reservation (SUMMARY is always "CLOSED - Not available")
//   - Vrbo reservation + cancelled reservation
//   - WelcomeBnB-emitted event with X-WELCOMEBNB-UID for echo detection
//   - Line folding (RFC 5545 §3.1)
//
// Pure Node, no network, no live Supabase.
import assert from 'node:assert/strict';
import { parseICS, vEventToRow, icsDateToISO, normalizePlatform } from '../api/ical-sync.js';

// ── Sample feeds ────────────────────────────────────────────────────
// Line folding (continuation starts with a space) is RFC 5545 §3.1.
// Including one folded line to exercise the unfold loop.
const AIRBNB = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260601',
  'DTEND;VALUE=DATE:20260604',
  'UID:airbnb-reservation-ABC123@airbnb.com',
  'SUMMARY:Reserved',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/',
  ' details/HMABC123XYZ\\nPhone Number (Last 4 Digits): 1234',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260615',
  'DTEND;VALUE=DATE:20260620',
  'UID:airbnb-block-DEF456@airbnb.com',
  'SUMMARY:Airbnb (Not available)',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const BOOKING = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Booking.com//Hotel Calendar//EN',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260701',
  'DTEND;VALUE=DATE:20260705',
  'UID:booking.com-RES-98765',
  'SUMMARY:CLOSED - Not available',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const VRBO = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Vrbo//EN',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260801',
  'DTEND;VALUE=DATE:20260806',
  'UID:HA-RES-11111',
  'SUMMARY:Reserved - John Doe',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260810',
  'DTEND;VALUE=DATE:20260812',
  'UID:HA-RES-22222',
  'SUMMARY:Reserved',
  'STATUS:CANCELLED',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const ECHO = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260901',
  'DTEND;VALUE=DATE:20260903',
  'UID:other-platform-999@example.invalid',
  'SUMMARY:Reserved',
  'DESCRIPTION:WelcomeBnB calendar event: direct-booking-xyz',
  'X-WELCOMEBNB-UID:direct-booking-xyz',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

// ── Airbnb: reservation + block ─────────────────────────────────────
{
  const events = parseICS(AIRBNB);
  assert.equal(events.length, 2);
  const [res, block] = events.map(e => vEventToRow(e, 'prop-1', 'airbnb'));
  assert.equal(res.entry_type, 'reservation');
  assert.equal(res.status, 'active');
  assert.equal(res.checkin_date, '2026-06-01');
  assert.equal(res.checkout_date, '2026-06-04');
  // "Reserved" alone → guest_name null (summary is boilerplate, not a name).
  assert.equal(res.guest_name, null);
  assert.equal(res.reservation_url, 'https://www.airbnb.com/hosting/reservations/details/HMABC123XYZ');
  assert.equal(res.phone_last4, '1234');

  assert.equal(block.entry_type, 'block');
  assert.equal(block.status, 'active');
  assert.equal(block.guest_name, null);
}

// ── Booking.com: SUMMARY is always "CLOSED - Not available", but
//    on Booking we treat EVERY event as a reservation (Round 36.2) ─
// Known quirk: because the Booking.com branch bypasses the block
// classifier, the guest_name extractor strips the "CLOSED - " prefix
// and leaves "Not available" as a pseudo-name. The host UI treats
// this as "unknown guest" at render time. Document the current shape;
// any future fix moves the Booking summary straight to null and this
// test is the signal to update the assertion in the same commit.
{
  const events = parseICS(BOOKING);
  assert.equal(events.length, 1);
  const row = vEventToRow(events[0], 'prop-1', 'booking');
  assert.equal(row.entry_type, 'reservation', 'Booking never produces a block via SUMMARY');
  assert.equal(row.status, 'active');
  assert.equal(row.guest_name, 'Not available',
    'current behaviour: Booking.com strips "CLOSED - " prefix; UI treats "Not available" as unknown');
  assert.equal(row.checkin_date, '2026-07-01');
  assert.equal(row.checkout_date, '2026-07-05');
}

// ── Vrbo: reservation with real name + cancelled reservation ──────
{
  const events = parseICS(VRBO);
  assert.equal(events.length, 2);
  const [real, cancelled] = events.map(e => vEventToRow(e, 'prop-1', 'vrbo'));
  assert.equal(real.entry_type, 'reservation');
  assert.equal(real.guest_name, 'John Doe', 'Reserved - <name> strips the prefix');
  assert.equal(cancelled.status, 'cancelled', 'STATUS:CANCELLED propagates');
  assert.equal(cancelled.entry_type, 'reservation');
}

// ── Echo: an iCal event we previously exported ourselves comes back
//    with X-WELCOMEBNB-UID so the roundtrip can suppress a duplicate ─
{
  const events = parseICS(ECHO);
  assert.equal(events.length, 1);
  assert.equal(events[0].ORIGIN_UID, 'direct-booking-xyz');
  const row = vEventToRow(events[0], 'prop-1', 'other');
  assert.equal(row.raw.origin_uid, 'direct-booking-xyz');
}

// ── icsDateToISO: DATE vs DATETIME forms ───────────────────────────
assert.equal(icsDateToISO({ value: '20260215' }), '2026-02-15');
assert.equal(icsDateToISO({ value: '20260215T120000Z' }), '2026-02-15');
assert.equal(icsDateToISO(null), null);
assert.equal(icsDateToISO({ value: 'bogus' }), null);
assert.equal(icsDateToISO({}), null);

// ── normalizePlatform ──────────────────────────────────────────────
assert.equal(normalizePlatform('Airbnb'), 'airbnb');
assert.equal(normalizePlatform(' BOOKING '), 'booking');
assert.equal(normalizePlatform('vrbo'), 'vrbo');
assert.equal(normalizePlatform(''), 'other');
assert.equal(normalizePlatform('expedia'), 'other');

// ── Idempotent re-parse: parsing the same text twice yields the same
//    data (no module-level state leaks between calls) ────────────────
assert.deepEqual(
  parseICS(AIRBNB).map(e => ({ UID: e.UID, SUMMARY: e.SUMMARY, DTSTART: e.DTSTART?.value })),
  parseICS(AIRBNB).map(e => ({ UID: e.UID, SUMMARY: e.SUMMARY, DTSTART: e.DTSTART?.value })),
);

console.log('PASS ical-sync-parse: Airbnb/Booking/Vrbo parsing, folded lines, block-vs-reservation classification, cancelled propagation, echo UID detection, idempotent reparse.');
