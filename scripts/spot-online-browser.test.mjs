// Exercise the actual host integration and download UI with synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
const integration=source.slice(source.indexOf('let _regionalExportController ='),source.indexOf('\nfunction renderExportChecklist()'));
const detectStart=source.indexOf("  if (data.region === 'Puglia' && !data.regional_service && typeof Cin !== 'undefined')");
const detection=source.slice(detectStart,source.indexOf("  if (el('propRoomsAvailable'))",detectStart));
const fixture=JSON.parse(fs.readFileSync(new URL('./golden/synthetic/spot-online-fixtures.json',import.meta.url)));
const output=process.env.SPOT_TEST_OUTPUT_DIR||path.join(os.tmpdir(),'spot-online-browser');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try{for(const width of [390,1280])for(const lang of ['it','en']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/*',r=>r.abort());await page.route('https://spot.example.invalid/',r=>r.fulfill({body:'<html><body></body></html>',contentType:'text/html'}));await page.goto('https://spot.example.invalid/');
 await page.setContent('<html><head><style>'+styles+'</style></head><body style="display:block;padding:16px"><div id="regionalTile"></div><select id="propRegionalService"><option value=""></option><option value="spot_online">Online</option><option value="spot_easy">Easy</option></select></body></html>');
 for(const file of ['lib/alloggiati-records.js','lib/regional-exports.js','lib/cin.js','host-regional-exports.js'])await page.addScriptTag({path:new URL('../'+file,import.meta.url).pathname});
 await page.addScriptTag({content:`var hostLang=${JSON.stringify(lang)},propertyId='p1',propertyData=${JSON.stringify({...fixture.property,name:'Fictional B&B',city:'Ostuni',regional_service:null})},allRooms=[{id:'A',beds:2},{id:'B',beds:2}];window.fixture=${JSON.stringify(fixture)};window.rows=structuredClone(fixture.rows);window.updates=[];window.saveFailure=false;window.delay=0;window.saveDelay=0;window.reads=0;window.panel=null;const sb={from(table){let id,patch;const q={select(){return q;},update(value){patch=value;return q;},eq(k,v){if(k==='id'||k==='property_id')id=v;return q;},is(){return q;},order(){return q;},async single(){updates.push({id,patch});await new Promise(r=>setTimeout(r,saveDelay));return saveFailure?{data:null,error:null}:{data:{id},error:null};},async range(a,b){reads++;await new Promise(r=>setTimeout(r,delay));return {data:rows.slice(a,b+1),error:null};}};return q;}};async function showPanel(name){window.panel=name;}function comuneCodeFromCity(city){return AllogRecords.lookupPoliceCode(city);} function el(id){return document.getElementById(id);}window.toasts=[];function toast(message){toasts.push(message);}function fireDetect(data){${detection}} ${integration}`});
 // Execute the real property-load detection block, including asynchronous stale guards.
 await page.evaluate(()=>{propertyData.property_type='bnb';fireDetect(propertyData);});
 await page.waitForFunction(()=>propertyData.regional_service==='spot_online');
 assert.match(await page.evaluate(()=>toasts[0]),lang==='it'?/rilevato automaticamente/:/auto-detected/);
 assert.equal(await page.locator('#propRegionalService').inputValue(),'spot_online');
 await page.evaluate(()=>{saveDelay=100;propertyData={id:'old',region:'Puglia',property_type:'bnb',regional_service:null};propertyId='old';fireDetect(propertyData);propertyId='p1';propertyData={...fixture.property,name:'Fictional B&B',city:'Ostuni',regional_service:'spot_easy'};});
 await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>propertyData.regional_service),'spot_easy');assert.equal(await page.evaluate(()=>toasts.length),1);
 await page.evaluate(()=>{saveDelay=0;updates=[];propertyData={...fixture.property,name:'Fictional B&B',city:'Ostuni',regional_service:null};document.getElementById('propRegionalService').value='';});
 await page.evaluate(()=>renderRegionalTile());assert.match(await page.locator('#regionalTile').textContent(),lang==='it'?/scegli servizio/:/choose service/);
 const open=async()=>{await page.locator('[data-regional-open]').click();await page.locator('[data-field=start]').fill(fixture.start);await page.locator('[data-field=end]').fill(fixture.end);};
 const load=async()=>{await page.locator('[data-load]').click();await page.waitForSelector('[data-confirm]');};
 const close=async()=>{if(await page.locator('dialog').count())await page.locator('dialog [data-close]').click();};
 const choose=async()=>{await page.locator('[data-format]').selectOption('spot_online');await page.waitForFunction(()=>!document.querySelector('[data-load]').disabled);};
 // The first choice must save before Prepare data; zero rows is an explicit failure.
 await open();await page.evaluate(()=>saveFailure=true);await choose();assert.match(await page.locator('[data-status]').textContent(),lang==='it'?/non salvato/:/not saved/);assert.equal(await page.evaluate(()=>propertyData.regional_service),null);
 await page.evaluate(()=>saveFailure=false);await choose();assert.equal(await page.evaluate(()=>propertyData.regional_service),'spot_online');assert.equal(await page.locator('#propRegionalService').inputValue(),'spot_online');assert.match(await page.locator('#regionalTile').textContent(),/SPOT Online XML/);
 await load();assert.equal(await page.locator('[data-row="3"][data-key="_bedOccupancy"]').inputValue(),'si');assert.equal(await page.locator('[data-age="3"]').textContent(),'1');assert.equal(await page.locator('[data-date="2026-05-03"][data-day-key=occupied]').inputValue(),'1','checkout rooms must not count as occupied that night');
 assert.match(await page.locator('[data-review]').textContent(),lang==='it'?/primo giorno.*non ancora trasmesso/:/first day.*not yet transmitted/);
 assert.equal(await page.locator('[data-carry-warning]').isVisible(),true);assert.equal(await page.locator('[data-startup]').isChecked(),false);
 await page.locator('[data-row="3"][data-key="_bedOccupancy"]').selectOption('no');
 for(const [date,day] of Object.entries(fixture.daily)){await page.locator(`[data-date="${date}"][data-day-key=open]`).selectOption(day.open);}
 const download=async(startup)=>{await page.locator('[data-startup]').setChecked(startup);await page.locator('[data-confirm]').check();const event=page.waitForEvent('download');await page.locator('[data-download]').click();const d=await event;assert.equal(d.suggestedFilename(),'spot_online_2026-05-01_2026-05-08.xml');return fs.readFileSync(await d.path(),'utf8');};
 for(const startup of [false,true,false]){const content=await download(startup);assert.equal(content,fs.readFileSync(new URL('./golden/synthetic/spot-online'+(startup?'-startup':'')+'-expected.xml',import.meta.url),'utf8'));assert.equal(await page.locator('[data-carry-warning]').isVisible(),!startup);}
 assert.match(await page.locator('[data-status]').textContent(),/Carica movimentazione.*Invia movimentazione/);assert.equal(await page.evaluate(()=>updates.length),2,'only preference saves, no filing or guest writes');
 // A corrected guest input resets confirmation and makes invalid residence actionable.
 await page.locator('[data-review]>details>summary').click();await page.locator('[data-guest="1"]>summary').click();
 const residence=page.locator('[data-row="1"][data-key=residence_country]');await residence.fill('');assert.equal(await page.locator('[data-confirm]').isChecked(),false);
 const blocked=async(pattern)=>{await page.locator('[data-confirm]').check();await page.locator('[data-download]').click();assert.match(await page.locator('[data-errors]').textContent(),pattern);};
 await blocked(lang==='it'?/Stato di residenza/:/Country of residence/);await residence.fill('Italy');
 const comune=page.locator('[data-row="1"][data-key=residence_place]');await comune.fill('Castro');await blocked(lang==='it'?/ambiguo/:/ambiguous/);await comune.fill('Milano');
 const capacity=page.locator('[data-date="2026-05-02"][data-day-key=beds]');await capacity.fill('');await blocked(lang==='it'?/verifica unità/:/check units/);await capacity.fill('4');
 await page.locator('[data-date="2026-05-02"][data-day-key=open]').selectOption('NO');await blocked(lang==='it'?/giornata chiusa/:/closed day/);
 await close();await open();assert.equal(await page.locator('[data-saved-service]').count(),1);assert.equal(await page.locator('[data-persist-service]').count(),0);
 await page.locator('[data-change-service]').click();assert.equal(await page.locator('dialog').count(),0);assert.equal(await page.evaluate(()=>window.panel),'property');assert.equal(await page.locator('#propRegionalService').evaluate(e=>e===document.activeElement),true);
 // Pending reads and preference saves must not bleed into another property's state.
 await open();await page.evaluate(()=>{delay=100;});await page.locator('[data-load]').click();await page.evaluate(()=>{propertyId='p2';propertyData={id:'p2',region:'Puglia',regional_service:null};renderRegionalTile();});await page.waitForTimeout(150);assert.equal(await page.locator('dialog').count(),0);
 await open();await page.evaluate(()=>saveDelay=100);await page.locator('[data-format]').selectOption('spot_online');await page.evaluate(()=>{propertyId='p3';propertyData={id:'p3',region:'Puglia',regional_service:'spot_easy'};renderRegionalTile();});await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>propertyData.regional_service),'spot_easy');assert.equal(await page.locator('dialog').count(),0);
 // Even without a render notification, a stale chooser cannot write the new property.
 await page.evaluate(()=>{propertyId='p1';propertyData={...fixture.property,regional_service:null};renderRegionalTile();});await open();
 const before=await page.evaluate(()=>updates.length);await page.evaluate(()=>{propertyId='no-render';propertyData={id:'no-render',region:'Puglia',regional_service:'spot_easy'};});await page.locator('[data-format]').selectOption('spot_online');
 assert.equal(await page.evaluate(()=>updates.length),before);assert.equal(await page.locator('dialog').count(),0);
 // Screenshot a complete, valid XML review for each width/language.
 await page.evaluate(()=>{propertyId='p1';propertyData={...fixture.property,name:'Fictional B&B',city:'Ostuni'};delay=0;saveDelay=0;renderRegionalTile();});await open();await load();
 await page.locator('[data-row="3"][data-key="_bedOccupancy"]').selectOption('no');await page.screenshot({path:path.join(output,`spot-${width}-${lang}.png`)});
 assert.ok(await page.evaluate(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&d.scrollWidth<=d.clientWidth+1;}),'review fits viewport');
 assert.deepEqual(errors,[]);await page.close();console.log(`PASS SPOT ${width}px ${lang}: saved/ask service, denied save, real golden downloads startup on/off, child bed/age, capacities, residence errors, change-service navigation, stale reads/saves and responsive UI`);
}}finally{await browser.close();}
