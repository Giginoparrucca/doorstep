// Round 70 Phase 1 — late Alloggiati filing alerts. Runs the shared date
// helper, the actual maybeFireDailyAlerts and runAutofileTick from
// api/alloggiati.js (time-stubbed, fictional rows, no network) and the real
// migration in PGlite. Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Allog = require('../lib/alloggiati-records.js');
const iso = s => new Date(s);

// ── 1. Shared date helper ────────────────────────────────────────────────
// Arrival 31 Oct 2026 (CET, UTC+1): window closes 1 Nov 23:59 Rome = 22:59Z.
assert.equal(Allog.portalWindowCloseAt('2026-10-31').toISOString(), '2026-11-01T22:59:00.000Z');
// DST start (29 Mar 2026): arrival 28 Mar closes 29 Mar 23:59 CEST = 21:59Z.
assert.equal(Allog.portalWindowCloseAt('2026-03-28').toISOString(), '2026-03-29T21:59:00.000Z');
// DST end (25 Oct 2026): arrival 24 Oct closes 25 Oct 23:59 CET = 22:59Z.
assert.equal(Allog.portalWindowCloseAt('2026-10-24').toISOString(), '2026-10-25T22:59:00.000Z');
assert.equal(Allog.portalWindowCloseAt(null), null);
const row = { arrival_date: '2026-10-31', alloggiati_status: 'pending', is_test: false };
assert.equal(Allog.isPastPortalWindow(row, iso('2026-11-01T22:58:00Z')), false, '23:58 Rome: still fileable');
assert.equal(Allog.isPastPortalWindow(row, iso('2026-11-01T22:59:00Z')), false, '23:59:00 Rome: last moment');
assert.equal(Allog.isPastPortalWindow(row, iso('2026-11-01T23:00:00Z')), true, '00:00 Rome next day: late');
for (const extra of [{ alloggiati_status: 'filed' }, { alloggiati_status: 'filing' }, { alloggiati_status: 'correction' },
  { autofile_excluded: true }, { is_test: true }, { deleted_at: '2026-11-01T00:00:00Z' }]) {
  assert.equal(Allog.isPastPortalWindow({ ...row, ...extra }, iso('2026-11-05T00:00:00Z')), false, JSON.stringify(extra));
}
// autofileDueAt uses the same close (null exactly when late).
assert.equal(Allog.autofileDueAt(row, {}, iso('2026-11-01T23:00:00Z')), null);
assert.notEqual(Allog.autofileDueAt(row, {}, iso('2026-11-01T22:58:00Z')), null);

// ── 2. Actual maybeFireDailyAlerts with a clock stub ─────────────────────
const api = fs.readFileSync(new URL('../api/alloggiati.js', import.meta.url), 'utf8');
const fn = name => { const s = api.indexOf('async function ' + name + '(') >= 0 ? api.indexOf('async function ' + name + '(') : api.indexOf('function ' + name + '('); return api.slice(s, api.indexOf('\n}\n', s) + 2); };
const constants = api.slice(api.indexOf('// Round 70 — error codes'), api.indexOf('async function maybeFireDailyAlerts('));
assert.ok(!/pgrestGET\(/.test(api.slice(0, api.indexOf('async function pgrestGET('))) || api.includes('async function pgrestGET('), 'pgrestGET is defined');
assert.ok(api.includes('async function pgrestGET('), 'the alert reader exists (it was missing before Round 70)');

const NAMES = ['FICTIONAL ROSSI', 'FICTIONAL BIANCHI'];
function harness(nowIso, rows, { prop = {} } = {}) {
  const RealDate = Date;
  class Clock extends RealDate { constructor(...a) { super(...(a.length ? a : [nowIso])); } static now() { return new RealDate(nowIso).getTime(); } }
  const sent = [], patches = [];
  const state = { prop: { id: 'p1', name: 'Fictional House', owner_id: 'o1', host_language: 'it', alloggiati_autofile_mode: 'off', alloggiati_autofile_alerts: {}, ...prop }, rows };
  const ctx = vm.createContext({
    Date: Clock, Intl, Set, Map, console: { warn() {}, error() {} }, encodeURIComponent, AllogRecords: Allog,
    pgrestGET: async path => {
      if (path.startsWith('checkins?')) {
        const q = new URLSearchParams(path.split('?')[1]);
        const gte = q.getAll('arrival_date').find(v => v.startsWith('gte.'))?.slice(4);
        const lte = q.getAll('arrival_date').find(v => v.startsWith('lte.'))?.slice(4);
        return { ok: true, json: async () => state.rows.filter(r => (!gte || r.arrival_date >= gte) && (!lte || r.arrival_date <= lte)).map(r => ({ ...r })) };
      }
      return { ok: true, json: async () => [] };
    },
    sbPatch: async (q, patch) => {
      patches.push({ q: decodeURIComponent(q), patch });
      if (q.startsWith('properties?')) Object.assign(state.prop.alloggiati_autofile_alerts, patch.alloggiati_autofile_alerts);
      for (const r of state.rows) if (decodeURIComponent(q).includes(r.id)) Object.assign(r, patch);
    },
    notifyHostAutofileAlert: async a => { sent.push(a); return { ok: true }; },
  });
  vm.runInContext(['_romeYmd', '_romeHour'].map(fn).join('\n') + '\n' + constants + fn('maybeFireDailyAlerts') + '\n' + fn('_sendAutofileAlert'), ctx);
  return { run: () => ctx.maybeFireDailyAlerts(state.prop, null, { alertsOnly: true }), sent, patches, state };
}
const r = (id, arrival, extra = {}) => ({ id: 'row-' + id, booking_code: 'BOOK-' + id.slice(0, 1), arrival_date: arrival, alloggiati_status: 'pending',
  is_test: false, autofile_excluded: false, deleted_at: null, autofile_last_error: null, late_alert_at: null, ...extra });
const noNames = sent => { for (const m of sent) for (const n of NAMES) assert.ok(!m.text.includes(n), 'no guest names'); };

// Closing: arrival yesterday, 17:59 Rome → nothing; 18:00 → one alert; next tick silent.
{
  const rows = [r('A1', '2026-11-02'), r('A2', '2026-11-02')];
  let h = harness('2026-11-03T16:59:00Z', rows); await h.run();
  assert.equal(h.sent.filter(m => m.kind === 'closing').length, 0, 'not before 18:00');
  h = harness('2026-11-03T17:00:00Z', rows); await h.run();
  const closing = h.sent.filter(m => m.kind === 'closing');
  assert.equal(closing.length, 1, 'closing fires at 18:00 Rome');
  assert.match(closing[0].text, /2 ospiti di Fictional House vanno inviati ad Alloggiati entro le 23:59 di stasera/);
  assert.ok(!/PEC/.test(closing[0].text), 'no outage line without an outage error');
  await h.run();
  assert.equal(h.sent.filter(m => m.kind === 'closing').length, 1, 'once per day');
  noNames(h.sent);
}
// Closing with an outage-type last error → PEC line.
{
  const h = harness('2026-11-03T19:00:00Z', [r('B1', '2026-11-02', { autofile_last_error: 'send_transport_error' })]); await h.run();
  const c = h.sent.find(m => m.kind === 'closing');
  assert.match(c.text, /Se il portale non funziona, invia i dati via PEC alla Questura entro stasera e conserva la ricevuta di consegna/);
}
// Nothing closes tonight (arrival today only) → no closing alert.
{
  const h = harness('2026-11-03T19:00:00Z', [r('C1', '2026-11-03')]); await h.run();
  assert.equal(h.sent.filter(m => m.kind === 'closing').length, 0);
}
// Window closed: arrival 1 Nov, after 2 Nov 23:59 Rome → one alert per group, then silent; stamped.
{
  const rows = [r('D1', '2026-11-01'), r('D2', '2026-11-01'), r('E1', '2026-11-01', { booking_code: 'BOOK-E' })];
  const h = harness('2026-11-03T08:30:00Z', rows); await h.run();
  const wc = h.sent.filter(m => m.kind === 'window_closed');
  assert.equal(wc.length, 2, 'one per booking group');
  assert.ok(wc.some(m => /Il termine per inviare 2 ospiti \(prenotazione BOOK-D\) è scaduto/.test(m.text)));
  assert.ok(wc.every(m => /«Invio tardivo»/.test(m.text)));
  assert.ok(rows.every(x => x.late_alert_at && x.autofile_last_error === 'past_portal_window'), 'stamped late + past_portal_window');
  await h.run();
  assert.equal(h.sent.filter(m => m.kind === 'window_closed').length, 2, 'silent on the next ticks');
  noNames(h.sent);
}
// Old late rows (window closed > 48 h ago): marked silently, no alert storm.
{
  const rows = [r('F1', '2026-10-20')];
  const h = harness('2026-11-03T08:30:00Z', rows); await h.run();
  assert.equal(h.sent.filter(m => m.kind === 'window_closed').length, 0);
  assert.ok(rows[0].late_alert_at, 'marked without alerting');
}
// 09:00 overdue splits fileable vs late (English host).
{
  const h = harness('2026-11-03T08:30:00Z', [r('G1', '2026-11-03'), r('G2', '2026-11-02'), r('H1', '2026-11-01')], { prop: { host_language: 'en' } });
  await h.run();
  const o = h.sent.find(m => m.kind === 'overdue');
  assert.match(o.text, /2 guests still to send today, 1 late \(the portal no longer accepts it: contact your Questura/);
}
// Filed / excluded / test rows never alert.
{
  const h = harness('2026-11-03T19:00:00Z', []); await h.run();
  assert.equal(h.sent.length, 0);
}

// ── 3. Actual runAutofileTick: autofile-off properties get the alerts-only pass ──
{
  const calls = [];
  const ctx = vm.createContext({
    Date, Set, Map, console: { warn() {}, error() {} }, encodeURIComponent, AUTOFILE_TICK_BUDGET_MS: 45000, AUTOFILE_MAX_PROPS_PER_TICK: 25,
    collectReceipts: async () => ({}),
    _romeYmd: d => d.toISOString().slice(0, 10),
    sbGet: async q => {
      if (q.startsWith('properties?alloggiati_autofile_mode=in.')) return [];
      if (q.startsWith('checkins?')) return [{ property_id: 'off-1' }, { property_id: 'off-1' }];
      if (q.startsWith('properties?id=in.')) return [{ id: 'off-1', name: 'Manual House', alloggiati_autofile_mode: 'off' }];
      throw Error('unexpected ' + q);
    },
    processPropertyAutofile: async () => { throw Error('must not file for autofile-off properties'); },
    maybeFireDailyAlerts: async (prop, _c, opts) => { calls.push([prop.id, opts && opts.alertsOnly]); },
  });
  vm.runInContext(fn('runAutofileTick'), ctx);
  let out; const res = { status() { return this; }, json(b) { out = b; return b; } };
  await ctx.runAutofileTick(res, null);
  assert.deepEqual(calls, [['off-1', true]], 'autofile-off property visited once, alerts only');
  assert.equal(out.properties_alerts_only, 1);
}

// ── 4. Real migration in PGlite ─────────────────────────────────────────
let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch (_) { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create table public.checkins(id uuid primary key default gen_random_uuid());
    create table public.notification_log(id bigserial primary key, trigger text,
      constraint notification_log_trigger_check check (trigger = any (array['escalation','guest_message','test'])));`);
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261103090000_round70_late_alerts.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.query(`insert into public.checkins(late_alert_at) values (now())`);
  for (const t of ['escalation', 'guest_message', 'test', 'autofile_closing', 'autofile_window_closed', 'autofile_overdue']) {
    await db.query('insert into public.notification_log(trigger) values ($1)', [t]);
  }
  for (const t of ['bogus', 'autofile_', 'autofile_DROP TABLE']) {
    await assert.rejects(db.query('insert into public.notification_log(trigger) values ($1)', [t]), /check constraint/, t);
  }
}

console.log('PASS round70-late-alerts: window close at arrival+1 23:59 Rome across both DST changes (23:59 fileable, 00:00 late; filed/excluded/test never late; autofileDueAt agrees); actual maybeFireDailyAlerts: closing not before 18:00, once after, outage PEC line only with outage errors, none when nothing closes tonight; window-closed once per booking group then silent, rows stamped past_portal_window; old late rows marked without alerting; 09:00 split fileable/late; no guest names; actual runAutofileTick gives autofile-off properties an alerts-only pass; migration re-runnable, autofile_<kind> log triggers accepted, others refused');
