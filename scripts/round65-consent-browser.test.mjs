import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fn(name){let start=html.indexOf('function '+name+'(');assert.ok(start>=0);if(html.slice(start-6,start)==='async ')start-=6;return html.slice(start,html.indexOf('\n}\n',start)+2);}
const start=html.indexOf('<div id="consentCard"');let depth=0,end;
const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=start;let tag;
while((tag=tags.exec(html))){depth+=tag[0].startsWith('</')?-1:1;if(depth===0){end=tags.lastIndex;break;}}
assert.ok(end);const markup=html.slice(start,end);
const translations=html.slice(html.indexOf('const T ='),html.indexOf('\nfunction setLang('));
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const out=path.join(os.tmpdir(),'round65-consent-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{for(const width of [390,1440])for(const language of ['it','en']){
 const page=await browser.newPage({viewport:{width,height:900}});let status=429;const requests=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
 await page.route('https://round65-consent.example.invalid/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'}));
 await page.route('https://round65-consent.example.invalid/api/guest',async route=>{
  assert.equal(route.request().method(),'POST');assert.equal(route.request().headers().authorization,'Bearer fictional-token');
  const body=route.request().postDataJSON();requests.push(body);
  assert.deepEqual(body,{action:'consent_save',email:'guest@example.invalid',phone:null,consent:true});
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{ok:true}:{error:'Too many consent changes'})});
 });
 await page.goto('https://round65-consent.example.invalid/');
 await page.addStyleTag({content:styles+' body{display:block;padding:16px}'});await page.locator('body').evaluate((el,markup)=>el.innerHTML=markup,markup);
 await page.addScriptTag({content:`let lang=${JSON.stringify(language)},IS_TEST_SESSION=false,propertyId='fictional-property';${translations}
 function trackGuest(){} async function _authedAIFetch(url,init){return fetch(url,{...init,headers:{...init.headers,Authorization:'Bearer fictional-token'}});}
 ${fn('_guestCall')}\n${fn('toggleConsentFields')}\n${fn('saveMarketingConsent')}
 document.getElementById('consentCard').style.display='block';document.querySelectorAll('[data-i18n]').forEach(el=>el.textContent=T[lang][el.dataset.i18n]||el.textContent);`});
 assert.equal(requests.length,0);await page.locator('#consentCheckbox').check();await page.locator('#consentSaveBtn').click();
 assert.equal(requests.length,0);assert.equal(await page.locator('#consentErr').isVisible(),true);
 await page.locator('#consentEmail').fill('guest@example.invalid');await page.locator('#consentSaveBtn').click();
 await page.waitForFunction(()=>!document.getElementById('consentSaveBtn').disabled);
 assert.equal(requests.length,1);assert.equal(await page.locator('#consentSavedMsg').isVisible(),false);assert.equal(await page.locator('#consentErr').isVisible(),true);
 status=200;await page.locator('#consentSaveBtn').click();await page.locator('#consentSavedMsg').waitFor({state:'visible'});
 assert.equal(requests.length,2);assert.equal(await page.locator('#consentFields').isVisible(),false);assert.deepEqual(errors,[]);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(out,`${language}-${width}.png`),fullPage:true});await page.close();
}console.log('PASS actual consent card/save code/translations at mobile/desktop IT/EN: no implicit opt-in, empty contact, signed same-origin whitelist, rate-error retry and persisted-success UI; fictional transport only.');}
finally{await browser.close();}
