// Execute the actual mint function; stale mint responses cannot change the token scope.
import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function mintGuestToken('),end=html.indexOf('\n}\n',start)+2;
let pending=[],calls=[];const cache=new Map();
const ctx=vm.createContext({Date,JSON,console,propertyId:'P-A',bookingCode:'BOOK-A',IS_TEST_SESSION:false,
 _guestToken:null,_guestTokenScope:null,_guestSessionId:'fictional-session',_WBNB_TOKEN_KEY:'token',_mintInFlight:null,_mintScope:null,
 sessionStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v)},setupTestModeBanner(){},
 fetch:async(url,o)=>{calls.push(JSON.parse(o.body));return new Promise(resolve=>pending.push(body=>resolve({ok:true,json:async()=>body})));}});
vm.runInContext("function _guestScopeKey(){return JSON.stringify([propertyId,bookingCode,IS_TEST_SESSION]);}\n"+html.slice(start,end),ctx);
const a=ctx.mintGuestToken(true),same=ctx.mintGuestToken(true);assert.equal(calls.length,1);
ctx.bookingCode='BOOK-B';const b=ctx.mintGuestToken(true);assert.equal(calls.length,2);
pending[1]({token:'TOKEN-B',expires_at:'2099-01-01T00:00:00Z'});assert.equal(await b,'TOKEN-B');
pending[0]({token:'TOKEN-A-STALE',expires_at:'2099-01-01T00:00:00Z'});assert.equal(await a,null);assert.equal(await same,null);
assert.equal(ctx._guestToken,'TOKEN-B');assert.ok(!cache.get('token').includes('TOKEN-A-STALE'));
ctx.IS_TEST_SESSION=true;const test=ctx.mintGuestToken();assert.equal(calls.length,3);assert.equal(calls[2].is_test,true);
pending[2]({token:'TOKEN-TEST',expires_at:'2099-01-01T00:00:00Z'});await test;
assert.equal(await ctx.mintGuestToken(),'TOKEN-TEST');assert.equal(calls.length,3);
console.log('PASS actual token mint: same-scope collapse, changed-booking/test remint, out-of-order response fence and scoped cache reuse.');
