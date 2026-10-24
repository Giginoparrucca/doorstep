// Round 63 Phase 2: pure normalization/reporting. Never mutates a calendar.
import { createHash } from 'node:crypto';
import { IresError } from './_ireservation-core.js';
const fail = code => { throw new IresError(code, code.startsWith('provider_') ? 503 : 400); };
export function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
}
export function windowRange(from, to) {
  if (!date(from) || !date(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 31) fail('comparison_range_invalid');
  return { fromDate: from, toDate: to };
}
export function normalizeReservations(records) {
  if (!Array.isArray(records) || records.length > 5000) fail('provider_response_invalid');
  return records.map(r => {
    if (!r || typeof r.idReservation !== 'string' || !r.idReservation || r.idReservation.length > 200 ||
        !Number.isInteger(r.idDistributor) || r.idDistributor < 0 || typeof r.status !== 'string' || r.status.length > 20) fail('provider_response_invalid');
    const rooms = Array.isArray(r.rooms) ? r.rooms.map(x => x?.id) : [];
    if (rooms.some(id => !Number.isInteger(id) || id <= 0)) fail('provider_response_invalid');
    const active = r.status === 'I' || r.status === 'U';
    const validDates = date(r.dateCheckIn) && date(r.dateCheckOut) && r.dateCheckOut > r.dateCheckIn;
    // Only necessary identity/status/date/inventory fields survive the boundary.
    return { id: r.idReservation, distributor: r.idDistributor, status: r.status,
      checkin: validDates ? r.dateCheckIn : null, checkout: validDates ? r.dateCheckOut : null,
      updated: typeof r.dateTimeLastUpdate === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.dateTimeLastUpdate) ? r.dateTimeLastUpdate : null,
      rooms, invalid: !['I','U','D'].includes(r.status) ? 'unknown_status' : active && !validDates ? 'invalid_dates' : active && !rooms.length ? 'missing_rooms' : null };
  });
}
export function validateMapping(mapping, providerRooms, localRooms) {
  if (!Array.isArray(mapping) || mapping.length > 500) fail('mapping_invalid');
  const provider = new Map(providerRooms.map(r => [r.id,r])), locals = new Set(localRooms.map(r => r.id));
  const ids = new Set(), assigned = new Set();
  return mapping.map(m => {
    if (!m || !Number.isInteger(m.provider_id) || !provider.has(m.provider_id) || ids.has(m.provider_id)) fail('mapping_invalid');
    ids.add(m.provider_id);
    if (m.strategy === 'unmapped') return { provider_id:m.provider_id, strategy:'unmapped', room_id:null, confirmed:false };
    if (m.confirmed !== true) fail('mapping_confirmation_required');
    if (m.strategy === 'whole_property' && !localRooms.length && provider.get(m.provider_id).type === 'property') {
      if (assigned.has('property')) fail('mapping_duplicate_room'); assigned.add('property');
      return { provider_id:m.provider_id, strategy:'whole_property',room_id:null,confirmed:true };
    }
    if (m.strategy !== 'single_unit' || provider.get(m.provider_id).type !== 'room' || !locals.has(m.room_id) || assigned.has(m.room_id)) fail('mapping_duplicate_room');
    assigned.add(m.room_id);
    return { provider_id:m.provider_id,strategy:'single_unit',room_id:m.room_id,confirmed:true };
  });
}
const identity = (calendar, r) => JSON.stringify([calendar,r.distributor,r.id]);
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function compareReservations({ calendarId, native, local, mapping, distributors, range, localTruncated = false }) {
  const map = new Map(mapping.map(m => [m.provider_id,m]));
  const channels = new Set(distributors.map(d => d.idDistributor)); channels.add(0);
  const seen = new Map(), conflicts = new Set(), duplicateKeys = new Set();
  for (const r of native) { const key=identity(calendarId,r); if(seen.has(key)) { duplicateKeys.add(key); if(hash(seen.get(key))!==hash(r))conflicts.add(key); } else seen.set(key,r); }
  const counts = { fetched:native.length, unique:seen.size, duplicate:duplicateKeys.size, conflict:conflicts.size,
    matched:0, changed:0, api_only:0, review:0, ambiguous:0, quarantined:0, deleted:0, local_only:0 };
  const items=[], considered=new Set();
  for(const [key,r] of seen) {
    const out={id:r.id,distributor:r.distributor,status:r.status,checkin:r.checkin,checkout:r.checkout,room_ids:[],outcome:'',reasons:[]};
    if(r.invalid)out.reasons.push(r.invalid);
    if(conflicts.has(key))out.reasons.push('conflicting_versions');
    if(!channels.has(r.distributor))out.reasons.push('unknown_distributor');
    if(r.status==='D')counts.deleted++;
    const distinctRooms=new Set(r.rooms);
    if(distinctRooms.size!==r.rooms.length || r.rooms.length>1)out.reasons.push('multi_unit_requires_allocation');
    for(const room of distinctRooms) {
      const m=map.get(room);if(!m||m.strategy==='unmapped'||!m.confirmed)out.reasons.push('room_unmapped');
      else out.room_ids.push(m.room_id);
    }
    const exact=local.filter(l=>l.provider_identity===key);
    if(exact.length>1)out.reasons.push('duplicate_local_identity');
    if(out.reasons.length) {out.outcome='quarantined';counts.quarantined++;}
    else if(exact.length===1) {
      const l=exact[0]; considered.add(l.id);
      const same=r.status==='D'?l.status==='cancelled':l.status==='active'&&l.checkin_date===r.checkin&&l.checkout_date===r.checkout&&out.room_ids.includes(l.room_id??null);
      out.outcome=same?'matched':'changed';counts[out.outcome]++;
    } else {
      // Date/room similarity is a review hint only, never an identity/merge.
      const hints=r.status==='D'?[]:local.filter(l=>l.entry_type!=='block'&&l.status==='active'&&l.checkin_date===r.checkin&&l.checkout_date===r.checkout&&out.room_ids.includes(l.room_id??null));
      hints.forEach(l=>considered.add(l.id));
      out.outcome=hints.length>1?'ambiguous':hints.length===1?'review':'api_only';counts[out.outcome]++;
    }
    // The UI gets minimal private references, never provider names/contact data.
    items.push(out);
  }
  counts.local_only=local.filter(l=>!considered.has(l.id)&&l.status==='active'&&l.entry_type!=='block').length;
  return { mode:'compare',generated_at:new Date().toISOString(),calendarId,range,counts,items,coverage:'unverified',local_truncated:localTruncated,
    can_cutover:false,warnings:['provider_range_completeness_unverified','provider_timestamp_timezone_unverified',...(localTruncated?['local_comparison_truncated']:[])] };
}
