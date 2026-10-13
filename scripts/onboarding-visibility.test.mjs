// Regression: run the actual dashboard + onboarding module against a DOM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('host-console.html');
const {document,window:dom}=parseHTML(source);
let focused;
for(const n of document.querySelectorAll('*')) {n.scrollIntoView=()=>{};n.focus=()=>{focused=n.id;};}
const strings={};for(const m of source.matchAll(/(obx_\w+|lang_refreshing):\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")/g)) (strings[m[1]] ||= []).push(vm.runInNewContext(m[2]));
for(const key of ['obx_attention_title','obx_attention_intro','obx_show','obx_load_error','obx_retry']) assert.equal(strings[key].length,2,key+' EN/IT');
let settings={push_enabled:false,email_mode:'off'},ob={skips:{}},failBooking=false,activeTestBooking=null,section='oggi',lastPanel,edited;
const query=table=>new Proxy({}, {get(_,key){if(key==='then') return resolve=>resolve(table==='ota_reservations'&&failBooking?{error:new Error('offline')}:{data:table==='host_notification_settings'?settings:table==='host_onboarding'?ob:table==='ota_reservations'&&activeTestBooking?[activeTestBooking]:[]});return arg=>{if(key==='update'&&table==='host_onboarding') Object.assign(ob,arg);return query(table);};}});
const w={document,hostLang:'it',propertyId:'fixture',propertyData:{id:'fixture'},WELCOME_BNB_CONFIG:{support:{}},
  sb:{auth:{getUser:async()=>({data:{user:{id:'host'}}}),getSession:async()=>({data:{session:{access_token:'fixture'}}})},from:query},
  addEventListener:()=>{},h:key=>strings[key]?.[w.hostLang==='it'?1:0]||key,
  showSection:next=>{section=next;},showPanel:panel=>{lastPanel=panel;section=panel==='chat'?'ospiti':'prop';w.HostOnboarding.renderPropertyAttention(section);},
  startPropertyEdit:()=>{edited='property';},startSettingsEdit:()=>{edited='settings';},
};
const ctx=vm.createContext({window:w,document,console,Date,Map,Set,setTimeout:fn=>fn(),fetch:async()=>({ok:true,json:async()=>({configured:false})}),
  dashboardRenderVersion:0,propertyId:'fixture',allCheckins:[],sb:w.sb,hostLang:'it',h:w.h,APP_CONFIG:{mode:'production'},dismissedBookingCodes:new Set(),
  _loadGuestChatAsEvents:async()=>[],loadGuestSummariesByCode:async()=>({}),renderUpcomingReservationsPanel:async()=>'',renderCoverageLostBanner:async()=>''});
Object.defineProperty(w,'hostLang',{get:()=>ctx.hostLang,set:value=>{ctx.hostLang=value;}});
vm.runInContext(read('lib/onboarding-readiness.js'),ctx);vm.runInContext(read('host-onboarding.js'),ctx);
const start=source.indexOf('async function renderDashboard()');const end=source.indexOf('\n}\n',start)+2;
vm.runInContext(source.slice(start,end),ctx);
// This failed with the original dashboard: its final innerHTML wiped the card.
for(let i=0;i<2;i++) {await ctx.renderDashboard();assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step').length,5);assert.ok(document.getElementById('dashboardContent'));}
console.log('PASS full dashboard refresh retains the five checklist steps');
w.HostOnboarding.renderPropertyAttention('prop');
const attention=document.getElementById('onboardingPropertyAttention');assert.equal(attention.style.display,'');assert.equal(attention.querySelectorAll('.obx-step').length,4);assert.match(attention.textContent,/Nome.*Città.*Regione.*CIN/);assert.match(attention.textContent,/pallino arancione/);
for(const [focus,panel,edit,field] of [['name','property','property','propName'],['ical_feeds','settings','settings','icalFeedsList'],['welcome_message','property','property','propWelcome'],['notification_channel','chat',undefined,'notifCard']]) {edited=undefined;const button=attention.querySelector('[data-focus="'+focus+'"]');assert.ok(button,focus);button.click();assert.equal(lastPanel,panel);assert.equal(edited,edit);assert.equal(focused,field);w.HostOnboarding.renderPropertyAttention('prop');}
console.log('PASS property dot explanation lists missing steps and routes into the right editable panels');
w.propertyData={id:'fixture',name:'Fixture',city:'Ostuni',region:'Puglia',cir_code:'IT048017B4VKMD9QX6',tax_rules:[{rate_eur:2}],alloggiati_autofile_mode:'manual',ical_feeds:[{url:'https://example.com/ical'}],wifi_name:'Fixture',welcome_message_it:'Benvenuti',checkin_instructions_it:'Facsimile'};settings={push_enabled:true};ob={skips:{},test_checkin_done_at:'2026-10-13T00:00:00Z',checklist_dismissed_at:'2026-10-13T00:00:00Z'};
await w.HostOnboarding.renderChecklist();assert.ok(document.querySelector('.obx-ready-badge'));assert.equal(attention.style.display,'none');assert.equal(document.getElementById('onboardingSidebarDot').style.display,'none');await document.querySelector('.obx-expand').onclick();await w.HostOnboarding.renderChecklist();assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step').length,5);
console.log('PASS ready property clears the dot and dismissed checklist can be reopened');
const readyProperty={...w.propertyData};
activeTestBooking={booking_code:'WB-TEST1234'};await w.HostOnboarding.renderChecklist();assert.ok(document.querySelector('#onboardingHostContainer > .obx-card > .obx-test-delete'));assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step button').length,0);activeTestBooking=null;await w.HostOnboarding.renderChecklist();
console.log('PASS active test cleanup remains separate from completed-step controls');
const autoContent=document.querySelector('#onboardingHostContainer [data-step="content"]').innerHTML;
assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step button').length,0);
assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step-status').length,5);
console.log('PASS all automatically completed steps show status only, including test check-in');
for(const [missing,change,field,panel] of [['tax_rules',{tax_rules:[]},'propTaxRate','settings'],['alloggiati',{alloggiati_autofile_mode:'off'},'alloggiatiCard','settings'],['wifi_name',{wifi_name:''},'propWifiName','property'],['checkin_instructions',{checkin_instructions_it:''},'propCheckinInstructions','property']]) {w.propertyData={...readyProperty,...change};await w.HostOnboarding.renderChecklist();w.HostOnboarding.renderPropertyAttention('prop');const b=attention.querySelector('[data-focus="'+missing+'"]');assert.ok(b,missing);b.click();assert.equal(lastPanel,panel);assert.equal(focused,field);}
w.hostLang='en';w.HostOnboarding.renderPropertyAttention('prop');assert.match(attention.textContent,/Needs attention for this property/);
w.hostLang='it';w.propertyData=readyProperty;
console.log('PASS tax, Alloggiati and welcome-field destinations plus English attention copy');
failBooking=true;await w.HostOnboarding.renderChecklist();assert.ok(document.querySelector('.obx-retry'));assert.match(document.getElementById('onboardingHostContainer').textContent,/Impossibile/);failBooking=false;await document.querySelector('.obx-retry').onclick();assert.equal(document.querySelectorAll('#onboardingHostContainer .obx-step').length,5);
console.log('PASS load failure stays visible with a working retry');
w.propertyData={id:'fixture'};settings={push_enabled:false,email_mode:'off'};ob={skips:{},updated_at:'2026-10-13T00:00:00Z'};
await w.HostOnboarding.renderChecklist();
const card=document.getElementById('onboardingHostContainer');
await card.querySelector('[data-step="content"] [data-choice="done"]').onclick();
assert.equal(ob.skips.step_decisions.content,'done');assert.match(card.querySelector('[data-step="content"]').textContent,/Completato/);assert.equal(card.querySelector('[data-step="content"]').querySelectorAll('button').length,0);assert.equal(w.propertyData.welcome_message,undefined);
await card.querySelector('[data-step="calendar"] [data-choice="dismissed"]').onclick();assert.equal(ob.skips.step_decisions.calendar,'dismissed');
await w.HostOnboarding.renderChecklist();assert.equal(card.querySelector('[data-step="content"]').querySelectorAll('button').length,0);assert.equal(card.querySelector('[data-step="calendar"]').querySelectorAll('button').length,0);
assert.ok(!card.querySelector('[data-choice="tax"]'));assert.ok(!card.querySelector('[data-choice="tax_auto"]'));
const decisions=card.querySelector('[data-step="property"] .obx-choice-row');assert.ok(decisions.querySelector('[data-choice="done"]'));assert.ok(decisions.querySelector('[data-choice="dismissed"]'));
assert.match(read('host-onboarding.js'),/\.obx-actions\{display:flex;flex-direction:row;flex-wrap:wrap/);
console.log('PASS generic Confirm/Dismiss choices are grouped horizontally; no applicability-review controls');
await card.querySelector('.obx-dismiss').onclick();assert.ok(card.querySelector('.obx-collapsed-badge'));assert.ok(!card.querySelector('.obx-ready-badge'));
await card.querySelector('.obx-expand').onclick();assert.equal(card.querySelectorAll('.obx-step').length,5);
console.log('PASS incomplete checklist can be hidden/reopened without claiming readiness');
w.propertyData={...readyProperty,wifi_name:'',welcome_message_it:''};ob={skips:{},updated_at:'2026-10-13T00:00:00Z'};await w.HostOnboarding.renderChecklist();await card.querySelector('[data-step="content"] [data-choice="done"]').onclick();assert.equal(card.querySelector('[data-step="content"]').innerHTML,autoContent);
console.log('PASS host-confirmed and automatically completed steps render identically');
let networkCalls=0;const originalFetch=ctx.fetch;ctx.fetch=async()=>{networkCalls++;return originalFetch();};
w.hostLang='en';w.HostOnboarding.repaint();assert.match(card.textContent,/Property setup/);assert.equal(networkCalls,0);w.hostLang='it';
console.log('PASS persisted completed step choices persist separately from property data; language repaint requires no fetch');
const ls=source.indexOf('function setHostLang('),le=source.indexOf('\n}',ls)+2;
for(const name of ['renderCheckins','renderRules','renderRecos','renderCompliance','renderPropertySwitcher','renderExportChecklist','_updatePropPrivacyWarnings','renderNotifCard','loadGuestAnalytics','renderCalendarPanel','_hgEnsurePill','_renderSectionTabs']) ctx[name]=()=>{};
ctx.propertyData=w.propertyData;
ctx.titles={dashboard:['Dashboard','Fixture']};ctx.panelSection=()=> 'oggi';ctx._notifState=null;
vm.runInContext(source.slice(ls,le),ctx);
let releaseFetch;ctx.fetch=()=>new Promise(resolve=>{releaseFetch=resolve;});
ctx.setHostLang('en');
assert.match(card.textContent,/Property setup/);assert.match(document.getElementById('dashboardContent').textContent,/Updating this view/);
ctx.fetch=originalFetch;if(releaseFetch)releaseFetch({ok:true,json:async()=>({configured:false})});
console.log('PASS actual language switch instantly relabels checklist and shows loading before slow requests finish');
w.HostOnboarding.renderPropertyAttention('oggi');assert.equal(attention.style.display,'none');w.propertyId='other';w.HostOnboarding.renderPropertyAttention('prop');assert.equal(attention.style.display,'none');
console.log('PASS section/property switches hide stale attention state');
