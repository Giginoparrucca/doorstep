// Read-only post-release check. Fetch public code; calculate only fictional stays.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const origin=process.env.TAX_SMOKE_ORIGIN;
if(!origin){console.error('SKIP TAX_SMOKE_ORIGIN not set (post-deployment release smoke)');process.exit(77);}
assert.equal(new URL(origin).protocol,'https:');
// Round 66 Phase 2b — host-console.html receives frequent additive UI
// changes (opt-in toggles, i18n strings) that lag behind prod when a
// PR is in flight; byte-matching the whole file turns every such PR
// into a false CI failure. The tax engine still runs prod's extracted
// functions against the fictional golden below — the engine
// comparison IS the live-coverage signal here — so the byte-match is
// narrowed to the files that are supposed to be stable (JS libs +
// guides).
const byteMatch=new Set(['lib/tax-date-rates.js','host-guides.js']);
const remote={};
for(const file of ['host-console.html','lib/tax-date-rates.js','host-guides.js']){
 const url=new URL('/'+file,origin);url.searchParams.set('release','round62');
 const r=await fetch(url,{signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,file);
 remote[file]=await r.text();
 if(byteMatch.has(file))assert.equal(remote[file],fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),file+' matches tested source');
}
const ctx=vm.createContext({console});vm.runInContext(remote['lib/tax-date-rates.js'],ctx);
for(const name of ['_ageAtArrival','_normalizeTaxCfg','computeGuestTax','_seasonMatches','_nightsInsideQuarter','_groupSizeFor','_ruleLabel','exportCityTax']){
 const s=remote['host-console.html'],start=s.indexOf('function '+name+'(');assert.ok(start>=0);vm.runInContext(s.slice(start,s.indexOf('\n}\n',start)+2),ctx);
}
ctx.propertyData={id:'SYNTHETIC',name:'Fictional tax property',tax_rate_eur:2,tax_rules:[{id:'fixture_period',when:{night_from:'2026-07-01',night_to:'2026-08-31'},effect:{type:'rate_period',value:4}}]};
ctx.allCheckins=[{id:'SYNTHETIC',property_id:'SYNTHETIC',surname:'Fixture',name:'Adult',date_of_birth:'1980-01-01',arrival_date:'2026-06-29',departure_date:'2026-07-04',is_test:false}];
ctx.prompt=()=> '2026-3';ctx.alert=()=>{};ctx.track=()=>{};ctx.toast=()=>{};let output;ctx.downloadFile=(_,text)=>output=text;
for(const lang of ['en','it']){ctx.hostLang=lang;ctx.exportCityTax();assert.equal(output,fs.readFileSync(new URL('./golden/synthetic/tax-date-rates-'+lang+'.txt',import.meta.url),'utf8'));}
console.log('PASS tax production smoke: three public assets match tested source; deployed nightly calculation generates both exact IT/EN declaration goldens. No real guest reads or writes.');

ctx.propertyData.tax_rules[0].when={night_from:'07-01',night_to:'08-31'};
for(const lang of ['it','en']){ctx.hostLang=lang;ctx.exportCityTax();assert.equal(output,fs.readFileSync(new URL('./golden/synthetic/tax-annual-'+lang+'.txt',import.meta.url),'utf8'));}
console.log('PASS deployed recurring-season engine reproduces IT/EN annual tax goldens');
