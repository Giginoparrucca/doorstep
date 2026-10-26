// Round 64: read-only, property-scoped admin metrics. No filing side effects.
(function (root) {
  'use strict';
  const PAGE_SIZE = 500;
  async function readPages(makeQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await makeQuery().order('id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('Missing metric data');
      rows.push(...data);
      if (data.length < PAGE_SIZE) return rows;
    }
  }
  async function load(sb, { since, until, showHidden = false, showTestData = false }) {
    const visible = q => {
      if (showHidden) return q;
      if (!showTestData) q = q.eq('is_test', false);
      return q.is('deleted_at', null);
    };
    const queries = {
      checkins: () => visible(sb.from('checkins').select('id,property_id,booking_code,arrival_date,submitted_at,alloggiati_status,filed_at,autofile_last_error,autofile_last_attempt_at,is_test,deleted_at')),
      reservations: () => visible(sb.from('ota_reservations').select('id,property_id,booking_code,checkin_date,status,entry_type,covered_by_reservation_id,is_test,deleted_at')),
      events: () => visible(sb.from('analytics_events').select('id,property_id,booking_code,event_type,created_at,is_test,deleted_at').gte('created_at', since).lte('created_at', until).like('event_type', 'guest_%')),
    };
    const results = await Promise.all(Object.entries(queries).map(async ([name, query]) => {
      try { return [name, await readPages(query)]; }
      catch (_) { return [name, null]; } // unavailable is distinct from empty
    }));
    return { ...Object.fromEntries(results), since, until, showHidden, showTestData };
  }
  function aggregate(input) {
    const { checkins, reservations, events, since, until, showHidden = false, showTestData = false } = input;
    const result = new Map();
    const get = pid => {
      if (!result.has(pid)) result.set(pid, { completed: 0, sent: 0, failed: 0, used: 0, bookings: 0 });
      return result.get(pid);
    };
    const visible = r => showHidden || (!r.deleted_at && (showTestData || !r.is_test));
    const start = Date.parse(since), end = Date.parse(until);
    const inPeriod = t => Number.isFinite(Date.parse(t)) && Date.parse(t) >= start && Date.parse(t) <= end;
    // Arrival dates are calendar dates: use the same explicit UTC date boundaries on every client.
    const arrived = date => typeof date === 'string' && date >= since.slice(0, 10) && date <= until.slice(0, 10);
    const key = r => JSON.stringify([r.property_id, r.booking_code]);
    const cohort = new Map(), excluded = new Set();
    const seenReservations = new Set();
    for (const r of reservations || []) {
      if (!r.property_id || !visible(r)) continue;
      if (!r.booking_code) {
        if (r.id && r.status === 'active' && r.entry_type !== 'block' && !r.covered_by_reservation_id && arrived(r.checkin_date))
          cohort.set(JSON.stringify([r.property_id, null, r.id]), r.property_id);
        continue;
      }
      const k = key(r);
      // Remember ineligible codes so a stale check-in cannot revive a cancelled booking or echo.
      if (r.status !== 'active' || r.entry_type === 'block' || r.covered_by_reservation_id) { excluded.add(k); continue; }
      seenReservations.add(k);
      if (arrived(r.checkin_date)) cohort.set(k, r.property_id);
    }
    const seenCheckins = new Set();
    for (const c of checkins || []) {
      if (!c.property_id || !visible(c) || !c.id || seenCheckins.has(c.id)) continue;
      seenCheckins.add(c.id);
      const m = get(c.property_id);
      if (inPeriod(c.submitted_at)) m.completed++;
      if (c.alloggiati_status === 'filed' && inPeriod(c.filed_at)) m.sent++;
      const err = String(c.autofile_last_error || '').split(':')[0];
      if (!['filed', 'filing'].includes(c.alloggiati_status) && inPeriod(c.autofile_last_attempt_at) &&
          ['generate_token_failed', 'test_failed', 'test_rejected', 'test_transport_error', 'send_failed', 'send_rejected', 'send_transport_error', 'send_result_uncertain', 'send_result_requires_review', 'prior_send_requires_review'].includes(err)) m.failed++;
      const k = key(c);
      if (c.booking_code && !seenReservations.has(k) && !excluded.has(k) && arrived(c.arrival_date)) cohort.set(k, c.property_id);
    }
    const active = new Set();
    for (const e of events || []) {
      if (!visible(e) || !e.booking_code || !String(e.event_type || '').startsWith('guest_') || !inPeriod(e.created_at)) continue;
      const k = key(e);
      if (cohort.has(k)) active.add(k);
    }
    for (const [k, pid] of cohort) {
      const m = get(pid); m.bookings++; if (active.has(k)) m.used++;
    }
    return result;
  }
  root.AdminOpsMetrics = { load, aggregate, readPages };
})(globalThis);
