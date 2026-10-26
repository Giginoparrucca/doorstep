import assert from 'node:assert/strict';
import { validatePersistedEntrySubmission as validate } from '../api/_entry-submission-validation.js';
import { evaluateEntryRelease as evaluate } from '../api/_entry-release-policy.js';
const now=Date.parse('2026-11-01T10:00:00Z');
function fixture(kind='head'){
  const row={id:'synthetic-row',property_id:'p',booking_code:'SYNTHETIC',is_test:false,
    guest_type:kind,surname:'Synthetic',name:'Person',sex:'F',date_of_birth:'2000-01-01',
    place_of_birth:'London',birth_country:'United Kingdom',citizenship:'United Kingdom',
    document_type:'passport',document_number:'FICTIONAL123',doc_issue_place:'London',
    arrival_date:'2026-11-01',departure_date:'2026-11-05',nights:4,
    submitted_at:'2026-11-01T09:00:00Z',id_photo_path:'id-photos/synthetic-only.jpg'};
  const booking={booking_id:'b',property_id:'p',booking_code:'SYNTHETIC',is_test:false,
    identity_version:'identity-v1',arrival_date:row.arrival_date,departure_date:row.departure_date};
  const context={booking,roster:{version:'roster-v1'},slot:{id:'slot',required:true,guest_type:kind,photo_required:false},
    binding:{checkin_id:row.id,slot_id:'slot',booking_id:'b',property_id:'p'}};
  return {row,context};
}
let checks=0;
function invalid(change,field){const f=fixture();change(f);const r=validate(f.row,f.context,now);assert.equal(r.valid,false,field);assert.ok(r.errors.includes(field),field);assert.equal(r.submission?.validated,false);checks++;}
for(const [change,field] of [
  [f=>{f.row.property_id='other'},'submission_scope'],
  [f=>{f.row.booking_code='OTHER'},'submission_scope'],
  [f=>{f.row.is_test=true},'submission_scope'],
  [f=>{f.row.deleted_at='2026-11-01T09:30:00Z'},'submission_scope'],
  [f=>{f.context.binding.slot_id='other'},'submission_scope'],
  [f=>{f.context.binding.checkin_id='other'},'submission_scope'],
  [f=>{f.context.binding.booking_id='other'},'submission_scope'],
  [f=>{f.context.binding.property_id='other'},'submission_scope'],
  [f=>{f.context.slot.required=false},'submission_scope'],
  [f=>{f.row.guest_type='member'},'guest_type'],
  [f=>{f.row.surname=''},'surname'],[f=>{f.row.surname='X'.repeat(51)},'surname'],
  [f=>{f.row.name=null},'name'],[f=>{f.row.name='X'.repeat(31)},'name'],
  [f=>{f.row.sex='unknown'},'sex'],[f=>{f.row.date_of_birth='2000-02-30'},'date_of_birth'],
  [f=>{f.row.date_of_birth='2027-01-01'},'date_of_birth'],
  [f=>{f.row.place_of_birth=''},'place_of_birth'],[f=>{f.row.birth_country='Atlantis'},'birth_country'],
  [f=>{f.row.citizenship='Atlantis'},'citizenship'],
  [f=>{f.row.birth_country='Italy';f.row.place_of_birth='Roma'},'birth_province'],
  [f=>{f.row.birth_country='Italia';f.row.birth_province='RM';f.row.place_of_birth='Unknown village'},'place_of_birth'],
  [f=>{f.row.document_type='invented'},'document_type'],[f=>{f.row.document_type=''},'document_type'],
  [f=>{f.row.document_number=''},'document_number'],[f=>{f.row.document_number='X'.repeat(21)},'document_number'],
  [f=>{f.row.doc_issue_place=''},'doc_issue_place'],[f=>{f.row.arrival_date='2026-11-02'},'arrival_date'],
  [f=>{f.row.departure_date='2026-11-06'},'departure_date'],[f=>{f.row.nights=1},'nights'],
  [f=>{f.row.submitted_at=null},'submitted_at'],[f=>{f.row.submitted_at='2026-11-02T09:00:00Z'},'submitted_at'],
  [f=>{f.row.checkin_reopened_at='2026-11-01T09:30:00Z'},'checkin_reopened_at'],
  [f=>{f.context.slot.photo_required=true},'id_photo'],
  [f=>{delete f.context.slot.photo_required},'photo_requirement'],
  [f=>{f.context.slot.photo_required=true;f.context.photo={verified:true,path:f.row.id_photo_path,checkin_id:'other'}},'id_photo'],
  [f=>{f.context.slot.photo_required=true;f.context.photo={verified:true,path:'other',checkin_id:f.row.id}},'id_photo'],
])invalid(change,field);
for(const kind of ['single','head','group','member','group_member']){
  const f=fixture(kind);
  if(['member','group_member'].includes(kind)){
    Object.assign(f.row,{document_type:'',document_number:'',doc_issue_place:'',id_photo_path:null,date_of_birth:'2020-01-01'});
  }
  assert.equal(validate(f.row,f.context,now).valid,true,kind);checks++;
}
const f=fixture();const original=validate(f.row,f.context,now);
assert.equal(original.valid,true);checks++;
const wire=JSON.stringify(original);
for(const secret of ['Synthetic','Person','FICTIONAL123','id-photos/'])assert.ok(!wire.includes(secret)); checks++;
f.row.name='Corrected';const corrected=validate(f.row,f.context,now);
assert.equal(corrected.valid,true);assert.notEqual(corrected.submission.source_revision,original.submission.source_revision);checks++;
f.row.alloggiati_status='error';f.row.docs_status='pending';f.row.tax_paid=false;f.row.filed_at=null;
assert.equal(validate(f.row,f.context,now).valid,true);checks++;
f.context.slot.photo_required=true;f.context.photo={verified:true,path:f.row.id_photo_path,checkin_id:f.row.id};
assert.equal(validate(f.row,f.context,now).valid,true);checks++;
f.row.birth_country='Italy';f.row.birth_province='RM';f.row.place_of_birth='Roma';
assert.equal(validate(f.row,f.context,now).valid,true);checks++;
assert.deepEqual(validate(null,null,now),{valid:false,errors:['validation_context'],submission:null});checks++;

// Feed actual validation evidence into the release evaluator, then invalidate
// the persisted document. No client-complete flag or portal status can unlock.
const only=fixture('single');const ctx=only.context;
const snapshot={reads_complete:true,scope:{property_id:'p',booking_id:'b',booking_code:'SYNTHETIC',is_test:false,
  session_valid:true,session_valid_until:'2026-11-02T00:00:00Z'},property:{id:'p',entry_checkin_required:true},
  booking:{...ctx.booking,status:'active',valid_until:'2026-11-05T10:00:00Z',expected_count:1},
  roster:{...ctx.booking,version:'roster-v1',confirmed:true,source:'host',slots:[ctx.slot]},room_resolution:'none',
  submissions:[validate(only.row,ctx,now).submission]};
assert.equal(evaluate(snapshot,now).state,'available');
only.row.document_number=''; snapshot.submissions=[validate(only.row,ctx,now).submission];
assert.equal(evaluate(snapshot,now).state,'locked');checks+=2;
console.log(`PASS ${checks} current-row validation/evidence scenarios, including real policy composition; synthetic data only.`);
