import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {supabaseAuthHeaders} from '../api/_supabase-auth.js';
import {createStore} from '../api/_ireservation-store.js';
import {collectReceipts} from '../api/_alloggiati-receipts.js';
const secret='sb_secret_SYNTHETIC_NO_REAL_CREDENTIAL_12345';
const legacy='synthetic.legacy.jwt';
const user='synthetic.user.jwt';
assert.deepEqual(supabaseAuthHeaders(secret),{apikey:secret});
assert.deepEqual(supabaseAuthHeaders('sb_publishable_SYNTHETIC'),{apikey:'sb_publishable_SYNTHETIC'});
assert.deepEqual(supabaseAuthHeaders(legacy),{apikey:legacy,Authorization:'Bearer '+legacy});
assert.deepEqual(supabaseAuthHeaders(secret,user),{apikey:secret,Authorization:'Bearer '+user});
assert.deepEqual(supabaseAuthHeaders('sb_publishable_SYNTHETIC',user),{apikey:'sb_publishable_SYNTHETIC',Authorization:'Bearer '+user});
process.env.GUEST_TOKEN_SECRET=createHash('sha256').update('synthetic-key-format-test').digest('hex');
const {signGuestToken}=await import('../api/_guest-token.js');
const property='11111111-1111-4111-8111-111111111111';
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(s){this.statusCode=s;return this},json(body){this.body=body;return this},end(){return this}});
for(const key of [legacy,secret]) {
 const expected=supabaseAuthHeaders(key);
 let storeCalls=0;
 await createStore({url:'https://synthetic.invalid',serviceKey:key,transport:async(url,init)=>{
  storeCalls++;assert.equal(url,'https://synthetic.invalid/rest/v1/rpc/ireservation_state');
  for(const h of ['apikey','Authorization'])assert.equal(init.headers[h],expected[h]);
  return {ok:true,json:async()=>({ok:true})};
 }}).call('synthetic_read',{});
 assert.equal(storeCalls,1);
 let receiptCalls=0;
 await collectReceipts({}, {key,url:'https://synthetic.invalid',gate(){},fetch:async(url,init)=>{
  receiptCalls++;for(const h of ['apikey','Authorization'])assert.equal(init.headers[h],expected[h]);
  return {ok:true,json:async()=>[]};
 }});
 assert.ok(receiptCalls>0);
 process.env.SUPABASE_SERVICE_ROLE_KEY=key;
 const {default:guest}=await import('../api/guest.js?key-format='+encodeURIComponent(key));
 let calls=0;
 global.fetch=async(url,init)=>{
  calls++;for(const h of ['apikey','Authorization'])assert.equal(init.headers[h],expected[h]);
  const u=new URL(url),table=u.pathname.split('/').pop();
  if(table==='properties')return {ok:true,json:async()=>[{id:property,rotating_lockbox_enabled:true,show_rotating_lockbox_to_guest:true}]};
  assert.equal(u.searchParams.get('property_id'),'eq.'+property);
  assert.equal(u.searchParams.get('booking_code'),'eq.SYNTHETIC');
  return {ok:true,json:async()=>table==='checkins'?[{id:'synthetic-checkin'}]:[{keybox_code:'SYNTHETIC-CODE'}]};
 };
 const token=signGuestToken({p:property,s:'synthetic',b:'SYNTHETIC',t:false}).token;
 const req={method:'POST',headers:{origin:'https://app.welcomebnb.it',authorization:'Bearer '+token},body:{action:'keybox',property_id:'FORGED',booking_code:'FORGED'}};
 const res=response();await guest(req,res);assert.equal(res.body.code,'SYNTHETIC-CODE');assert.ok(calls>=3);
 calls=0;await guest({...req,headers:{origin:req.headers.origin}},response());assert.equal(calls,0,'API-key change must not bypass guest authorization');
 const {default:push}=await import('../api/push-config.js?key-format='+encodeURIComponent(key));
 let userCalls=0,serviceCalls=0;
 global.fetch=async(url,init)=>{
  const u=new URL(url);
  if(u.pathname==='/auth/v1/user'){userCalls++;assert.equal(init.headers.Authorization,'Bearer '+user);assert.notEqual(init.headers.apikey,key);return {ok:true,json:async()=>({id:property})};}
  serviceCalls++;for(const h of ['apikey','Authorization'])assert.equal(init.headers[h],expected[h]);
  return {ok:true,json:async()=>Array(20).fill({id:'synthetic'})};
 };
 const limited=response();await push({method:'POST',query:{action:'test'},headers:{origin:'https://app.welcomebnb.it',authorization:'Bearer '+user}},limited);
 assert.equal(limited.statusCode,429);assert.equal(userCalls,1);assert.equal(serviceCalls,1);
}
console.log('PASS legacy/opaque keys across real guest gateway, authenticated host path, private RPC store and receipt collector; user JWTs and tenant/guest authorization preserved; synthetic transports only');
