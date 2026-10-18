// Shared browser/server calendar semantics. No network, clock, credentials or PII.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CalendarRoundtrip = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function validRange(r) {
    return validDate(r.checkin_date) && validDate(r.checkout_date) && r.checkin_date < r.checkout_date;
  }
  function active(r) { return r.status === 'active' && !r.deleted_at; }
  function sameRoom(a, b) { return (a.room_id || null) === (b.room_id || null); }
  function matchingCheckins(reservation, checkins, hasRooms = false) {
    const eligible = checkins.filter(c => !c.deleted_at && !c.is_test &&
      (!reservation.property_id || c.property_id === reservation.property_id) && c.arrival_date);
    const exact = reservation.booking_code ? eligible.filter(c => c.booking_code === reservation.booking_code) : [];
    if (exact.length) return exact;
    return eligible.filter(c => (!hasRooms || (reservation.room_id && sameRoom(reservation, c))) &&
      c.arrival_date < reservation.checkout_date && (!c.departure_date || c.departure_date > reservation.checkin_date));
  }
  function outboundUid(r) {
    const base = String(r.uid || r.id || '').replace(/[<>\s]/g, '_');
    // Event UIDs must remain byte-identical across releases.
    return base + '@welcomebnb.vercel.app';
  }
  function identifyOrigin(row, sources) {
    if (row.platform === 'direct' || row.is_test || row.deleted_at || !validRange(row)) return null;
    const identities = [row.uid, row.raw && row.raw.origin_uid, row.raw && row.raw.welcomebnb_feed_uid].filter(Boolean);
    const matches = sources.filter(source =>
      !source.is_test && ['reservation', 'block'].includes(source.entry_type) &&
      source.property_id === row.property_id && sameRoom(source, row) && validRange(source) &&
      !source.covered_by_reservation_id &&
      identities.includes(outboundUid(source))
    );
    return matches.length === 1 ? matches[0] : null;
  }
  function matchOrigin(row, sources) {
    const source = identifyOrigin(row, sources);
    return source && active(source) && source.checkin_date === row.checkin_date &&
      source.checkout_date === row.checkout_date ? source : null;
  }
  function automaticLinkValid(row, sources) {
    const match = matchOrigin(row, sources);
    return !!match && match.id === row.covered_by_reservation_id;
  }
  function visibleRows(rows) {
    return rows.filter(active).flatMap(row => {
      if (!row.covered_by_reservation_id) return [row];
      const source = rows.find(r => r.id === row.covered_by_reservation_id);
      if (source && !sameRoom(row, source)) return [{ ...row, covered_by_reservation_id: null }];
      // Host-confirmed links retain their existing behaviour. Only links owned
      // by this matcher can be invalidated automatically, and only in projection.
      if (!row.raw || !row.raw.welcomebnb_auto_echo || automaticLinkValid(row, rows)) return [];
      return [{ ...row, covered_by_reservation_id: null }];
    });
  }
  function subtractRange(start, end, covers) {
    let parts = [[start, end]];
    for (const cover of covers) {
      parts = parts.flatMap(([a, b]) => {
        if (cover.checkout_date <= a || cover.checkin_date >= b) return [[a, b]];
        const out = [];
        if (a < cover.checkin_date) out.push([a, cover.checkin_date]);
        if (cover.checkout_date < b) out.push([cover.checkout_date, b]);
        return out;
      });
    }
    return parts;
  }
  function projectRows(rows) {
    const visible = visibleRows(rows);
    const direct = visible.filter(r => r.platform === 'direct' && validRange(r));
    return visible.flatMap(row => {
      // Booking's opaque CLOSED events are reservation-shaped: never infer
      // identity or discard a guest reservation from dates alone.
      if (row.platform === 'direct' || row.entry_type !== 'block' || row.raw?.welcomebnb_echo_ignored || !validRange(row)) return [row];
      const covers = direct.filter(d => d.property_id === row.property_id && sameRoom(d, row) && !!d.is_test === !!row.is_test);
      const parts = subtractRange(row.checkin_date, row.checkout_date, covers);
      if (parts.length === 1 && parts[0][0] === row.checkin_date && parts[0][1] === row.checkout_date) return [row];
      return parts.map(([start, end]) => ({ ...row, checkin_date: start, checkout_date: end,
        calendar_original_start: row.checkin_date, calendar_original_end: row.checkout_date }));
    });
  }
  function exportRows(rows) {
    return projectRows(rows).filter(row => {
      if (row.is_test) return false;
      if (row.platform === 'direct') return true;
      // An imported opaque closure may be an echo, lead-time rule or buffer.
      // Relaying it would turn source-specific unavailability into an endless
      // cross-channel block, including after a local booking is cancelled.
      if (row.entry_type === 'block') return false;
      // Even a date-mismatched/stale identified return must not be forwarded.
      // Retain its availability on screen until the source OTA releases it.
      return !row.raw?.welcomebnb_origin_source && !row.raw?.welcomebnb_auto_echo && !identifyOrigin(row, rows);
    });
  }
  return { sameRoom, matchingCheckins, outboundUid, identifyOrigin, matchOrigin, automaticLinkValid, visibleRows, projectRows, exportRows, validRange };
});
