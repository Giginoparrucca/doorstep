// 25 Nov 2026 — two host reports from a multi-room property (fictional data here):
//   1. a new booking with no check-in showed the name of a guest already
//      staying in another room (different booking code) and the expected
//      guest count only in the private box;
//   2. a guest marked «Non inviare (no-show)» still ended up in the manual
//      Alloggiati .txt and in «Invia»;
//   3. (26 Nov) guests already marked as sent were in the .txt and «Valida».
// Also: editing a direct booking must keep its room.
// Runs the REAL functions sliced out of host-console.html in a VM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
function slice(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'cannot find ' + name);
  let end = html.indexOf('\n}', start);
  while (end >= 0) {
    const s = html.slice(start - (html.slice(start - 6, start) === 'async ' ? 6 : 0), end + 2);
    try { new vm.Script(s); return s; } catch { /* keep looking */ }
    end = html.indexOf('\n}', end + 2);
  }
  throw new Error('cannot extract ' + name);
}
let failures = 0, passes = 0;
async function test(name, fn) {
  try { await fn(); passes++; console.log('  ✓ ' + name); }
  catch (e) { failures++; console.log('  ✗ ' + name + '\n    ' + (e && e.message)); }
}

// ── 1. booking card: name and count ───────────────────────────────
const dict = { dash_guests_one: 'ospite', dash_guests_n: 'ospiti', dash_nights_one: 'notte', dash_nights_n: 'notti', dash_checked_in: 'Check-in fatto', dash_awaiting: 'In attesa' };
function cardCtx(extra = {}) {
  const ctx = vm.createContext({
    hostLang: 'it', h: k => dict[k] || k, APP_ORIGIN: 'https://app.example.test', propertyId: 'prop-1',
    propertyData: {}, allCheckins: [], _knownReservationCodes: new Set(), _calAllReservationCodes: new Set(),
    _cleanOtaGuestName: n => n || null, encodeURIComponent, console, Date, ...extra,
  });
  vm.runInContext(slice('_renderReservationCard'), ctx);
  return ctx;
}
const staying = { id: 'c-stay', property_id: 'prop-1', booking_code: 'WB-STAY01', room_id: null, guest_type: 'single',
  surname: 'Rossi', name: 'Mario', arrival_date: '2026-12-01', departure_date: '2026-12-10' };
const newBooking = { id: 'r-new', platform: 'direct', booking_code: 'WB-NEW001', room_id: 'room-2', guest_name: 'Bianchi Anna',
  guest_count: 3, checkin_date: '2026-12-04', checkout_date: '2026-12-06' };

await test('new booking never shows the guest of another booking (known code, check-in without room)', () => {
  const ctx = cardCtx({ allCheckins: [staying], _knownReservationCodes: new Set(['WB-STAY01', 'WB-NEW001']) });
  const { html: out } = ctx._renderReservationCard(newBooking, '2026-12-03');
  assert.ok(!out.includes('Rossi'), 'other guest leaked into the card');
  assert.ok(out.includes('Bianchi Anna'), 'own guest name shown');
  assert.ok(out.includes('In attesa'), 'still awaiting check-in');
});
await test('also when the other booking is only known from the calendar month', () => {
  const ctx = cardCtx({ allCheckins: [staying], _calAllReservationCodes: new Set(['WB-STAY01']) });
  assert.ok(!ctx._renderReservationCard(newBooking, '2026-12-03').html.includes('Rossi'));
});
await test('expected guest count is shown on the card before check-in', () => {
  const ctx = cardCtx({ allCheckins: [staying], _knownReservationCodes: new Set(['WB-STAY01']) });
  assert.match(ctx._renderReservationCard(newBooking, '2026-12-03').html, /3 ospiti/);
});
await test('own check-ins (same code) still match and win', () => {
  const own = { ...staying, id: 'c-own', booking_code: 'WB-NEW001', surname: 'Bianchi', name: 'Anna', arrival_date: '2026-12-04', departure_date: '2026-12-06' };
  const ctx = cardCtx({ allCheckins: [staying, own], _knownReservationCodes: new Set(['WB-STAY01', 'WB-NEW001']) });
  const out = ctx._renderReservationCard(newBooking, '2026-12-03').html;
  assert.ok(out.includes('Check-in fatto') && !out.includes('Rossi'));
});
await test('walk-in check-in (code of no reservation) can still pair by dates in the same room', () => {
  const walkIn = { ...staying, id: 'c-walk', booking_code: 'WB-WALK99', room_id: 'room-2', surname: 'Verdi', arrival_date: '2026-12-04', departure_date: '2026-12-06' };
  const ctx = cardCtx({ allCheckins: [walkIn], _knownReservationCodes: new Set(['WB-STAY01', 'WB-NEW001']) });
  assert.ok(ctx._renderReservationCard(newBooking, '2026-12-03').html.includes('Verdi'));
});
await test('dashboard loads the known codes before rendering the cards', () => {
  const fn = slice('renderUpcomingReservationsPanel');
  assert.ok(fn.indexOf('_loadKnownReservationCodes(') > 0 && fn.indexOf('_loadKnownReservationCodes(') < fn.indexOf('_renderReservationCard('));
});

// ── 2. edit keeps the room ────────────────────────────────────────
await test('editing a direct booking pre-fills its room', async () => {
  let opened = null;
  const row = { id: 'r1', entry_type: 'reservation', channel: 'website', guest_name: 'Bianchi Anna', guest_count: 2, contact_phone: null,
    contact_email: null, notes: null, checkin_date: '2026-12-04', checkout_date: '2026-12-06', room_id: 'room-2' };
  let selected = '';
  const q = { select(c) { selected = c; return q; }, or() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: row, error: null }) };
  const ctx = vm.createContext({ hostLang: 'it', APP_CONFIG: { mode: 'prod' }, sb: { from: () => q }, toast() {}, console,
    _closeReservationDetail() {}, openReservationForm: o => { opened = o; } });
  vm.runInContext(slice('editDirectReservation'), ctx);
  await ctx.editDirectReservation('r1');
  assert.match(selected, /room_id/);
  assert.equal(opened.prefill.room_id, 'room-2');
});

// ── 3. no-show never goes into the manual file or «Invia» ─────────
function exportCtx(rows) {
  const toasts = [];
  const ctx = vm.createContext({
    hostLang: 'it', allCheckins: rows, toast: m => toasts.push(m), alert: m => toasts.push('ALERT ' + m), confirm: () => true, h: k => k,
    AllogRecords: { isPastPortalWindow: () => false }, _isValidPastDOB: () => true, _skipErasedForExport: l => l,
    buildBatch: list => ({ lines: list.map(c => c.surname), warnings: [], rowMeta: [], groupCount: list.length }), Date, console,
  });
  vm.runInContext(slice('_prepareAlloggiatiExport'), ctx);
  return { ctx, toasts };
}
const today = new Date().toISOString().slice(0, 10);
const g = (id, surname, extra = {}) => ({ id, surname, is_test: false, deleted_at: null, arrival_date: today, submitted_at: today + 'T09:00:00Z', alloggiati_status: null, ...extra });
await test('manual .txt leaves out the no-show and says so', () => {
  const { ctx, toasts } = exportCtx([g('a', 'Presente'), g('b', 'Noshow', { autofile_excluded: true })]);
  const prep = ctx._prepareAlloggiatiExport();
  assert.deepEqual([...prep.lines], ['Presente']);
  assert.ok(toasts.some(t => /1 ospiti segnati «Non inviare \(no-show\)» esclusi/.test(t)), toasts.join(' | '));
});
await test('«Invia» (excludeFiled) leaves out the no-show too', () => {
  const { ctx } = exportCtx([g('a', 'Presente'), g('b', 'Noshow', { autofile_excluded: true })]);
  assert.deepEqual([...ctx._prepareAlloggiatiExport({ excludeFiled: true }).lines], ['Presente']);
});
await test('only no-shows → no file', () => {
  const { ctx } = exportCtx([g('b', 'Noshow', { autofile_excluded: true })]);
  assert.equal(ctx._prepareAlloggiatiExport(), null);
});
// 26 Nov 2026 — guests marked as sent (filed by hand on the portal, then
// «Segna inviato») were still in the manual .txt and in «Valida».
await test('manual .txt and «Valida» leave out guests already marked as sent', () => {
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rows = [g('a', 'Oggi1'), g('b', 'Oggi2'), g('c', 'IeriInviato', { arrival_date: y, alloggiati_status: 'filed' }), g('d', 'IeriInviato2', { arrival_date: y, alloggiati_status: 'filed' })];
  const { ctx, toasts } = exportCtx(rows);
  assert.deepEqual([...ctx._prepareAlloggiatiExport().lines], ['Oggi1', 'Oggi2']);
  assert.ok(toasts.some(t => /2 ospiti già segnati come inviati esclusi/.test(t)), toasts.join(' | '));
  const send = exportCtx(rows);
  assert.deepEqual([...send.ctx._prepareAlloggiatiExport({ excludeFiled: true }).lines], ['Oggi1', 'Oggi2']);
  assert.ok(!send.toasts.some(t => /già segnati/.test(t)), '«Invia» keeps its own note, no double notice');
});
await test('everyone already sent → no file, clear notice', () => {
  const { ctx, toasts } = exportCtx([g('c', 'Inviato', { alloggiati_status: 'filed' })]);
  assert.equal(ctx._prepareAlloggiatiExport(), null);
  assert.ok(toasts.some(t => /Tutti gli ospiti risultano già inviati/.test(t)));
});
await test('«Valida» and the .txt use the default (filed excluded)', () => {
  assert.match(slice('validateAlloggiati'), /_prepareAlloggiatiExport\(\)/);
  assert.match(slice('exportAlloggiati'), /_prepareAlloggiatiExport\(\)/);
  assert.match(slice('_prepareAlloggiatiExport'), /const excludeFiled = opts\.excludeFiled !== false;/);
});
await test('late filing group leaves out the no-show companion', () => {
  const ctx = vm.createContext({ allCheckins: [g('a', 'Uno', { booking_code: 'WB-G1' }), g('b', 'Due', { booking_code: 'WB-G1', autofile_excluded: true })] });
  vm.runInContext(slice('_lateGroupRows'), ctx);
  assert.deepEqual(ctx._lateGroupRows('b:WB-G1').map(c => c.id), ['a']);
});
await test('no-show chip shows in every autofile mode, before the late button', () => {
  for (const mode of ['off', 'dry_run', 'live', undefined]) {
    const ctx = vm.createContext({ propertyData: { alloggiati_autofile_mode: mode }, _isLateRow: () => true, _lateFilingButton: () => 'LATE', autofileDueAt: () => null, Date });
    vm.runInContext(slice('_renderAutofileRowChip'), ctx);
    const out = ctx._renderAutofileRowChip(g('b', 'Noshow', { autofile_excluded: true }), true);
    assert.match(out, /data-no-show/, String(mode));
    assert.ok(!out.includes('LATE'));
  }
});
await test('menu wording: no-show, not «autofile only»', () => {
  assert.ok(html.includes("btn_autofile_exclude: 'Non inviare (no-show)'"));
  assert.ok(html.includes("btn_autofile_include: 'Annulla no-show'"));
  assert.ok(!html.includes('L’invio manuale continua a funzionare'));
});

// ── 4. no-shows: no ISTAT arrival or night, no tourist tax (26 Nov 2026) ──
await test('statistics and tax exports drop no-shows and say how many', () => {
  const toasts = [];
  const ctx = vm.createContext({ hostLang: 'it', toast: m => toasts.push(m) });
  vm.runInContext(slice('_withoutNoShows'), ctx);
  const kept = ctx._withoutNoShows([g('a', 'Presente'), g('b', 'Noshow', { autofile_excluded: true })]);
  assert.deepEqual(kept.map(c => c.id), ['a']);
  assert.ok(toasts.some(t => /1 ospiti segnati come no-show esclusi/.test(t)));
  for (const fn of ['exportISTAT', 'exportCityTax', 'exportPayTourist']) assert.match(slice(fn), /_withoutNoShows\(allCheckins\.filter/, fn);
});
await test('tax group size counts only the guests who stayed', () => {
  const ctx = vm.createContext({ allCheckins: [
    g('a', 'A', { property_id: 'p', booking_code: 'WB-G2' }), g('b', 'B', { property_id: 'p', booking_code: 'WB-G2' }),
    g('c', 'C', { property_id: 'p', booking_code: 'WB-G2', autofile_excluded: true }) ] });
  vm.runInContext(slice('_groupSizeFor'), ctx);
  assert.equal(ctx._groupSizeFor({ property_id: 'p', booking_code: 'WB-G2' }), 2);
});
await test('regional statistics (SPOT, ROSS1000, …) leave out no-shows', async () => {
  const R = (await import('../lib/regional-exports.js')).default;
  const row = (id, extra = {}) => ({ id, property_id: 'p', is_test: false, deleted_at: null, submitted_at: '2026-11-20T10:00:00Z', ...extra });
  assert.deepEqual(R.scope([row('a'), row('b', { autofile_excluded: true }), row('c', { autofile_excluded: false })], 'p').map(r => r.id), ['a', 'c']);
  assert.match(fs.readFileSync(new URL('../host-regional-exports.js', import.meta.url), 'utf8'), /statistics_erased_at,autofile_excluded'/, 'the regional loader reads the flag');
});

console.log(`\nhost-booking-card-noshow: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
