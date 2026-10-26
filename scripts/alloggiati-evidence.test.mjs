import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createFilingEvidence,parseFilingEvidence} from '../api/_alloggiati-evidence.js';
import {test as portalTest} from '../api/_alloggiati-soap.js';
const property='11111111-1111-4111-8111-111111111111',ids=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
const lines=fs.readFileSync(new URL('./golden/synthetic/alloggiati-expected.txt',import.meta.url),'utf8').trimEnd().split(/\r?\n/).slice(0,2);
const fixed=()=>new Date('2026-10-26T03:00:00Z');
const events=[];
const create=(extra={})=>createFilingEvidence({persist:async entry=>events.push(entry),propertyId:property,trigger:'autofile',checkinIds:ids,lines,rowIds:ids.map(id=>[id]),version:'FICTIONAL_CODE_VERSION',attemptId:'55555555-5555-4555-8555-555555555555',clock:fixed,...extra});
let evidence=create(),originalFetch=globalThis.fetch;
try {
 const wire=fs.readFileSync(new URL('./golden/synthetic/alloggiati-test-empty-fields.xml',import.meta.url),'utf8');
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>wire});
 await evidence.run('test',options=>portalTest({utente:'FICTIONAL',token:'FICTIONAL',rows:lines},options));
 const golden=events.map(entry=>({outcome:entry.outcome,evidence:parseFilingEvidence(entry.errorDetail)}));
 const path=new URL('./golden/synthetic/alloggiati-evidence-expected.json',import.meta.url);
 if(process.env.WRITE_FICTIONAL_GOLDEN==='1')fs.writeFileSync(path,JSON.stringify(golden,null,2)+'\n');
 assert.equal(JSON.stringify(golden,null,2)+'\n',fs.readFileSync(path,'utf8'),'exact fictional wire-to-evidence golden');
 assert.equal(golden[1].evidence.diagnostic_fields.filter(row=>row.field==='ErroreDettaglio').length,2);
 assert.equal(golden[2].evidence.per_row[1].checkin_ids[0],ids[1]);
 // Response detail survives a parser failure and a later changed-date attempt.
 const originalFailure=events[2].errorDetail;
 globalThis.fetch=async()=>({ok:true,status:200,text:async()=>'<Unexpected><ErroreDettaglio>Original field problem</ErroreDettaglio></Unexpected>'});
 await assert.rejects(()=>evidence.run('test',options=>portalTest({utente:'FICTIONAL',token:'FICTIONAL',rows:lines},options)),e=>e.code==='unrecognized_response');
 assert.ok(events.some(entry=>entry.errorDetail.includes('Original field problem')));
 const changed=create({attemptId:'66666666-6666-4666-8666-666666666666',lines:lines.map(line=>line.slice(0,2)+'26/10/2026'+line.slice(12))});
 await changed.run('test',async()=>({overall:{ok:true},perRow:ids.map(()=>({ok:true}))}));
 assert.equal(events[2].errorDetail,originalFailure);
} finally {globalThis.fetch=originalFetch;}
// All rows and long details are retained; secrets and raw request lines are excluded.
const long='Original detail '.repeat(300),many=Array.from({length:8},(_,i)=>({ok:false,erroreCod:12,erroreDes:'Bad field',erroreDet:long+' PASS_SECRET USER_SECRET TOK_SECRET DOC_SECRET'}));
evidence=create({lines:Array(8).fill(lines[0]),rowIds:Array(8).fill([ids[0]]),secrets:['PASS_SECRET','USER_SECRET','TOK_SECRET','DOC_SECRET']});
await evidence.run('test',async()=>({overall:{ok:true},perRow:many}));
const retained=JSON.parse(events.at(-1).errorDetail);assert.equal(retained.per_row.length,8);assert.ok(retained.per_row[7].erroreDet.length>4000);assert.doesNotMatch(events.at(-1).errorDetail,/PASS_SECRET|USER_SECRET|TOK_SECRET|DOC_SECRET/);assert.ok(!events.at(-1).errorDetail.includes(lines[0]));
const api=fs.readFileSync(new URL('../api/alloggiati.js',import.meta.url),'utf8');
function extract(name){const start=api.indexOf('async function '+name+'(');return api.slice(start,api.indexOf('\n}\n',start)+2);}
async function runtime(mode,{ledger=[],failureAt=null}={}) {
 let sendCalls=0,tokenCalls=0,testCalls=0;const patches=[],legacy=[];
 const rows=ids.map((id,i)=>({id,property_id:property,booking_code:'FICTIONAL',guest_type:i?'member':'head',arrival_date:'2026-10-26',submitted_at:'2026-10-26T00:00:00Z'}));
 const persist=async entry=>{if(entry.outcome.startsWith('evidence_')){const data=parseFilingEvidence(entry.errorDetail);if(failureAt?.(data))throw Error('store offline');ledger.push(entry);}else legacy.push(entry);};
 const RealDate=Date;class Clock extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-26T03:00:00Z']));}static now(){return new Clock().getTime();}}
 const context=vm.createContext({console:{warn(){},error(){}},Date:Clock,Set,Map,encodeURIComponent,createFilingEvidence,logFiling:persist,redactSupport:value=>value,
 AllogRecords:{autofileDueAt:()=>new Date('2026-10-26T02:00:00Z'),buildBatch:()=>({lines,rowMeta:rows.map(row=>({checkin_id:row.id})),warnings:[]})},
 _romeDateYmd:()=> '2026-10-26',sbGet:async query=>{
 if(query.startsWith('checkins?'))return query.includes('select=booking_code')?[]:rows;
 if(query.startsWith('host_alloggiati_credentials?'))return [{}];
 if(query.startsWith('alloggiati_filing_log?'))return ledger.filter(entry=>entry.outcome==='evidence_send_started').slice(0,1);
 throw Error('Unexpected query '+query);},
 decryptCredentials:async()=>({utente:'USER',password:'PASS',wskey:'KEY'}),generateToken:async()=>{tokenCalls++;return {token:'TOKEN'};},
 soapTest:async()=>{testCalls++;return {overall:{ok:mode!=='overall_rejected'},perRow:mode==='mismatch'?[]:ids.map(()=>({ok:mode!=='rejected',erroreDes:'Bad field',erroreDet:'Original field detail'}))};},
 soapSend:async()=>{sendCalls++;if(mode==='timeout')throw Object.assign(Error('network timeout'),{code:'timeout'});return {overall:{ok:true},perRow:ids.map(()=>({ok:true}))};},
 sbPatch:async(_query,patch)=>{patches.push(patch);if(mode==='stamp'&&patch.alloggiati_status==='filed')throw Error('DB stamp failed');},
 SUPABASE_URL:'https://fictional.invalid',SERVICE_KEY:'FICTIONAL',fetch:async()=>({ok:true,json:async()=>ids}),
 _releaseClaimAndStamp:async(_ids,reason)=>patches.push({released:reason}),_bumpAttempts:async()=>[],maybeFireFailuresAlert:async()=>{},maybeFireRejectionAlert:async()=>{}});
 vm.runInContext(extract('pauseAutofileRows')+'\n'+extract('processPropertyAutofile'),context);
 await context.processPropertyAutofile({id:property,alloggiati_autofile_mode:'live'});
 return {ledger,legacy,patches,sendCalls,tokenCalls,testCalls};
}
for(const mode of ['rejected','overall_rejected','mismatch']){const r=await runtime(mode);assert.equal(r.sendCalls,0);assert.ok(r.ledger.some(entry=>entry.outcome==='evidence_failure'));}
for(const failureAt of [e=>e.stage==='credentials'&&e.event==='started',e=>e.stage==='test'&&e.event==='completed',e=>e.stage==='send'&&e.event==='started']){const r=await runtime('success',{failureAt});assert.equal(r.sendCalls,0);}
let r=await runtime('success',{failureAt:e=>e.stage==='send'&&e.event==='completed'});assert.equal(r.sendCalls,1);assert.ok(r.patches.some(patch=>patch.alloggiati_status==='correction'));
const recovered=await runtime('success',{ledger:r.ledger});assert.equal(recovered.tokenCalls,0);assert.equal(recovered.testCalls,0);assert.equal(recovered.sendCalls,0);assert.ok(recovered.patches.some(patch=>patch.autofile_last_error==='prior_send_requires_review'));
r=await runtime('timeout');assert.equal(r.sendCalls,1);assert.ok(r.patches.some(patch=>patch.alloggiati_status==='correction'));assert.equal(parseFilingEvidence(r.ledger.at(-1).errorDetail).source,'transport_uncertain');
r=await runtime('stamp');assert.ok(r.ledger.some(entry=>parseFilingEvidence(entry.errorDetail).source==='application_database'));
r=await runtime('success');assert.equal(r.sendCalls,1);assert.ok(r.patches.some(patch=>patch.alloggiati_status==='filed'));
// The actual persistence helper requires a successful UUID acknowledgement and keeps >500 chars.
const logs=[];globalThis.fetch=async(_url,opts)=>{logs.push(JSON.parse(opts.body));return {ok:true,json:async()=>ids[0]};};
try{const context=vm.createContext({fetch:globalThis.fetch,console,SUPABASE_URL:'https://fictional.invalid',SERVICE_KEY:'FICTIONAL'});vm.runInContext(extract('logFiling'),context);await context.logFiling({propertyId:property,trigger:'autofile',checkinIds:ids,outcome:'evidence_failure',errorDetail:long,strict:true});assert.equal(logs[0].p_error_detail,long);
 globalThis.fetch=async()=>({ok:true,json:async()=>null});context.fetch=globalThis.fetch;await assert.rejects(()=>context.logFiling({propertyId:property,trigger:'autofile',checkinIds:ids,outcome:'evidence_started',strict:true}),/acknowledgement/);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS full wire/evidence golden; all-row/long-field retention; secret-free fingerprints; original survives retries/date changes; real auto path rejects mismatch/overall failure; strict pre-Send audit; post-Send uncertainty/manual-review guard; stamp responsibility and persistence acknowledgement');
// Execute the real manual pre-Send branches with the strict journal, not a no-op wrapper.
const begin=api.indexOf('    // ── Mint a fresh token',api.indexOf("  if (action === 'send')")),end=api.indexOf('    // ── Send succeeded.',begin);
for(const mode of ['rejected','overall_rejected','mismatch','audit_before_send','audit_after_send','timeout','success']){
 let sent=0;const ledger=[];
 const journal=create({persist:async entry=>{const e=parseFilingEvidence(entry.errorDetail);if((mode==='audit_before_send'&&e.stage==='send'&&e.event==='started')||(mode==='audit_after_send'&&e.stage==='send'&&e.event==='completed'))throw Error('store offline');ledger.push(entry);}});
 const context=vm.createContext({console:{warn(){},error(){}},evidence:journal,propertyId:property,checkinIdsFlat:ids,rowsIn:ids.map(id=>({checkin_ids:[id]})),lines,owner:{hostId:'fixture'},creds:{utente:'USER',password:'PASS',wskey:'KEY'},redactSupport:value=>value,logFiling:async()=>{},
 generateToken:async()=>({token:'TOKEN'}),soapTest:async()=>({overall:{ok:mode!=='overall_rejected'},perRow:mode==='mismatch'?[]:ids.map(()=>({ok:mode!=='rejected',erroreDet:'Original detail'}))}),
 soapSend:async()=>{sent++;if(mode==='timeout')throw Object.assign(Error('timeout'),{code:'timeout'});return {overall:{ok:true},perRow:ids.map(()=>({ok:true}))};},res:{status(){return this;},json(value){return value;}}});
 vm.runInContext('async function probe(){'+api.slice(begin,end)+'}',context);const result=await context.probe();assert.equal(sent,['audit_after_send','timeout','success'].includes(mode)?1:0,mode);if(mode==='timeout'||mode==='audit_after_send')assert.equal(result.send_result_uncertain,true);if(mode==='audit_before_send')assert.equal(result.error_code,'audit_unavailable');
}
console.log('PASS actual manual send also blocks mismatched/overall-rejected Test and unavailable audit; post-Send audit/transport loss is explicitly uncertain');
