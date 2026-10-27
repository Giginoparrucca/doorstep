import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {parseHTML} from 'linkedom';
const host=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8'),admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function fn(source,name){let i=source.indexOf('function '+name+'(');assert.ok(i>=0,name);if(source.slice(i-6,i)==='async ')i-=6;return source.slice(i,source.indexOf('\n}\n',i)+2);}
for(const origin of ['https://app.welcomebnb.it','https://welcomebnb.vercel.app','https://demo.welcomebnb.it']){
 const nav=[],logs=[],errors=[];let user={id:'admin-fixture',email:'admin@example.invalid'},allowed=true,logError=null;
 const {document}=parseHTML('<html><body><div id="loginOverlay" class="hidden"></div></body></html>');
 const ctx=vm.createContext({URL,document,console:{warn:()=>{}},window:{location:{origin,assign:u=>nav.push(u)}},showLoginError:e=>errors.push(e),adminToast:e=>errors.push(e),isAdmin:async()=>allowed,
  sb:{auth:{getUser:async()=>({data:{user}})},from:table=>({insert:async row=>{logs.push({table,row});return {error:logError};}})}});
 vm.runInContext(fn(admin,'viewAsHost'),ctx);await ctx.viewAsHost('p&1');const url=new URL(nav.at(-1));assert.equal(url.origin,origin);assert.equal(url.pathname,'/host-console.html');assert.equal(url.searchParams.get('p'),'p&1');assert.equal(url.searchParams.get('admin'),'1');assert.equal(logs[0].table,'admin_impersonation_log');assert.ok(!/token|password|email/.test(url.search));
 user=null;await ctx.viewAsHost('p2');assert.equal(nav.length,1);assert.equal(document.getElementById('loginOverlay').classList.contains('hidden'),false);
 user={id:'host-fixture',email:'host@example.invalid'};allowed=false;await ctx.viewAsHost('p2');assert.equal(nav.length,1);assert.equal(logs.length,1);
 allowed=true;logError={message:'fixture audit unavailable'};await ctx.viewAsHost('p3');assert.equal(nav.length,2,'existing nonblocking audit behavior retained');
}
console.log('PASS source admin preflight, same-tab/same-origin scope, expiry/non-admin denial, audit payload/failure and no credentials in URLs');
function destination({authed=true,isAdmin=true,target='p-target'}={}){
 const {window,document}=parseHTML('<html><body><div id="loginOverlay"></div><div id="sidebarUserName"></div><div id="sidebarAvatar"></div><div id="adminViewBanner"><span id="adminViewLabel"></span><input id="adminEditToggle"></div><div class="main"><input id="field"><button id="action">Action</button></div></body></html>');
 const events=[],reads=[],errors=[],observers=[];const user={id:'admin-fixture',email:'admin@example.invalid'};const row={id:target,name:'Target house',owner_id:'other-host',address:'Fixture',wifi_name:'Fixture'};
 const sb={auth:{getSession:async()=>({data:{session:authed?{user}:null}}),getUser:async()=>({data:{user}})},from(table){reads.push(table);const q={select(){return q;},eq(){return q;},is(){return q;},order(){return q;},maybeSingle:async()=>({data:table==='admin_users'?(isAdmin?{email:user.email}:null):row}),then:r=>Promise.resolve({data:[row]}).then(r)};return q;}};
 const ctx=vm.createContext({console:{log:()=>{},warn:()=>{}},document,MutationObserver:class {constructor(f){observers.push(f);}observe(){}},window:{location:{origin:'https://app.welcomebnb.it',search:'?p='+target+'&admin=1'}},URLSearchParams,URL,history:{replaceState:()=>{}},
  sb,localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},hostLang:'en',propertyId:null,propertyData:null,allProperties:[],IS_ADMIN_VIEW:false,_adminEditEnabled:false,_adminReadOnlyObserver:null,
  track:()=>{},setHostLang:()=>events.push('language'),fillPropertyForm:()=>events.push('form'),showImpersonationError:()=>errors.push('denied'),loadPropertyData:async()=>events.push('data'),renderPropertySwitcher:()=>{},showPanel:()=>{},_readLastSection:()=>null,SECTIONS:{}});
 for(const name of ['checkAuth','_hostIsAdmin','setConsoleReadOnly','activateAdminView','init'])vm.runInContext(fn(host,name),ctx);
 const verify=ctx._hostIsAdmin;ctx._hostIsAdmin=async id=>{events.push('verify');return verify(id);};
 return {ctx,document,events,reads,errors,observers};
}
const valid=destination();await valid.ctx.init();assert.equal(valid.document.getElementById('loginOverlay').classList.contains('hidden'),true);assert.equal(valid.ctx.propertyId,'p-target');assert.equal(valid.ctx.IS_ADMIN_VIEW,true);assert.equal(valid.document.getElementById('field').disabled,true);assert.equal(valid.events[0],'verify');assert.ok(valid.events.indexOf('data')>valid.events.indexOf('verify'));assert.deepEqual(valid.reads,['admin_users','properties']);
const late=valid.document.createElement('button');valid.document.querySelector('.main').appendChild(late);valid.observers[0]();assert.equal(late.disabled,true,'late-rendered controls remain read-only');
const denied=destination({isAdmin:false});await denied.ctx.init();assert.deepEqual(denied.errors,['denied']);assert.ok(!denied.reads.includes('properties'),'deny before another property query');assert.equal(denied.ctx.propertyId,null);
const absent=destination({authed:false});await absent.ctx.init();assert.equal(absent.document.getElementById('loginOverlay').classList.contains('hidden'),false);assert.equal(absent.reads.length,0);
console.log('PASS actual destination init: persisted session, selected foreign property, server admin check before read, read-only including late DOM, non-admin/no-session denial');
// Execute the real callback with an exclusive-auth-lock fixture.
const tasks=[],rpc=[],updates=[],alerts=[];let locked=true;const location={origin:'https://app.welcomebnb.it',search:'?p=p-target&admin=1',pathname:'/host-console.html',hash:''};const storage=new Map();let handler;
const ctx=vm.createContext({console,location,window:{location,promptForNewPassword:async()=>'fixture-password'},document:{title:'Fixture'},hostLang:'en',sessionStorage:{getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)},history:{replaceState:()=>{}},alert:m=>alerts.push(m),setTimeout:f=>{tasks.push(f);},
 sb:{auth:{onAuthStateChange:f=>handler=f,updateUser:async value=>{assert.equal(locked,false);updates.push(value);return {}; }},rpc:async name=>{assert.equal(locked,false,'no nested auth inside locked callback');rpc.push(name);return {};}}});
vm.runInContext(fn(host,'handleHostAuthEvent'),ctx);const a=host.indexOf('sb.auth.onAuthStateChange(');vm.runInContext(host.slice(a,host.indexOf('\n});',a)+4),ctx);
assert.equal(handler('SIGNED_IN',{user:{user_metadata:{}}}),undefined);assert.equal(rpc.length,0);locked=false;tasks.shift()();await new Promise(r=>setTimeout(r,0));assert.equal(rpc.length,1);
storage.set('wbnb_auth_hint','invite');handler('SIGNED_IN',{user:{user_metadata:{}}});tasks.shift()();await new Promise(r=>setTimeout(r,0));assert.equal(updates.length,1);assert.equal(location.href,'https://app.welcomebnb.it/host-console.html?p=p-target&admin=1');assert.equal(storage.has('wbnb_auth_hint'),false);
const codes=vm.createContext({IS_ADMIN_VIEW:true,_adminEditEnabled:false});vm.runInContext(fn(host,'ensureReservationBookingCodes'),codes);const rows=[{id:'fixture',booking_code:null}];assert.equal(await codes.ensureReservationBookingCodes(rows),rows,'read-only never mints booking/lockbox codes');
assert.ok(host.includes("!(typeof IS_ADMIN_VIEW !== 'undefined' && IS_ADMIN_VIEW && !_adminEditEnabled)"));assert.ok(host.includes('href="/admin.html"'));assert.ok(host.includes("admin_back: 'Torna all’admin'"));
console.log('PASS deferred auth work, invite/password target retention, no URL tokens, read-only language/code assignment guards and bilingual return navigation');
