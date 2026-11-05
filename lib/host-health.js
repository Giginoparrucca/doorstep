// lib/host-health.js — Round 71: admin host health metrics.
//
// Pure: no network, no Date.now() unless the caller omits `now`. Dual-load
// (IIFE + module.exports) like the other lib/ files so the admin endpoint
// (Node) and tests share one definition. Definitions and targets are in
// PLAN_round71_admin_host_health.md; Phase 1 findings fixed the data rules:
//   - real stays: entry_type 'reservation', status 'active', not an echo;
//   - link path: same property + booking code (several check-ins = one);
//   - link_sent_at is never written, so "link reached guest" = a guest_*
//     analytics event for that booking (the caller passes the codes);
//   - filing attempts exclude evidence_* audit rows and probes.
// Guests leave this module as surname initial + arrival date only.
(function (root) {
  'use strict';

  var DAY = 86400000;
  var SUCCESS = { filed: true, test_all_ok: true };
  var FAILURE = { test_rejected: true, cred_error: true, send_rejected: true, send_failed: true, test_failed: true, generate_token_failed: true, test_transport_error: true, send_transport_error: true };
  var HINTS = {
    coverage: 'Host may still be collecting documents outside WelcomeBnB. Check they send the guest link at booking (share templates).',
    link: 'Guest link not reaching guests: check the host sends it at booking (share templates).',
    overdue: 'Overdue filing: the host must file today or send a PEC to the Questura.',
    failures: '3 failed filings in a row usually means expired or changed Alloggiati credentials. Contact the host before a fine.',
    upcoming: 'Nudge guest / tell host.',
    filing: 'Some guests were not filed by the day after arrival. Check the host files every booking.',
    stale: 'Unfiled records older than 30 days: probably filed outside WelcomeBnB or test data. Ask the host to mark them as filed or excluded.',
  };

  // Calendar date (YYYY-MM-DD) of an instant in a timezone.
  function ymd(instant, tz) {
    var d = instant instanceof Date ? instant : new Date(instant);
    if (!isFinite(d.getTime())) return null;
    var p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
    return p.year + '-' + p.month + '-' + p.day;
  }
  function addDays(dateStr, n) {
    var t = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) + n * DAY;
    return new Date(t).toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { // b - a in whole days (date strings)
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / DAY);
  }
  function str(v) { return typeof v === 'string' ? v.trim() : ''; }
  function initial(surname) { var s = str(surname); return s ? s.charAt(0).toUpperCase() + '.' : '?'; }
  function live(r) { return r && r.is_test !== true && !r.deleted_at; }
  function realStay(r) { return live(r) && r.entry_type === 'reservation' && r.status === 'active' && !r.covered_by_reservation_id; }
  function pct(n, d) { return d ? Math.round(n / d * 100) : null; }

  // input: { property, reservations, checkins, filingLog, credentials,
  //          onboarding, recommendationCount, guestEventCodes (array/Set of
  //          booking codes with a guest_* event), lastActivityAt,
  //          regionCompliance, now }
  function computeHostHealth(input) {
    var p = input.property || {};
    var tz = str(p.timezone) || 'Europe/Rome';
    var now = input.now ? new Date(input.now) : new Date();
    var today = ymd(now, tz);
    var from30 = addDays(today, -30);
    var codesOpened = new Set(input.guestEventCodes || []);
    var reservations = (input.reservations || []).filter(function (r) { return r.property_id === p.id && realStay(r); });
    var checkins = (input.checkins || []).filter(function (c) { return c.property_id === p.id && live(c); });
    var checkinCodes = new Set(checkins.map(function (c) { return str(c.booking_code); }).filter(Boolean));

    // ── 3.1 coverage ──
    var window = reservations.filter(function (r) { return r.checkin_date >= from30 && r.checkin_date <= today; });
    var unlinkable = window.filter(function (r) { return !str(r.booking_code); });
    var linkable = window.filter(function (r) { return str(r.booking_code); });
    var covered = linkable.filter(function (r) { return checkinCodes.has(str(r.booking_code)); });
    var reached = linkable.filter(function (r) { return codesOpened.has(str(r.booking_code)); });
    var weeks = [0, 1, 2, 3].map(function (w) {
      var rows = linkable.filter(function (r) { return Math.min(3, Math.floor(daysBetween(r.checkin_date, today) / 7)) === w; });
      var cov = rows.filter(function (r) { return checkinCodes.has(str(r.booking_code)); }).length;
      return { weeks_ago: w, total: rows.length, covered: cov, pct: pct(cov, rows.length) };
    }).reverse();
    var covPct = pct(covered.length, linkable.length);
    var covStatus = linkable.length === 0 ? 'grey' : covPct >= 85 ? 'green' : covPct >= 50 ? 'amber' : 'red';
    var linkPct = pct(reached.length, linkable.length);
    var covHint = null;
    if (covStatus === 'red' || covStatus === 'amber') covHint = (linkPct !== null && linkPct < 50) ? HINTS.link : HINTS.coverage;
    var coverage = { status: covStatus, pct: covPct, covered: covered.length, total: linkable.length, unlinkable: unlinkable.length,
      link_reached_pct: linkPct, link_reached: reached.length, weeks: weeks, target: '≥ 85%', hint: covHint };

    // ── 3.2 filing ──
    var eligible = checkins.filter(function (c) { return !c.autofile_excluded && c.arrival_date >= from30 && c.arrival_date <= today; });
    var onTime = 0, due = 0;
    eligible.forEach(function (c) {
      var deadline = addDays(c.arrival_date, 1);
      var filedDay = c.filed_at ? ymd(c.filed_at, tz) : null;
      var passed = today > deadline;
      if (passed || filedDay) { due++; if (filedDay && filedDay <= deadline) onTime++; }
    });
    var onTimePct = pct(onTime, due);
    var onTimeStatus = due === 0 ? 'grey' : onTimePct === 100 ? 'green' : onTimePct >= 90 ? 'amber' : 'red';
    var unfiled = checkins.filter(function (c) { return !c.filed_at && !c.autofile_excluded && c.alloggiati_status !== 'filing' && c.arrival_date && c.arrival_date <= today; });
    // Overdue = arrival in the last 30 days, before today (Phase 1 decision d):
    // older unfiled rows are historic records (e.g. pre-autofile pilot data),
    // reported separately as amber, not as a call-today emergency.
    var stale = unfiled.filter(function (c) { return c.arrival_date < from30; });
    var overdueRows = unfiled.filter(function (c) { return c.arrival_date < today && c.arrival_date >= from30; })
      .sort(function (a, b) { return a.arrival_date < b.arrival_date ? -1 : a.arrival_date > b.arrival_date ? 1 : 0; })
      .map(function (c) { return { guest: initial(c.surname), arrival_date: c.arrival_date, booking_code: c.booking_code || null, last_error: c.autofile_last_error ? String(c.autofile_last_error).split(':')[0].slice(0, 60) : null }; });
    var dueToday = unfiled.filter(function (c) { return c.arrival_date === today; }).length;
    var late = checkins.filter(function (c) { return c.filing_method === 'late_questura_pec' && c.arrival_date >= from30 && c.arrival_date <= today; }).length;
    var filing = {
      on_time: { status: onTimeStatus, pct: onTimePct, on_time: onTime, total: due, target: '100%', hint: onTimeStatus === 'amber' || onTimeStatus === 'red' ? HINTS.filing : null },
      overdue: { status: overdueRows.length ? 'red' : 'green', count: overdueRows.length, rows: overdueRows.slice(0, 50), due_today: dueToday, target: '0', hint: overdueRows.length ? HINTS.overdue : null },
      late_pec_30d: late,
      old_unfiled: { count: stale.length, oldest: stale.length ? stale.map(function (c) { return c.arrival_date; }).sort()[0] : null, hint: stale.length ? HINTS.stale : null },
    };

    // ── autofile health ──
    var attempts = (input.filingLog || []).filter(function (l) { return l.property_id === p.id && !/^evidence_/.test(l.outcome || '') && l.outcome !== 'phase2-probe'; })
      .sort(function (a, b) { return a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0; });
    var last5 = attempts.slice(0, 5).map(function (l) { return { trigger: l.trigger, outcome: l.outcome, error_code: l.error_code || null, run_at: l.run_at, ok: !!SUCCESS[l.outcome] }; });
    var lastThreeFailed = attempts.length >= 3 && attempts.slice(0, 3).every(function (l) { return !SUCCESS[l.outcome] && (FAILURE[l.outcome] || /reject|fail|error/.test(l.outcome || '')); });
    var autofile = { status: lastThreeFailed ? 'red' : attempts.length ? 'green' : 'grey', last: last5, last_three_failed: lastThreeFailed, hint: lastThreeFailed ? HINTS.failures : null };

    // ── credentials ──
    var mode = str(p.alloggiati_autofile_mode) || 'off';
    var cr = input.credentials || null, credStatus, credWhy = null;
    if (!cr) { credStatus = mode === 'live' ? 'red' : 'grey'; credWhy = 'not connected'; }
    else if (cr.last_error) { credStatus = 'red'; credWhy = 'last check failed'; }
    else if (!cr.verified_at) { credStatus = 'red'; credWhy = 'saved, never verified'; }
    else if (cr.wskey_expires_at && Date.parse(cr.wskey_expires_at) - now.getTime() < 14 * DAY) { credStatus = Date.parse(cr.wskey_expires_at) < now.getTime() ? 'red' : 'amber'; credWhy = Date.parse(cr.wskey_expires_at) < now.getTime() ? 'key expired' : 'key expires within 14 days'; }
    else credStatus = 'green';
    var credentials = { status: credStatus, mode: mode, configured: !!cr, verified_at: cr ? cr.verified_at || null : null, wskey_expires_at: cr ? cr.wskey_expires_at || null : null, problem: credWhy };

    // ── 3.3 setup gaps ──
    var skips = (input.onboarding && input.onboarding.skips) || {};
    var gaps = [];
    if (!str(p.cir_code)) gaps.push({ key: 'cin', label: 'CIN missing', section: 'prop' });
    if (input.regionCompliance && input.regionCompliance.export === 'ross1000' && !str(p.ross1000_codice)) gaps.push({ key: 'ross1000', label: 'ROSS1000 code missing', section: 'prop' });
    var taxRules = Array.isArray(p.tax_rules) ? p.tax_rules : [];
    if ((p.tax_rate_eur === null || p.tax_rate_eur === undefined || String(p.tax_rate_eur).trim() === '') && taxRules.length === 0 && !skips.tax_not_applicable) gaps.push({ key: 'tax', label: 'Tourist tax not set', section: 'prop' });
    var feeds = Array.isArray(p.ical_feeds) ? p.ical_feeds : [];
    if (feeds.length === 0 && !skips.direct_only) gaps.push({ key: 'ical', label: 'No calendar (iCal) connected', section: 'prop' });
    var recos = Number(input.recommendationCount || 0);
    if (recos < 10) gaps.push({ key: 'recos', label: 'Only ' + recos + ' recommendations (target 10)', section: 'recos' });
    if (!str(p.welcome_message_it) && !str(p.welcome_message_en) && !str(p.welcome_message)) gaps.push({ key: 'welcome', label: 'No welcome message', section: 'prop' });
    // Only when not already a red credentials reason (spec: «if not already covered above»).
    if ((!cr || !cr.verified_at) && credStatus !== 'red') gaps.push({ key: 'alloggiati', label: cr ? 'Alloggiati connection not verified' : 'Alloggiati not connected', section: 'prop' });

    // ── 3.4 upcoming without check-in ──
    var to2 = addDays(today, 2);
    var upcoming = reservations.filter(function (r) { return r.checkin_date >= today && r.checkin_date <= to2 && !(str(r.booking_code) && checkinCodes.has(str(r.booking_code))); })
      .sort(function (a, b) { return a.checkin_date < b.checkin_date ? -1 : a.checkin_date > b.checkin_date ? 1 : 0; })
      .map(function (r) { return { checkin_date: r.checkin_date, platform: r.platform || null, booking_code: r.booking_code || null, link_reached: !!(str(r.booking_code) && codesOpened.has(str(r.booking_code))) }; });

    // ── activity ──
    var hasRecentOrUpcoming = reservations.some(function (r) { return r.checkin_date >= from30 && r.checkin_date <= addDays(today, 30); });
    var lastAt = input.lastActivityAt || null;
    var idle = lastAt ? Math.floor((now.getTime() - Date.parse(lastAt)) / DAY) : null;
    var actStatus = !hasRecentOrUpcoming ? 'grey' : idle === null || idle > 14 ? 'red' : idle > 7 ? 'amber' : 'green';
    var activity = { status: actStatus, last_at: lastAt, days_idle: idle, has_reservations: hasRecentOrUpcoming };

    // ── 3.5 health ──
    var red = [], amber = [];
    if (overdueRows.length) red.push(overdueRows.length + ' filing' + (overdueRows.length > 1 ? 's' : '') + ' overdue (arr. ' + overdueRows[0].arrival_date + ')');
    if (lastThreeFailed) red.push('last 3 automatic filings failed');
    if (credStatus === 'red' && !(credWhy === 'not connected' && mode !== 'live')) red.push('Alloggiati ' + credWhy);
    if (covStatus === 'red') red.push('check-in coverage ' + covPct + '% (' + covered.length + '/' + linkable.length + ')');
    if (covStatus === 'amber') amber.push('check-in coverage ' + covPct + '% (' + covered.length + '/' + linkable.length + ')');
    if (credStatus === 'amber') amber.push('Alloggiati ' + credWhy);
    if (actStatus === 'red' && hasRecentOrUpcoming && (idle === null || idle > 14)) amber.push(idle === null ? 'no host activity recorded' : 'host inactive for ' + idle + ' days');
    if (stale.length) amber.push(stale.length + ' old unfiled record' + (stale.length > 1 ? 's' : '') + ' (since ' + filing.old_unfiled.oldest + ')');
    if (upcoming.length) amber.push(upcoming.length + ' arrival' + (upcoming.length > 1 ? 's' : '') + ' in 48 h without check-in');
    if (gaps.length) amber.push(gaps.map(function (g) { return g.label; }).join(', '));
    var anyReservations = hasRecentOrUpcoming;
    var color = red.length ? 'red' : amber.length ? 'amber' : !anyReservations ? 'grey' : 'green';
    var reasons = red.length ? red.concat(amber) : amber;
    if (color === 'grey') reasons = ['no reservations in the last or next 30 days'].concat(gaps.length ? [gaps.map(function (g) { return g.label; }).join(', ')] : []);

    return {
      property_id: p.id, name: p.name || null, owner_id: p.owner_id || null, timezone: tz, today: today,
      health: { color: color, reasons: reasons },
      coverage: coverage, filing: filing, autofile: autofile, credentials: credentials,
      setup_gaps: gaps, upcoming: upcoming, activity: activity,
    };
  }

  var RANK = { red: 0, amber: 1, green: 2, grey: 3 };
  // Action-needed lines: red first, then amber; within a colour, oldest
  // overdue arrival / soonest upcoming arrival first.
  function actionNeeded(results) {
    var items = [];
    (results || []).forEach(function (r) {
      if (r.health.color !== 'red' && r.health.color !== 'amber') return;
      var date = (r.filing.overdue.rows[0] && r.filing.overdue.rows[0].arrival_date) || (r.upcoming[0] && r.upcoming[0].checkin_date) || '9999-12-31';
      items.push({ property_id: r.property_id, name: r.name, owner_id: r.owner_id, color: r.health.color, text: r.health.reasons[0], date: date });
    });
    return items.sort(function (a, b) { return RANK[a.color] - RANK[b.color] || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || String(a.name).localeCompare(String(b.name)); });
  }
  function sortByHealth(results) {
    return (results || []).slice().sort(function (a, b) { return RANK[a.health.color] - RANK[b.health.color] || String(a.name).localeCompare(String(b.name)); });
  }

  var api = { computeHostHealth: computeHostHealth, actionNeeded: actionNeeded, sortByHealth: sortByHealth, ymd: ymd, addDays: addDays, HINTS: HINTS, RANK: RANK };
  root.HostHealth = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
