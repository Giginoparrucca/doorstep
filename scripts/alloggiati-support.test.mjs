import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { handleAlloggiatiSupport, redactSupport } from '../api/_alloggiati-support.js';
import { _internal } from '../api/_alloggiati-soap.js';
const property='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-333333333333';
const fakeSecrets=['fixture-user','fixture-password','fixture-wskey','fixture-token','DOCSECRET'];
function fixture(changes={}) {
 const calls=[],rows=[{id,property_id:property,booking_code:'BOOK',arrival_date:'2026-10-23',submitted_at:'2026-10-23T10:00:00Z',alloggiati_status:'pending',document_number:'DOCSECRET'}];
 let soapCalls=0;
 const deps={url:'https://fixture.invalid',anonKey:'public',serviceKey:'service',
  fetch:async(url,opts)=>{calls.push({url,opts});if(url.endsWith('/auth/v1/user'))return {ok:changes.auth!==false,json:async()=>({id:'admin',email:'admin@example.invalid',user_metadata:{is_admin:true}})};if(url.endsWith('/rpc/is_admin')){assert.equal(opts.headers.Authorization,'Bearer jwt');return {ok:true,json:async()=>changes.admin!==false};}if(url.endsWith('/admin_impersonation_log'))return {ok:changes.audit!==false};throw Error('unexpected fetch '+url);},
  get:async query=>{calls.push({query});if(changes.readError)throw Error('backend secret details');if(query.startsWith('properties?'))return [{id:property,name:'Fixture property',alloggiati_autofile_mode:'live',is_test:changes.testProperty,deleted_at:changes.deletedProperty}];if(query.startsWith('host_alloggiati_credentials?'))return changes.noCredentials?[]:[query.includes('credentials_enc')?{credentials_enc:'ENCRYPTEDSECRET'}:{verified_at:null,last_error:'token=OLDSECRET'}];if(query.startsWith('alloggiati_filing_log?'))return [{outcome:'test_rejected',checkin_ids:[id],error_detail:'password=OLDSECRET'}];if(query.startsWith('checkins?')){assert.ok(query.includes('property_id=eq.'+property));assert.match(query,/is_test=eq.false/);assert.match(query,/deleted_at=is.null/);if(query.includes('&id=eq.'))return changes.foreignTarget?[]:[{id,booking_code:'BOOK'}];return changes.badGroup?[{...rows[0],property_id:other}]:rows;}throw Error('unexpected read '+query);},
  allog:{autofileDueAt:()=>null,buildBatch:records=>({lines:records.map(()=> 'X'.repeat(168)),rowMeta:records.map((r,i)=>({checkin_id:r.id,booking_code:r.booking_code,idx:i+1})),warnings:changes.warning?['Row 1: unresolved country']:[]})},
  decrypt:async()=>{if(changes.decryptError)throw Error('secret');return {utente:fakeSecrets[0],password:fakeSecrets[1],wskey:fakeSecrets[2]};},
  generateToken:async()=>{soapCalls++;if(changes.portalError)throw Object.assign(Error(fakeSecrets.slice(0,3).join(' ')),{code:'authentication_failed'});return {token:fakeSecrets[3]};},
  authenticationTest:async()=>{soapCalls++;},
  test:async({rows})=>{soapCalls++;assert.equal(rows.length,1);return {overall:{ok:true,code:'ok'},perRow:changes.mismatch?[]:[{ok:false,code:'row_rejected',erroreDes:'SCHEDINA_CAMPO_NON_CORRETTO',erroreDet:'Field document_number '+fakeSecrets.join(' ')}]};},
 };
 async function run(action='support_status',body={}) {const req={query:{action},headers:changes.anonymous?{}:{authorization:'Bearer jwt'},body:{property_id:property,checkin_id:id,...body}};const res={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handleAlloggiatiSupport(req,res,deps);return res;}
 return {run,calls,get soapCalls(){return soapCalls;}};
}
for(const option of [{anonymous:true},{admin:false},{auth:false}]){for(const action of ['support_status','support_verify','support_validate','support_investigate']){const f=fixture(option),r=await f.run(action);assert.ok([401,403].includes(r.code));assert.equal(f.soapCalls,0);assert.ok(!f.calls.some(c=>c.query));}}
for(const option of [{testProperty:true},{deletedProperty:'2026-10-25'}]){const f=fixture(option),r=await f.run();assert.equal(r.code,404);assert.equal(f.soapCalls,0);}
let f=fixture(),r=await f.run();assert.equal(r.code,200);assert.equal(r.data.connection.configured,true);assert.ok(r.data.records[0].past_automatic_window);assert.ok(!JSON.stringify(r.data).includes('OLDSECRET'));assert.ok(!JSON.stringify(r.data).includes('ENCRYPTEDSECRET'));assert.equal(f.soapCalls,0);
f=fixture();r=await f.run('support_verify');assert.equal(r.data.ok,true);assert.equal(r.data.filed,false);assert.equal(f.soapCalls,2);assert.ok(!f.calls.some(c=>c.opts?.method==='PATCH'));
f=fixture();r=await f.run('support_validate');assert.equal(r.data.ok,false);assert.equal(r.data.rows[0].checkin_id,id);assert.match(r.data.rows[0].detail,/Field document_number/);for(const value of fakeSecrets)assert.ok(!JSON.stringify(r.data).includes(value));assert.equal(r.data.filed,false);
for(const [changes,code] of [[{foreignTarget:true},404],[{badGroup:true},403],[{audit:false},503],[{readError:true},503]]){f=fixture(changes);r=await f.run('support_validate');assert.equal(r.code,code);assert.equal(f.soapCalls,0);}
f=fixture({warning:true});r=await f.run('support_validate');assert.equal(r.data.stage,'local_validation');assert.equal(f.soapCalls,0);
f=fixture({mismatch:true});r=await f.run('support_validate');assert.equal(r.data.ok,false);assert.equal(r.data.rows[0].error_code,'response_mismatch');
for(const changes of [{noCredentials:true},{decryptError:true},{portalError:true}]){f=fixture(changes);r=await f.run('support_verify');assert.equal(r.data.ok,false);for(const secret of fakeSecrets)assert.ok(!JSON.stringify(r.data).includes(secret));}
f=fixture();r=await f.run('support_send');assert.equal(r.code,400);assert.equal(f.soapCalls,0);
const parsed=_internal.extractDettaglio('<EsitoOperazioneServizio><esito>false</esito><ErroreCod>99</ErroreCod><ErroreDes>SCHEDINA_CAMPO_NON_CORRETTO</ErroreDes><ErroreDettaglio>Data nascita non valida</ErroreDettaglio></EsitoOperazioneServizio>');assert.equal(parsed[0].erroreDet,'Data nascita non valida');assert.equal(parsed[0].ok,false);
assert.ok(!redactSupport('Bearer abc.def.ghi password=secret <token>tokenvalue</token>').match(/abc.def.ghi|secret|tokenvalue/));
const api=fs.readFileSync(new URL('../api/alloggiati.js',import.meta.url),'utf8');assert.ok(api.indexOf('if (rejectDemoIntegration')<api.indexOf("action.startsWith('support_')"));assert.ok(api.indexOf("action.startsWith('support_')")<api.indexOf('const owner = await resolveHostAndProperty'));
const helper=fs.readFileSync(new URL('../api/_alloggiati-support.js',import.meta.url),'utf8');assert.ok(!/soapSend|\.send\(/.test(helper));assert.ok(!helper.includes('user_metadata'));assert.ok(!/method: 'PATCH'|method: 'DELETE'/.test(helper));
const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);assert.match(html,/showAlloggiatiSupport/);
console.log('PASS Alloggiati support auth/property/test/audit gates, no Send/no secret/no guest writes, safe connection checks, authoritative group validation, detail parsing, unknown responses and unavailable data');
// Execute the actual manual portal-stage branches; failure recording must not change filing decisions.
const sendStart=api.indexOf("  if (action === 'send')");const mint=api.indexOf('    // ── Mint a fresh token',sendStart),stop=api.indexOf('    // ── Send succeeded.',mint);const branch=api.slice(mint,stop);
for(const scenario of ['auth','test_transport','test_rejected','send_transport','send_rejected','send_partial','success']){
 const audit=[];let sent=0;
 const context=vm.createContext({console:{warn(){},error(){}},propertyId:property,checkinIdsFlat:[id],rowsIn:[{checkin_ids:[id]}],lines:['X'.repeat(168)],owner:{hostId:'owner'},creds:{utente:'USERSECRET',password:'PASSSECRET',wskey:'KEYSECRET'},redactSupport,
 logFiling:async item=>audit.push(item),
 generateToken:async()=>{if(scenario==='auth')throw Error('PASSSECRET');return {token:'TOKENSECRET'};},
 soapTest:async()=>{if(scenario==='test_transport')throw Error('PASSSECRET');return {overall:{ok:true},perRow:[{ok:scenario!=='test_rejected',erroreDes:'Bad field',erroreDet:'Data nascita non valida'}]};},
 soapSend:async()=>{sent++;if(scenario==='send_transport')throw Error('TOKENSECRET');return {overall:{ok:scenario!=='send_rejected',code:'rejected',erroreDes:'Rejected'},perRow:[{ok:scenario!=='send_partial',erroreDes:'Partial',erroreDet:'Check portal'}]};},
 res:{status(){return this;},json(value){return value;}}});
 vm.runInContext('async function probe(){'+branch+'}',context);await context.probe();
 assert.equal(audit.length,scenario==='success'?0:1);if(audit.length){assert.equal(audit[0].trigger,'host');assert.equal(audit[0].actor,'owner');assert.ok(!JSON.stringify(audit[0]).match(/PASSSECRET|TOKENSECRET|KEYSECRET|USERSECRET/));}
 if(['auth','test_transport','test_rejected'].includes(scenario))assert.equal(sent,0);else assert.equal(sent,1);
}
console.log('PASS actual manual authentication/Test/Send failure auditing, detail retention, secret redaction and unchanged no-Send-on-Test-rejection behavior');
// Real dispatcher: admin support does not grant owner-only save/delete/send privileges.
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-service';
const {default:handler}=await import('../api/alloggiati.js');const originalFetch=globalThis.fetch;
let adminAllowed=true;
try{
 globalThis.fetch=async(url,opts={})=>{
  const ok=data=>({ok:true,json:async()=>data,text:async()=>JSON.stringify(data)});
  if(url.endsWith('/auth/v1/user'))return ok({id:'admin',email:'admin@example.invalid'});
  if(url.endsWith('/rpc/is_admin'))return ok(adminAllowed);
  if(url.includes('/rest/v1/properties?'))return ok([{id:property,name:'Fixture',owner_id:'owner',alloggiati_autofile_mode:'live'}]);
  if(url.endsWith('/admin_impersonation_log'))return ok(null);
  if(url.includes('/rest/v1/host_alloggiati_credentials?')||url.includes('/rest/v1/checkins?')||url.includes('/rest/v1/alloggiati_filing_log?'))return ok([]);
  throw Error('Unexpected external request');
 };
 async function dispatch(action){const response={setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;}};await handler({method:'POST',query:{action},headers:{origin:'https://app.welcomebnb.it',authorization:'Bearer fixture-admin'},body:{property_id:property}},response);return response;}
 assert.equal((await dispatch('support_status')).code,200);
 for(const action of ['status','save','verify','validate','send','delete'])assert.equal((await dispatch(action)).code,403,action+' remains owner-only');
 adminAllowed=false;assert.equal((await dispatch('support_status')).code,403);
}finally{globalThis.fetch=originalFetch;}
console.log('PASS real dispatcher support access and unchanged owner-only status/save/verify/validate/send/delete boundaries');
