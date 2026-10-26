import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createRequire} from 'node:module';import vm from 'node:vm';
import {securityHeaders} from '../lib/security-headers.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const root=new URL('../',import.meta.url),source=fs.readFileSync(new URL('host-console.html',root),'utf8');
const sdk=process.env.SUPABASE_BROWSER_SDK?fs.readFileSync(process.env.SUPABASE_BROWSER_SDK,'utf8'):
 fs.readFileSync(new URL('../vendor/supabase-2.118.0.js',import.meta.url),'utf8');
const def=source.split('\n').find(line=>line.includes('const _alloggiatiSafe = s =>'));
const safe=vm.runInNewContext(def+'\n_alloggiatiSafe');
const tags=[...source.matchAll(/<button\b[^>]*>/g)].map(x=>x[0]).filter(t=>/data-(?:booking-code|reservation-id|receipt-path|date|guest-link)=/.test(t)&&/onclick=/.test(t));
assert.equal(tags.length,12);
const payload=`O'Brien ");window.pwned=true;// <img src=x onerror=window.pwned=true> \` & /`;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
const out=path.join(os.tmpdir(),'round65-security-qa');fs.mkdirSync(out,{recursive:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<div id="fixture"></div>');
 const names=['restoreDismissal','dismissBooking','dismissCoverageLost','reopenCheckinForBooking','copyReservationLink','unlinkCoverage',
  'editDirectReservation','cancelDirectReservation','_upcomingCalSelectDay','_showReservationDetail','_confirmCoverage','_openAlloggiatiReceipt'];
 await page.evaluate(names=>{window.calls=[];window.pwned=false;for(const name of names)window[name]=(...args)=>calls.push({name,args:args.filter(a=>typeof a==='string')});},names);
 for(const tag of tags){
  const html=tag.replace(/\$\{safe\([\s\S]*?\)\}/g,safe(payload)).replace(/\$\{[^}]*\}/g,'')+'Fixture</button>';
  await page.locator('#fixture').evaluate((el,html)=>el.innerHTML=html,html);
  assert.equal(await page.locator('#fixture img').count(),0);
  await page.locator('#fixture button').click();
  const call=await page.evaluate(()=>calls.at(-1));assert.ok(call);
  assert.ok(call.args.includes(payload),call.name+' preserves exact data');
  assert.ok(call.args.every(arg=>arg===payload||arg==='booking'));
  assert.equal(await page.evaluate(()=>pwned),false);
 }
 assert.deepEqual(errors,[]);await page.close();
 // Load the entire real host page with HTTP response headers, real local
 // modules and SDK. Only fonts/network/auth are fictional; no account is used.
 for(const width of [390,1440])for(const language of ['it','en']){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],reports=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(u.pathname==='/api/csp-report'){reports.push(req.postDataJSON());return route.fulfill({status:204});}
   if(u.hostname==='fonts.googleapis.com')return route.fulfill({contentType:'text/css',body:''});
   if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('supabase-js'))return route.fulfill({contentType:'text/javascript',body:sdk});
   if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('qrcode-generator'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(require.resolve('qrcode-generator'))});
   if(u.origin==='https://app.welcomebnb.it'){
    const file=new URL('.'+u.pathname,root);if(!file.href.startsWith(root.href))throw Error('bad fixture path');
    if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({headers:Object.fromEntries(securityHeaders.map(h=>[h.key,h.value])),contentType:u.pathname.endsWith('.html')?'text/html':u.pathname.endsWith('.js')?'text/javascript':'text/plain',body:fs.readFileSync(file)});
   }
   return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  });
  await page.goto('https://app.welcomebnb.it/host-console.html');
  await page.locator('#loginOverlay').waitFor({state:'visible'});await page.waitForTimeout(250);
  await page.evaluate(language=>setHostLang(language),language);
  assert.ok((await page.locator('#authBtn').textContent()).trim().length>0);
  assert.deepEqual(errors,[]);assert.deepEqual(reports,[],'no report-only violations at host login');
  await page.screenshot({path:path.join(out,`host-${language}-${width}.png`),fullPage:true});await page.close();
 }
 console.log('PASS 12 actual dynamic handlers preserve attack-shaped values without code execution; full host login with real SDK/modules and CSP HTTP headers at mobile/desktop IT/EN has no script/console/CSP errors');
}finally{await browser.close();}
