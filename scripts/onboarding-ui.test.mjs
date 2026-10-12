import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { supportConfiguration } from '../lib/environment.mjs';
const require = createRequire(import.meta.url);
const { computeReadiness } = require('../lib/onboarding-readiness.js');
const { buildSupportPrefill, supportLinks } = require('../lib/onboarding-support.js');
const html = fs.readFileSync('host-console.html', 'utf8');
const main = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].find(m => m[1].includes('const HT'))[1];
const dictionaries = main.slice(main.indexOf('const HT ='), main.indexOf('function h(key)'));
const context = {}; vm.createContext(context); vm.runInContext(dictionaries + ';globalThis.dictionary = HT;', context);
const keys = Object.keys(context.dictionary.it).filter(k => k.startsWith('ob_'));
assert.ok(keys.length >= 40);
for (const key of keys) { for (const lang of ['en', 'it']) { assert.equal(typeof context.dictionary[lang][key], 'string', key); assert.ok(!/[\r\n]/.test(context.dictionary[lang][key]), key); } }
for (const match of fs.readFileSync('host-onboarding.js', 'utf8').matchAll(/h\('(ob_[^']+)'\)/g)) if (!match[1].endsWith('_')) assert.ok(keys.includes(match[1]), match[1]);
assert.ok(html.includes('/host-onboarding.js'));
for (const file of ['index.html','admin.html']) assert.ok(!fs.readFileSync(file,'utf8').includes('/host-onboarding.js'));
assert.ok(!/wa\.me\/|mailto:|calendly\.com/.test(fs.readFileSync('host-onboarding.js','utf8')));
const msg = buildSupportPrefill('Host & Partner', 'Casa <Demo>', 'Calendar', 'en');
assert.equal(msg, "Hi, I'm Host & Partner, property Casa <Demo>. I need help with: Calendar.");
assert.match(buildSupportPrefill('Mario','Casa','Calendario','it'), /^Ciao, sono Mario/);
assert.ok(!buildSupportPrefill('Mario','Casa','Setup','it').includes('booking'));
const links = supportLinks({whatsapp:'+391234567890',email:'support@example.com',calendly:'https://calendly.com/example/help'},msg);
assert.equal(new URL(links.whatsapp).searchParams.get('text'),msg);
assert.equal(new URL(links.email).searchParams.get('body'),msg);
assert.deepEqual(supportLinks({whatsapp:'bad',email:'bad\r\nBcc:bad',calendly:'javascript:alert(1)'},msg), {});
assert.deepEqual(supportConfiguration({SUPPORT_WHATSAPP_E164:'+391234567890',SUPPORT_EMAIL:'real@example.com',SUPPORT_CALENDLY_URL:'https://calendly.com/real'},true), {whatsapp:'',email:'',calendly:''});
assert.throws(()=>supportConfiguration({SUPPORT_EMAIL:'x@example.com\nBcc:evil'},false));
assert.throws(()=>supportConfiguration({SUPPORT_CALENDLY_URL:'https://evil.example'},false));
for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (m[1].trim()) new vm.Script(m[1]);
assert.ok(computeReadiness({property:{name:'Demo',city:'Ostuni',region:'Puglia',cir_code:'IT123456789012'},onboardingState:{skips:{tax_not_applicable:true,alloggiati_manual:true}}}).steps[0].done);
console.log('PASS Phase 3 static/i18n/config/prefill/syntax checks');
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<body><div id="panel-dashboard"></div></body>',{runScripts:'outside-only',url:'https://demo.example'});
for(const file of ['lib/onboarding-readiness.js','lib/onboarding-support.js','host-onboarding.js']) dom.window.eval(fs.readFileSync(file,'utf8'));
const property = {id:'A',name:'Casa',city:'Ostuni',region:'Puglia',cir_code:'IT123456789012',wifi_name:'Demo',welcome_message_it:'Benvenuto',checkin_instructions_it:'Ingresso',tax_rules:[{}],ical_feeds:['https://example.com/calendar.ics']};
let current={userId:'host-A',property,properties:[property],lang:'it',support:{email:'support@example.com'},hostName:'Mario',credentials:{configured:true},notifications:{email_mode:'always'},readOnly:false};
const stored = new Map(), updates=[], events=[]; let denied=false;
class Query {
 constructor(){this.filters={};this.kind='select';}
 select(){return this;} eq(k,v){this.filters[k]=v;return this;}
 upsert(value){this.kind='upsert';this.value=value;return this;}
 update(value){this.kind='update';this.value=value;return this;}
 then(resolve,reject){return Promise.resolve().then(()=>{
  if(this.kind==='upsert'){if(!stored.has(this.value.property_id))stored.set(this.value.property_id,{...this.value,first_seen_at:'original-first-seen',skips:{}});return{data:[stored.get(this.value.property_id)]};}
  const rows=[...stored.values()].filter(r=>Object.entries(this.filters).every(([k,v])=>r[k]===v));
  if(this.kind==='update'){if(denied)return{data:[]};updates.push({...this.value,property_id:this.filters.property_id});rows.forEach(r=>Object.assign(r,this.value));}
  return{data:rows};
 }).then(resolve,reject);}
}
const adapter={context:()=>current,db:{from:()=>new Query()},h:k=>context.dictionary[current.lang][k]||k,toast:()=>events.push('error'),regionCompliance:()=>({}),section:()=> 'Oggi',sectionId:()=> 'oggi',track:(type,data)=>events.push({type,data}),paintBadges:()=>{},addProperty:()=>{},focusStep:()=>{},guide:()=>{}};
dom.window.HostOnboarding.init(adapter);await dom.window.HostOnboarding.refresh();
assert.equal(stored.get('A').first_seen_at,'original-first-seen');assert.ok(stored.get('A').completed_at);
const completed=stored.get('A').completed_at;await dom.window.HostOnboarding.changed();assert.equal(stored.get('A').completed_at,completed);
assert.equal(dom.window.document.querySelector('progress').value,4); // optional guest test remains incomplete
const directOnly=dom.window.document.querySelector('[data-value="direct_only"][data-action="skip"]');directOnly.click();await new Promise(r=>setTimeout(r,0));assert.equal(stored.get('A').skips.direct_only,true);
assert.ok(events.some(e=>e.type==='onboarding_step_skipped'));
const button=dom.window.document.querySelector('[data-action="dismiss"]');assert.ok(button);button.click();await new Promise(r=>setTimeout(r,0));assert.ok(stored.get('A').checklist_dismissed_at);assert.equal(dom.window.document.getElementById('hostOnboardingChecklist').hidden,true);
current={...current,property:{...property,id:'B',city:''},properties:[property,{...property,id:'B',city:''}]};await dom.window.HostOnboarding.refresh();assert.ok(!stored.get('B').completed_at);assert.equal(dom.window.document.querySelector('[data-action="dismiss"]'),null);assert.equal(stored.get('B').skips.direct_only,undefined);
current.lang='en';dom.window.HostOnboarding.paint();assert.match(dom.window.document.getElementById('hostOnboardingChecklist').textContent,/Get your property ready/);
denied=true;dom.window.document.querySelector('[data-action="skip"]').click();await new Promise(r=>setTimeout(r,0));assert.ok(events.includes('error'));
current={...current,property:null,properties:[]};await dom.window.HostOnboarding.refresh();assert.ok(dom.window.document.querySelector('[data-action="add"]'));
current={...current,userId:null};await dom.window.HostOnboarding.refresh();assert.equal(dom.window.document.getElementById('onboardingHelp').hidden,true);
console.log('PASS DOM persistence/completion/skips/dismissal/property-switch/i18n/denied-write/empty-account checks');
