// Actual complete guest page, lifecycle wiring, token wrapper and controller.
// All network is intercepted and all data is fictional. No hosted guest writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const root=new URL('../',import.meta.url);
const origin='https://refresh.example.invalid';
const pid='11111111-1111-4111-8111-111111111111';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
try {
 for(const language of ['it','en']) for(const width of [390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900},timezoneId:'Asia/Singapore'});
  const errors=[],requests=[],tokens=new Map();let tokenId=0,fail=false,hold=null,reply;
  const denied=(state='locked',extra={})=>({property:{id:pid,name:'Fictional House',host_names:'Fictional Host',rotating_lockbox_enabled:true},
    entry_release:{state,allow_entry:false,protected_chat:true,...extra},rotating_code:null});
  const released=()=>({property:{...denied().property,keybox_code:'FIXED-FICTIONAL',access_method:'ENTRY-FICTIONAL',wifi_name:'WIFI-NAME',wifi_password:'WIFI-FICTIONAL',checkin_instructions_it:'ISTRUZIONI-FICTIONAL',checkin_instructions_en:'INSTRUCTIONS-FICTIONAL'},
    room:{id:'room-a',name:'Fictional Room',door_code:'ROOM-FICTIONAL'},rotating_code:'ROTATING-FICTIONAL',entry_release:{state:'available',allow_entry:true,protected_chat:true}});
  reply=denied();
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.origin!==origin)return route.fulfill({contentType:'application/json',body:'[]'});
   if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname==='/app-config.js')return route.fulfill({contentType:'text/javascript',body:`window.WELCOME_BNB_CONFIG=${JSON.stringify({mode:'production',projectRef:'abcdefghijklmnopqrst',supabaseUrl:'https://abcdefghijklmnopqrst.supabase.co',publicKey:'fictional-public',allowedOrigins:[origin],appOrigin:origin})}`});
   if(u.pathname==='/api/guest-token') {
    const b=route.request().postDataJSON();const token='fictional-token-'+(++tokenId);tokens.set(token,b);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({token,expires_at:'2099-01-01T00:00:00Z'})});
   }
   if(u.pathname==='/api/guest') {
    const b=route.request().postDataJSON(),token=route.request().headers().authorization?.replace('Bearer ','');
    const scope=tokens.get(token);assert.ok(scope,'gateway request uses minted scope');requests.push({action:b.action,scope,sender:b.sender,message:b.message});
    let data={};
    if(b.action==='property') {data=structuredClone(reply);if(hold){const pending=hold;hold=null;await pending;}return route.fulfill({status:fail?503:200,contentType:'application/json',body:JSON.stringify(data)});}
    if(b.action==='history'||b.action==='poll')data={messages:[]};
    if(b.action==='checkin_list')data={guests:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
   }
   if(['/app-bootstrap.js','/lib/cover-layout.js','/lib/guest-entry-refresh.js','/vendor/supabase-2.118.0.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(new URL('.'+u.pathname,root),'utf8')});
   return route.fulfill({body:''});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-10-25T00:30:00Z')});
  await page.addInitScript(()=>{localStorage.setItem('wbnb_property_data','LEGACY-FICTIONAL');sessionStorage.setItem('doorstep_keybox_code','LEGACY-FICTIONAL');});
  await page.goto(origin+'/?p='+pid+'&b=BOOK-A');
  await page.waitForFunction(()=>_entryRefreshReady && _entryLastResponse?.data.entry_release.state==='locked');
  await page.evaluate(l=>{setLang(l);goTo('welcome');},language);
  assert.match(await page.locator('#accessMethod').textContent(),language==='it'?/Completa il check-in/:/Complete online check-in/);
  assert.ok(!(await page.content()).includes('FIXED-FICTIONAL'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('wbnb_property_data')),null);
  // A completed final save refreshes every surface, including room/Wi-Fi/rotating.
  reply=released();await page.evaluate(()=>refreshEntryAfterSave());
  assert.match(await page.locator('#lockboxCodesWrap').textContent(),/FIXED-FICTIONAL/);
  assert.match(await page.locator('#lockboxCodesWrap').textContent(),/ROTATING-FICTIONAL/);
  assert.match(await page.locator('#roomDoorCode').textContent(),/ROOM-FICTIONAL/);
  assert.match(await page.locator('#wifiPass').textContent(),/WIFI-FICTIONAL/);
  assert.match(await page.locator('#checkinInstructionsText').textContent(),/FICTIONAL/);
  if(process.env.ENTRY_QA_DIR){fs.mkdirSync(process.env.ENTRY_QA_DIR,{recursive:true});await page.locator('#checkinCard').scrollIntoViewIfNeeded();await page.screenshot({path:process.env.ENTRY_QA_DIR+`/entry-${language}-${width}.png`});}
  // Focus clears immediately, before a delayed denial arrives.
  let finish;hold=new Promise(r=>finish=r);reply=denied();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>document.getElementById('lockboxCodesWrap').textContent==='');
  assert.ok(!(await page.content()).includes('ROOM-FICTIONAL'));finish();
  await page.waitForFunction(()=>_entryLastResponse?.data.entry_release.state==='locked');
  // DST repeated-hour instant is rendered in Rome, even on a Singapore device.
  reply=denied('scheduled',{release_at:'2026-10-25T01:30:00Z',release_timezone:'Europe/Rome'});
  await page.evaluate(()=>_entryRefresh.refresh());
  assert.match(await page.locator('#accessMethod').textContent(),/02:30/);
  assert.match(await page.locator('#accessMethod').textContent(),/Europe\/Rome/);
  await page.evaluate(l=>setLang(l==='it'?'en':'it'),language);
  assert.match(await page.locator('#accessMethod').textContent(),/02:30/);
  // Reaching a timer only fetches: a server which still says scheduled stays locked.
  reply=denied('scheduled',{release_at:'2026-10-25T00:30:02Z',release_timezone:'Europe/Rome'});
  await page.evaluate(()=>_entryRefresh.refresh());await page.clock.fastForward(2500);
  await page.waitForFunction(()=>_entryLastResponse?.data.entry_release.state==='scheduled');
  assert.equal(await page.locator('#lockboxCodesWrap').textContent(),'');
  reply=released();await page.clock.fastForward(60000);
  await page.waitForFunction(()=>document.getElementById('roomDoorCode').textContent.includes('ROOM-FICTIONAL'));
  // Hidden/page-cache and offline transitions discard codes before any new fetch.
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.ok(!(await page.content()).includes('FIXED-FICTIONAL'));
  reply=denied();await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
  await page.waitForFunction(()=>_entryLastResponse?.data.entry_release.state==='locked');
  reply=released();await page.evaluate(()=>_entryRefresh.refresh());
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  assert.ok(!(await page.content()).includes('ROOM-FICTIONAL'));
  fail=true;await page.evaluate(()=>_entryRefresh.refresh());
  assert.ok(!(await page.content()).includes('FIXED-FICTIONAL'));fail=false;
  await page.locator('#entryRetry').click();
  await page.waitForFunction(()=>document.getElementById('roomDoorCode').textContent.includes('ROOM-FICTIONAL'));
  // A stale allowed reply cannot revive a later denied response.
  reply=released();hold=new Promise(r=>finish=r);
  await page.evaluate(()=>{window.oldRefresh=_entryRefresh.refresh();});
  await page.waitForFunction(()=>document.getElementById('lockboxCodesWrap').textContent==='');
  reply=denied();await page.evaluate(()=>_entryRefresh.refresh());finish();await page.evaluate(()=>window.oldRefresh);
  assert.equal(await page.locator('#lockboxCodesWrap').textContent(),'');
  // An AI reply started under an old access state cannot reappear/save after refresh.
  reply=released();await page.evaluate(()=>_entryRefresh.refresh());
  await page.evaluate(()=>{
    const original=window.fetch;
    window.fetch=async(url,options)=>{
      if(url==='/api/chat')return new Response(new ReadableStream({start(c){
        window.fixtureStream=c;window.fixtureSignal=options.signal;
        c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'text',text:'Public test reply'})+'\\n\\n'));
      }}),{headers:{'Content-Type':'text/event-stream'}});
      return original(url,options);
    };
    document.getElementById('chatInput').value='Fictional question';window.fixtureChatRun=sendChat();
  });
  await page.waitForFunction(()=>window.fixtureStream!==undefined);
  reply=denied();await page.evaluate(()=>_entryRefresh.refresh());
  assert.equal(await page.evaluate(()=>window.fixtureSignal.aborted),true);
  await page.evaluate(()=>{fixtureStream.enqueue(new TextEncoder().encode('data: '+JSON.stringify({type:'text',text:'OLD-AI-CODE-FICTIONAL'})+'\\n\\n'));fixtureStream.close();});
  await page.evaluate(()=>window.fixtureChatRun);
  assert.ok(!(await page.content()).includes('OLD-AI-CODE-FICTIONAL'));
  assert.ok(!requests.some(r=>r.sender==='bot'&&String(r.message).includes('OLD-AI-CODE-FICTIONAL')));
  // Separate tab invalidates this tab; the signal itself contains no access value.
  const second=await context.newPage();await second.goto(origin+'/?p='+pid+'&b=BOOK-A');
  await second.waitForFunction(()=>_entryRefreshReady);
  reply=released();await second.evaluate(()=>refreshEntryAfterSave());
  await page.waitForFunction(()=>document.getElementById('roomDoorCode').textContent.includes('ROOM-FICTIONAL'));
  const store=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
  for(const value of ['FIXED-FICTIONAL','ROTATING-FICTIONAL','ROOM-FICTIONAL','WIFI-FICTIONAL','ISTRUZIONI-FICTIONAL','INSTRUCTIONS-FICTIONAL','LEGACY-FICTIONAL'])assert.ok(!store.includes(value));
  assert.ok(requests.every(r=>r.scope.property_id===pid && r.scope.booking_code==='BOOK-A'));
  // A booking navigation invalidates the old view and mints the new token scope.
  reply=denied();
  await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.evaluate(()=>{
    history.pushState(null,'','?p='+propertyId+'&b=BOOK-B');window.dispatchEvent(new PopStateEvent('popstate'));
  })]);
  await page.waitForFunction(()=>_entryRefreshReady && _entryLastResponse?.data.entry_release.state==='locked');
  assert.ok(requests.some(r=>r.scope.booking_code==='BOOK-B'));
  assert.ok(!(await page.content()).includes('FIXED-FICTIONAL'));
  // Real visibility callback is also exercised, without granting from the event.
  reply=released();await page.evaluate(()=>_entryRefresh.refresh());
  await page.evaluate(()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.fixtureHidden?'hidden':'visible'});
    window.fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.ok(!(await page.content()).includes('ROOM-FICTIONAL'));
  reply=denied();await page.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>_entryLastResponse?.data.entry_release.state==='locked');
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS complete guest page IT/EN 390/1440: final-save surfaces, focus clear/restore, property timezone/DST, timer recheck, page-cache/offline/error, stale reply and cross-tab signal; fictional HTTP only.');
}finally{await browser.close();}
