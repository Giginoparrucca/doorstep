import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
process.env.GUEST_TOKEN_SECRET=createHash('sha256').update('round65-fictional-keybox-tests').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service-key';
const {signGuestToken}=await import('../api/_guest-token.js');
const {default:handler}=await import('../api/guest.js');
const property='11111111-1111-4111-8111-111111111111',booking='SYNTHETIC-BOOKING';
let scenario,requests,checks=0;
global.fetch=async(url,opts={})=>{
  const u=new URL(url);requests.push(u);
  assert.equal(opts.headers.apikey,'fictional-service-key');
  const table=u.pathname.split('/').pop();
  assert.equal(u.searchParams.get(table==='properties'?'id':'property_id'),'eq.'+property);
  if(table!=='properties')assert.equal(u.searchParams.get('booking_code'),'eq.'+booking);
  if(table==='properties')return {ok:!scenario.propertyError,json:async()=>scenario.deleted?[]:[{id:property,
    rotating_lockbox_enabled:!scenario.disabled,show_rotating_lockbox_to_guest:!scenario.hidden}]};
  assert.equal(u.searchParams.get('is_test'),'eq.'+(scenario.test?'true':'false'));
  if(table==='checkins')return {ok:!scenario.checkinError,json:async()=>scenario.incomplete?[]:[{id:'synthetic-checkin'}]};
  assert.equal(table,'ota_reservations');assert.equal(u.searchParams.get('status'),'eq.active');
  assert.equal(u.searchParams.get('entry_type'),'eq.reservation');assert.equal(u.searchParams.get('deleted_at'),'is.null');
  return {ok:!scenario.reservationError,json:async()=>scenario.ambiguous?[{keybox_code:'NEVER-A'},{keybox_code:'NEVER-B'}]
    :scenario.cancelled?[]:[{keybox_code:'FICTIONAL-CODE'}]};
};
async function run(extra={},auth=true,b=booking){
  scenario=extra;requests=[];
  const signed=signGuestToken({p:property,s:'synthetic-session',b,t:extra.test===true});
  const res={statusCode:200,headers:{},status(s){this.statusCode=s;return this},json(body){this.body=body;return this},
    end(){return this},setHeader(k,v){this.headers[k]=v}};
  await handler({method:'POST',headers:{origin:'https://app.welcomebnb.it',authorization:auth?'Bearer '+signed.token:''},
    body:{action:'keybox',property_id:'forged',booking_code:'FORGED',is_test:!extra.test}},res);
  checks++;return res;
}
let res=await run();assert.equal(res.body.code,'FICTIONAL-CODE');assert.equal(res.headers['Cache-Control'],'private, no-store');
assert.equal((await run({test:true})).body.code,'FICTIONAL-CODE');
assert.equal((await run({},false)).statusCode,401);
assert.equal((await run({},true,null)).body.code,null);assert.equal(requests.length,0);
for(const extra of [{incomplete:true},{disabled:true},{hidden:true},{checkinError:true},{cancelled:true}]){
  res=await run(extra);assert.equal(res.body.code,null);assert.ok(!JSON.stringify(res.body).includes('FICTIONAL-CODE'));
}
for(const extra of [{propertyError:true},{reservationError:true},{ambiguous:true}]){
  res=await run(extra);assert.equal(res.statusCode,503);assert.equal(res.body.code,undefined);assert.ok(!JSON.stringify(res.body).includes('NEVER'));
}
assert.equal((await run({deleted:true})).statusCode,404);
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(!/sb\.rpc\(['"]get_reservation_keybox/.test(html));
const start=html.indexOf('async function fetchReservationKeybox(');
const client=html.slice(start,html.indexOf('\n}\n',start)+2);
let delegated=0;
const ctx=vm.createContext({_entryRefresh:{refresh:async()=>{delegated++;return true;}}});
vm.runInContext(client,ctx);
assert.equal(await ctx.fetchReservationKeybox(),true);assert.equal(delegated,1);checks++;
console.log(`PASS ${checks} actual keybox gateway/client auth, tenant/test, visibility, error and stale-response cases; no real codes used.`);
