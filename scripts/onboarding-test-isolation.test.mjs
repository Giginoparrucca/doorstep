import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('host-console.html');
function fn(name, src=source) {
  const start=src.indexOf('function '+name+'(');
  assert.ok(start>=0,name);
  let end=src.indexOf('\n}',start);
  while(end>=0) { const candidate=src.slice(start,end+2); try { new vm.Script(candidate); return candidate; } catch {} end=src.indexOf('\n}',end+2); }
  throw new Error('Cannot extract '+name);
}
const day=new Date().toISOString().slice(0,10);
const next=new Date(Date.now()+86400000).toISOString().slice(0,10);
const base={ name:'NORMAL',surname:'SURVIVES',id:'51111111-1111-4111-8111-111111111111',is_test:false,guest_type:'single',booking_code:'NORMAL',arrival_date:day,departure_date:next,nights:1,date_of_birth:'1980-01-01',birth_country:'France',citizenship:'France',birth_province:'EE',document_type:'passport',document_number:'FACSIMILE123',submitted_at:new Date().toISOString() };
const test={...base,is_test:true,name:'TESTMUSTNOTLEAK',id:'52222222-2222-4222-8222-222222222222',booking_code:'TESTMUSTNOTLEAK'};
let downloads=[];
const context=vm.createContext({console,Date,Map,Set,allCheckins:[base,test],hostLang:'it',propertyData:{name:'Fixture',city:'Ostuni',cir_code:'FACSIMILE',ross1000_codice:'FACSIMILE',tax_rate_eur:1.5},
  downloadFile:(name,text)=>downloads.push({name,text}),track:()=>{},toast:()=>{},alert:()=>{},confirm:()=>true,
  prompt:(label)=>label.includes('Mese')?day.slice(0,7):day.slice(0,4)+'-'+(Math.floor((new Date().getMonth())/3)+1),
  document:{getElementById:()=>({value:''}),body:{appendChild:()=>{}}},
  escHtml:s=>String(s),_isValidPastDOB:()=>true,lookupStateCode:()=> '100000219',lookupDocCode:()=> 'PASOR',lookupPoliceCode:()=> '',
  sanitizeAllogName:s=>s,isItalianCitizenshipCode:()=>false,GUEST_TYPE_CODES:{single:'16'},
  buildBatch:rows=>({lines:rows.map(c=>c.name),warnings:[],rowMeta:[],groupCount:rows.length}),
  _ross1000Idswh:c=>c.id,_xmlEsc:s=>s,_ymd:s=>s?.replaceAll('-',''),_ross1000Arrivo:c=>c.name,
  _ruleLabel:()=>null, _groupSizeFor:()=>1,
  _normalizeTaxCfg:()=>({baseRate:1.5,cap:null,basis:'per_stay',rules:[],declared:[]}),_nightsInsideQuarter:()=>1,
  computeGuestTax:c=>({guest:c.name,nights_in_period:1,taxable_nights:1,over_cap_nights:0,rule_exempt_nights:0,amount:1.5,requires_documentation:false}),
});
for(const name of ['_prepareAlloggiatiExport','exportAlloggiati','exportCSV','exportISTAT','exportRoss1000','exportCityTax','exportPayTourist']) vm.runInContext(fn(name),context);
for(const name of ['exportAlloggiati','exportCSV','exportISTAT','exportRoss1000','exportCityTax','exportPayTourist']) {
  const before=downloads.length;
  try { context[name](); } catch(e) { throw new Error(name+': '+e.message); }
  assert.equal(downloads.length,before+1,name+' downloads');
  assert.ok(!downloads.at(-1).text.includes('TESTMUSTNOTLEAK'),name+' excludes tests');
  console.log('PASS actual '+name+' with a mixed real/test cache');
}
// Execute the real API guard before credentials/transport; even a mixed batch
// must fail before SOAP and before writing any filing log.
const api=read('api/alloggiati.js');
const send=api.slice(api.indexOf("  if (action === 'send')"),api.indexOf('    // ── Load and decrypt credentials',api.indexOf("  if (action === 'send')")));
let credentialOrSoapCalls=0;
const guard=vm.createContext({action:'send',body:{rows:[{line:'x',checkin_ids:[test.id]}]},propertyId:'property',SERVICE_KEY:'stub',SUPABASE_URL:'https://stub.invalid',console,
  fetch:async url=> {assert.match(url,/select=id,property_id,is_test,deleted_at/);return {ok:true,json:async()=>[{id:test.id,property_id:'property',is_test:true}]};},
  res:{status(n){this.code=n;return this;},json(b){this.body=b;return b;}},
});
vm.runInContext('async function probe(){'+send+'}\n}',guard);
await guard.probe(); assert.equal(guard.res.code,400); assert.equal(guard.res.body.error_code,'test_checkin_excluded');
guard.body.rows=[{line:'x',checkin_ids:[base.id]}]; guard.fetch=async()=>({ok:true,json:async()=>[{id:base.id,property_id:'property',is_test:false}]});
guard.res.code=undefined; await guard.probe(); assert.equal(guard.res.code,undefined,'real row passes guard');
console.log('PASS manual send rejects test IDs and accepts normal IDs before credential/SOAP work');
// The official host reads/booking feeds/reminders include server query filters.
assert.match(read('api/send-arrival-reminders.js'),/entry_type=eq.reservation&status=eq.active&is_test=eq.false/);
assert.match(read('api/ical-sync.js'),/status=eq.active&is_test=eq.false/);
assert.match(source,/Object.defineProperties\(window/);
assert.match(read('api/guest-token.js'),/if \(rows\[0\]\?\.is_test === true\) t = true/);
assert.match(read('api/alloggiati.js'),/const cleanup = await runTestCleanup\(false\)/);
assert.match(read('host-onboarding.js'),/ignoreDuplicates: true/);
for(const key of ['obx_test_delete','obx_test_open','obx_test_hint','obx_test_error','obx_test_confirm']) assert.equal((source.match(new RegExp(key+':','g'))||[]).length,2);
// Parse every inline script; catches syntax regressions in large vanilla files.
for(const file of ['index.html','host-console.html','admin.html']) for(const script of read(file).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) if(script[1].trim()) new vm.Script(script[1],{filename:file});
console.log('PASS query filters, authoritative test minting, scheduler reuse, i18n and inline syntax');

const {mintWalkinCode} = await import('../api/_booking-code.js');
assert.match(mintWalkinCode(true),/^WB-TEST[0-9A-HJKMNP-TV-Z]{4}$/);
for(let i=0;i<100;i++) assert.ok(!mintWalkinCode().startsWith('WB-TEST'));
assert.match(read('api/guest-token.js'),/Test booking expired/);
console.log('PASS reserved test prefix and expired-link rejection');

assert.match(read('index.html'),/banner.style.top = demoHeight/);
for (const key of ['test_banner_title','test_banner_hint','test_banner_exit']) assert.equal((read('index.html').match(new RegExp(key+':','g'))||[]).length,2);
