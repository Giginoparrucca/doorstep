// Actual host form, router, save/restore functions and photo editor; fictional transport only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
function fn(name){let a=html.indexOf('function '+name+'(');assert.ok(a>=0,name);if(html.slice(a-6,a)==='async ')a-=6;return html.slice(a,html.indexOf('\n}\n',a)+2);}
const markup=html.slice(html.indexOf('<div class="panel" id="panel-property"'),html.indexOf('<div class="panel" id="panel-rules"'));
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const out=process.env.PROPERTY_TEST_OUTPUT_DIR||path.join(os.tmpdir(),'welcomebnb-property-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {for(const width of [390,1280])for(const lang of ['it','en']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',route=>route.abort());
 await page.route('https://round57.example.invalid/',route=>route.fulfill({body:'<!doctype html><html><body></body></html>',contentType:'text/html'}));await page.goto('https://round57.example.invalid/'); // No production transport or real image requests.
 await page.setContent('<html><head><style>'+styles+'</style></head><body style="display:block;padding:16px"><div id="sidebar"></div><div id="sidebarOverlay"></div><div id="propSwitcher"></div><h1 id="panelTitle"></h1><p id="panelSubtitle"></p><div id="sidebarUserName"></div><div id="sidebarAvatar"></div>'+markup+'</body></html>');
 for(const src of ['lib/cover-layout.js','host-property-editor.js'])await page.addScriptTag({path:new URL('../'+src,import.meta.url).pathname});
 const ht=html.slice(html.indexOf('const HT ='),html.indexOf('\nfunction h('));
 const declaration=html.slice(html.indexOf('const propertyEditor ='),html.indexOf('function startPropertyEdit('));
 const funcs=['h','_i18nHydrateField','_i18nRenderPill','_i18nSetLang','_i18nCollect','_numOrNull','fillPropertyForm','_setPropertyEditControls','startPropertyEdit','cancelPropertyEdit','savePropertyEdit','saveProperty','showPanel','switchProperty','handleCoverUpload','chooseCoverPhoto'].map(fn).join('\n');
 await page.addScriptTag({content:`
 var hostLang=${JSON.stringify(lang)},propertyId='p1',propertyData={id:'p1',name:'Fictional farmhouse',city:'Roma',region:'Lazio',property_type:'villa',host_names:'Sample host',hero_image_url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="400" height="600" fill="#9d572e"/><rect x="400" width="400" height="600" fill="#83a880"/><rect x="800" width="400" height="600" fill="#6f94b5"/></svg>'),hero_image_layout:{zoom:1.2,x:40,y:60},welcome_message_it:'Benvenuti',welcome_message_en:'Welcome'},allProperties=[],propertyEditMode=false,_taxRulesDraft=[],_taxDeclaredDraft=[],IS_ADMIN_VIEW=false,_adminEditEnabled=false;
 allProperties=[propertyData,{id:'p2',name:'Second fixture',property_type:'apartment'}];
 window.writes=[];window.uploads=[];window.failSave=false;window.failUpload=false;window.zeroRows=false;window.saveDelay=0;window.notices=[];
 const sb={from(table){let update,id;const q={update(v){update=v;return q;},eq(k,v){id=v;return q;},select(){return q;},async maybeSingle(){await new Promise(r=>setTimeout(r,window.saveDelay));writes.push({table,id,update});return {data:window.zeroRows?null:{id},error:window.failSave?{message:'Fixture save failed'}:null};}};return q;},storage:{from(){return {async upload(path,file){uploads.push({path,type:file.type});return {error:window.failUpload?{message:'Fixture storage failed'}:null};},getPublicUrl(path){return {data:{publicUrl:'https://images.example.invalid/'+path}};}};}}};
 const IT_REGIONS=['Lazio'];function _populatePropRegionOptions(){document.getElementById('propRegion').innerHTML='<option value=""></option><option value="Lazio">Lazio</option>';}function regionFromCity(){return '';}
 function refreshPayTouristLink(){}function onToggleRotatingLockbox(){}function renderIcalFeeds(){}function renderIcalExportCard(){}function loadAlloggiatiCard(){}function renderTaxConfigPanel(){}function renderDismissedList(){}function renderPropertySwitcher(){}function collectIcalFeeds(){return [];}function toast(msg){notices.push(msg);}function track(){}function panelSection(){return 'prop';}function _paintSidebarActive(){}function _renderSectionTabs(){}function _writeLastTab(){}function _writeLastSection(){}function trackPanelSwitch(){}function setHostLang(v){hostLang=v;}function refreshChatBadge(){}async function loadPropertyData(){}function setConsoleReadOnly(){}
 const titles={property:['Property',''],settings:['Settings','']};
 ${ht}\n${declaration}\n${funcs}
 fillPropertyForm(propertyData);document.getElementById('panel-property').classList.add('active');
 document.querySelectorAll('[data-h]').forEach(el=>{el.textContent=h(el.dataset.h);});
 `});
 assert.deepEqual(errors,[], 'fixture scripts load');
 const visible=async id=>page.locator('#panel-'+id).evaluate(el=>el.classList.contains('active'));
 const dirty=()=>page.evaluate(()=>propertyEditor.dirty());
 const openEdit=async()=>{await page.evaluate(()=>showPanel('property'));await page.locator('#propertyEditBtn').click();};
 const navigate=()=>page.evaluate(()=>{void showPanel('settings');});
 const choose=async choice=>{await page.locator('dialog [data-choice="'+choice+'"]').click();await page.waitForFunction(()=>!document.querySelector('dialog'));};
 await page.locator('#propertyEditBtn').click();assert.equal(await dirty(),false);
 await page.evaluate(()=>_i18nSetLang('welcome_message',hostLang==='it'?'en':'it'));assert.equal(await dirty(),false,'language toggle alone stays clean');
 await page.locator('#propName').fill('Changed');assert.equal(await dirty(),true);await page.locator('#propName').fill('Fictional farmhouse');assert.equal(await dirty(),false,'reverted value is clean');
 await page.locator('#propType').selectOption('agriturismo');await navigate();await navigate();assert.equal(await page.locator('dialog').count(),1);assert.equal(await visible('property'),true);await choose('stay');assert.equal(await dirty(),true);
 await navigate();await page.keyboard.press('Escape');assert.equal(await visible('property'),true);
 await page.evaluate(()=>window.failSave=true);await navigate();await choose('save');await page.waitForFunction(()=>_propertySavePending===null);assert.equal(await visible('property'),true);assert.equal(await dirty(),true);assert.equal(await page.locator('#propType').inputValue(),'agriturismo');
 await page.evaluate(()=>{window.failSave=false;window.zeroRows=true;});await navigate();await choose('save');await page.waitForFunction(()=>_propertySavePending===null);assert.equal(await visible('property'),true);assert.equal(await dirty(),true);
 await page.evaluate(()=>{window.zeroRows=false;window.saveDelay=100;});await navigate();await choose('save');await page.waitForFunction(()=>document.getElementById('panel-settings').classList.contains('active'));assert.equal(await page.evaluate(()=>propertyData.property_type),'agriturismo');assert.equal(await dirty(),false);
 // Discard restores text + original framing, without writing.
 await openEdit();await page.locator('#propName').fill('Discard me');const count=await page.evaluate(()=>writes.length);await navigate();await choose('discard');assert.equal(await visible('settings'),true);assert.equal(await page.locator('#propName').inputValue(),'Fictional farmhouse');assert.equal(await page.evaluate(()=>writes.length),count);
 // Property switch cannot lose unsaved bilingual changes.
 await openEdit();await page.locator('#propWelcome').fill('Edited language');await page.evaluate(()=>_i18nSetLang('welcome_message',document.getElementById('propWelcome').dataset.lang==='it'?'en':'it'));assert.equal(await dirty(),true);
 await page.evaluate(()=>{void switchProperty('p2');});await choose('stay');assert.equal(await page.evaluate(()=>propertyId),'p1');
 await page.evaluate(()=>{void switchProperty('p2');});await choose('discard');await page.waitForFunction(()=>propertyId==='p2');assert.deepEqual(errors,[]);assert.equal(await page.locator('#coverPhotoPreview').isVisible(),false,'property without photo clears old image');
 await page.evaluate(()=>switchProperty('p1'));await openEdit();
 // Framing controls have real keyboard behavior and no blank edges at any zoom.
 await page.locator('#coverFrame-zoom').focus();await page.keyboard.press('ArrowRight');assert.equal(await dirty(),true);
 await page.evaluate(()=>{const x=document.getElementById('coverFrame-x');x.value=0;x.dispatchEvent(new Event('input',{bubbles:true}));});assert.match(await page.locator('#coverPhotoPreview').getAttribute('style'),/scale\(1.21\)/);
 await page.locator('#coverFrameCenter').click();assert.equal(await page.locator('#coverFrame-x').inputValue(),'50');await page.locator('#coverFrameReset').click();assert.equal(await page.locator('#coverFrame-zoom').inputValue(),'1');
 // File validation, decode failure, staged replacement and cancel.
 await page.locator('#coverPhotoInput').setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});assert.equal(await page.evaluate(()=>uploads.length),0);assert.match(await page.locator('#coverPhotoStatus').textContent(),/JPG/);
 await page.locator('#coverPhotoInput').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});await page.waitForFunction(()=>document.getElementById('coverPhotoStatus').textContent.includes(hostLang==='it'?'Impossibile':'Cannot'));
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=600;const g=c.getContext('2d');g.fillStyle='#8ab89d';g.fillRect(0,0,1200,600);return c.toDataURL('image/png').split(',')[1];});
 await page.route('https://images.example.invalid/**',route=>route.fulfill({body:Buffer.from(png,'base64'),contentType:'image/png'}));
 await page.locator('#coverPhotoInput').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>document.getElementById('coverPhotoStatus').textContent.includes(hostLang==='it'?'pronta':'ready'));assert.equal(await page.evaluate(()=>uploads.length),0,'selection does not persist');assert.match(await page.locator('#coverPhotoPreview').getAttribute('src'),/^blob:/);
 await page.locator('#propertyCancelBtn').click();assert.match(await page.locator('#coverPhotoPreview').getAttribute('src'),/^data:/);assert.equal(await page.locator('#coverFrame-zoom').inputValue(),'1.2');assert.equal(await dirty(),false);
 await openEdit();await page.locator('#coverPhotoInput').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForFunction(()=>document.getElementById('coverPhotoStatus').textContent.includes(hostLang==='it'?'pronta':'ready'));
 await page.evaluate(()=>window.failUpload=true);await page.locator('#propertySaveBtn').click();await page.waitForFunction(()=>_propertySavePending===null);assert.equal(await dirty(),true);assert.ok((await page.evaluate(()=>notices.at(-1))).includes('Fixture storage failed'));
 await page.evaluate(()=>{window.failUpload=false;window.failSave=true;});await page.locator('#propertySaveBtn').click();await page.waitForFunction(()=>_propertySavePending===null);const uploadCount=await page.evaluate(()=>uploads.length);assert.equal(await dirty(),true);
 await page.evaluate(()=>{window.failSave=false;});await page.evaluate(()=>{void savePropertyEdit();void savePropertyEdit();void switchProperty('p2');});await page.waitForFunction(()=>_propertySavePending===null);assert.equal(await page.evaluate(()=>uploads.length),uploadCount,'DB retry reuses successful upload');assert.equal(await page.evaluate(()=>propertyId),'p1','cannot switch while saving');assert.equal(await dirty(),false);assert.match(await page.evaluate(()=>propertyData.hero_image_url),/^https:\/\/images.example.invalid\/covers\/p1_/);
 await openEdit();await page.locator('#propName').fill('Unsaved');const unload=await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;});assert.equal(unload,true);
 await page.evaluate(()=>{IS_ADMIN_VIEW=true;_adminEditEnabled=false;});assert.equal(await page.evaluate(()=>savePropertyEdit()),false,'read-only admin denied');await page.evaluate(()=>{IS_ADMIN_VIEW=false;cancelPropertyEdit();});
 assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),false);
 await openEdit();await page.locator('#propName').fill('Unsaved');await navigate();await page.screenshot({path:path.join(out,`save-prompt-${width}-${lang}.png`),fullPage:true});await choose('stay');await page.locator('#propertyCancelBtn').click();await openEdit();await page.locator('#coverPhotoZone').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,`cover-editor-${width}-${lang}.png`)});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile overflow');assert.deepEqual(errors,[]);
 await page.close();console.log(`PASS ${width}px ${lang}: actual form/router save, deny/failed/zero-row save, all prompt actions, bilingual dirtiness, property switch, keyboard framing, invalid/decode/upload failures, draft/cancel/retry, save concurrency, admin denial and unload guard`);
}
 // Guest hero: actual CSS/markup and the same persisted metadata at both viewport sizes.
 const guest=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const guestStyles=[...guest.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
 for (const width of [390,1280]) {
   const page=await browser.newPage({viewport:{width,height:700}});
   await page.setContent('<html><head><style>'+guestStyles+'</style></head><body><div class="welcome-hero"><img class="welcome-hero-img" id="heroImg" alt="Fixture"></div></body></html>');
   await page.addScriptTag({path:new URL('../lib/cover-layout.js',import.meta.url).pathname});
   await page.evaluate(async()=>{const img=document.getElementById('heroImg');img.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="400" height="600" fill="#9d572e"/><rect x="400" width="400" height="600" fill="#83a880"/><rect x="800" width="400" height="600" fill="#6f94b5"/></svg>');await img.decode();});
   for(const zoom of [1,1.8,3])for(const x of [0,50,100])for(const y of [0,50,100]) {
     const cover=await page.evaluate(layout=>{const img=document.getElementById('heroImg');CoverLayout.apply(img,layout);const a=img.getBoundingClientRect(),b=img.parentElement.getBoundingClientRect();return {left:a.left<=b.left+.1,top:a.top<=b.top+.1,right:a.right>=b.right-.1,bottom:a.bottom>=b.bottom-.1};},{zoom,x,y});
     assert.ok(Object.values(cover).every(Boolean),'framing keeps every edge covered');
   }
   await page.evaluate(()=>CoverLayout.apply(document.getElementById('heroImg'),{zoom:1.8,x:30,y:70}));
   await page.screenshot({path:path.join(out,`guest-cover-${width}.png`)});
   await page.close();
 }
 console.log('PASS actual guest hero CSS at 390/1280px: shared persisted framing and image coverage at min/max zoom and all positioning extremes');
}finally{await browser.close();}
