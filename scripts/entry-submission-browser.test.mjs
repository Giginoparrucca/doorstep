// Actual client retry/save/refresh helpers in Chromium; fictional HTTP only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const source = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
const start=source.indexOf('const _entrySavedIds =');
const helpers=source.slice(start,source.indexOf('async function saveCurrentGuest()',start));
function fn(name){const a=source.indexOf('function '+name+'(');assert.ok(a>0);return source.slice(a,source.indexOf('\n}\n',a)+2);}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try {
  for(const language of ['it','en']) for(const width of [390,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}}), requests=[],errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let failSave=true, failRead=false;
    let propertyReply={property:{},entry_release:{state:'locked',allow_entry:false}};
    await page.route('**/*',route=>route.abort());
    await page.route('https://submission.example.invalid/',route=>route.fulfill({contentType:'text/html',
      body:'<div id="accessMethod"></div><div id="lockboxCodesWrap"></div><div id="checkinInstructionsText"></div><div id="roomDoorCode"></div>'}));
    await page.route('https://submission.example.invalid/api/guest',async route=>{
      const body=route.request().postDataJSON(); requests.push(body);
      if(body.action==='property') return route.fulfill({status:failRead?503:200,contentType:'application/json',body:JSON.stringify(propertyReply)});
      if(failSave){failSave=false;return route.fulfill({status:503,contentType:'application/json',body:'{"error":"fictional_outage"}'});}
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body.action==='checkin_update'
        ? {updated:{id:body.id}} : {id:body.submission_id,booking_code:'BOOK-FICTIONAL'})});
    });
    await page.goto('https://submission.example.invalid/');
    await page.addScriptTag({content:`let lang=${JSON.stringify(language)},propertyId='property-fictional',bookingCode='BOOK-FICTIONAL',
      IS_TEST_SESSION=false,isReopenedCheckin=false,currentGuestIdx=0,totalGuests=1,selectedGuestType='single',existingCheckins=[],savedGuests=[],propertyData={},reservationKeyboxCode='';
      const T={en:{},it:{}};
      ${fs.readFileSync(new URL('../lib/guest-entry-refresh.js',import.meta.url),'utf8')}
      async function _guestCall(action,body){const r=await fetch('/api/guest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})});return {ok:r.ok,status:r.status,data:await r.json()};}
      ${fn('_isLockboxPlaceholder')}
      ${fn('_resolveLockboxCodes')}
      ${fn('refreshLockboxDisplay')}
      ${fn('guestLinkedText')}
      ${helpers}
      _entryRefreshReady=true;`});
    const record={surname:'Fictional',name:'Guest'};
    const first=await page.evaluate(()=>entrySubmissionIdentity());
    assert.deepEqual(await page.evaluate(()=>{adoptEntryGuestCount({data:{expected_count:8}});return [totalGuests,selectedGuestType];}),[8,'family']);
    await page.evaluate(record=>saveEntryGuest(record,entrySubmissionIdentity()),record);
    await page.evaluate(record=>saveEntryGuest(record,entrySubmissionIdentity()),record);
    assert.equal(requests[0].submission_id,first.id);
    assert.deepEqual(requests[1],requests[0],'retry uses exact same guest identity, ordinal and record');
    await page.evaluate(record=>saveEntryGuest({...record,name:'Correction'},entrySubmissionIdentity()),record);
    assert.equal(requests[2].action,'checkin_update');
    assert.equal(requests[2].id,first.id,'back/edit changes the saved row instead of inserting another');
    const next=await page.evaluate(()=>{currentGuestIdx=1;return entrySubmissionIdentity();});
    assert.notEqual(next.id,first.id);assert.equal(next.ordinal,2);
    const switched=await page.evaluate(()=>{bookingCode='OTHER-FICTIONAL';currentGuestIdx=0;return entrySubmissionIdentity();});
    assert.notEqual(switched.id,first.id);
    assert.deepEqual(await page.evaluate(()=>{bookingCode='BOOK-FICTIONAL';return entrySubmissionIdentity();}),first);
    assert.equal(await page.evaluate(()=>{isReopenedCheckin=true;existingCheckins=[{},{}];currentGuestIdx=0;return entrySubmissionIdentity().ordinal;}),3);
    // Final completion refresh consumes the server result, not a client count.
    propertyReply={property:{keybox_code:'FIXED-FICTIONAL',access_method:'Fictional entry'},entry_release:{state:'available',allow_entry:true}};
    await page.evaluate(()=>refreshEntryAfterSave());
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(),true);
    assert.match(await page.locator('#lockboxCodesWrap').textContent(),/FIXED-FICTIONAL/);
    propertyReply={property:{},entry_release:{state:'locked',allow_entry:false}};
    await page.evaluate(()=>{reservationKeyboxCode='ROTATING-FICTIONAL';existingCheckins=[{keybox_code:'OLD-FICTIONAL'}];savedGuests=[{keybox_code:'OLD-FICTIONAL'}];return refreshEntryAfterSave();});
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(),false);
    assert.ok(!(await page.locator('body').innerHTML()).includes('FICTIONAL'));
    assert.match(await page.locator('#accessMethod').textContent(),language==='it'?/Completa il check-in/:/Complete online check-in/);
    propertyReply={property:{keybox_code:'FIXED-FICTIONAL'},entry_release:{state:'manual',allow_entry:true}};
    await page.evaluate(()=>refreshEntryAfterSave());
    assert.equal(await page.locator('.entry-released-note').count(),1);
    failRead=true; await page.evaluate(()=>refreshEntryAfterSave());
    assert.equal(await page.locator('#lockboxCodesWrap').isVisible(),false);
    assert.equal(await page.locator('.entry-released-note').count(),0);
    const storage=await page.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}));
    for(const secret of ['Guest','Correction','FIXED-FICTIONAL','ROTATING-FICTIONAL','OLD-FICTIONAL'])assert.ok(!storage.includes(secret));
    assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS actual retry/save/refresh helpers at IT/EN 390/1440: stable identity, failed-response retry, edit without duplicate, booking/ordinal separation, final unlock, re-lock cache clearing and failed-read deny; fictional HTTP transport.');
} finally {await browser.close();}
