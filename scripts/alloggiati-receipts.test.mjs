import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const {collectReceipts, romeDate, receiptWindow} = await import('../api/_alloggiati-receipts.js');
const pdf = Buffer.from('%PDF-1.7\n' + 'FACSIMILE '.repeat(40));
const now = new Date('2026-10-13T08:00:00Z');
const property = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const row = (id, extra={}) => ({id, property_id:property, filed_at:'2026-10-11T01:00:00Z', alloggiati_status:'filed', is_test:false, deleted_at:null, receipt_path:null, ...extra});
const log = (rows, extra={}) => ({property_id:property, checkin_ids:rows.map(r=>r.id), run_at:'2026-10-11T01:00:08Z', trigger:'autofile', outcome:'filed', ...extra});
function fixture(rows, logs) {
  const objects = new Map(), calls = [], downloads = [];
  let failUpload=false, failPatch=false, failPortal=false, empty=false, race=false, hiddenProperty=false, noCreds=false, concurrent=false;
  const hooks={set upload(v){failUpload=v},set patch(v){failPatch=v},set portal(v){failPortal=v},set empty(v){empty=v},set race(v){race=v},set hiddenProperty(v){hiddenProperty=v},set noCreds(v){noCreds=v},set concurrent(v){concurrent=v}};
  const response=(data,status=200,total)=>new Response(Buffer.isBuffer(data)?data:JSON.stringify(data),{status,headers:{'content-range':`0-99/${total??(Array.isArray(data)?data.length:0)}`}});
  const match=(r,p)=> [...p].every(([key,val])=>{
    if(['select','order','limit','offset'].includes(key)) return true;
    if(key==='checkin_ids'&&val.startsWith('ov.')) return r.checkin_ids.some(id=>val.slice(3).includes(id));
    if(val.startsWith('eq.')) return String(r[key])===val.slice(3);
    if(val==='is.null') return r[key]==null;
    if(val==='not.is.null') return r[key]!=null;
    if(val.startsWith('gte.')) return r[key]>=val.slice(4);
    if(val.startsWith('in.(')) return val.slice(4,-1).split(',').includes(String(r[key]));
    throw Error('Unsupported fixture filter '+key+'='+val);
  });
  const deps={gate:()=>{},url:'https://fixture.invalid',key:'fixture',decrypt:async()=>({utente:'FACSIMILE'}),token:async()=>({token:'FACSIMILE'}),receipt:async args=>{downloads.push(args.date);if(failPortal)throw Error('offline');return {pdf:empty?Buffer.from('not a PDF'):pdf}},fetch:async(url,opts={})=>{
    const u=new URL(url),p=u.searchParams,method=opts.method||'GET';calls.push({path:u.pathname,method,query:p.toString(),body:opts.body});
    if(u.pathname.startsWith('/storage/')) {
      const path=u.pathname.split('/receipts/')[1];
      if(method==='GET')return objects.has(path)?response(objects.get(path)):response({statusCode:'404'},400);
      if(failUpload)return response({},500);
      if(concurrent){objects.set(path,pdf);return response({statusCode:'409'},400);}
      assert.equal(opts.headers['x-upsert'],'false');objects.set(path,opts.body);return response({});
    }
    const table=u.pathname.split('/').at(-1);
    if(table==='properties')return response(hiddenProperty?[]:[{id:p.get('id').slice(3)}]);
    if(table==='host_alloggiati_credentials')return response(noCreds?[]:[{verified_at:'fixture'}]);
    let data=(table==='checkins'?rows:logs).filter(r=>match(r,p));
    if(method==='PATCH') {
      if(failPatch)return response({},500);
      if(race){rows[0].filed_at='2026-10-12T01:00:00Z';data=rows.filter(r=>match(r,p));}
      const patch=JSON.parse(opts.body);assert.deepEqual(Object.keys(patch),['receipt_path']);for(const r of data)Object.assign(r,patch);return response(data.map(r=>({id:r.id})));
    }
    const total=data.length;data=data.slice(Number(p.get('offset')||0),Number(p.get('offset')||0)+Number(p.get('limit')||1000));return response(data,200,total);
  }};
  return {rows,objects,calls,downloads,deps,hooks,run:(date=now)=>collectReceipts({now:date,budgetMs:30000},deps)};
}
assert.equal(romeDate(new Date('2026-10-12T22:30:00Z')),'2026-10-13');
assert.equal(romeDate(new Date('2026-03-29T00:30:00Z')),'2026-03-29');
assert.equal(romeDate(new Date('2026-10-25T01:30:00Z')),'2026-10-25');
assert.deepEqual(receiptWindow(now),{today:'2026-10-13',oldest:'2026-09-13'});
const good=[row('a'),row('b')];let f=fixture(good,[log([good[0]]),log([good[1]],{trigger:'host'})]);
let s=await f.run();assert.equal(s.rows_attached,2);assert.equal(f.downloads.length,1);assert.equal(f.rows[0].receipt_path,f.rows[1].receipt_path);assert.equal(f.objects.size,1);
assert.deepEqual(await f.run(),{dates_pending:0,dates_attached:0,rows_attached:0,downloads:0,errors:0,deferred:0});assert.equal(f.downloads.length,1);
console.log('PASS real collector: host/autofile daily PDF sharing and repeat-run idempotence');
for(const change of [{is_test:true},{deleted_at:'2026-10-12'},{alloggiati_status:'correction'},{alloggiati_status:'pending'},{receipt_path:'manual.pdf'},{property_id:other},{filed_at:'2026-10-13T01:00:00Z'},{filed_at:'2026-10-14T01:00:00Z'},{filed_at:'2026-09-12T01:00:00Z'},{filed_at:'2026-10-12T01:00:00Z'}]) {
 const r=row('x',change);f=fixture([r],[log([r])]);assert.equal((await f.run()).rows_attached,0);assert.equal(f.downloads.length,0);
}
for(const change of [{trigger:'autofile_dry_run'},{outcome:'send_rejected'},{checkin_ids:[]}]){const r=row('x');f=fixture([r],[log([r],change)]);assert.equal((await f.run()).rows_attached,0);}
const boundary=row('x',{filed_at:'2026-09-12T22:05:00Z'});f=fixture([boundary],[log([boundary],{run_at:'2026-09-12T22:05:08Z'})]);assert.equal((await f.run()).rows_attached,1);
console.log('PASS time window, exact Rome 30-day boundary, exclusion and proof/property isolation');
for(const failure of ['upload','patch','portal','empty']){const r=row('x');f=fixture([r],[log([r])]);f.hooks[failure]=true;assert.equal((await f.run()).errors,1);assert.equal(r.receipt_path,null);f.hooks[failure]=false;assert.equal((await f.run()).rows_attached,1);}
const r=row('x');f=fixture([r],[log([r])]);f.hooks.race=true;assert.equal((await f.run()).rows_attached,0);assert.equal(r.receipt_path,null);
f=fixture([row('x')],[log([row('x')])]);f.hooks.concurrent=true;assert.equal((await f.run()).rows_attached,1);
for(const flag of ['hiddenProperty','noCreds']){f=fixture([row('x')],[log([row('x')])]);f.hooks[flag]=true;assert.equal((await f.run()).rows_attached,0);assert.equal(f.downloads.length,0);}
console.log('PASS portal/PDF/storage/attachment failures retry, race guards, concurrent object conflict and removed access');
f=fixture([row('x')],[log([row('x')])]);assert.equal((await collectReceipts({now,budgetMs:0},f.deps)).errors,1);assert.equal(f.calls.length,0);
const many=Array.from({length:150},(_,i)=>row('id'+i));f=fixture(many,[log(many)]);await f.run(new Date(now.getTime()+600000));assert.ok(f.calls.some(c=>c.query.includes('offset=100')));assert.equal(f.rows.filter(r=>r.receipt_path).length,50);await f.run(new Date(now.getTime()+1200000));assert.equal(f.rows.filter(r=>r.receipt_path).length,150);assert.equal(f.downloads.length,1);
let elapsed=0;f=fixture([row('x')],[log([row('x')])]);f.deps.clock=()=>elapsed+=15000;assert.equal((await f.run()).errors,1);assert.equal(f.downloads.length,0);
console.log('PASS bounded runtime and rotating pagination beyond the first missing-row page');
const nextRow=row('next',{filed_at:'2026-10-12T01:00:00Z'});f=fixture([row('x'),nextRow],[log([row('x')]),log([nextRow],{run_at:'2026-10-12T01:00:08Z'})]);elapsed=0;f.deps.clock=()=>elapsed;f.deps.receipt=async args=>{if(args.date==='2026-10-11'){elapsed=30000;throw Error('timeout');}return {pdf};};assert.equal((await f.run()).deferred,1);elapsed=0;assert.equal((await f.run(new Date(now.getTime()+600000))).rows_attached,1);
console.log('PASS failed date cannot starve the next daily receipt across ticks');
const api=fs.readFileSync(new URL('../api/alloggiati.js',import.meta.url),'utf8');
assert.match(api,/action === 'receipt_tick'/);assert.match(api,/const receipts = await collectReceipts\(\{ budgetMs: 12000 \}\)/);
assert.ok(!api.includes('await soapRicevuta('));assert.ok(!fs.readFileSync(new URL('../api/_alloggiati-receipts.js',import.meta.url),'utf8').match(/import[^;]*\b(send|test)\b/s));
const html=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');assert.equal((html.match(/receipt_auto_pending:/g)||[]).length,2);assert.match(html,/safe\(h\('receipt_auto_pending'\)\)/);
console.log('PASS existing scheduler reuse, no same-day Ricevuta, no filing imports and bilingual pending status');
// Execute the real post-Send branches: corrected filings must not keep an
// old daily PDF as their current proof. No SOAP code is executed by this gate.
for (const mode of ['host','autofile']) {
 const record={alloggiati_status:'correction',receipt_path:'previous.pdf',filed_at:'2026-10-01T00:00:00Z'};
 const context=vm.createContext({console,Date,prop:{id:property},propertyId:property,owner:{hostId:'fixture'},batchCheckinIds:['x'],checkinIdsFlat:['x'],lines:['fixture'],summary:{rows_filed:0,errors:0},
   sbPatch:async(_path,patch)=>Object.assign(record,patch),logFiling:async()=>{},res:{status(){return this},json(v){return v}}});
 const start=api.indexOf(mode==='host'?'    const filedAt = new Date();':'  const filedAt = new Date();',api.indexOf(mode==='host'?"  if (action === 'send')":'async function processPropertyAutofile'));
 const end=mode==='host'?api.indexOf("\n  }\n\n  if (action === 'delete')",start):api.indexOf('\n}\n',start);
 assert.ok(start>=0&&end>start);vm.runInContext('async function finish(){'+api.slice(start,end)+'}',context);await context.finish();
 assert.equal(record.alloggiati_status,'filed');assert.equal(record.receipt_path,null);assert.notEqual(record.filed_at,'2026-10-01T00:00:00Z');
}
console.log('PASS actual host/autofile completion schedules a fresh receipt for corrected submissions');
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.AUTOFILE_CRON_SECRET='fixture-cron';
const handler=(await import('../api/alloggiati.js')).default;
const originalFetch=globalThis.fetch;let dispatcherCalls=0;
globalThis.fetch=async url=>{dispatcherCalls++;assert.match(url,/\/rest\/v1\/checkins\?/);return new Response('[]',{headers:{'content-range':'*/0'}})};
const res=()=>({status(n){this.code=n;return this},json(v){this.body=v;return this},setHeader(){}});
try {
 let r=res();await handler({method:'POST',query:{action:'receipt_tick'},headers:{'x-cron-secret':'wrong'},body:{}},r);assert.equal(r.code,401);assert.equal(dispatcherCalls,0);
 r=res();await handler({method:'POST',query:{action:'receipt_tick'},headers:{'x-cron-secret':'fixture-cron'},body:{}},r);assert.equal(r.code,200);assert.equal(dispatcherCalls,1);assert.equal(r.body.receipts.rows_attached,0);
} finally {globalThis.fetch=originalFetch;}
console.log('PASS actual receipt-only dispatcher authentication and isolated collector execution');
