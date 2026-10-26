import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../admin-ops-metrics.js', import.meta.url), 'utf8'), context);
const { aggregate, load, readPages } = context.AdminOpsMetrics;
const since='2026-10-01T00:00:00.000Z',until='2026-10-25T12:00:00.000Z';
const c=(id,extra={})=>({id,property_id:'p',booking_code:'B',arrival_date:'2026-10-10',submitted_at:since,...extra});
const r=(code,extra={})=>({id:code,property_id:'p',booking_code:code,checkin_date:'2026-10-10',status:'active',entry_type:'reservation',...extra});
const e=(code,extra={})=>({property_id:'p',booking_code:code,event_type:'guest_link_opened',created_at:since,...extra});
const input={since,until,checkins:[c('1',{alloggiati_status:'filed',filed_at:since,autofile_last_error:'send_rejected',autofile_last_attempt_at:since}),c('2',{alloggiati_status:'pending',autofile_last_error:'send_transport_error: network',autofile_last_attempt_at:until}),c('3',{autofile_last_error:'dry_run_rejected',autofile_last_attempt_at:since}),c('4',{is_test:true}),c('5',{deleted_at:since}),c('6',{submitted_at:'2026-09-30'}),c('7',{property_id:'q'})],reservations:[r('B'),r('C'),r('C'),r('cancel',{status:'cancelled'}),r('block',{entry_type:'block'}),r('echo',{covered_by_reservation_id:'a'}),r('future',{checkin_date:'2026-10-26'}),r('old',{checkin_date:'2026-09-30'})],events:[e('B'),e('B'),e('B',{event_type:'save_property'}),e('C',{created_at:'2026-09-30'}),e('B',{property_id:'q'})]};
let m=aggregate(input);assert.equal(m.get('p').completed,3);assert.equal(m.get('p').sent,1);assert.equal(m.get('p').failed,1);assert.equal(m.get('p').bookings,2);assert.equal(m.get('p').used,1);assert.equal(m.get('q').bookings,1);assert.equal(m.get('q').used,1);
// Companions, duplicate IDs and sessions do not inflate bookings. Cancelled/echo check-ins cannot revive bookings.
m=aggregate({...input,checkins:[c('a',{booking_code:'cancel'}),c('b',{booking_code:'echo'}),c('x',{booking_code:'walkin'}),c('x',{booking_code:'walkin'})],events:[e('walkin'),e('cancel'),e('echo')]});assert.equal(m.get('p').bookings,3);assert.equal(m.get('p').used,1);assert.equal(m.get('p').completed,3);
assert.equal(aggregate({...input,checkins:[],reservations:[],events:[]}).size,0);
assert.equal(aggregate({...input,showTestData:true}).get('p').completed,4);assert.equal(aggregate({...input,showHidden:true}).get('p').completed,5);
assert.equal(aggregate({...input,checkins:[c('a',{alloggiati_status:'filing',autofile_last_error:'send_rejected',autofile_last_attempt_at:since})]}).get('p').failed,0);
assert.equal(aggregate({...input,reservations:[r('missing',{booking_code:null})],checkins:[],events:[]}).get('p').bookings,1);
let calls=0;
const rows=await readPages(()=>({order(col,opts){assert.equal(col,'id');assert.equal(opts.ascending,true);return this;},async range(a,b){calls++;assert.equal(b-a,499);return {data:Array.from({length:a===0?500:2},(_,i)=>({id:a+i}))};}}));assert.equal(rows.length,502);assert.equal(calls,2);
await assert.rejects(()=>readPages(()=>({order(){return this;},range(){return {error:new Error('denied')};}})),/denied/);
// Actual loader: minimal fields, filters, pagination and per-source error isolation.
const reads=[];const sb={from(table){const q={select(fields){reads.push([table,fields]);return q;},eq(){return q;},is(){return q;},gte(){return q;},lte(){return q;},like(){return q;},order(){return q;},range(){return table==='ota_reservations'?Promise.reject(new Error('denied')):Promise.resolve({data:[]});}};return q;}};
const data=await load(sb,{since,until});assert.equal(data.reservations,null);assert.ok(Array.isArray(data.checkins));assert.ok(Array.isArray(data.events));assert.equal(reads.length,3);assert.ok(!reads.some(([,fields])=>/surname|name|phone|email|document|\*/.test(fields)));
const html=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);assert.match(html,/AdminOpsMetrics.load\(sb/);assert.match(html,/opsMetricsData = opsRes/);assert.match(html,/admin-ops-metrics.js\?v=64.6/);
console.log('PASS admin Ops aggregation, period boundaries, isolation, pagination, source failures and inline syntax');

for(const reason of ['send_result_uncertain','send_result_requires_review','prior_send_requires_review'])assert.equal(aggregate({...input,checkins:[c('review',{alloggiati_status:'correction',autofile_last_error:reason,autofile_last_attempt_at:since})]}).get('p').failed,1);
