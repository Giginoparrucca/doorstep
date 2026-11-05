// Round 71 — host health metric rules (lib/host-health.js), fictional rows.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const H = require('../lib/host-health.js');

const NOW = '2026-11-05T09:00:00Z'; // 10:00 Rome
const P = 'p1';
const prop = (x = {}) => ({ id: P, name: 'Casa Prova', owner_id: 'o1', timezone: 'Europe/Rome', cir_code: 'IT000000C200000001', ross1000_codice: 'R1', tax_rate_eur: 2, ical_feeds: ['https://example.invalid/a.ics'], welcome_message_it: 'Ciao', alloggiati_autofile_mode: 'live', ...x });
const res = (code, date, x = {}) => ({ id: 'r-' + code + date, property_id: P, booking_code: code, checkin_date: date, platform: 'airbnb', entry_type: 'reservation', status: 'active', covered_by_reservation_id: null, is_test: false, deleted_at: null, ...x });
const ci = (code, arrival, x = {}) => ({ id: 'c-' + code + arrival + (x.n || ''), property_id: P, booking_code: code, surname: 'Rossi', arrival_date: arrival, filed_at: null, autofile_excluded: false, alloggiati_status: 'pending', is_test: false, deleted_at: null, ...x });
const okCreds = { property_id: P, verified_at: '2026-10-01T10:00:00Z', wskey_expires_at: '2027-06-01T00:00:00Z', last_error: null };
const base = (x = {}) => ({ property: prop(), now: NOW, reservations: [], checkins: [], filingLog: [], credentials: okCreds, onboarding: { skips: {} }, recommendationCount: 12, guestEventCodes: [], lastActivityAt: '2026-11-04T10:00:00Z', regionCompliance: { export: 'other' }, ...x });

// No reservations → grey, coverage grey.
{ const r = H.computeHostHealth(base()); assert.equal(r.coverage.status, 'grey'); assert.equal(r.coverage.total, 0); assert.equal(r.health.color, 'grey'); assert.match(r.health.reasons[0], /no reservations/); }

// Coverage: multi-guest booking counts once; empty code = unlinkable; blocks, echoes, cancelled, test, other property ignored.
{
  const reservations = [res('A', '2026-11-01'), res('B', '2026-10-20'), res('C', '2026-10-10'), res('', '2026-10-15'), res(null, '2026-10-16'),
    res('X', '2026-10-12', { entry_type: 'block' }), res('Y', '2026-10-12', { status: 'cancelled' }), res('Z', '2026-10-12', { covered_by_reservation_id: 'r1' }),
    res('T', '2026-10-12', { is_test: true }), res('Q', '2026-10-12', { property_id: 'other' }), res('OLD', '2026-10-05')]; // 31 days before: outside
  const F = { filed_at: '2026-11-01T12:00:00Z', alloggiati_status: 'filed' };
  const checkins = [ci('A', '2026-11-01', F), ci('A', '2026-11-01', { n: 2, surname: 'Bianchi', ...F }), ci('A', '2026-11-01', { n: 3, ...F }), ci('B', '2026-10-20', { filed_at: '2026-10-20T12:00:00Z', alloggiati_status: 'filed' })];
  const r = H.computeHostHealth(base({ reservations, checkins, guestEventCodes: ['A', 'C'] }));
  assert.deepEqual([r.coverage.covered, r.coverage.total, r.coverage.unlinkable, r.coverage.pct], [2, 3, 2, 67], 'A (3 guests) counts once');
  assert.equal(r.coverage.status, 'amber'); assert.equal(r.coverage.link_reached, 2); assert.equal(r.coverage.hint, H.HINTS.coverage);
  assert.equal(r.coverage.weeks.length, 4); assert.equal(r.coverage.weeks.reduce((a, w) => a + w.total, 0), 3);
  assert.equal(r.health.color, 'amber'); assert.match(r.health.reasons.join(' '), /coverage 67% \(2\/3\)/);
}
// Low link reach switches the hint; < 50% is red.
{ const r = H.computeHostHealth(base({ reservations: [res('A', '2026-11-01'), res('B', '2026-11-02'), res('C', '2026-11-03')], checkins: [ci('A', '2026-11-01', { filed_at: '2026-11-01T12:00:00Z' })] }));
  assert.equal(r.coverage.status, 'red'); assert.equal(r.coverage.hint, H.HINTS.link); assert.equal(r.health.color, 'red'); }
// ≥ 85% green.
{ const rs = Array.from({ length: 7 }, (_, i) => res('K' + i, '2026-10-2' + i)); const r = H.computeHostHealth(base({ reservations: rs, checkins: rs.slice(0, 6).map(x => ci(x.booking_code, x.checkin_date, { filed_at: x.checkin_date + 'T12:00:00Z' })), guestEventCodes: rs.map(x => x.booking_code) }));
  assert.equal(r.coverage.pct, 86); assert.equal(r.coverage.status, 'green'); assert.equal(r.coverage.hint, null); }

// Filing: on time = filed by end of arrival+1 (property tz); deadline not passed and unfiled → not counted; excluded ignored.
{
  const checkins = [
    ci('A', '2026-10-20', { filed_at: '2026-10-21T21:00:00Z', alloggiati_status: 'filed' }),  // 22:00 Rome on arrival+1: on time
    ci('B', '2026-10-20', { filed_at: '2026-10-21T23:30:00Z', alloggiati_status: 'filed' }),  // 00:30 Rome on arrival+2: late
    ci('C', '2026-11-04'),                                                                      // deadline 5 Nov, not passed: not counted
    ci('D', '2026-11-05'),                                                                      // arrives today: due today, not overdue
    ci('E', '2026-10-25'),                                                                      // unfiled, deadline passed: counted, overdue
    ci('F', '2026-10-25', { autofile_excluded: true }),                                         // excluded
    ci('G', '2026-10-28', { filing_method: 'late_questura_pec', filed_at: '2026-11-02T10:00:00Z', alloggiati_status: 'filed' }),
    ci('H', '2026-09-01', { surname: 'Verdi' }),                                                // old unfiled: overdue
  ];
  const r = H.computeHostHealth(base({ checkins, reservations: [res('A', '2026-10-20')] }));
  assert.deepEqual([r.filing.on_time.on_time, r.filing.on_time.total], [1, 4], 'A on time; B, E, G counted, C/D/F not');
  assert.equal(r.filing.on_time.status, 'red');
  assert.equal(r.filing.overdue.count, 2); assert.deepEqual(r.filing.overdue.rows.map(x => x.arrival_date), ['2026-10-25', '2026-11-04']);
  assert.deepEqual([r.filing.old_unfiled.count, r.filing.old_unfiled.oldest], [1, '2026-09-01'], 'older than 30 days: old unfiled, not overdue');
  assert.match(r.health.reasons.join(' '), /1 old unfiled record \(since 1 Sep\)/);
  assert.equal(r.filing.overdue.due_today, 1); assert.equal(r.filing.late_pec_30d, 1);
  assert.deepEqual(r.filing.overdue.rows.map(x => x.guest), ['R.', 'R.'], 'surname initial only');
  assert.ok(!JSON.stringify(r).includes('Rossi') && !JSON.stringify(r).includes('Verdi'), 'no surname leaves the module');
  assert.equal(r.health.color, 'red'); assert.match(r.health.reasons[0], /^2 filings overdue \(arr\. 25 Oct\)$/);
  // Only old unfiled rows → amber, not red.
  const oldOnly = H.computeHostHealth(base({ checkins: [ci('H', '2026-09-01')], reservations: [res('A', '2026-11-20')] }));
  assert.equal(oldOnly.filing.overdue.count, 0); assert.equal(oldOnly.health.color, 'amber');
}

// Non-Rome timezone: "today" follows the property.
{ const now = '2026-11-05T03:00:00Z'; // 04:00 Rome (5 Nov), 22:00 New York (4 Nov)
  const rome = H.computeHostHealth(base({ now, checkins: [ci('A', '2026-11-04')] }));
  const ny = H.computeHostHealth(base({ now, property: prop({ timezone: 'America/New_York' }), checkins: [ci('A', '2026-11-04')] }));
  assert.equal(rome.today, '2026-11-05'); assert.equal(ny.today, '2026-11-04');
  assert.equal(rome.filing.overdue.count, 1, 'Rome: arrival yesterday is overdue'); assert.equal(ny.filing.overdue.count, 0); assert.equal(ny.filing.overdue.due_today, 1); }

// Autofile: evidence rows are not attempts; last 3 failed → red.
{ const log = (o, t) => ({ property_id: P, trigger: 'autofile', outcome: o, error_code: o === 'filed' ? null : 'X', run_at: t });
  const failing = [log('test_rejected', '2026-11-05T08:00:00Z'), log('evidence_completed', '2026-11-05T08:00:01Z'), log('cred_error', '2026-11-04T08:00:00Z'), log('test_rejected', '2026-11-03T08:00:00Z'), log('filed', '2026-11-01T08:00:00Z')];
  const r = H.computeHostHealth(base({ filingLog: failing, reservations: [res('A', '2026-11-04')], checkins: [ci('A', '2026-11-04', { filed_at: '2026-11-04T12:00:00Z' })] }));
  assert.equal(r.autofile.last_three_failed, true); assert.equal(r.autofile.last.length, 4, 'evidence row excluded'); assert.equal(r.autofile.hint, H.HINTS.failures);
  assert.equal(r.health.color, 'red'); assert.match(r.health.reasons.join(' '), /last 3 automatic filings failed/);
  const recovered = H.computeHostHealth(base({ filingLog: [log('filed', '2026-11-05T09:00:00Z'), ...failing] }));
  assert.equal(recovered.autofile.last_three_failed, false); }

// Credentials.
{ const c = x => H.computeHostHealth(base({ credentials: x })).credentials;
  // Not connected while live = manual filing: amber, red only with overdue filings (Daniele, 5 Nov 2026).
  assert.equal(c(null).status, 'amber', 'missing while live, nothing overdue'); assert.equal(c(null).problem, 'not connected (manual filing only)');
  { const withRes = H.computeHostHealth(base({ credentials: null, reservations: [res('A', '2026-11-20')] }));
    assert.equal(withRes.health.color, 'amber'); assert.match(withRes.health.reasons.join(' '), /Alloggiati not connected \(manual filing only\)/);
    assert.ok(!withRes.setup_gaps.some(g => g.key === 'alloggiati'), 'not repeated as a setup gap');
    const withOverdue = H.computeHostHealth(base({ credentials: null, reservations: [res('A', '2026-11-03')], checkins: [ci('A', '2026-11-03')] }));
    assert.equal(withOverdue.credentials.status, 'red'); assert.equal(withOverdue.health.color, 'red'); assert.match(withOverdue.health.reasons.join(' '), /Alloggiati not connected/); }
  assert.equal(H.computeHostHealth(base({ credentials: null, property: prop({ alloggiati_autofile_mode: 'off' }) })).credentials.status, 'grey');
  assert.equal(c({ ...okCreds, verified_at: null }).status, 'red'); assert.equal(c({ ...okCreds, last_error: 'auth_failed' }).status, 'red');
  assert.equal(c({ ...okCreds, wskey_expires_at: '2026-11-12T00:00:00Z' }).status, 'amber'); assert.equal(c({ ...okCreds, wskey_expires_at: '2026-11-01T00:00:00Z' }).problem, 'key expired');
  assert.equal(c(okCreds).status, 'green'); assert.equal(c(okCreds).mode, 'live'); }

// Setup gaps (ROSS1000 only where the region's export is ROSS1000; skips respected).
{ const gaps = x => H.computeHostHealth(base(x)).setup_gaps.map(g => g.key);
  assert.deepEqual(gaps({ property: prop({ cir_code: '', ross1000_codice: '', tax_rate_eur: null, ical_feeds: [], welcome_message_it: '' }), recommendationCount: 3, regionCompliance: { export: 'ross1000' }, credentials: { ...okCreds } }),
    ['cin', 'ross1000', 'tax', 'ical', 'recos', 'welcome']);
  assert.deepEqual(gaps({ property: prop({ ross1000_codice: '' }), regionCompliance: { export: 'spot' } }), [], 'ROSS1000 only for ROSS1000 regions');
  assert.deepEqual(gaps({ property: prop({ tax_rate_eur: null, ical_feeds: [] }), onboarding: { skips: { tax_not_applicable: true, direct_only: true } } }), []);
  assert.deepEqual(gaps({ property: prop({ welcome_message_it: '', welcome_message: 'legacy' }) }), [], 'legacy welcome message counts');
  assert.deepEqual(gaps({ credentials: { ...okCreds, verified_at: null }, property: prop({ alloggiati_autofile_mode: 'off' }) }), [], 'unverified is already a red credentials reason');
  assert.deepEqual(gaps({ credentials: null }), [], 'not connected while live is a health reason, not a gap');
  assert.deepEqual(gaps({ credentials: null, property: prop({ alloggiati_autofile_mode: 'off' }) }), ['alloggiati'], 'missing while off: a gap, not red'); }

// Upcoming 48 h without check-in.
{ const r = H.computeHostHealth(base({ reservations: [res('U1', '2026-11-05'), res('U2', '2026-11-07'), res('U3', '2026-11-08'), res('U4', '2026-11-06')], checkins: [ci('U4', '2026-11-06')], guestEventCodes: ['U2'] }));
  assert.deepEqual(r.upcoming.map(u => [u.booking_code, u.link_reached]), [['U1', false], ['U2', true]]);
  assert.match(r.health.reasons.join(' '), /2 arrivals in 48 h without check-in/); assert.equal(r.coverage.total, 1, 'arrival today is in the coverage window (spec: today−30…today)'); }

// Activity: only with reservations; > 14 days idle → amber reason.
{ const r = H.computeHostHealth(base({ reservations: [res('A', '2026-11-20')], lastActivityAt: '2026-10-10T10:00:00Z' }));
  assert.equal(r.activity.status, 'red'); assert.equal(r.activity.days_idle, 25); assert.match(r.health.reasons.join(' '), /host inactive for 25 days/);
  const quiet = H.computeHostHealth(base({ lastActivityAt: '2026-09-01T10:00:00Z' })); assert.equal(quiet.activity.status, 'grey', 'no reservations: inactivity is not flagged'); }

// No reservations in the last/next 30 days → grey even with other reasons (Daniele, 5 Nov 2026),
// except overdue filings, which stay red; the reasons are kept.
{ const quiet = H.computeHostHealth(base({ credentials: { ...okCreds, verified_at: null }, property: prop({ cir_code: '' }) }));
  assert.equal(quiet.health.color, 'grey'); assert.equal(quiet.health.reasons[0], 'no reservations in the last or next 30 days');
  assert.match(quiet.health.reasons.join(' '), /Alloggiati saved, never verified/); assert.match(quiet.health.reasons.join(' '), /CIN missing/);
  const legal = H.computeHostHealth(base({ checkins: [ci('Z', '2026-11-02')] }));
  assert.equal(legal.health.color, 'red', 'overdue filing without a reservation stays red'); assert.match(legal.health.reasons[0], /1 filing overdue/);
  assert.deepEqual(H.actionNeeded([quiet, legal]).map(x => x.color), ['red'], 'grey properties are not in Action needed'); }

// Green host.
{ const r = H.computeHostHealth(base({ reservations: [res('A', '2026-11-01')], checkins: [ci('A', '2026-11-01', { filed_at: '2026-11-01T15:00:00Z', alloggiati_status: 'filed' })], guestEventCodes: ['A'] }));
  assert.equal(r.health.color, 'green'); assert.deepEqual(r.health.reasons, []); }

// Action needed: red first, then oldest date; green/grey not listed. Health sort.
{ const mk = (id, color, reason, overdue, upcoming) => ({ property_id: id, name: id, owner_id: 'o', health: { color, reasons: [reason] }, filing: { overdue: { rows: overdue ? [{ arrival_date: overdue }] : [] } }, upcoming: upcoming ? [{ checkin_date: upcoming }] : [] });
  const list = [mk('g', 'green', 'x'), mk('a1', 'amber', 'gap', null, '2026-11-06'), mk('r2', 'red', '1 filing overdue', '2026-11-03'), mk('r1', 'red', '2 filings overdue', '2026-11-01'), mk('grey', 'grey', 'none'), mk('a2', 'amber', 'cov')];
  assert.deepEqual(H.actionNeeded(list).map(x => x.property_id), ['r1', 'r2', 'a1', 'a2']);
  assert.deepEqual(H.sortByHealth(list).map(x => x.health.color), ['red', 'red', 'amber', 'amber', 'green', 'grey']); }

console.log('PASS round71 host health: coverage (multi-guest once, unlinkable, blocks/echo/cancelled/test excluded, 30-day window, weekly bars, link-reach hint, 85/50 thresholds), filing on time (property-tz deadline, not-yet-due excluded, excluded rows), overdue vs due today, late PEC, non-Rome timezone, autofile last-3 (evidence rows ignored), credentials rules, setup gaps (ROSS1000 by region, skips, legacy welcome), upcoming 48 h, activity, health colours/reasons, action-needed order, surname initial only');
