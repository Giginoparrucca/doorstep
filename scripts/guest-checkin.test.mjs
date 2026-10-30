import {supabaseAuthHeaders} from '../api/_supabase-auth.js';
import {submitEntryCheckin} from '../api/_entry-submission-save.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../api/guest.js', import.meta.url), 'utf8');
// Exercise the actual gateway insert with a database stub enforcing NOT NULL.
const insert = source.slice(source.indexOf('async function doCheckinInsert('),
  source.indexOf('// ── action: checkin_update'));
const helpers = source.slice(source.indexOf('function pickFields('));
const fields = source.match(/const CHECKIN_WRITE_FIELDS = (\[[\s\S]*?\]);/)[1];
let rows = [];
const context = vm.createContext({supabaseAuthHeaders,
  SUPABASE_URL: 'https://database.invalid', SERVICE_KEY: 'test',
  callRPC: async () => ({ok:true,json:async()=>({enabled:false})}),
  submitEntryCheckin: async () => ({enabled:false}),
  CHECKIN_WRITE_FIELDS: vm.runInNewContext(fields),
  CodiceFiscale: createRequire(import.meta.url)('../lib/codice-fiscale.js'),
  pgrestGET: async () => ({ ok: true, json: async () => [{ region: 'Puglia' }] }),
  WALKIN_PREFIX: 'WB-', console, recordUsage: async () => {},
  fetch: async (url, opts) => {
    if (opts.method === 'POST' && url.endsWith('/checkins')) {
      const row = JSON.parse(opts.body);
      const ok = row.document_number != null && row.document_type != null;
      if (ok) rows.push(row);
      return { ok, status: ok ? 201 : 400,
        json: async () => [{ ...row, id: 'inserted' }],
        text: async () => JSON.stringify({ code: '23502' }) };
    }
    return { ok: true, json: async () => null };
  },
});
vm.runInContext(helpers + '\n' + insert, context);
const base = { surname: 'Test', name: 'Guest', sex: 'F',
  date_of_birth: '1981-03-16', citizenship: 'United States', residence_country: 'United States',
  arrival_date: '2026-10-06', departure_date: '2026-10-10', nights: 4 };
for (const guest_type of ['group', 'group_member', 'head', 'member']) {
  const member = ['group_member', 'member'].includes(guest_type);
  let status, response;
  const res = { status(s) { status = s; return this; }, json(r) { response = r; } };
  await context.doCheckinInsert(res, 'property', 'BOOKING', 'session', {
    record: { ...base, guest_type, document_type: member ? '' : 'passport',
      document_number: member ? '' : 'TEST123', docs_status: member ? 'not_required' : 'pending' },
  }, false);
  assert.equal(status, 200, guest_type);
  assert.equal(response.id, 'inserted');
  assert.equal(rows.at(-1).document_number, member ? '' : 'TEST123');
  assert.equal(rows.at(-1).document_type, member ? '' : 'passport');
}
const patch = context.pickFields({ document_number: '', document_type: '', surname: 'Test', ignored: 'no' },
  ['document_number', 'document_type', 'surname']);
assert.equal(patch.document_number, '');
assert.equal(patch.document_type, '');
assert.equal(patch.ignored, undefined);
assert.equal(Object.hasOwn(context.pickFields({}, ['document_number']), 'document_number'), false);
// Execute the real handler's ON branch through its real adapter. Metadata
// comes from verified handler arguments; untrusted record totals/scope are dropped.
context.submitEntryCheckin=submitEntryCheckin;
const legacyCount=rows.length;
let rpcArgs;
context.callRPC=async(name,args)=>{
  assert.equal(name,'entry_access_submit_checkin');rpcArgs=args;
  return {ok:true,json:async()=>({enabled:true,id:'transactional-row',booking_code:'BOOKING'})};
};
let actualStatus,actualBody;
const response={status(n){actualStatus=n;return this;},json(v){actualBody=v;}};
await context.doCheckinInsert(response,'property','BOOKING','session',{
  record:{...base,guest_type:'single',document_type:'passport',document_number:'TEST123',property_id:'foreign',guest_count:1},
  submission_id:'request-fictional',guest_ordinal:2},false);
assert.equal(actualStatus,200);assert.equal(actualBody.id,'transactional-row');assert.equal(rows.length,legacyCount);
assert.equal(rpcArgs.p_property_id,'property');assert.equal(rpcArgs.p_booking_code,'BOOKING');
assert.equal(rpcArgs.p_record.property_id,undefined);assert.equal(rpcArgs.p_record.guest_count,undefined);
context.callRPC=async()=>({ok:false,json:async()=>({code:'40001',details:'PRIVATE-FICTIONAL'})});
await context.doCheckinInsert(response,'property','BOOKING','session',{record:{...base,guest_type:'single',document_type:'passport',document_number:'TEST123'}},false);
assert.equal(actualStatus,409);assert.equal(rows.length,legacyCount);assert.ok(!JSON.stringify(actualBody).includes('PRIVATE-FICTIONAL'));
console.log('PASS: family/group leaders and members insert; explicit empty document updates survive; omitted fields stay omitted.');
