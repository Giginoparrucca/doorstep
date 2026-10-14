// Real browser interaction with the actual Share markup/module, fictional transport.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const outputDir=process.env.SHARE_TEST_OUTPUT_DIR||path.join(os.tmpdir(),'welcomebnb-share-qa');fs.mkdirSync(outputDir,{recursive:true});
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const panel=html.slice(html.indexOf('<div class="panel" id="panel-qrlink">'),html.indexOf('<!-- ════════════ GUEST ANALYTICS'));
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 for(const width of [390,1280])for(const lang of ['it','en']) {
  const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<html><head><style>'+styles+'</style></head><body style="display:block;padding:20px">'+panel+'</body></html>');
  await page.locator('#panel-qrlink').evaluate(el=>{el.classList.add('active');el.style.display='block';});
  await page.addScriptTag({path:new URL('../node_modules/qrcode-generator/qrcode.js',import.meta.url).pathname});
  await page.addScriptTag({path:new URL('../node_modules/jsqr/dist/jsQR.js',import.meta.url).pathname});
  await page.addScriptTag({path:new URL('../host-share.js',import.meta.url).pathname});
  await page.evaluate(async lang=>{
   const rows=[{id:'r1',property_id:'p1',guest_name:'Sample Guest',guest_count:2,booking_code:'SAMPLE-1',entry_type:'reservation',status:'active',checkin_date:'2099-10-14',checkout_date:'2099-10-17'},{id:'r2',property_id:'p1',guest_name:'Another Guest',booking_code:'SAMPLE-2',entry_type:'reservation',status:'active',checkin_date:'2099-11-01',checkout_date:'2099-11-04'}];
   const prefs=[];window.copied=[];window.opened=[];window.nativeOpen=window.open.bind(window);Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copied.push(text)},configurable:true});window.open=(url)=>{window.opened.push(url);return {};};
   const sb={from(table){let prop,payload;const q={select(){return q;},eq(k,v){prop=v;return q;},order(){return q;},range(){return Promise.resolve({data:table==='ota_reservations'?rows:[]});},upsert(v){payload=v;return q;},then(resolve,reject){if(payload)prefs.push(payload);return Promise.resolve({data:prefs}).then(resolve,reject);}};return q;}};
   window.shareContext={propertyId:'p1',property:{name:'Casa di prova',timezone:'Europe/Rome'},origin:'https://app.welcomebnb.it',lang,mode:'production',sb};
   window.shareController=HostShare.create({root:document.getElementById('hostShareRoot'),context:()=>window.shareContext,ensureCodes:async()=>{}});await shareController.load();window.houseController=HostShare.createHouse({root:document.getElementById('houseShareRoot'),context:()=>window.shareContext});houseController.render();
  },lang);
  await page.locator('#shareMessage').fill('Edited for this booking 👋');await page.locator('[data-share-copy]').click();assert.equal(await page.evaluate(()=>copied.at(-1)),'Edited for this booking 👋');
  await page.locator('[data-share-whatsapp]').click();assert.equal(new URL(await page.evaluate(()=>opened.at(-1))).searchParams.get('text'),'Edited for this booking 👋');
  await page.locator('#shareBooking').selectOption('r2');assert.ok(!(await page.locator('#shareMessage').inputValue()).includes('Edited for'));
  await page.locator('#shareBooking').selectOption('r1');assert.equal(await page.locator('#shareMessage').inputValue(),'Edited for this booking 👋');
  await page.locator('[data-share-defaults] summary').click();await page.locator('#shareDefaultTemplate').fill('Hi {guest_name}: {guest_link}');await page.locator('[data-share-save-default]').click();
  await page.locator('[data-share-reset]').click();assert.match(await page.locator('#shareMessage').inputValue(),/Hi Sample Guest/);
  const qrBefore=await page.locator('.house-qr-image').innerHTML();
  await page.locator('#shareBooking').selectOption('r2');assert.equal(await page.locator('.house-qr-image').innerHTML(),qrBefore,'selected guest never changes house QR');
  const decoded=await page.evaluate(async()=>{const svg=document.querySelector('.house-qr-image svg').outerHTML;const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,512,512);return jsQR(ctx.getImageData(0,0,512,512).data,512,512)?.data;});
  assert.equal(decoded,'https://app.welcomebnb.it/?p=p1');
  await page.locator('[data-house-copy]').click();assert.equal(await page.evaluate(()=>copied.at(-1)),decoded);
  const downloadWait=page.waitForEvent('download');await page.locator('[data-house-download]').click();const download=await downloadWait;const downloadPath=await download.path();assert.ok(fs.readFileSync(downloadPath,'utf8').includes('<svg'));assert.equal(download.suggestedFilename(),'welcomebnb-house-qr.svg');
  // A blocked popup leaves honest feedback, then native print opens the clean sheet.
  await page.evaluate(()=>window.open=()=>null);await page.locator('[data-house-print]').click();assert.match(await page.locator('[data-house-feedback]').textContent(),lang==='it'?/bloccata/:/blocked/);
  await page.evaluate(()=>window.open=window.nativeOpen);const popupWait=page.waitForEvent('popup');await page.locator('[data-house-print]').click();const popup=await popupWait;await popup.waitForSelector('.qr svg');assert.equal(await popup.locator('h1').textContent(),'Casa di prova');assert.equal(await popup.locator('a.url').getAttribute('href'),decoded);assert.ok(!(await popup.locator('body').textContent()).includes('SAMPLE-'));
  await popup.emulateMedia({media:'print'});assert.equal(await popup.locator('.tools').isVisible(),false);if(width===1280&&lang==='en')await popup.pdf({path:path.join(outputDir,'house-qr-print.pdf'),format:'A4',printBackground:true});
  await popup.screenshot({path:path.join(outputDir,'house-print-'+width+'-'+lang+'.png'),fullPage:true});await popup.close();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(outputDir,'share-'+width+'-'+lang+'.png'),fullPage:true});await page.close();
  console.log('PASS real browser '+width+'px '+lang+': copy/WhatsApp/booking drafts/private defaults/reset responsive layout; decoded permanent QR, copy/download, blocked popup and actual print sheet');
 }
}finally{await browser.close();}
