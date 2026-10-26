import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GUEST_TOKEN_SECRET='round65-fictional-consent-secret';
process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service';
const {signGuestToken}=await import('../api/_guest-token.js');
const {default:handler}=await import('../api/guest.js');
let failure=null,calls=0;const property='11111111-1111-4111-8111-111111111111';
global.fetch=async(url,opts)=>{
 calls++;assert.ok(url.endsWith('/rpc/save_guest_marketing_consent'));assert.equal(opts.method,'POST');
 const body=JSON.parse(opts.body);assert.deepEqual(Object.keys(body).sort(),['p_booking_code','p_consent','p_email','p_phone','p_property_id']);
 assert.equal(body.p_property_id,property);assert.equal(body.p_booking_code,'SYNTHETIC');assert.equal(body.p_consent,true);
 return {ok:!failure,json:async()=>failure?{code:failure,message:'PRIVATE database detail'}:{ok:true,duplicate:false}};
};
async function request(extra={},options={}){
 const {token}=signGuestToken({p:property,s:'synthetic-session',b:options.noBooking?null:'SYNTHETIC',t:options.test});
 const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(v){this.statusCode=v;return this},json(v){this.body=v;return this},end(){return this}};
 await handler({method:'POST',headers:{origin:'https://app.welcomebnb.it',authorization:options.anon?'':'Bearer '+token},
  body:{action:'consent_save',email:'guest@example.invalid',consent:true,guest_name:'FORGED',consent_text_version:'FORGED',created_at:'FORGED',...extra}},res);
 return res;
}
assert.equal((await request()).statusCode,200);
assert.equal((await request({email:null,phone:'+39 123 456 789'})).statusCode,200);
assert.equal((await request()).headers['Cache-Control'],'private, no-store');
for(const extra of [{consent:false},{consent:'true'},{email:null},{email:'bad'},{phone:'bad'},{email:'x'.repeat(255)}]){
 const before=calls;assert.equal((await request(extra)).statusCode,400);assert.equal(calls,before);
}
assert.equal((await request({}, {noBooking:true})).statusCode,400);
assert.equal((await request({}, {anon:true})).statusCode,401);
const before=calls;assert.equal((await request({}, {test:true})).body.skipped,true);assert.equal(calls,before);
for(const [code,status] of [['P0001',429],['42501',403],['22023',400],['XX000',503]]){
 failure=code;const res=await request();assert.equal(res.statusCode,status);assert.ok(!JSON.stringify(res.body).includes('PRIVATE'));
 if(status===429)assert.equal(res.headers['Retry-After'],'3600');
}
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.ok(!/sb\.from\(['"]marketing_consents['"]\)\.insert/.test(html));
assert.ok(html.includes("_guestCall('consent_save'"));
console.log('PASS consent gateway: signed scope, explicit boolean consent, contact validation, no test/anonymous writes, field whitelist, rate/error folding and closed direct-browser path.');
