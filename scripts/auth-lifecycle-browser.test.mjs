// Real login/logout handlers and login markup; fictional auth only, no live accounts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {parseHTML} from 'linkedom';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const markup=parseHTML(source).document.getElementById('loginOverlay').outerHTML;
function fn(name){const a=source.indexOf('async function '+name+'(');assert.ok(a>=0);return source.slice(a,source.indexOf('\n}\n',a)+2);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{for(const lang of ['it','en']){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent('<style>.hidden{display:none!important}.login-overlay{display:block}</style>'+markup+'<button id="logout" onclick="signOut()">Logout</button>');
 const labels=lang==='it'?{login_signin:'Accedi',login_signing_in:'Accesso in corso…'}:{login_signin:'Sign In',login_signing_in:'Signing in…'};
 await page.addScriptTag({content:`var labels=${JSON.stringify(labels)},_trackUserId=null,_trackEmail=null,_propertySavePending=false;function h(key){return labels[key]||key;}function track(){}function init(){window.initCalls++;}async function leaveConsoleDrafts(){return window.allowLeave;}window.allowLeave=true;window.initCalls=0;window.signInCalls=0;window.signOutCalls=0;window.authMode='pending';const timers=new Map();let timerId=0;const setTimeout=(callback,ms)=>{if(ms!==15000)throw Error('Unexpected auth timer');const id=++timerId;timers.set(id,callback);return id;};const clearTimeout=id=>timers.delete(id);window.expireAuth=()=>[...timers.values()].forEach(fn=>fn());window.timerCount=()=>timers.size;const sb={auth:{async signInWithPassword(){signInCalls++;if(authMode==='error')return {error:{message:'Fictional invalid credentials'}};if(authMode==='throw')throw Error('Fictional network failure');return new Promise(resolve=>window.finishAuth=resolve);},async signOut(){signOutCalls++;}}};${fn('handleAuth')} ${fn('signOut')}document.getElementById('authBtn').textContent=h('login_signin');`});
 await page.locator('#loginEmail').fill('fictional@example.invalid');await page.locator('#loginPassword').fill('fictional-password');
 const begin=async()=>{await page.locator('#authBtn').click();assert.equal(await page.locator('#authBtn').isDisabled(),true);assert.equal(await page.locator('#authBtn').textContent(),labels.login_signing_in);};
 const idle=async()=>{await page.waitForFunction(()=>!document.getElementById('authBtn').disabled);assert.equal(await page.locator('#authBtn').textContent(),labels.login_signin);assert.equal(await page.evaluate(()=>timerCount()),0);};
 // The exact reported flow: sign in, sign out, sign in again in the same DOM.
 for(let cycle=1;cycle<=2;cycle++){
  await begin();await page.evaluate(()=>finishAuth({data:{user:{id:'fixture-owner',email:'fictional@example.invalid'}},error:null}));await idle();
  assert.equal(await page.locator('#loginOverlay').evaluate(e=>e.classList.contains('hidden')),true);assert.equal(await page.evaluate(()=>initCalls),cycle);
  await page.evaluate(()=>allowLeave=false);await page.locator('#logout').click();assert.equal(await page.evaluate(()=>signOutCalls),cycle-1,'cancelled draft prompt keeps the session');
  await page.evaluate(()=>allowLeave=true);await page.locator('#logout').click();assert.equal(await page.locator('#loginOverlay').isVisible(),true);await idle();
 }
 assert.equal(await page.evaluate(()=>signInCalls),2);assert.equal(await page.evaluate(()=>signOutCalls),2);
 // Every unsuccessful outcome must also restore the button for a retry.
 await page.evaluate(()=>authMode='error');await page.locator('#authBtn').click();await idle();assert.match(await page.locator('#loginError').textContent(),/invalid credentials/);
 await page.evaluate(()=>authMode='throw');await page.locator('#authBtn').click();await idle();assert.equal(await page.locator('#loginError').textContent(),'login_err_connection');
 await page.evaluate(()=>authMode='pending');await begin();await page.evaluate(()=>expireAuth());await idle();assert.equal(await page.locator('#loginError').textContent(),'login_err_timeout');assert.equal(await page.locator('#loginEmail').inputValue(),'fictional@example.invalid');
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${lang} real login/logout markup: two sign-in/logout cycles without refresh, success/error/rejection/timeout reset, translated labels, timer cleanup and unsaved-change guard`);
}}finally{await browser.close();}
