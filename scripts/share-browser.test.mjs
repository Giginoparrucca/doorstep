// Real browser interaction with the actual Share markup/module, fictional transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const panel=html.slice(html.indexOf('<div class="panel" id="panel-qrlink">'),html.indexOf('<!-- ════════════ GUEST ANALYTICS'));
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 for(const width of [390,1280])for(const lang of ['it','en']) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<html><head><style>'+styles+'</style></head><body style="display:block;padding:20px">'+panel+'</body></html>');
  await page.locator('#panel-qrlink').evaluate(el=>{el.classList.add('active');el.style.display='block';});
  await page.addScriptTag({path:new URL('../host-share.js',import.meta.url).pathname});
  await page.evaluate(async lang=>{
   const rows=[{id:'r1',property_id:'p1',guest_name:'Sample Guest',guest_count:2,booking_code:'SAMPLE-1',entry_type:'reservation',status:'active',checkin_date:'2099-10-14',checkout_date:'2099-10-17'},{id:'r2',property_id:'p1',guest_name:'Another Guest',booking_code:'SAMPLE-2',entry_type:'reservation',status:'active',checkin_date:'2099-11-01',checkout_date:'2099-11-04'}];
   const prefs=[];window.copied=[];window.opened=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});window.open=(url)=>{window.opened.push(url);return {};};
   const sb={from(table){let prop,payload;const q={select(){return q;},eq(k,v){prop=v;return q;},order(){return q;},range(){return Promise.resolve({data:table==='ota_reservations'?rows:[]});},upsert(v){payload=v;return q;},then(resolve,reject){if(payload)prefs.push(payload);return Promise.resolve({data:prefs}).then(resolve,reject);}};return q;}};
   window.shareContext={propertyId:'p1',property:{name:'Casa di prova',timezone:'Europe/Rome'},origin:'https://app.welcomebnb.it',lang,mode:'production',sb};
   window.shareController=HostShare.create({root:document.getElementById('hostShareRoot'),context:()=>window.shareContext,ensureCodes:async()=>{}});await shareController.load();
  },lang);
  await page.locator('#shareMessage').fill('Edited for this booking 👋');await page.locator('[data-share-copy]').click();assert.equal(await page.evaluate(()=>copied.at(-1)),'Edited for this booking 👋');
  await page.locator('[data-share-whatsapp]').click();assert.equal(new URL(await page.evaluate(()=>opened.at(-1))).searchParams.get('text'),'Edited for this booking 👋');
  await page.locator('#shareBooking').selectOption('r2');assert.ok(!(await page.locator('#shareMessage').inputValue()).includes('Edited for'));
  await page.locator('#shareBooking').selectOption('r1');assert.equal(await page.locator('#shareMessage').inputValue(),'Edited for this booking 👋');
  await page.locator('[data-share-defaults] summary').click();await page.locator('#shareDefaultTemplate').fill('Hi {guest_name}: {guest_link}');await page.locator('[data-share-save-default]').click();
  await page.locator('[data-share-reset]').click();assert.match(await page.locator('#shareMessage').inputValue(),/Hi Sample Guest/);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.deepEqual(errors,[]);
  await page.screenshot({path:'/workspace/scratch/7e89e5ef8035/share-'+width+'-'+lang+'.png',fullPage:true});await page.close();
  console.log('PASS real browser '+width+'px '+lang+': copy/WhatsApp/booking drafts/private defaults/reset and responsive layout');
 }
}finally{await browser.close();}
