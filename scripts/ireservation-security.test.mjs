import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { configuration, seal, unseal, connectionContext, createReadClient, IresError, safeError } from '../api/_ireservation-core.js';
import { createConnectionHandler } from '../api/_ireservation.js';
import { createStore } from '../api/_ireservation-store.js';
const env = { IRESERVATION_ENABLED:'true', IRESERVATION_PARTNER_USERNAME:'fixture-partner-user',
  IRESERVATION_PARTNER_PASSWORD:'fixture-partner-password',IRESERVATION_API_KEY:'fixture-key',
  IRESERVATION_ENC_KEY:randomBytes(32).toString('base64') };
const cfg = configuration(env);
for (const changes of [{IRESERVATION_ENABLED:'false'},{IRESERVATION_API_KEY:''},{IRESERVATION_ENC_KEY:'bad'},
  {IRESERVATION_BASE_URL:'https://attacker.invalid'}, {IRESERVATION_RATE_PER_SECOND:'6'}, {IRESERVATION_DAILY_BUDGET:'5001'},
  {VERCEL_ENV:'preview'},{APP_ENV:'demo'},{APP_ENV:'typo'}]) assert.throws(()=>configuration({...env,...changes}));
const owner='11111111-1111-4111-8111-111111111111', property='22222222-2222-4222-8222-222222222222';
const other='33333333-3333-4333-8333-333333333333';
const row={property_id:property,owner_id:owner,calendar_id:330,version:'fixture-version'};
const creds={propertyUsername:'fixture-property-user',propertyPassword:' fixture-password with whitespace '};
row.secret=seal(creds,connectionContext(row,cfg),env);
assert.deepEqual(unseal(row.secret,connectionContext(row,cfg),env),creds);
assert.notEqual(seal(creds,connectionContext(row,cfg),env).nonce,row.secret.nonce);
for (const k of ['environment','ownerId','propertyId','calendarId','kind','version']) assert.throws(()=>unseal(row.secret,{...connectionContext(row,cfg),[k]:'different'},env));
assert.throws(()=>unseal({...row.secret,data:Buffer.from('tampered').toString('base64')},connectionContext(row,cfg),env));
const env2={...env,IRESERVATION_ENC_KEY_ID:'v2',IRESERVATION_ENC_KEY_V2:randomBytes(32).toString('base64')};
assert.deepEqual(unseal(row.secret,connectionContext(row,cfg),env2),creds,'rotation reads v1');
assert.equal(seal(creds,connectionContext(row,cfg),env2).keyId,'v2');
const changedKey=configuration({...env,IRESERVATION_API_KEY:'fixture-rotated-key'});
assert.equal(changedKey.scope,cfg.scope,'rotation cannot reset quota');assert.notEqual(changedKey.authScope,cfg.authScope);

// Behavioral fixture implementing the durable store contract; SQL is independently
// exercised by scripts/ireservation-state-probe.sql, not inferred from this fake.
function memoryStore() {
 const tokens=new Map(), connections=new Map([[property,structuredClone(row)],[other,{...structuredClone(row),property_id:other,owner_id:other}]]);
 const calls=[];let allowed=true;
 return {tokens,connections,calls,setAllowed:v=>allowed=v, async call(op,p) {
  calls.push({op,p});
  if(op.startsWith('connection_')) {
   const r=connections.get(p.property_id);
   if(r && r.owner_id!==p.owner_id) throw new IresError('property_forbidden',403);
   if(!r && p.owner_id!==owner) throw new IresError('property_forbidden',403);
   if(op==='connection_get')return structuredClone(r||{});
   if((r?.version||'none')!==p.expected)throw new IresError('connection_changed',409);
   if(op==='connection_save')connections.set(p.property_id,{...p,verified_at:null,last_error:null});
   if(op==='connection_disconnect'){r.secret=null;r.version=p.version;}
   if(op==='connection_verify'){r.last_error=p.error;r.verified_at=p.error?null:new Date().toISOString();}
   return structuredClone(connections.get(p.property_id)||{});
  }
  if(op==='reserve')return {allowed,reason:allowed?null:'quota'};
  if(op==='pause')return {paused:true};
  let s=tokens.get(p.scope); if(!s){s={version:'none'};tokens.set(p.scope,s);}
  if(op==='token_get')return structuredClone(s);
  if(op==='token_claim'){if(s.lease||s.version!==p.version)return {claimed:false};s.lease=p.lease;return {claimed:true};}
  if(op==='token_finish'){if(s.lease!==p.lease||s.version!==p.previous)return {saved:false};Object.assign(s,p,{lease:null});return {saved:true};}
  if(op==='token_fail'){if(s.lease===p.lease){s.lease=null;s.auth_blocked=p.blocked;}return {released:true};}
  throw Error(op);
 }};
}
const response=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
function provider({refreshOmitted=false,refresh401=false,failRoom=null,authMalformed=false}={}) {
 const calls=[]; let auth=0,rooms=0;
 return {calls,async fetch(url,options){calls.push({url,options});
  assert.equal(options.redirect,'error'); assert.equal(options.headers['x-api-key'],env.IRESERVATION_API_KEY);
  if(url.endsWith('/v1/oauth2/authorizations')){
   auth++; const body=JSON.parse(options.body);
   if(body.refreshToken&&refresh401)return response({code:401,message:'fixture-sensitive-upstream-text'},401);
   if(authMalformed)return response({code:0,result:{expiresIn:1,token:null}});
   await new Promise(r=>setTimeout(r,2));
   return response({code:0,result:{token:'fixture-token-'+auth,expiresIn:3600,...(auth===1||!refreshOmitted?{refreshToken:'fixture-refresh-'+auth}:{})}});
  }
  if(url.endsWith('/rooms')) {rooms++;if(rooms===1&&failRoom)return failRoom;
   assert.match(options.headers.Authorization,/^Bearer fixture-token-/);
   assert.deepEqual(JSON.parse(options.body).parameters,{calendarId:330,...creds});
   return response({code:0,results:[{id:104,type:'room',name:'Fixture room',extra:'discard'}]});
  }
  if(url.endsWith('/distributors'))return response({code:0,results:[{idDistributor:17,nameDistributor:'Fixture channel',extra:'discard'}]});
  throw Error('unexpected endpoint');
 }};
}
const s=memoryStore(), p=provider();
const clients=Array.from({length:8},()=>createReadClient({store:s,env,transport:p.fetch,sleep:ms=>new Promise(r=>setTimeout(r,ms/10))}));
const all=await Promise.all(clients.map(c=>c.rooms(row)));
assert.equal(p.calls.filter(c=>c.url.endsWith('/v1/oauth2/authorizations')).length,1,'one auth across independent worker clients');
assert.ok(all.every(r=>r.length===1&&Object.keys(r[0]).length===3));
assert.equal(s.calls.filter(c=>c.op==='reserve').length,9,'auth plus each data call budgeted');
assert.equal((await clients[0].distributors()).length,1);
// Refresh has no password, preserves omitted refresh token, and is retried once.
const refreshStore=memoryStore(), rp=provider({refreshOmitted:true,failRoom:response({code:401},401)});
const rc=createReadClient({store:refreshStore,env,transport:rp.fetch});await rc.rooms(row);
const refreshCalls=rp.calls.filter(x=>x.url.endsWith('/v1/oauth2/authorizations'));
assert.deepEqual(JSON.parse(refreshCalls[1].options.body),{refreshToken:'fixture-refresh-1'});
// Expired token forces refresh without an unauthorized data read.
refreshStore.tokens.get(cfg.authScope).expires_at=new Date(0).toISOString();
await rc.rooms(row);
assert.deepEqual(JSON.parse(rp.calls.filter(x=>x.url.endsWith('/v1/oauth2/authorizations'))[2].options.body),{refreshToken:'fixture-refresh-1'});
const saved=refreshStore.tokens.get(cfg.authScope);
const tc={environment:cfg.environment,ownerId:'partner',propertyId:cfg.authScope,calendarId:'partner',kind:'token',version:saved.version};
assert.equal(unseal(saved.secret,tc,env).refreshToken,'fixture-refresh-1');
const blockedStore=memoryStore(), bp=provider({refresh401:true,failRoom:response({code:401},401)});
const bc=createReadClient({store:blockedStore,env,transport:bp.fetch});
await assert.rejects(bc.rooms(row),e=>e.code==='provider_unauthorized');
const count=bp.calls.length;await assert.rejects(bc.rooms(row),e=>e.code==='partner_auth_blocked');assert.equal(bp.calls.length,count,'blocked auth does not loop');
for(const [failure,code] of [[response({code:429},429,{'retry-after':'9'}),'quota_paused'],[response({code:77,message:'fixture-sensitive-upstream-text'}),'provider_rejected'],[response({code:500},500),'provider_unavailable'],[response('bad json'),'provider_response_invalid'],[response({code:0,results:null}),'provider_response_invalid'],[response({code:401},401),'success_after_refresh']]) {
 const st=memoryStore(),pr=provider({failRoom:failure});const c=createReadClient({store:st,env,transport:pr.fetch});
 if(code==='success_after_refresh')await c.rooms(row);else await assert.rejects(c.rooms(row),e=>e.code===code&&!JSON.stringify(safeError(e)).includes('sensitive'));
 if(code==='quota_paused')assert.equal(st.calls.find(x=>x.op==='pause').p.seconds,9);
}
const quota=memoryStore();quota.setAllowed(false);let calls=0;
await assert.rejects(createReadClient({store:quota,env,transport:async()=>{calls++;}}).rooms(row),e=>e.code==='quota_paused');assert.equal(calls,0);
await assert.rejects(createReadClient({store:memoryStore(),env,transport:async()=>{throw new Error('fixture-secret-transport');}}).rooms(row),e=>e.code==='provider_unreachable'&&!String(e).includes('transport'));
await assert.rejects(createReadClient({store:memoryStore(),env,transport:provider({authMalformed:true}).fetch}).rooms(row),e=>e.code==='provider_response_invalid');

// Actual route, fictional JWT validation and store. Every action shares the same
// authorization boundary; browser responses never include encrypted/clear secrets.
const routeStore=memoryStore();let actor=owner,anon=false;
const routeTransport=async(url,options)=>url.endsWith('/auth/v1/user')?response({id:actor,is_anonymous:anon}):p.fetch(url,options);
const handler=createConnectionHandler({env,store:routeStore,transport:routeTransport});
async function route(action,body={},headers={authorization:'Bearer fixture-session'}) {
 const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},end(){return this;}};
 await handler({method:'POST',query:{action},headers,body:{property_id:property,...body}},res);
 const text=JSON.stringify(res.body);for(const v of [creds.propertyPassword,row.secret.data,env.IRESERVATION_API_KEY,env.IRESERVATION_PARTNER_PASSWORD])assert.equal(text.includes(v),false);
 return res;
}
assert.equal((await route('status')).body.configured,true);
for(const action of ['status','save','verify','disconnect']){
 assert.equal((await route(action,{},{})).statusCode,401);
 actor=other;assert.equal((await route(action)).statusCode,403);actor=owner;
 anon=true;assert.equal((await route(action)).statusCode,401);anon=false;
}
assert.equal((await route('save',{version:'wrong'})).statusCode,409);
assert.equal((await route('status',{}, {authorization:'Bearer fixture-session',origin:'https://attacker.invalid'})).statusCode,403);
assert.equal((await route('save',{version:row.version,calendar_id:330,propertyUsername:'fixture-renamed',propertyPassword:''})).statusCode,200);
let current=routeStore.connections.get(property);
assert.equal(unseal(current.secret,connectionContext(current,cfg),env).propertyPassword,creds.propertyPassword,'blank retains password');
assert.equal((await route('save',{version:current.version,calendar_id:331,propertyUsername:'fixture-renamed',propertyPassword:''})).statusCode,400,'calendar change requires new secret');
assert.equal((await route('disconnect',{version:current.version})).body.configured,false);
assert.equal((await route('verify',{version:routeStore.connections.get(property).version})).statusCode,400);
// The actual deployed router returns a closed gate with no setup by default.
const deployed=(await import('../api/ical-sync.js')).default;
const closed={setHeader(){},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
await deployed({method:'POST',query:{integration:'ireservation',action:'status'},headers:{},body:{property_id:property}},closed);
assert.equal(closed.body.code,'integration_disabled');
assert.deepEqual(safeError(new Error('fixture-secret-error')),{code:'integration_unavailable',status:503});
await assert.rejects(createStore({url:'https://example.invalid',serviceKey:'fixture-service',transport:async()=>response('fixture-secret-db-body',500)}).call('token_get',{}),e=>e.code==='storage_unavailable'&&!String(e).includes('secret'));
console.log('PASS iReservation crypto/AAD/key rotation, config gates, worker auth/refresh, budgets, response/error redaction, tenant/anonymous denial and connection lifecycle; all transport fictional.');
