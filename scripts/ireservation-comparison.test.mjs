import assert from 'node:assert/strict';
import { normalizeReservations, windowRange, validateMapping, compareReservations } from '../api/_ireservation-compare.js';
import { createConnectionHandler } from '../api/_ireservation.js';
const rooms=[{id:104,type:'room',name:'Duplicate label'},{id:105,type:'room',name:'Duplicate label'},{id:106,type:'property',name:'Whole property'}];
const localRooms=[{id:'room-a',name:'Duplicate label'},{id:'room-b',name:'Duplicate label'}];
const map=validateMapping([{provider_id:104,strategy:'single_unit',room_id:'room-a',confirmed:true}],rooms,localRooms);
assert.deepEqual(map,[{provider_id:104,strategy:'single_unit',room_id:'room-a',confirmed:true}]);
for(const mappings of [
 [{provider_id:104,strategy:'single_unit',room_id:'room-a',confirmed:false}],
 [{provider_id:104,strategy:'single_unit',room_id:'alien-room',confirmed:true}],
 [{provider_id:104,strategy:'single_unit',room_id:'room-a',confirmed:true},{provider_id:105,strategy:'single_unit',room_id:'room-a',confirmed:true}],
 [{provider_id:104,strategy:'unmapped'},{provider_id:104,strategy:'unmapped'}],
 [{provider_id:106,strategy:'single_unit',room_id:'room-a',confirmed:true}],
 [{provider_id:106,strategy:'whole_property',confirmed:true}],
 [{provider_id:999,strategy:'unmapped'}],
])assert.throws(()=>validateMapping(mappings,rooms,localRooms));
assert.equal(validateMapping([{provider_id:106,strategy:'whole_property',confirmed:true}],rooms,[])[0].room_id,null);
assert.throws(()=>windowRange('2026-02-30','2026-03-01'));assert.throws(()=>windowRange('2026-10-01','2026-09-01'));assert.throws(()=>windowRange('2026-01-01','2026-02-02'));
assert.deepEqual(windowRange('2028-02-01','2028-03-01'),{fromDate:'2028-02-01',toDate:'2028-03-01'});
const raw={idReservation:'0000123',idDistributor:17,status:'I',dateCheckIn:'2026-10-01',dateCheckOut:'2026-10-03',dateTimeLastUpdate:'2026-09-01 12:34:56',rooms:[{id:104,name:'Fixture'}],guestEmail:'private@example.invalid',guestFirstName:'PII fixture',price:155};
const n=normalizeReservations([raw])[0];assert.equal(n.id,'0000123');assert.equal(JSON.stringify(n).includes('private@'),false);assert.equal('guestFirstName' in n,false);assert.equal('price' in n,false);
assert.equal(normalizeReservations([{...raw,status:'D',rooms:null,dateCheckIn:null,dateCheckOut:null}])[0].invalid,null);
assert.equal(normalizeReservations([{...raw,status:'X'}])[0].invalid,'unknown_status');
assert.equal(normalizeReservations([{...raw,dateCheckOut:'2026-09-01'}])[0].invalid,'invalid_dates');
assert.throws(()=>normalizeReservations([{...raw,idReservation:123}]));assert.throws(()=>normalizeReservations([{...raw,rooms:[{id:'104'}]}]));
const local={id:'local-a',status:'active',entry_type:'reservation',room_id:'room-a',checkin_date:'2026-10-01',checkout_date:'2026-10-03'};
const input={calendarId:330,native:[n],local:[local],mapping:map,distributors:[{idDistributor:17}],range:{fromDate:'2026-10-01',toDate:'2026-10-31'}};
const snapshot=structuredClone(input);let r=compareReservations(input);
assert.equal(r.counts.review,1,'date/room match is review only, never proven identity');assert.equal(r.counts.matched,0);assert.equal(r.can_cutover,false);assert.equal(r.coverage,'unverified');assert.deepEqual(input,snapshot,'comparison has no mutations');
r=compareReservations({...input,local:[local,{...local,id:'local-b'}]});assert.equal(r.counts.ambiguous,1);
r=compareReservations({...input,local:[{...local,room_id:'room-b'}]});assert.equal(r.counts.api_only,1);assert.equal(r.counts.local_only,1);
r=compareReservations({...input,mapping:[]});assert.equal(r.counts.quarantined,1);
r=compareReservations({...input,native:[n,{...n,rooms:[104,104]}]});assert.equal(r.counts.conflict,1);assert.equal(r.counts.quarantined,1);
r=compareReservations({...input,native:[n,n]});assert.equal(r.counts.unique,1);assert.equal(r.counts.duplicate,1);
r=compareReservations({...input,native:[{...n,distributor:999}]});assert.equal(r.counts.quarantined,1);
r=compareReservations({...input,native:[{...n,status:'D',rooms:[]}],localTruncated:true});assert.equal(r.counts.deleted,1);assert.equal(r.counts.local_only,1);assert.equal(r.local_truncated,true);
r=compareReservations({...input,local:[{...local,provider_identity:JSON.stringify([330,17,'0000123'])}]});assert.equal(r.counts.matched,1);
r=compareReservations({...input,native:[],local:[local]});assert.equal(r.counts.local_only,1,'missing source row never cancels a local row');assert.equal(local.status,'active');

// Actual action router: every new action shares owner/anonymous boundaries.
const env={IRESERVATION_ENABLED:'true',IRESERVATION_PARTNER_USERNAME:'fixture-partner',IRESERVATION_PARTNER_PASSWORD:'fixture-password',IRESERVATION_API_KEY:'fixture-api',IRESERVATION_ENC_KEY:Buffer.alloc(32,5).toString('base64')};
const owner='11111111-1111-4111-8111-111111111111',property='22222222-2222-4222-8222-222222222222';let actor=owner,anonymous=false,writes=0;
const handler=createConnectionHandler({env,transport:async()=>new Response(JSON.stringify({id:actor,is_anonymous:anonymous})),store:{async call(){if(actor!==owner)throw Object.assign(new Error(),{code:'forbidden'});return {version:'v1'};}},comparisonStore:{async call(){writes++;throw Error('must not reach comparison for invalid/unverified connection');}}});
async function route(action,headers={authorization:'Bearer fixture-jwt'}){const res={setHeader(){},status(s){this.statusCode=s;return this;},json(v){this.body=v;return this;}};await handler({method:'POST',query:{action},headers,body:{property_id:property,version:'v1'}},res);return res;}
for(const action of ['catalog','save_mapping','compare']){assert.equal((await route(action,{})).statusCode,401);anonymous=true;assert.equal((await route(action)).statusCode,401);anonymous=false;assert.equal((await route(action)).body.code,'connection_verification_required');}
assert.equal(writes,0);
console.log('PASS native reservation minimization/statuses, explicit inventory mapping, immutable comparison/quarantine/no missing-row cancellation, and new action authorization gates');

// Complete action -> real client -> minimal report -> final CAS path.
const { configuration, seal, connectionContext, IresError }=await import('../api/_ireservation-core.js');
const cfg=configuration(env), verifiedRow={property_id:property,owner_id:owner,calendar_id:330,version:'v1',verified_at:'2026-10-24T00:00:00Z'};
verifiedRow.secret=seal({propertyUsername:'fixture-user',propertyPassword:'fixture-secret'},connectionContext(verifiedRow,cfg),env);
let tokenState={version:'none'}, mappingState={version:'map1',mappings:map,local_rooms:localRooms}, finalConflict=false, savedReports=0;
const transport=async(url,options)=>{
 if(url.includes('/auth/v1/user'))return new Response(JSON.stringify({id:owner}));
 assert.equal(options.headers['x-api-key'],env.IRESERVATION_API_KEY);
 assert.ok(!url.endsWith('/save'),'no native writes');
 let result;
 if(url.endsWith('/v1/oauth2/authorizations'))result={code:0,result:{token:'fixture-access',refreshToken:'fixture-refresh',expiresIn:3600}};
 else if(url.endsWith('/rooms'))result={code:0,results:rooms};
 else if(url.endsWith('/distributors'))result={code:0,results:[{idDistributor:17,nameDistributor:'Fixture'}]};
 else if(url.endsWith('/reservations')){assert.deepEqual(JSON.parse(options.body).parameters,{calendarId:330,propertyUsername:'fixture-user',propertyPassword:'fixture-secret',fromDate:'2026-10-01',toDate:'2026-10-31'});result={code:0,results:{reservations:[raw]}};}
 else throw Error('unexpected endpoint');
 return new Response(JSON.stringify(result));
};
const positive=createConnectionHandler({env,transport,store:{async call(op,p){
 if(op==='connection_get')return structuredClone(verifiedRow);
 if(op==='reserve')return {allowed:true};if(op==='token_get')return tokenState;if(op==='token_claim')return {claimed:true};
 if(op==='token_finish'){tokenState={...p};return {saved:true};}throw Error(op);
}},comparisonStore:{async call(op,p){
 assert.equal(p.owner_id,owner);assert.equal(p.property_id,property);assert.equal(p.expected,'v1');
 if(op==='mapping_get')return structuredClone(mappingState);
 if(op==='mapping_save'){mappingState={...mappingState,version:p.version,mappings:p.mappings};return structuredClone(mappingState);}
 if(op==='comparison_context')return {mappings:map,local:[local]};
 if(op==='comparison_save'){if(finalConflict)throw new IresError('connection_changed',409);savedReports++;assert.equal(p.report.can_cutover,false);assert.equal(JSON.stringify(p.report).includes('private@'),false);return {report:p.report};}throw Error(op);
}}});
async function positiveRoute(action,extra={}){const res={setHeader(){},status(s){this.statusCode=s;return this;},json(v){this.body=v;return this;}};await positive({method:'POST',query:{action},headers:{authorization:'Bearer fixture'},body:{property_id:property,version:'v1',mapping_version:mappingState.version,...extra}},res);return res;}
assert.equal((await positiveRoute('catalog')).body.provider_rooms.length,3);
assert.equal((await positiveRoute('save_mapping',{mappings:map})).statusCode,200);
let result=await positiveRoute('compare',{fromDate:'2026-10-01',toDate:'2026-10-31'});assert.equal(result.statusCode,200);assert.equal(result.body.report.counts.review,1);assert.equal(savedReports,1);
finalConflict=true;result=await positiveRoute('compare',{fromDate:'2026-10-01',toDate:'2026-10-31'});assert.equal(result.statusCode,409);assert.equal(savedReports,1,'stale final stamp never saves');
assert.deepEqual(local,snapshot.local[0]);
console.log('PASS action/client/provider schema integration, masked saved report and final race fencing');
