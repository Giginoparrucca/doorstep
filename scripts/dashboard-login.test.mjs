// Execute real console initialization with saved tabs and fictional authenticated data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const start=source.indexOf('async function init()');
const init=source.slice(start,source.indexOf('\n}\n',start)+2);
async function boot({search='',blank=false,active='dashboard',authenticated=true,savedSection='prop',savedTabs={prop:'settings',oggi:'calendar'}}={}){
 const {document}=parseHTML(`<html><body><div id="loginOverlay"></div><span id="sidebarUserName"></span><span id="sidebarAvatar"></span><div id="onboardingBanner" style="display:none"></div>${['dashboard','property','settings','calendar','chat'].map(p=>`<div id="panel-${p}" class="panel ${p===active?'active':''}"></div>`).join('')}</body></html>`);
 const storage=new Map([['wbnb_section_last',savedSection],['wbnb_section_tab',JSON.stringify(savedTabs)],['wbnb_host_selected_property','p2']]);
 const rows=[{id:'p1',name:'One',address:blank?'':'Fixture',wifi_name:blank?'':'Fixture'},{id:'p2',name:'Two',address:'Fixture',wifi_name:'Fixture'}];if(blank)rows.splice(1);
 const panels=[],sections=[],shares=[],cleaned=[],switches=[];let reads=0;
 const location={origin:'https://app.welcomebnb.it',search,href:'https://app.welcomebnb.it/host-console.html'+search};
 const ctx=vm.createContext({document,window:{location,history:{replaceState:(a,b,url)=>cleaned.push(String(url))}},history:{replaceState:(a,b,url)=>cleaned.push(String(url))},URL,URLSearchParams,console,setTimeout:f=>f(),
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},propertyId:null,propertyData:null,allProperties:[],hostLang:'en',
  checkAuth:async()=>authenticated,sb:{auth:{getSession:async()=>({data:{session:{user:{id:'fictional-owner',email:'owner@example.invalid'}}}})},from(){reads++;const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,then:resolve=>Promise.resolve({data:rows}).then(resolve)};return q;}},
  track(){},setHostLang(){},fillPropertyForm(){},renderPropertySwitcher(){},loadPropertyData:async()=>{},activateAdminView(){},_hostIsAdmin:async()=>true,ensureHostTerms:async()=>true,
  showPanel:async panel=>{panels.push(panel);document.querySelectorAll('.panel').forEach(e=>e.classList.toggle('active',e.id==='panel-'+panel));},
  showSection:(section,tab)=>{sections.push([section,tab]);},switchProperty:async id=>{switches.push(id);ctx.propertyId=id;},openBookingShare:code=>shares.push(code),loadHostChat(){},
  // Existing stored state must never be consulted to choose the landing page.
  _readLastSection:()=>savedSection,SECTIONS:{prop:{panels:['property','settings']},oggi:{panels:['dashboard','calendar']}}});
 vm.runInContext(init,ctx);await ctx.init();return {panels,sections,shares,cleaned,switches,ctx,document,reads};
}
for(const savedSection of ['prop','oggi','ospiti','conf','corrupt'])for(const active of ['dashboard','settings','calendar']){
 const r=await boot({savedSection,active});assert.deepEqual(r.panels,['dashboard']);assert.deepEqual(r.sections,[]);assert.equal(r.ctx.propertyId,'p2','preserve owned selected property');assert.equal(r.document.querySelector('.panel.active').id,'panel-dashboard');
}
const blank=await boot({blank:true});assert.deepEqual(blank.panels,['dashboard'],'first-property setup also starts on dashboard');assert.equal(blank.document.getElementById('onboardingBanner').style.display,'block');
const repeat=await boot({active:'settings'});await repeat.ctx.init();assert.deepEqual(repeat.panels,['dashboard','dashboard'],'same-page re-login resets an already active settings tab');
const chat=await boot({search:'?notify_prop=p1&open=chat&conv=BOOK-1'});assert.deepEqual(chat.sections,[['ospiti','chat']]);assert.deepEqual(chat.panels,[]);assert.deepEqual(chat.switches,['p1']);assert.equal(chat.cleaned.length,1);
const share=await boot({search:'?notify_prop=p1&open=share&booking=BOOK-1'});assert.deepEqual(share.shares,['BOOK-1']);assert.deepEqual(share.panels,[]);assert.deepEqual(share.switches,['p1']);
const foreign=await boot({search:'?notify_prop=other-owner&open=chat'});assert.deepEqual(foreign.panels,['dashboard']);assert.deepEqual(foreign.switches,[]);assert.deepEqual(foreign.sections,[]);
const absent=await boot({authenticated:false});assert.equal(absent.reads,0);assert.deepEqual(absent.panels,[]);
console.log('PASS dashboard landing: saved sections/tabs and active panels ignored, reload/re-login and blank setup use dashboard; owned property selection, explicit notifications and authentication checks preserved');
