// Actual host dialog/status/release functions, fictional HTTP/RPC transport.
import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
function fn(name){let a=source.indexOf('function '+name+'(');if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,source.indexOf('\n}\n',a)+2);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{for(const lang of ['it','en'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://host-entry.example.invalid/',r=>r.fulfill({contentType:'text/html',body:'<button id="open">Entry status</button>'}));await page.goto('https://host-entry.example.invalid/');
 await page.addScriptTag({content:`let APP_CONFIG={entryReleaseUiEnabled:true};let propertyData={entry_checkin_required:true};let hostLang=${JSON.stringify(lang)},propertyId='fictional-property',IS_ADMIN_VIEW=false,_adminEditEnabled=false;
 let version='version-1',released=false,failed=false,unknown=false,visible=false,mutations=[],toasts=[];const toast=m=>toasts.push(m);
 const state=()=>({entry_release:{state:released?'manual':visible?'available':'locked',allow_entry:released,submitted:1,expected:3},summary:unknown?null:{booking_id:'fictional-booking',state_version:version,expected_count:3,released_manually:released,reservation_id:null,arrival_date:'2099-01-01',departure_date:'2099-01-02'},reservation:null});
 const reservationRow={id:'fictional-res',booking_code:'FICTIONAL-BOOK',is_test:false,checkin_date:'2099-01-02',checkout_date:'2099-01-05',guest_count:2,status:'active',deleted_at:null};
 const sb={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:reservationRow,error:null})}),auth:{getSession:async()=>({data:{session:{access_token:'fictional-host'}}})},rpc:async(name,args)=>{mutations.push({name,args});if(args.p_expected_version!==(unknown?null:version))throw Error('wrong optimistic version');version=crypto.randomUUID();unknown=false;if(name==='entry_access_set_release')released=args.p_release;return {data:{booking_id:'fictional-booking',state_version:version}};}};
 window.fetch=async(url,options)=>{if(url!=='/api/guest'||options.cache!=='no-store'||options.headers.Authorization!=='Bearer fictional-host')throw Error('unexpected transport');const b=JSON.parse(options.body);if(b.property_id!==propertyId||b.action!=='host_entry_state')throw Error('wrong scope');return {ok:!failed,json:async()=>state()};};
 ${['entryUiEnabled','readHostEntryState','entryStatusButton','openEntryAccessStatus','releaseEntryManually','restoreAutomaticRelease','entryReleaseControls','_entryReleaseView','_renderEntryReleaseControls','hydrateEntryReleaseControls','refreshEntryReleaseControls','syncEntryRosterAfterEdit'].map(fn).join('\n')}`});
 await page.evaluate(()=>openEntryAccessStatus('FICTIONAL-BOOK','2099-01-01','2099-01-02',false,null,3));
 assert.match(await page.locator('#entryStatusSummary').textContent(),/1\/3/);
 await page.locator('#entryStatusRelease').click();await page.waitForFunction(()=>released&&document.getElementById('entryStatusSummary').textContent.includes(hostLang==='it'?'Rilasciato':'Released'));
 assert.equal(await page.evaluate(()=>mutations.length),2);
 await page.locator('#entryStatusRestore').click();await page.waitForFunction(()=>!released&&document.getElementById('entryStatusSummary').textContent.includes('1/3'));
 assert.equal(await page.evaluate(()=>mutations.length),4);
 const old=await page.evaluate(()=>mutations.length);await page.evaluate(async()=>{for(const n of [null,0,1.5,51])await releaseEntryManually('FICTIONAL-BOOK','2099-01-01','2099-01-02',false,null,n);});assert.equal(await page.evaluate(()=>mutations.length),old,'unknown count never defaults to one');
 await page.evaluate(()=>{failed=true;});await page.locator('#entryStatusRetry').click();await page.waitForFunction(()=>document.getElementById('entryStatusSummary').textContent.includes(hostLang==='it'?'non disponibile':'unavailable'));assert.equal(await page.locator('#entryStatusRelease').isDisabled(),true);
 await page.evaluate(()=>{failed=false;IS_ADMIN_VIEW=true;});await page.locator('#entryStatusRetry').click();await page.waitForFunction(()=>document.getElementById('entryStatusSummary').textContent.includes('1/3'));assert.equal(await page.locator('#entryStatusRelease').isDisabled(),true,'read-only admin cannot invoke mutation');
 await page.evaluate(()=>releaseEntryManually('FICTIONAL-BOOK','2099-01-01','2099-01-02',false,null,3));assert.equal(await page.evaluate(()=>mutations.length),old);
 await page.evaluate(()=>{APP_CONFIG.entryReleaseUiEnabled=false;_adminEditEnabled=true;});await page.locator('#entryStatusRetry').click();await page.waitForFunction(()=>document.getElementById('entryStatusSummary').textContent.includes('1/3'));
 assert.equal(await page.locator('#entryStatusRelease').isDisabled(),true,'rollback pause blocks new overrides');await page.evaluate(()=>restoreAutomaticRelease('FICTIONAL-BOOK','2099-01-01','2099-01-02',false,null,3));assert.equal(await page.evaluate(()=>mutations.length),old);await page.evaluate(()=>APP_CONFIG.entryReleaseUiEnabled=true);
 await page.evaluate(()=>{IS_ADMIN_VIEW=false;unknown=true;});await page.locator('#entryStatusClose').click();await page.evaluate(()=>openEntryAccessStatus('STANDALONE','2099-01-01','2099-01-02',false,null,null));
 assert.equal(await page.locator('#entryRosterCount').inputValue(),'');await page.locator('#entryRosterCount').fill('2');await page.locator('#entryRosterConfirm').click();await page.waitForFunction(()=>mutations.length===5);
 assert.equal(await page.evaluate(()=>mutations.at(-1).args.p_count),2);assert.equal(await page.evaluate(()=>mutations.at(-1).args.p_reservation_id),null);assert.equal(await page.evaluate(()=>mutations.at(-1).args.p_expected_version),null);
 // Inline status-aware control (reservation rows, calendar detail, dashboard).
 await page.locator('#entryStatusClose').click();await page.evaluate(()=>{unknown=false;released=false;IS_ADMIN_VIEW=false;});
 await page.evaluate(()=>{document.body.insertAdjacentHTML('beforeend','<div id="inline">'+entryReleaseControls('FICTIONAL-BOOK',false)+entryReleaseControls('FICTIONAL-BOOK',false)+'</div>');return hydrateEntryReleaseControls();});
 const badge=()=>page.locator('#inline .entry-release-badge').first().textContent();
 assert.match(await badge(),lang==='it'?/Codice nascosto: check-in incompleto/:/Code hidden: check-in incomplete/);
 assert.equal(await page.locator('#inline .entry-release-btn').first().isDisabled(),false,'release available while locked');
 assert.equal(await page.locator('#inline .entry-restore-btn').first().isDisabled(),true,'restore unavailable while not released');
 const before=await page.evaluate(()=>mutations.length);await page.locator('#inline .entry-restore-btn').first().click({force:true});assert.equal(await page.evaluate(()=>mutations.length),before,'disabled restore does nothing');
 await page.locator('#inline .entry-release-btn').first().click();await page.waitForFunction(()=>released&&[...document.querySelectorAll('#inline .entry-release-badge')].every(b=>/rilasciato manualmente|released manually/i.test(b.textContent)));
 assert.equal(await page.evaluate(()=>mutations.length),before+2);
 for(let i=0;i<2;i++){assert.equal(await page.locator('#inline .entry-release-btn').nth(i).isDisabled(),true,'release disabled once released');assert.equal(await page.locator('#inline .entry-restore-btn').nth(i).isDisabled(),false,'only restore is available once released');}
 await page.locator('#inline .entry-restore-btn').first().click();await page.waitForFunction(()=>!released&&/nascosto|hidden/i.test(document.querySelector('#inline .entry-release-badge').textContent));
 assert.equal(await page.locator('#inline .entry-release-btn').first().isDisabled(),false);assert.equal(await page.locator('#inline .entry-restore-btn').first().isDisabled(),true);
 await page.evaluate(()=>{IS_ADMIN_VIEW=true;_adminEditEnabled=false;});await page.evaluate(()=>refreshEntryReleaseControls('FICTIONAL-BOOK',false));assert.equal(await page.locator('#inline .entry-release-btn').first().isDisabled(),true,'read-only admin sees status but cannot act');
 await page.evaluate(()=>{IS_ADMIN_VIEW=false;failed=true;});await page.evaluate(()=>refreshEntryReleaseControls('FICTIONAL-BOOK',false));assert.match(await badge(),lang==='it'?/non disponibile/:/unavailable/);assert.equal(await page.locator('#inline .entry-release-btn').count(),0,'no actions without a known state');
 await page.evaluate(()=>{failed=false;});
 // Code already visible after a complete check-in: nothing to release or restore.
 await page.evaluate(async()=>{released=false;visible=true;await refreshEntryReleaseControls('FICTIONAL-BOOK',false);});
 assert.match(await badge(),lang==='it'?/Codice visibile: check-in completo/:/Code visible: check-in complete/);
 assert.equal(await page.locator('#inline .entry-release-btn').first().isDisabled(),true,'no release once the code is visible');
 assert.equal(await page.locator('#inline .entry-restore-btn').first().isDisabled(),true);
 await page.evaluate(()=>{visible=false;});
 // Editing the reservation (2 guests, new dates) re-syncs the stored record.
 const mBefore=await page.evaluate(()=>mutations.length);
 await page.evaluate(()=>syncEntryRosterAfterEdit('fictional-res'));
 const sync=await page.evaluate(()=>mutations.at(-1));
 assert.equal(await page.evaluate(()=>mutations.length),mBefore+1);
 assert.equal(sync.name,'entry_access_confirm_roster');assert.equal(sync.args.p_count,2);assert.equal(sync.args.p_arrival,'2099-01-02');assert.equal(sync.args.p_departure,'2099-01-05');assert.equal(sync.args.p_reservation_id,'fictional-res');
 // Already in sync: no write.
 await page.evaluate(()=>{reservationRow.checkin_date='2099-01-01';reservationRow.checkout_date='2099-01-02';reservationRow.guest_count=3;});
 await page.evaluate(()=>syncEntryRosterAfterEdit('fictional-res'));assert.equal(await page.evaluate(()=>mutations.length),mBefore+1,'unchanged booking is not rewritten');
 if(process.env.ENTRY_QA_DIR&&width===390){await page.evaluate(async()=>{released=true;await refreshEntryReleaseControls('FICTIONAL-BOOK',false);});await page.locator('#inline').screenshot({path:`${process.env.ENTRY_QA_DIR}/release-controls-${lang}.png`});}
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS actual host status/roster/release/restore UI IT/EN 390/1440: authoritative counts, optimistic versions, no unknown-count fallback, errors/read-only admin, standalone confirmation; inline control shows released/visible state and enables only the applicable action; reservation edits re-sync the stored check-in record.');}finally{await browser.close();}
