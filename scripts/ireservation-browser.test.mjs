import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const out=path.join(os.tmpdir(),'welcomebnb-ireservation-qa');fs.mkdirSync(out,{recursive:true});
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{for(const width of [390,1280])for(const lang of ['it','en']){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(10000);
 await page.route('**/*',r=>r.abort());
 await page.setContent('<html><head><style>'+styles+'</style></head><body style="display:block;padding:15px"><div id="panel-settings" class="panel active"><div id="ireservationSettings" data-guide="ireservation-settings"></div></div></body></html>');
 await page.addScriptTag({path:new URL('../host-ireservation.js',import.meta.url).pathname});
 await page.addScriptTag({content:`
 window.ctx={propertyId:'p1',lang:${JSON.stringify(lang)},readOnly:false};window.requests=[];window.confirmResult=true;window.confirm=()=>confirmResult;
 window.fixture={connection:{configured:false,version:'none',calendar_id:null,verified_at:null},mappingVersion:'m0',mappings:[],failSave:false,disabled:false,delayCompare:false,calendar:[{id:'same-booking',booking_code:'STABLE',status:'active'}]};
 window.report={counts:{fetched:2,review:1,quarantined:1},items:[{id:'<img src=x onerror=alert(1)>',distributor:17,status:'I',checkin:'2026-10-01',checkout:'2026-10-03',outcome:'review'}],coverage:'unverified',can_cutover:false};
 window.panel=IreservationPanel.create({root:document.getElementById('ireservationSettings'),context:()=>ctx,request:async(action,data,owner)=>{
  requests.push({action,data:structuredClone(data),owner});
  if(action==='status'){if(fixture.disabled)throw {code:'integration_disabled'};return owner==='p2'?{configured:false,version:'none'}:structuredClone(fixture.connection);}
  if(owner!==ctx.propertyId)throw {code:'connection_changed'};
  if(action==='save'){if(fixture.failSave)throw {code:'connection_changed'};fixture.connection={configured:true,version:'c1',calendar_id:data.calendar_id,verified_at:null};return structuredClone(fixture.connection);}
  if(action==='verify'){fixture.connection={...fixture.connection,verified:true,verified_at:'2026-10-24T08:00:00Z'};return structuredClone(fixture.connection);}
  if(action==='catalog')return {version:fixture.mappingVersion,mappings:structuredClone(fixture.mappings),local_rooms:[{id:'room-a',name:'Same room name'},{id:'room-b',name:'Second room'}],provider_rooms:[{id:104,type:'room',name:'Same room name'},{id:105,type:'room',name:'<img src=x>'}],distributors:[{idDistributor:17,nameDistributor:'Fixture'}]};
  if(action==='save_mapping'){if(data.mappings.some(m=>m.strategy!=='unmapped'&&!m.confirmed))throw {code:'mapping_confirmation_required'};fixture.mappingVersion='m1';fixture.mappings=data.mappings;return {version:'m1',mappings:structuredClone(data.mappings),report:null};}
  if(action==='compare'){if(data.fromDate>data.toDate)throw {code:'comparison_range_invalid'};if(fixture.delayCompare)await new Promise(resolve=>window.resolveLate=resolve);return {report:structuredClone(report)};}
  if(action==='disconnect'){fixture.connection={configured:false,version:'c2'};return structuredClone(fixture.connection);}
  throw Error('unexpected action');
 }});window.panelReady=panel.load();
 `});
 await page.evaluate(()=>panelReady);assert.deepEqual(errors,[],'fixture loads actual component');
 const text=(it,en)=>lang==='it'?it:en;
 const button=(it,en)=>page.getByRole('button',{name:text(it,en),exact:true});
 await button('Connetti','Connect').click();
 await page.locator('[data-ir-field=calendar]').fill('330');await page.locator('[data-ir-field=username]').fill('fixture-user');await page.locator('[data-ir-field=password]').fill('fixture-password');
 await page.evaluate(()=>fixture.failSave=true);await button('Salva connessione','Save connection').click();
 await page.waitForFunction(()=>document.querySelector('dialog [role=status]').textContent.includes('configurazione')||document.querySelector('dialog [role=status]').textContent.includes('Configuration'));
 assert.equal(await page.locator('[data-ir-field=password]').inputValue(),'fixture-password','failed save retains the unsubmitted draft');
 await page.evaluate(()=>fixture.failSave=false);await button('Salva connessione','Save connection').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.equal(await page.locator('input[type=password]').count(),0,'saved password removed from DOM');
 await button('Verifica connessione','Check connection').click();await page.waitForFunction(()=>document.querySelector('#ireservationSettings').textContent.includes('verificata')||document.querySelector('#ireservationSettings').textContent.includes('verified'));
 await button('Associa camere','Match rooms').click();await page.waitForSelector('dialog select');
 assert.equal(await page.locator('[data-ir-provider="104"]').inputValue(),'','matching labels never auto-map');assert.equal(await page.locator('dialog img').count(),0,'provider labels are text');
 await page.locator('[data-ir-provider="104"]').selectOption('room-a');await button('Salva associazioni','Save room mapping').click();
 await page.waitForFunction(()=>document.querySelector('dialog [role=status]').textContent.length>0&&!document.querySelector('dialog button').disabled);
 assert.equal(await page.locator('[data-ir-provider="104"]').inputValue(),'room-a');
 await page.locator('[data-ir-confirm="104"]').check();await page.screenshot({path:path.join(out,'mapping-'+width+'-'+lang+'.png')});
 await button('Salva associazioni','Save room mapping').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 await button('Confronta prenotazioni','Compare bookings').click();await page.waitForSelector('[data-ir-field=from]');
 await page.locator('[data-ir-field=from]').fill('2026-10-01');await page.locator('[data-ir-field=to]').fill('2026-10-31');await button('Esegui confronto','Run comparison').click();
 await page.waitForFunction(()=>document.querySelector('dialog').textContent.includes('Calendario invariato')||document.querySelector('dialog').textContent.includes('Calendar unchanged'));
 assert.equal(await page.locator('dialog img').count(),0,'booking references cannot inject markup');
 assert.equal(await page.evaluate(()=>JSON.stringify(fixture.calendar)),JSON.stringify([{id:'same-booking',booking_code:'STABLE',status:'active'}]));
 await page.screenshot({path:path.join(out,'report-'+width+'-'+lang+'.png')});
 const size=await page.locator('dialog').boundingBox();assert.ok(size.x>=0&&size.x+size.width<=width,'dialog fits viewport');
 await page.locator('[data-ir-field=from]').fill('2026-11-01');await page.evaluate(()=>confirmResult=false);await button('Chiudi','Close').click();assert.equal(await page.locator('dialog').count(),1,'dirty cancel respects keep editing');
 await page.evaluate(()=>confirmResult=true);await button('Chiudi','Close').click();
 // Late response for property A must never repaint property B.
 await button('Confronta prenotazioni','Compare bookings').click();await page.waitForSelector('[data-ir-field=from]');
 await page.evaluate(()=>fixture.delayCompare=true);await button('Esegui confronto','Run comparison').click();await page.waitForFunction(()=>typeof resolveLate==='function');
 await page.evaluate(async()=>{ctx.propertyId='p2';await panel.load();resolveLate();});await page.waitForTimeout(30);
 assert.equal(await page.locator('dialog').count(),0);assert.equal(await button('Connetti','Connect').count(),1);assert.equal((await page.locator('#ireservationSettings').textContent()).includes('<img'),false);
 await page.evaluate(()=>{ctx.lang=ctx.lang==='it'?'en':'it';panel.repaint();});assert.equal(await page.getByRole('button',{name:lang==='it'?'Connect':'Connetti',exact:true}).count(),1);
 await page.evaluate(async()=>{fixture.disabled=true;await panel.load();});assert.equal(await page.getByRole('button',{name:lang==='it'?'Connect':'Connetti',exact:true}).isDisabled(),true);
 const before=await page.evaluate(()=>requests.length);await page.evaluate(async()=>{ctx.readOnly=true;await panel.load();});assert.equal(await page.evaluate(()=>requests.length),before,'admin/read-only mode performs no private requests');
 await page.addScriptTag({path:new URL('../host-guides.js',import.meta.url).pathname});const guide=await page.evaluate(()=>window.__checkGuides());assert.deepEqual(guide.missingTargets,[],'Settings guide targets exist');
 assert.deepEqual(errors,[]);await page.close();console.log('PASS iReservation actual dialogs '+width+'px '+lang+': save/failure/secrets, explicit mapping, read-only report, cancellation, switch race, unavailable/admin gates and guide targets');
}}finally{await browser.close();}
