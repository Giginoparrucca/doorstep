// Server-only revalidation of current, persisted check-in rows. Not an HTTP
// parser or auth mechanism; the snapshot loader must supply authoritative rows,
// stable slot bindings and storage evidence from one consistent read.
import { createHash } from 'node:crypto';
// Static import keeps the shared CommonJS tables visible to deployment tracing.
import records from '../lib/alloggiati-records.js';
const text = v => typeof v === 'string' && v.trim().length > 0;
const day = v => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const timestamp = v => typeof v === 'string'
  && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v)
  && Number.isFinite(Date.parse(v));
const revisionFields = ['id','property_id','booking_code','is_test','deleted_at','guest_type',
  'surname','name','sex','date_of_birth','place_of_birth','birth_province','birth_country',
  'citizenship','document_type','document_number','doc_issue_place','arrival_date','departure_date',
  'nights','id_photo_path','submitted_at','checkin_reopened_at'];

export function validatePersistedEntrySubmission(row, context, now=Date.now()) {
  const errors = new Set();
  const { booking, roster, slot, binding, photo } = context || {};
  if (!row || !booking || !roster || !slot || !binding || !Number.isFinite(now)) {
    return { valid:false, errors:['validation_context'], submission:null };
  }
  if (!text(row.id) || binding.checkin_id !== row.id || binding.slot_id !== slot.id
      || binding.booking_id !== booking.booking_id || binding.property_id !== booking.property_id
      || row.property_id !== booking.property_id || row.booking_code !== booking.booking_code
      || row.is_test !== booking.is_test || row.deleted_at != null
      || slot.required !== true || !text(slot.id) || !text(roster.version)
      || !text(booking.identity_version)) errors.add('submission_scope');
  if (!['single','head','group','member','group_member'].includes(slot.guest_type)
      || row.guest_type !== slot.guest_type) errors.add('guest_type');
  if (!text(row.surname) || row.surname.length>50) errors.add('surname');
  if (!text(row.name) || row.name.length>30) errors.add('name');
  if (!['M','F'].includes(row.sex)) errors.add('sex');
  if (!day(row.date_of_birth) || Date.parse(row.date_of_birth)>now) errors.add('date_of_birth');
  if (!text(row.place_of_birth)) errors.add('place_of_birth');
  const birthCountry = text(row.birth_country) ? records.lookupStateCode(row.birth_country).trim() : '';
  if (!birthCountry) errors.add('birth_country');
  if (!text(row.citizenship) || !records.lookupStateCode(row.citizenship).trim()) errors.add('citizenship');
  if (records.isItalianCitizenshipCode(birthCountry)) {
    if (!text(row.birth_province) || !/^[A-Z]{2}$/.test(row.birth_province)
        || row.birth_province==='EE') errors.add('birth_province');
    if (!records.lookupPoliceCode(row.place_of_birth,row.birth_province)) errors.add('place_of_birth');
  }
  if (['single','head','group'].includes(slot.guest_type)) {
    const normalized = text(row.document_type) ? records._normKey(row.document_type) : '';
    // lookupDocCode has a legacy IDENT fallback; it must not make an unknown
    // document type appear validated here.
    if (!normalized || !(Object.values(records.DOCS).includes(normalized)
        || Object.hasOwn(records.DOCS,normalized) || Object.hasOwn(records.DOC_ALIASES,normalized))) {
      errors.add('document_type');
    }
    if (!text(row.document_number) || row.document_number.length>20) errors.add('document_number');
    if (!text(row.doc_issue_place)) errors.add('doc_issue_place');
  }
  if (!day(row.arrival_date) || row.arrival_date !== booking.arrival_date) errors.add('arrival_date');
  if (!day(row.departure_date) || row.departure_date !== booking.departure_date
      || Date.parse(row.departure_date)<=Date.parse(row.arrival_date)) errors.add('departure_date');
  if (!Number.isInteger(row.nights) || row.nights<1 || row.nights>99
      || row.nights !== (Date.parse(row.departure_date)-Date.parse(row.arrival_date))/86400000) errors.add('nights');
  if (!timestamp(row.submitted_at) || Date.parse(row.submitted_at)>now) errors.add('submitted_at');
  if (row.checkin_reopened_at != null) errors.add('checkin_reopened_at');
  if (typeof slot.photo_required !== 'boolean') errors.add('photo_requirement');
  const photoVerified = !!(photo && photo.verified === true && photo.checkin_id === row.id
    && text(row.id_photo_path) && photo.path === row.id_photo_path);
  if (slot.photo_required === true && !photoVerified) errors.add('id_photo');
  const sourceRevision = createHash('sha256').update(JSON.stringify({
    row:revisionFields.map(k=>[k,row[k]??null]), slot_id:slot.id,
    identity_version:booking.identity_version, roster_version:roster.version,
    photo_required:slot.photo_required, photo_verified:photoVerified,
  })).digest('hex');
  // Evidence contains neither names/documents/photo paths nor entry codes.
  // A fresh read is revalidated, so unrelated valid corrections stay eligible.
  return { valid:errors.size===0, errors:[...errors], submission:{
    id:row.id, property_id:booking.property_id, booking_id:booking.booking_id,
    is_test:booking.is_test, slot_id:slot.id, guest_type:row.guest_type,
    identity_version:booking.identity_version, roster_version:roster.version,
    validated:errors.size===0, validation_version:'entry-v1',
    source_revision:sourceRevision, validated_revision:sourceRevision,
    submitted_at:row.submitted_at, reopened_at:row.checkin_reopened_at??null,
    deleted_at:row.deleted_at??null, photo_verified:photoVerified,
  }};
}
