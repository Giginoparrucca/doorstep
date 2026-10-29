// Actual host dialog/status/release functions, fictional HTTP/RPC transport.
import fs from 'node:fs';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
function fn(name){let a=source.indexOf('function '+name+'(');if(source.slice(a-6,a)==='async ')a-=6;return source.slice(a,source.indexOf('\n}\n',a)+2);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try{for(const lang of ['it','en'])for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('https://host-entry.example.invalid/',r=>r.fulfill({contentType:'text/html',body:'<button id="open">Entry status</button>'}));await page.goto('https://host-entry.example.invalid/');
 await page.addScriptTag({content:`let APP_CONFIG={entryReleaseUiEnabled:true};let hostLang=${JSON.stringify(lang)},propertyId='fictional-property',IS_ADMIN_VIEW=false,_adminEditEnabled=false;
 let version='version-1',released=false,failed=false,unknown=false,mutations=[];
 const state=()=>({entry_release:{state:released?'manual':'locked',allow_entry:released,submitted:1,expected:3},summary:unknown?null:{booking_id:'fictional-booking',state_version:version,expected_count:3,released_manually:released,reservation_id:null,arrival_date:'2099-01-01',departure_date:'2099-01-02'},reservation:null});
 const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-host'}}})},rpc:async(name,args)=>{mutations.push({name,args});if(args.p_expected_version!==(unknown?null:version))throw Error('wrong optimistic version');version=crypto.randomUUID();unknown=false;if(name==='entry_access_set_release')released=args.p_release;return {data:{booking_id:'fictional-booking',state_version:version}};}};
 window.fetch=async(url,options)=>{if(url!=='/api/guest'||options.cache!=='no-store'||options.headers.Authorization!=='Bearer fictional-host')throw Error('unexpected transport');const b=JSON.parse(options.body);if(b.property_id!==propertyId||b.action!=='host_entry_state')throw Error('wrong scope');return {ok:!failed,json:async()=>state()};};
 ${['entryUiEnabled','readHostEntryState','entryStatusButton','openEntryAccessStatus','releaseEntryManually','restoreAutomaticRelease'].map(fn).join('\n')}`});
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
 assert.deepEqual(errors,[]);await page.close();
}console.log('PASS actual host status/roster/release/restore UI IT/EN 390/1440: authoritative counts, optimistic versions, no unknown-count fallback, errors/read-only admin, standalone confirmation.');}finally{await browser.close();}
