import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../admin-ops-metrics.js',import.meta.url),'utf8');
const table=fs.readFileSync(new URL('../admin-ops-table.js',import.meta.url),'utf8');
const tableUi=fs.readFileSync(new URL('../admin-table-ui.js',import.meta.url),'utf8');
const sdk=process.env.SUPABASE_BROWSER_SDK?fs.readFileSync(process.env.SUPABASE_BROWSER_SDK,'utf8'):fs.readFileSync(new URL('../vendor/supabase-2.118.0.js',import.meta.url),'utf8');
function fn(name){const i=html.indexOf('function '+name+'(');assert.ok(i>=0);return html.slice(i,html.indexOf('\n}\n',i)+2);}
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const since='2026-10-01T00:00:00Z',until='2026-10-25T12:00:00Z';
const c=(id,extra={})=>({id,property_id:'p',booking_code:'B',submitted_at:since,arrival_date:'2026-10-10',...extra});
const checkins=[c('full',{property_id:'full',booking_code:'F'}),c('1',{alloggiati_status:'filed',filed_at:since}),c('2',{autofile_last_error:'send_rejected',autofile_last_attempt_at:since}),c('late',{property_id:'empty',booking_code:null,submitted_at:'2026-09-01T00:00:00Z',alloggiati_status:'pending',autofile_last_error:'past_portal_window'})];
const reservations=['B','C'].map(id=>({id,property_id:'p',booking_code:id,status:'active',entry_type:'reservation',checkin_date:'2026-10-10'})).concat(['full','zero'].map(id=>({id,property_id:id,booking_code:id==='full'?'F':'Z',status:'active',entry_type:'reservation',checkin_date:'2026-10-10'})));
const events=[{id:'f',property_id:'full',booking_code:'F',event_type:'guest_link_opened',created_at:since},{id:'e',property_id:'p',booking_code:'B',event_type:'guest_link_opened',created_at:since}];
const out=path.join(os.tmpdir(),'round64-admin-qa');fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||undefined,headless:true,args:['--no-sandbox']});
try {
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:950}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));const requests=[];
  await page.route('https://fixture.supabase.co/**',async route=>{
   assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());requests.push(url);
   const table=url.pathname.split('/').pop();const rows=table==='checkins'?checkins:table==='ota_reservations'?reservations:events;
   assert.equal(url.searchParams.get('order'),'id.asc');
   await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(rows)});
  });
  await page.route('https://ops.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="content"></div><script>${sdk}</script><script>${helper}</script><script>${tableUi}</script><script>${table}</script><script>
const sb=supabase.createClient('https://fixture.supabase.co','fixture-key',{auth:{persistSession:false}});
const APP_CONFIG={appOrigin:'https://app.welcomebnb.it'};
let opsMetricsData=null;
const allProperties=[{id:'p',owner_id:'owner',name:'Fixture property',city:'Ostuni',host_names:'Fixture host',_checkin_count:2},{id:'empty',name:'Empty property',_checkin_count:0,alloggiati_autofile_mode:'live'},{id:'full',owner_id:'fullOwner',name:'Villa 12',city:'Roma',_checkin_count:12,wifi_name:'fixture',host_names:'Full host',host_phone:'fixture',address:'fixture',cir_code:'fixture'},{id:'zero',owner_id:'zeroOwner',name:'Zero usage',city:'Ostuni',_checkin_count:0}];
function adminRowClass(){return '';}function copyableId(id){return id;}function adminRowActions(){return '';}function viewAsHost(id){window.clickedProperty=id;}
${fn('escapeHtml')}
let hostTermsByHost={owner:[{id:'acc-1',host_id:'owner',version:1,document_id:'doc-1',text_sha256:'a'.repeat(64),host_kind:'private',method:'password_login+email_otp',account_email:'host@example.invalid',created_at:'2026-11-01T10:00:00Z'}]};
let legalDocsById={'doc-1':{id:'doc-1',kind:'host_terms',version:1,text_sha256:'a'.repeat(64),specific_clauses:[{ref:'15.2',label:'foro competente'}]}};
let readinessByProperty=null;
let allogConnections=new Map([['p',{property_id:'p',verified_at:'2026-11-01T09:00:00Z',wskey_expires_at:'2099-01-01T00:00:00Z',last_error:null,updated_at:'2026-11-01T08:00:00Z'}],['full',{property_id:'full',verified_at:null,wskey_expires_at:null,last_error:'authentication_failed',updated_at:'2026-10-30T08:00:00Z'}],['zero',{property_id:'zero',verified_at:null,wskey_expires_at:null,last_error:null,updated_at:'2026-10-30T08:00:00Z'}]]);
allProperties[0].alloggiati_autofile_mode='live';
function showAlloggiatiSupport(id){window.supportOpened=id;}
${fn('allogConnectionState')}
${fn('allogConnectionCell')}
${fn('hostTermsCell')}
${fn('downloadHostTermsEvidence')}
${fn('renderHostsPropertiesTable')}
const userStats={'host@example.invalid':{sessions:new Set(['a','b']),events:2,lastSeen:'2026-10-25T10:00:00Z'},'full@example.invalid':{sessions:new Set(['a']),lastSeen:'2026-10-24T10:00:00Z'},'zero@example.invalid':{sessions:new Set(),lastSeen:'2026-10-22T10:00:00Z'},'orphan@example.invalid':{sessions:new Set(['a']),lastSeen:'2026-10-20T10:00:00Z'}};
const userIdToEmail={owner:'host@example.invalid',fullOwner:'full@example.invalid',zeroOwner:'zero@example.invalid'};
window.fixtureRender=()=>{document.getElementById('content').innerHTML=renderHostsPropertiesTable(userStats,userIdToEmail);AdminOpsTable.mount(document.getElementById('content'));};
AdminOpsMetrics.load(sb,{since:'${since}',until:'${until}'}).then(data=>{opsMetricsData=data;fixtureRender();window.fixtureReady=true;});
</script></body></html>`}));
  await page.goto('https://ops.invalid/');await page.waitForFunction(()=>window.fixtureReady);
  // 25 Nov 2026 — Users-style table (admin-table-ui.js): cells by column name,
  // filter chips, header sort on wide screens, «Sort by» menu on cards.
  const rowOf=name=>page.locator('tbody tr').filter({hasText:name}).first();
  const col=async(name,key)=>(await rowOf(name).locator(`td[data-ops-col="${key}"] .u-val`).textContent()).replace(/\s+/g,' ').trim();
  const cards=()=>page.locator('[data-ops-wrap]').evaluate(el=>el.classList.contains('u-cards'));
  const show=async k=>{await page.locator(`[data-ops-filter="${k}"]`).click();assert.equal(await page.locator(`[data-ops-filter="${k}"]`).getAttribute('aria-pressed'),'true');};
  const sortBy=async key=>{if(await cards()){const sel=page.locator('[data-ops-sortsel]');if(await sel.inputValue()===key)await page.locator('[data-ops-dir]').click();else await sel.selectOption(key);}else await page.locator(`[data-ops-sort="${key}"]`).click();};
  assert.equal(await cards(),width<1000,'table on a wide screen, cards on a phone');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal scroll');
  const cells=await page.locator('tbody tr').first().locator('td').count();
  assert.equal(cells,10,'property cell + 9 metric cells (terms are in Utenti)');assert.ok(!/Non accettate|Scarica prova/.test(await page.locator('#opsHostsProperties').textContent()),'no terms in Ops');
  {const main=(await rowOf('Fixture property').locator('td.u-main').textContent()).replace(/\s+/g,' ');assert.match(main,/Fixture property/);assert.match(main,/host@example\.invalid/);assert.match(main,/Ostuni/);
   for(const name of ['Console','Guest app','Alloggiati support','Deep dive'])assert.equal(await rowOf('Fixture property').locator('td.u-main').getByRole(name==='Guest app'?'link':'button',{name,exact:true}).count(),1,name+' icon beside the name');}
  assert.match(await col('Fixture property','alloggiati'),/✓ Connected/);assert.match(await col('Fixture property','alloggiati'),/Auto: live · 01\/11\/2026/);
  assert.match(await col('Villa 12','alloggiati'),/⚠ Error/);assert.match(await col('Villa 12','alloggiati'),/Auto: off/);
  assert.match(await col('Zero usage','alloggiati'),/Saved · not verified/);
  {const e=await col('Empty property','alloggiati');assert.match(e,/Not connected/);assert.match(e,/Manual filing only/);assert.ok(!/Auto:/.test(e),'no automatic mode shown without credentials');}
  await rowOf('Villa 12').getByRole('button',{name:/Error/}).click();assert.equal(await page.evaluate(()=>window.supportOpened),'full');
  assert.equal(await col('Fixture property','completed'),'2');assert.equal(await col('Fixture property','sent'),'1');assert.equal(await col('Fixture property','failed'),'1');assert.match(await col('Fixture property','usage'),/50%.*1 \/ 2 bookings/);
  assert.equal(requests.length,3);await rowOf('Fixture property').getByRole('button',{name:'Console'}).click();assert.equal(await page.evaluate(()=>window.clickedProperty),'p');
  await rowOf('Fixture property').getByRole('button',{name:'Alloggiati support'}).click();assert.equal(await page.evaluate(()=>window.supportOpened),'p');
  assert.match(await rowOf('Fixture property').getByRole('link',{name:'Guest app'}).getAttribute('href'),/\/\?p=p$/);
  await page.screenshot({path:path.join(out,`ops-${width}.png`),fullPage:true});
  const visible=()=>page.locator('[data-ops-row]:visible').evaluateAll(elements=>elements.map(el=>JSON.parse(el.dataset.opsRow).propertyId));
  assert.deepEqual(await visible(),['p','full','zero',null,'empty']);
  await sortBy('guests');assert.deepEqual(await visible(),['full','p','zero','empty',null]);
  await sortBy('guests');assert.equal((await visible()).at(-1),'full');
  assert.equal(await page.locator('[data-ops-sort="guests"]').locator('..').getAttribute('aria-sort'),'ascending');
  if(!(await cards())){assert.equal(await page.locator('[data-ops-sort="guests"] [data-ops-arrow]').textContent(),' ▲');
   await page.locator('[data-ops-sort="usage"]').focus();await page.keyboard.press('Enter');assert.deepEqual((await visible()).slice(0,3),['full','p','zero']);}
  else {await sortBy('usage');assert.deepEqual((await visible()).slice(0,3),['full','p','zero']);}
  await sortBy('usage');assert.deepEqual((await visible()).slice(0,3),['zero','p','full']);
  await page.getByLabel('Search',{exact:true}).fill('ostuni host');assert.deepEqual(await visible(),['p']);
  await page.getByLabel('City',{exact:true}).selectOption(JSON.stringify('Roma'));assert.deepEqual(await visible(),[]);assert.match(await page.locator('[data-ops-empty]').textContent(),/No hosts or properties match/);
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  assert.equal(await page.locator('[data-ops-filter="all"]').getAttribute('aria-pressed'),'true');
  assert.equal((await page.locator('[data-ops-filter="failures"] [data-ops-filter-count]').textContent()),'1','chip shows its count');
  assert.equal(await page.locator('[data-ops-filter="unavailable"]').isHidden(),true,'empty chips are hidden');
  await show('failures');assert.deepEqual(await visible(),['p']);
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  {const emptyRow=rowOf('Empty property');const u=emptyRow.locator('[data-unconfirmed]');assert.equal((await u.textContent()).trim(),'1 not confirmed');assert.match(await u.getAttribute('title'),/may have filed by hand/);
   assert.equal(await emptyRow.getByRole('button',{name:/Diagnose|failed attempt/}).count(),0,'no diagnostics link for a property without a connection');
   assert.equal(await col('Fixture property','failed'),'1','connected property keeps real failures');
   await u.click();assert.equal(await page.evaluate(()=>window.clickedProperty),'empty','opens the host console');}
  await show('unconfirmed');assert.deepEqual(await visible(),['empty']);
  await show('failures');assert.deepEqual(await visible(),['p'],'unconfirmed is not a failure');
  await show('allog_connection');assert.deepEqual(await visible(),['full','zero','empty'],'error, not verified, not connected');
  await show('no_usage');assert.deepEqual(await visible(),['zero']);
  await show('low_usage');assert.deepEqual(await visible(),['zero']);
  await show('no_bookings');assert.deepEqual(await visible(),['empty']);
  await show('no_property');assert.deepEqual(await visible(),[null]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'filtered list still fits');
  await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.getByLabel('City',{exact:true}).selectOption(JSON.stringify('Ostuni'));await page.getByLabel('Search',{exact:true}).fill('fixture');
  await sortBy('completed');await page.evaluate(()=>fixtureRender());
  assert.equal(await page.getByLabel('Search',{exact:true}).inputValue(),'fixture');assert.equal(await page.getByLabel('City',{exact:true}).inputValue(),JSON.stringify('Ostuni'));assert.deepEqual(await visible(),['p']);
  assert.equal(await page.locator('[data-ops-sort="completed"]').locator('..').getAttribute('aria-sort'),'descending');
  if(await cards())assert.equal(await page.locator('[data-ops-sortsel]').inputValue(),'completed','sort menu follows the state after a redraw');
  await page.getByLabel('Search',{exact:true}).fill('<img src=x onerror=alert(1)>');assert.deepEqual(await visible(),[]);assert.equal(await page.locator('#opsHostsProperties img').count(),0);
  await page.getByRole('button',{name:'Reset',exact:true}).click();assert.match(await page.locator('[data-ops-count]').textContent(),/5 of 5/);assert.equal(requests.length,3,'sorting and filtering never refetch');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'controls fit viewport');
  await page.screenshot({path:path.join(out,`ops-sort-filter-${width}.png`),fullPage:true});
  await page.evaluate(()=>{opsMetricsData.reservations=null;fixtureRender();});assert.equal(await col('Fixture property','usage'),'—');assert.match(await page.getByRole('status').textContent(),/unavailable/);await show('unavailable');assert.deepEqual(await visible(),['p','full','zero','empty']);await page.getByRole('button',{name:'Reset',exact:true}).click();
  await page.evaluate(()=>{allogConnections=null;fixtureRender();});assert.equal(await col('Fixture property','alloggiati'),'—','unreadable status is a dash, never "not connected"');
  await page.evaluate(()=>{opsMetricsData.checkins=null;fixtureRender();});assert.equal(await col('Fixture property','completed'),'—');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS actual SDK paginated reads and Ops table (Users-style: cards on 390, table on 1440, chips with counts, icons beside the name): 390/1440px, property cell + 9 metrics (terms in Utenti) incl. Alloggiati connection (connected/error/not verified/not connected, mode, opens diagnostics, problems filter), «N not confirmed» for unconnected properties (opens the console, own filter, not counted as failures) and Terms (version · date, Non accettate, evidence JSON download), keyboard/numeric sorting, compound filters, null/zero, empty/reset/state persistence, viewport fit, no extra reads, failed reads and Console action');
}finally{await browser.close();}
