import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../admin-ops-metrics.js',import.meta.url),'utf8');
const sdk=process.env.SUPABASE_BROWSER_SDK?fs.readFileSync(process.env.SUPABASE_BROWSER_SDK,'utf8'):await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js')).text();
function fn(name){const i=html.indexOf('function '+name+'(');assert.ok(i>=0);return html.slice(i,html.indexOf('\n}\n',i)+2);}
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const since='2026-10-01T00:00:00Z',until='2026-10-25T12:00:00Z';
const c=(id,extra={})=>({id,property_id:'p',booking_code:'B',submitted_at:since,arrival_date:'2026-10-10',...extra});
const checkins=[c('1',{alloggiati_status:'filed',filed_at:since}),c('2',{autofile_last_error:'send_rejected',autofile_last_attempt_at:since})];
const reservations=['B','C'].map(id=>({id,property_id:'p',booking_code:id,status:'active',entry_type:'reservation',checkin_date:'2026-10-10'}));
const events=[{id:'e',property_id:'p',booking_code:'B',event_type:'guest_link_opened',created_at:since}];
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
  await page.route('https://ops.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:`<html><head><meta charset="utf-8"><style>${styles}</style></head><body><div id="content"></div><script>${sdk}</script><script>${helper}</script><script>
const sb=supabase.createClient('https://fixture.supabase.co','fixture-key',{auth:{persistSession:false}});
const APP_CONFIG={appOrigin:'https://app.welcomebnb.it'};
let opsMetricsData=null;
const allProperties=[{id:'p',name:'Fixture property',city:'Ostuni',host_names:'Fixture host',_checkin_count:2},{id:'empty',name:'Empty property',_checkin_count:0}];
function adminRowClass(){return '';}function copyableId(id){return id;}function adminRowActions(){return '';}function viewAsHost(id){window.clickedProperty=id;}
${fn('renderHostsPropertiesTable')}
window.fixtureRender=()=>{document.getElementById('content').innerHTML=renderHostsPropertiesTable({},{});};
AdminOpsMetrics.load(sb,{since:'${since}',until:'${until}'}).then(data=>{opsMetricsData=data;fixtureRender();window.fixtureReady=true;});
</script></body></html>`}));
  await page.goto('https://ops.invalid/');await page.waitForFunction(()=>window.fixtureReady);
  const row=page.locator('tbody tr').first();const cells=await row.locator('td').allTextContents();
  assert.equal(cells.length,12);assert.equal(cells[4],'2');assert.equal(cells[5],'1');assert.equal(cells[6],'1');assert.match(cells[7],/50%.*1 \/ 2 bookings/s);
  assert.equal(requests.length,3);await row.getByRole('button',{name:'Console'}).click();assert.equal(await page.evaluate(()=>window.clickedProperty),'p');
  await page.locator('[aria-label="Hosts and properties metrics"]').evaluate(el=>el.scrollLeft=0);
  await page.screenshot({path:path.join(out,`ops-${width}.png`),fullPage:true});
  await page.evaluate(()=>{opsMetricsData.reservations=null;fixtureRender();});assert.equal(await page.locator('tbody tr').first().locator('td').nth(7).textContent(),'—');assert.match(await page.getByRole('status').textContent(),/unavailable/);
  await page.evaluate(()=>{opsMetricsData.checkins=null;fixtureRender();});assert.equal(await page.locator('tbody tr').first().locator('td').nth(4).textContent(),'—');assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS actual SDK paginated reads and Ops table: 390/1440px, 12 columns, usage counts, zero cohort, failed reads and Console action');
}finally{await browser.close();}
