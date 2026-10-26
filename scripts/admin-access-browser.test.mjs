// Actual Supabase browser SDK + actual admin/navigation/host-init functions.
// All Auth/REST calls are intercepted fictional fixtures; no live users or data.
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {parseHTML} from 'linkedom';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const host=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8'),admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
function fn(source,name){let i=source.indexOf('function '+name+'(');assert.ok(i>=0);if(source.slice(i-6,i)==='async ')i-=6;return source.slice(i,source.indexOf('\n}\n',i)+2);}
const sdk=process.env.SUPABASE_BROWSER_SDK?fs.readFileSync(process.env.SUPABASE_BROWSER_SDK,'utf8'):fs.readFileSync(new URL('../vendor/supabase-2.118.0.js',import.meta.url),'utf8');
const app='https://app.welcomebnb.it',backend='https://fixture.supabase.co';
const styles=[...host.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');const doc=parseHTML(host).document;
const authBlock=host.slice(host.indexOf('async function handleHostAuthEvent('),host.indexOf('// Round 38 — sign-up'));
const setup=`const sb=supabase.createClient('${backend}','fixture-public-key',{auth:{autoRefreshToken:false}});window.fixtureClient=sb;`;
function adminPage(){return `<html><body><div id="loginOverlay" class="hidden"></div><p id="error"></p><button id="viewHost" onclick="viewAsHost('00000000-0000-4000-8000-000000000099')">View host</button><script src="/fixture-sdk.js"></script><script>${setup}
function showLoginError(e){document.getElementById('error').textContent=e;}function adminToast(e){showLoginError(e);}
${fn(admin,'isAdmin')}\n${fn(admin,'viewAsHost')}
</script></body></html>`;}
function hostPage(){return `<html><head><style>${styles}</style></head><body>${doc.getElementById('adminViewBanner').outerHTML}${doc.getElementById('loginOverlay').outerHTML}<span id="sidebarUserName"></span><span id="sidebarAvatar"></span><div class="main"><h1 id="targetName"></h1><input id="fixtureField"><button id="fixtureAction">Edit</button></div><script src="/fixture-sdk.js"></script><script>${setup}
let hostLang='en',propertyId=null,propertyData=null,allProperties=[],IS_ADMIN_VIEW=false,_adminEditEnabled=false,_adminReadOnlyObserver=null;
function track(){}function setHostLang(l){hostLang=l;}function fillPropertyForm(row){document.getElementById('targetName').textContent=row.name;}async function loadPropertyData(){}function renderPropertySwitcher(){}function showPanel(){}function _readLastSection(){return null;}const SECTIONS={};
${['checkAuth','_hostIsAdmin','setConsoleReadOnly','activateAdminView','toggleAdminEdit','showImpersonationError','init'].map(n=>fn(host,n)).join('\n')}
${authBlock}
window.fixtureState=()=>({propertyId,admin:IS_ADMIN_VIEW});init().then(()=>window.fixtureReady=true);
</script></body></html>`;}
const out=process.env.ADMIN_TEST_OUTPUT_DIR||path.join(os.tmpdir(),'welcomebnb-admin-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const scenario of ['admin','refresh','nonadmin','absent']){
  const context=await browser.newContext();const page=await context.newPage();const errors=[],audit=[],reads=[];let refreshes=0;
  page.on('pageerror',e=>errors.push(String(e)));
  const user={id:'00000000-0000-4000-8000-000000000056',email:scenario==='nonadmin'?'host@example.invalid':'admin@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
  const expires=Math.floor(Date.now()/1000)+3600;const accessToken=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,email:user.email,role:'authenticated',aud:'authenticated',exp:expires})).toString('base64url')+'.fixture';
  const session={access_token:accessToken,refresh_token:'fixture-refresh',expires_in:3600,expires_at:expires,token_type:'bearer',user};
  await context.route(app+'/**',route=>{const url=new URL(route.request().url());return route.fulfill({contentType:url.pathname==='/fixture-sdk.js'?'application/javascript':'text/html',body:url.pathname==='/fixture-sdk.js'?sdk:url.pathname==='/host-console.html'?hostPage():adminPage()});});
  await context.route(backend+'/**',route=>{const url=new URL(route.request().url());let body={};
   if(url.pathname.includes('/token')){body=session;if(url.searchParams.get('grant_type')==='refresh_token')refreshes++;}
   else if(url.pathname.endsWith('/user'))body=user;
   else if(url.pathname.endsWith('/admin_users'))body=scenario==='nonadmin'?null:{email:user.email};
   else if(url.pathname.endsWith('/admin_impersonation_log')){audit.push(JSON.parse(route.request().postData()||'{}'));body={};}
   else if(url.pathname.endsWith('/properties')){reads.push(url.searchParams.get('id'));body={id:'00000000-0000-4000-8000-000000000099',owner_id:'different-host',name:'Fixture host property',address:'Fixture',wifi_name:'Fixture'};}
   return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  });
  await page.goto(app+'/admin.html');
  if(scenario!=='absent')assert.equal(await page.evaluate(async()=>{const {error}=await fixtureClient.auth.signInWithPassword({email:'fixture@example.invalid',password:'fixture-password'});return !!error;}),false);
  if(scenario==='refresh')await page.evaluate(()=>{const key=Object.keys(localStorage).find(k=>k.startsWith('sb-')&&k.endsWith('-auth-token'));const session=JSON.parse(localStorage.getItem(key));session.expires_at=Math.floor(Date.now()/1000)-300;localStorage.setItem(key,JSON.stringify(session));});
  if(scenario==='admin'||scenario==='refresh'){
   await Promise.all([page.waitForURL('**/host-console.html?**'),page.locator('#viewHost').click()]);await page.waitForFunction(()=>window.fixtureReady===true);assert.equal(context.pages().length,1);assert.equal(await page.locator('#loginOverlay').evaluate(el=>el.classList.contains('hidden')),true);assert.equal(await page.locator('#targetName').textContent(),'Fixture host property');assert.equal(await page.locator('#fixtureField').isDisabled(),true);assert.deepEqual(await page.evaluate(()=>fixtureState()),{propertyId:'00000000-0000-4000-8000-000000000099',admin:true});assert.equal(audit.length,1);assert.equal(reads.length,1);
   await page.locator('.main').evaluate(el=>{const b=document.createElement('button');b.id='lateAction';el.appendChild(b);});await page.waitForFunction(()=>document.getElementById('lateAction').disabled===true);
   await page.locator('#adminEditToggle').check();assert.equal(await page.locator('#fixtureField').isDisabled(),false);await page.locator('.main').evaluate(el=>{const b=document.createElement('button');b.id='editableAction';el.appendChild(b);});await page.waitForFunction(()=>document.getElementById('editableAction').disabled===false);await page.locator('#adminEditToggle').uncheck();assert.equal(await page.locator('#editableAction').isDisabled(),true);
   assert.ok(!/access_token|refresh_token|password/.test(page.url()));await page.screenshot({path:path.join(out,scenario+'.png'),fullPage:true});await page.locator('[data-h="admin_back"]').click();await page.waitForURL(app+'/admin.html');assert.equal(await page.evaluate(async()=>!!(await fixtureClient.auth.getSession()).data.session),true);if(scenario==='refresh')assert.ok(refreshes>0);
  }else if(scenario==='nonadmin'){
   await page.locator('#viewHost').click();await page.waitForFunction(()=>document.getElementById('error').textContent.includes('Admin access'));assert.equal(page.url(),app+'/admin.html');assert.equal(audit.length,0);
   await page.goto(app+'/host-console.html?p=00000000-0000-4000-8000-000000000099&admin=1');await page.waitForFunction(()=>window.fixtureReady===true);assert.equal(reads.length,0);assert.equal(await page.locator('#adminViewBanner').isVisible(),false);assert.ok(await page.locator('h2').filter({hasText:'Admin view'}).count());
  }else{
   await page.locator('#viewHost').click();await page.waitForFunction(()=>document.getElementById('error').textContent.includes('session could not be verified'));assert.equal(page.url(),app+'/admin.html');await page.goto(app+'/host-console.html?p=00000000-0000-4000-8000-000000000099&admin=1');await page.waitForFunction(()=>window.fixtureReady===true);assert.equal(await page.locator('#loginOverlay').evaluate(el=>el.classList.contains('hidden')),false);assert.equal(reads.length,0);
  }
  assert.deepEqual(errors,[]);console.log('PASS real browser/SDK '+scenario+': admin entry/session/property/authorization/read-only/return path');await context.close();
 }
}finally{await browser.close();}
