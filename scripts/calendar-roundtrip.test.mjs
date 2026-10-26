// Round 53: use real matcher, sync/export handlers and calendar/day-click DOM.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const C = createRequire(import.meta.url)('../lib/calendar-roundtrip.js');
const direct = (id='direct', extra={}) => ({id,property_id:'p1',platform:'direct',uid:'direct_' + id,
  entry_type:'reservation',status:'active',is_test:false,deleted_at:null,covered_by_reservation_id:null,
  checkin_date:'2026-10-10',checkout_date:'2026-10-13',booking_code:'LOCAL-KEEP',...extra});
const block = (id='block', extra={}) => ({...direct(id),platform:'airbnb',entry_type:'block',uid:'ota_' + id,
  booking_code:null,raw:{summary:'Airbnb (Not available)',description:''},...extra});
const range = rows => rows.map(r => [r.id,r.checkin_date,r.checkout_date]);
const d=direct(), b=block();
assert.equal(C.outboundUid(d),'direct_direct@welcomebnb.vercel.app');
assert.deepEqual(range(C.projectRows([d,b])),range([d]));
const mismatch=block('shifted',{checkin_date:'2026-10-11',checkout_date:'2026-10-14'});
const input=[d,mismatch]; const saved=structuredClone(input);
assert.deepEqual(range(C.projectRows(input)),[['direct','2026-10-10','2026-10-13'],['shifted','2026-10-13','2026-10-14']]);
assert.deepEqual(input,saved,'projection never edits stored data');
assert.deepEqual(range(C.projectRows([{...d,status:'cancelled'},mismatch])),range([mismatch]));
assert.deepEqual(range(C.projectRows([direct('direct',{checkout_date:'2026-10-12'}),mismatch])),
  [['direct','2026-10-10','2026-10-12'],['shifted','2026-10-12','2026-10-14']]);
const long=block('long',{checkin_date:'2026-10-08',checkout_date:'2026-10-16'});
assert.deepEqual(range(C.projectRows([d,long])),[['direct','2026-10-10','2026-10-13'],['long','2026-10-08','2026-10-10'],['long','2026-10-13','2026-10-16']]);
for(const extra of [{platform:'booking',entry_type:'reservation'},{platform:'airbnb',entry_type:'reservation'},
  {property_id:'p2'},{is_test:true}]) assert.equal(C.projectRows([d,block('other',extra)]).length,2);
assert.equal(C.projectRows([direct('a',{entry_type:'block'}),b]).length,1);
assert.equal(C.projectRows([d,block('adjacent',{checkin_date:d.checkout_date,checkout_date:'2026-10-14'})]).length,2);
const native=block('native',{uid:C.outboundUid(d)});
assert.equal(C.matchOrigin(native,[d]).id,d.id);
assert.equal(C.matchOrigin(block('metadata',{raw:{origin_uid:C.outboundUid(d)}}),[d]).id,d.id);
assert.equal(C.matchOrigin(b,[d]),null,'matching dates alone never establishes identity');
for(const extra of [{property_id:'p2'},{is_test:true},{deleted_at:'2026-10-01'},
  {checkout_date:'2026-10-14'},{checkin_date:'2026-02-30'}]) assert.equal(C.matchOrigin({...native,...extra},[d]),null);
for(const extra of [{status:'cancelled'},{is_test:true},{deleted_at:'2026-10-01'}]) assert.equal(C.matchOrigin(native,[{...d,...extra}]),null);
assert.equal(C.matchOrigin(native,[d,{...d,id:'collision'}]),null);
const auto={...native,covered_by_reservation_id:d.id,raw:{welcomebnb_auto_echo:true}};
assert.equal(C.projectRows([d,auto]).length,1);
assert.equal(C.projectRows([direct('direct',{checkout_date:'2026-10-12'}),auto]).at(-1).checkin_date,'2026-10-12');
assert.equal(C.projectRows([auto]).length,1,'missing source reveals previously auto-linked availability');
assert.equal(C.projectRows([{...auto,raw:{}}]).length,0,'host-confirmed linkage remains host-controlled');
assert.deepEqual(C.exportRows([direct('host-block',{entry_type:'block'}),b]).map(r=>r.id),['host-block']);
assert.equal(C.exportRows([d,mismatch]).length,1,'opaque residual cannot become a self-sustaining exported block');
assert.equal(C.exportRows([{...native,entry_type:'reservation'},direct('direct',{status:'cancelled'})]).length,0,
  'cancelled native source cannot keep its old nights blocked via a return');

// Exhaustively preserve the occupied-night union under overlaps, adjoining
// sources, splits, source order and UTC dates (including DST/month boundaries).
function union(rows) {
  const nights=new Set();
  for(const r of rows) if(r.status==='active'&&!r.deleted_at) {
    for(let t=Date.parse(r.checkin_date);t<Date.parse(r.checkout_date);t+=86400000) nights.add(t);
  }
  return [...nights].sort();
}
for(const origin of ['2026-03-25','2026-10-25','2026-12-25']) {
  const date=i=>new Date(Date.parse(origin)+i*86400000).toISOString().slice(0,10);
  for(let a=0;a<7;a++)for(let z=a+1;z<10;z++) {
    const rows=[direct('a',{checkin_date:date(2),checkout_date:date(5)}),
      direct('b',{checkin_date:date(5),checkout_date:date(7)}),block('x',{checkin_date:date(a),checkout_date:date(z)})];
    assert.deepEqual(union(C.projectRows(rows)),union(rows));
    assert.deepEqual(range(C.projectRows(rows)),range(C.projectRows([rows[1],rows[0],rows[2]])).sort((x,y)=> x[0].localeCompare(y[0])));
  }
}
console.log('PASS identity, property/test isolation, edits/cancellations, splits and occupied-night invariance');

const RealDate=Date;
globalThis.Date=class extends RealDate {
  constructor(...args){super(...(args.length?args:['2026-10-14T12:00:00Z']));}
  static now(){return RealDate.parse('2026-10-14T12:00:00Z');}
};
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only-service';
const {default:handler,syncOnePropertyFeeds:syncFeeds,parseICS,vEventToRow}=await import('../api/ical-sync.js');
// Keep the real import/cancellation pipeline; only replace its network boundary.
const syncOnePropertyFeeds=(...args)=>syncFeeds(...args,{fetchFeed:async url=>{
  const content=feedTexts.get(url);if(content instanceof Error)throw content;
  assert.equal(typeof content,'string','every fixture feed must be configured');return content;
}});
const token='11111111-1111-4111-8111-111111111111';
let db=[], feedTexts=new Map(), calls=[], failUpsert=false, failLookup=false;
const response=(status,data)=>({ok:status<400,status,json:async()=>structuredClone(data),text:async()=>typeof data==='string'?data:JSON.stringify(data)});
function filtered(q) {
  return db.filter(row => {
    for(const [key,value] of q) {
      if(['select','order','limit','offset','on_conflict'].includes(key)) continue;
      if(key==='or') {
        const date=/checkin_date.gte.([^,)]+)/.exec(value)?.[1];
        if(!(row.entry_type==='block'||row.checkin_date>=date)) return false;
      } else if(value==='is.null') {if(row[key]!=null)return false;}
      else if(value.startsWith('in.(')) {if(!value.slice(4,-1).replaceAll('"','').split(',').includes(String(row[key])))return false;}
      else {
        const dot=value.indexOf('.');const op=value.slice(0,dot),v=value.slice(dot+1),actual=String(row[key]);
        if(op==='eq'&&actual!==v||op==='neq'&&actual===v||op==='gte'&&actual<v||op==='lte'&&actual>v)return false;
      }
    }
    return true;
  });
}
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url);const method=options.method||'GET';calls.push({path:u.pathname,query:u.search,method,body:options.body,headers:options.headers});
  if(feedTexts.has(url)) {
    const content=feedTexts.get(url);if(content instanceof Error)throw content;
    return response(200,content);
  }
  if(u.pathname==='/rest/v1/properties') {
    if(method==='PATCH')return response(200,[]);
    assert.equal(u.searchParams.get('ical_export_token'),'eq.'+token);
    return response(200,[{id:'p1',name:'Fixture',host_language:'it'}]);
  }
  assert.equal(u.pathname,'/rest/v1/ota_reservations');
  if(method==='GET') {
    if(failLookup)return response(503,'lookup failed');
    const rows=filtered(u.searchParams);const offset=Number(u.searchParams.get('offset')||0);
    return response(200,rows.slice(offset,offset+Number(u.searchParams.get('limit')||1000)));
  }
  if(method==='POST') {
    if(failUpsert)return response(503,'write failed');
    const incoming=JSON.parse(options.body);
    assert.ok(incoming.every(row=>Object.keys(row).sort().join(',')===Object.keys(incoming[0]).sort().join(',')),
      'PostgREST bulk upsert rows have identical keys');
    for(const row of incoming) {
      const old=db.find(r=>r.property_id===row.property_id&&r.platform===row.platform&&r.uid===row.uid);
      if(old)Object.assign(old,row);else db.push({id:'import-'+db.length,is_test:false,deleted_at:null,booking_code:null,...row});
    }
    return response(201,[]);
  }
  assert.equal(method,'PATCH');const hits=filtered(u.searchParams);for(const r of hits)Object.assign(r,JSON.parse(options.body));
  return response(200,hits);
};
const res=()=>({code:200,headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}});
async function exportFeed(){const r=res();await handler({method:'GET',query:{t:token},headers:{}},r);assert.equal(r.code,200);return r.body;}
const ics=events=>['BEGIN:VCALENDAR','VERSION:2.0',...events.flatMap(e=>['BEGIN:VEVENT',...Object.entries(e).map(([k,v])=>k+':'+v),'END:VEVENT']),'END:VCALENDAR',''].join('\r\n');
const ev=(uid,extra={})=>({UID:uid,'DTSTART;VALUE=DATE':'20261010','DTEND;VALUE=DATE':'20261013',SUMMARY:'Airbnb (Not available)',...extra});
const feed={platform:'airbnb',url:'https://feed.invalid/airbnb'};
db=[structuredClone(d),structuredClone(mismatch)];
let exported=await exportFeed();let events=parseICS(exported);
assert.equal(events.length,1,'anonymous residual blocks are never relayed');assert.equal(events[0].UID,C.outboundUid(d));
assert.equal(events[0].ORIGIN_UID,events[0].UID);
assert.ok(!exported.includes('LOCAL-KEEP'));assert.ok(!exported.includes(token));
db=[structuredClone(d)];exported=await exportFeed();feedTexts.set(feed.url,exported);
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
let echo=db.find(r=>r.platform==='airbnb');assert.equal(echo.covered_by_reservation_id,d.id);assert.equal(echo.entry_type,'block');
assert.equal(echo.booking_code,null);assert.equal(db[0].booking_code,'LOCAL-KEEP');
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');assert.equal(db.length,2);
assert.equal(parseICS(await exportFeed()).length,1,'echo is not re-exported');
// Origin identity also breaks round trips of OTA entries in the combined feed.
const originalOta=block('original',{platform:'vrbo',entry_type:'reservation',booking_code:'ORIGINAL-GUEST'});
db=[originalOta];feedTexts.set(feed.url,ics([ev(C.outboundUid(originalOta))]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db[1].covered_by_reservation_id,originalOta.id);assert.equal(db[0].booking_code,'ORIGINAL-GUEST');
assert.equal(parseICS(await exportFeed()).length,1);
// Explicit host unlink is retained on subsequent imports, including metadata.
db=[structuredClone(d),block('ignored',{uid:C.outboundUid(d),raw:{welcomebnb_echo_ignored:true}})];
feedTexts.set(feed.url,ics([ev(C.outboundUid(d))]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db[1].covered_by_reservation_id,null);assert.equal(db[1].raw.welcomebnb_echo_ignored,true);
assert.equal(C.projectRows(db).length,2);
const oneNight=direct('one-night',{checkin_date:'2026-10-14',checkout_date:'2026-10-15'});
db=[oneNight];feedTexts.set(feed.url,ics([ev(C.outboundUid(oneNight),{'DTSTART;VALUE=DATE':'20261014','DTEND;VALUE=DATE':'20261015'})]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db[1].covered_by_reservation_id,oneNight.id,'known day-of one-night echo survives noise filter');
assert.equal(db[1].status,'active');
db=[structuredClone(d)];
feedTexts.set(feed.url,ics([ev('rewritten',{'X-WELCOMEBNB-UID':C.outboundUid(d)})]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db.find(r=>r.uid==='rewritten').covered_by_reservation_id,d.id);
feedTexts.set(feed.url,ics([ev('description-copy',{DESCRIPTION:'WelcomeBnB calendar event: '+C.outboundUid(d)})]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db.find(r=>r.uid==='description-copy').covered_by_reservation_id,d.id);
const rawCopy=structuredClone(db.find(r=>r.uid==='description-copy').raw);
db[0].checkout_date='2026-10-12';assert.equal(parseICS(await exportFeed()).length,1,'edited-source echoes never pin stale nights outbound');
assert.equal(C.projectRows(db).at(-1).checkin_date,'2026-10-12','edited-source residual remains visible');
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');assert.equal(db.find(r=>r.uid==='description-copy').covered_by_reservation_id,null);
assert.ok(rawCopy.description.includes(C.outboundUid(d)),'raw evidence retained');
db[0].status='cancelled';await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(parseICS(await exportFeed()).length,0,'cancellation cannot bounce old availability back out');
db[0].deleted_at='2026-10-14T00:00:00Z';await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.equal(db.find(r=>r.uid==='description-copy').raw.welcomebnb_origin_source,d.id,'soft-deleted source identity retained');
// Metadata-stripping/rotation does not create a guest booking or identity claim.
db=[structuredClone(d)];feedTexts.set(feed.url,ics([ev('opaque')]));
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');assert.equal(db[1].covered_by_reservation_id,undefined);
assert.equal(C.projectRows(db).length,1);assert.equal(parseICS(await exportFeed()).length,1);
// Real reservations, guest links and host-confirmed links are protected.
for(const previous of [block('coded',{uid:C.outboundUid(d),booking_code:'OTA-KEEP'}),
  block('manual',{uid:C.outboundUid(d),covered_by_reservation_id:'host-chosen',coverage_lost_at:'old'})]) {
  db=[structuredClone(d),previous];feedTexts.set(feed.url,ics([ev(C.outboundUid(d))]));
  await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
  assert.equal(db[1].booking_code,previous.booking_code);
  assert.equal(db[1].covered_by_reservation_id,previous.covered_by_reservation_id);
  if(previous.id==='manual')assert.equal(db[1].coverage_lost_at,null);
}
// A failed same-platform sibling or write prevents the platform-wide sweep.
for(const failure of ['fetch','write','invalid','event','lookup']) {
  db=[structuredClone(d),block('future',{checkin_date:'2099-10-10',checkout_date:'2099-10-13'})];calls=[];
  const sibling={...feed,url:'https://feed.invalid/sibling'};
  feedTexts.set(feed.url,ics([]));feedTexts.set(sibling.url,failure==='fetch'?new Error('offline'):failure==='invalid'?'BEGIN:VCALENDAR\r\n':failure==='event'?ics([{'DTSTART;VALUE=DATE':'20261010'}]):ics([ev('new')]));
  failUpsert=failure==='write';failLookup=failure==='lookup';
  try {await syncOnePropertyFeeds('p1',[feed,sibling],'fixture-anon','fixture-owner');}catch(e){assert.equal(failure,'lookup');}
  assert.equal(db[1].status,'active',failure+' preserves previous rows');
  failLookup=false;failUpsert=false;
}
assert.ok(calls.every(call=>call.method==='GET'),'lookup failure is read-only');
// Pagination cannot make a direct source beyond the default page disappear.
db=Array.from({length:501},(_,i)=>direct('d'+i,{status:'cancelled'}));db.push(structuredClone(d));
feedTexts.set(feed.url,ics([ev(C.outboundUid(d))]));calls=[];
await syncOnePropertyFeeds('p1',[feed],'fixture-anon','fixture-owner');
assert.ok(calls.some(c=>c.query.includes('offset=500')));assert.equal(db.at(-1).covered_by_reservation_id,d.id);
console.log('PASS real export/sync: stable UID, raw evidence, repeat/rewritten/opaque feeds, protected links, failures and pagination');
globalThis.Date=RealDate;

// Execute the actual calendar and day-click functions against a real DOM.
const html=readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const fn=name=>{
  const start=html.indexOf('function '+name+'(');assert.ok(start>=0,name);
  for(let end=html.indexOf('\n}',start);end>=0;end=html.indexOf('\n}',end+2)) {
    const candidate=html.slice(start,end+2);try{new vm.Script((html.slice(start-6,start)==='async '?'async ':'')+candidate);return candidate;}catch{}
  }
  throw new Error('Cannot extract '+name);
};
const {document,window}=parseHTML('<html><body><main id="calendar"></main></body></html>');
let calendarRows=[d,mismatch],clicked=[];
const query=new Proxy({}, {get(_,key){if(key==='then')return resolve=>resolve({data:structuredClone(calendarRows)});return ()=>query;}});
const ctx=vm.createContext({document,window,console,Date,Intl,CalendarRoundtrip:C,propertyId:'p1',propertyData:{},hostLang:'it',
  APP_CONFIG:{mode:'production'},APP_ORIGIN:'https://fixture.invalid',allCheckins:[],allRooms:[],_calendarRoomFilter:null,_upcomingCalYear:2026,_upcomingCalMonth:9,
  _upcomingCalSelectedDay:null,_upcomingRowsById:{},sb:{from:()=>query},h:k=>k,
  ensureReservationBookingCodes:async rows=>rows,_cleanOtaGuestName:n=>n,_showReservationDetail:id=>clicked.push(id)});
for(const name of ['_r39Pad','_r39IsoDate','_r39ParseISO','_r39AddDays','_r39DowMon','_r39WeekdayLabels','_r39MonthLabel'])vm.runInContext(fn(name),ctx);
for(const name of ['_renderUpcomingCalendarBody','_upcomingCalSelectDay','_computeReservationOverlap'])vm.runInContext('async '+fn(name),ctx);
for(const lang of ['it','en']) {
  ctx.hostLang=lang;document.getElementById('calendar').innerHTML=await ctx._renderUpcomingCalendarBody(()=> '');
  const bars=[...document.querySelectorAll('.cal-bar-block')];assert.equal(bars.length,1);
  assert.match(bars[0].getAttribute('title'),/2026-10-13 → 2026-10-14/);
  assert.equal(document.querySelectorAll('.cal-cover-pill').length,0);
  assert.equal(ctx._upcomingRowsById.shifted.checkin_date,'2026-10-11','details retain original dates');
  clicked=[];await ctx._upcomingCalSelectDay('2026-10-12');assert.deepEqual(clicked,['direct']);
  clicked=[];await ctx._upcomingCalSelectDay('2026-10-13');assert.deepEqual(clicked,['shifted']);
  assert.equal((await ctx._computeReservationOverlap('p1','2026-10-10','2026-10-13','direct')).length,0,'a residual outside the requested dates does not create a false conflict');
  calendarRows=[d,b];document.getElementById('calendar').innerHTML=await ctx._renderUpcomingCalendarBody(()=> '');
  assert.equal(document.querySelectorAll('.cal-bar-block').length,0);
  assert.equal((await ctx._computeReservationOverlap('p1','2026-10-10','2026-10-13','direct')).length,0,'identical redundant block does not obstruct unchanged direct edit');
  calendarRows=[d,mismatch];
}
// Browser IIFE actually loads without a CommonJS environment.
const browserContext=vm.createContext({window:{},Date});vm.runInContext(readFileSync(new URL('../lib/calendar-roundtrip.js',import.meta.url),'utf8'),browserContext);
assert.equal(browserContext.window.CalendarRoundtrip.projectRows([d,b]).length,1);
console.log('PASS real calendar DOM IT/EN, residual bar, original details, mobile day clicks, editing and browser module');
