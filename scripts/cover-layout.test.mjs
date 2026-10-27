import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const helper=fs.readFileSync(new URL('../lib/cover-layout.js',import.meta.url),'utf8');const ctx=vm.createContext({});vm.runInContext(helper,ctx);const layout=ctx.CoverLayout;
for(const value of [null,undefined,{},'invalid',{zoom:'2',x:'9',y:NaN},{zoom:Infinity,x:null,y:{}}])assert.equal(JSON.stringify(layout.normalize(value)),JSON.stringify({zoom:1,x:50,y:50}));
assert.equal(JSON.stringify(layout.normalize({zoom:99,x:-3,y:300})),JSON.stringify({zoom:3,x:0,y:100}));
const image={style:{}};layout.apply(image,{zoom:2,x:25,y:75});assert.deepEqual(image.style,{objectPosition:'25% 75%',transformOrigin:'25% 75%',transform:'scale(2)'});layout.apply(image,null);assert.equal(image.style.transform,'scale(1)');
// Execute actual gateway projection: framing is public, private fields stay out.
const api=fs.readFileSync(new URL('../api/guest.js',import.meta.url),'utf8');
const fields=api.match(/const PROPERTY_PUBLIC_FIELDS = (\[[\s\S]*?\]);/)[1],gated=api.match(/const PROPERTY_POST_CHECKIN_FIELDS = new Set\((\[[\s\S]*?\])\)/)[1];
let checked=false,status,response;
// Round 60 Phase 4 adds a resolveGuestRoom call inside doProperty.
// This test doesn't care about room resolution (it's about the public-
// fields projection + framing), so stub it as a no-op.
// Round 66 Phase 1b (part 2) replaced bookingHasCheckin with entryReleaseAllows
// inside doProperty. For the OFF-path (every property today) they are
// equivalent; this stub returns the same `checked` boolean the old test used.
const gateway=vm.createContext({encodeURIComponent,PROPERTY_PUBLIC_FIELDS:vm.runInNewContext(fields),PROPERTY_POST_CHECKIN_FIELDS:new Set(vm.runInNewContext(gated)),pgrestGET:async url=>{assert.ok(url.startsWith('properties?id=eq.fixture'));return {ok:true,json:async()=>[{id:'fixture',hero_image_url:'https://example.invalid/image.jpg',hero_image_layout:{zoom:2,x:25,y:75},wifi_password:'secret',host_email:'private',owner_id:'private'}]};},bookingHasCheckin:async()=>checked,entryReleaseAllows:async()=>checked,resolveGuestRoom:async()=>null,Number:{isFinite:Number.isFinite},Date});
let a=api.indexOf('async function doProperty(');vm.runInContext(api.slice(a,api.indexOf('\n}\n',a)+2),gateway);
const res={status(v){status=v;return this;},json(v){response=v;return v;}};await gateway.doProperty(res,'fixture',null,false);assert.equal(status,200);assert.equal(response.property.hero_image_layout.zoom,2);assert.ok(!('owner_id' in response.property));assert.ok(!('host_email' in response.property));assert.ok(!('wifi_password' in response.property));checked=true;await gateway.doProperty(res,'fixture','booking',false);assert.equal(response.property.wifi_password,'secret');
const guest=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');assert.equal((guest.match(/CoverLayout\.apply\(el\('heroImg'\), (propData|d)\.hero_image_layout\)/g)||[]).length,2);
console.log('PASS framing bounds/defaults/transform/reset, actual guest gateway projection and retained private/check-in gates; both guest image paths apply layout');
