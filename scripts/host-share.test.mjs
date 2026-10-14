import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {parseHTML} from 'linkedom';
const script=fs.readFileSync(new URL('../host-share.js',import.meta.url),'utf8');
const fixture=(extra={})=>({id:'r1',property_id:'p1',booking_code:'CODE&1',guest_name:'Sample <Guest>',checkin_date:'2099-10-14',checkout_date:'2099-10-17',entry_type:'reservation',status:'active',is_test:false,...extra});
function harness(lang='en',origin='https://app.welcomebnb.it') {
 const {window,document}=parseHTML('<html><body><div id="root"></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(v){for(const o of this.querySelectorAll('option')){if(o.value===v)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
 const copy=[],queries=[],assigned=[];let fail=false,copyFail=false,pause=null;
 const db={ota_reservations:[fixture()],checkins:[]};
 const context={propertyId:'p1',property:{name:'Test House',timezone:'Europe/Rome'},lang,origin,mode:'production'};
 const sb={from(table){let prop;const q={select(){return q;},eq(k,v){if(k==='property_id')prop=v;return q;},order(){return q;},async range(from,to){queries.push({table,prop,from,to});if(pause)await pause;if(fail)return {error:Error('fixture failure')};return {data:db[table].filter(r=>r.property_id===prop).slice(from,to+1)};}};return q;}};
 context.sb=sb;const moduleWindow={navigator:{clipboard:{writeText:async value=>{if(copyFail)throw Error('denied');copy.push(value);}}}};
 vm.runInContext(script,vm.createContext({window:moduleWindow,console,URL,Intl,Date,Map,Set}));
 const root=document.getElementById('root');
 const controller=moduleWindow.HostShare.create({root,context:()=>context,ensureCodes:async rows=>{assigned.push(...rows.map(r=>r.id));for(const r of rows)r.booking_code='ASSIGNED-'+r.id;}});
 return {window:moduleWindow,document,root,controller,db,context,copy,queries,assigned,setFail:v=>fail=v,setCopyFail:v=>copyFail=v,setPause:v=>pause=v};
}
for(const lang of ['en','it'])for(const origin of ['https://app.welcomebnb.it','https://demo.welcomebnb.it']) {
 const h=harness(lang,origin);await h.controller.load();
 assert.equal(h.root.querySelectorAll('#shareBooking option').length,1);
 assert.equal(h.root.querySelector('guest'),null,'guest label escaped');
 const a=h.root.querySelector('a');const u=new URL(a.getAttribute('href'));assert.equal(u.origin,origin);assert.equal(u.searchParams.get('b'),'CODE&1');assert.equal(u.searchParams.get('p'),'p1');
 await h.root.querySelector('[data-share-link]').onclick();assert.equal(h.copy.at(-1),a.getAttribute('href'));
 const text=h.root.querySelector('textarea');assert.ok(!/\{guest_/.test(text.value));text.value='My edited message';text.oninput();await h.root.querySelector('[data-share-copy]').onclick();assert.equal(h.copy.at(-1),'My edited message');
 await h.controller.load();assert.equal(h.root.querySelector('textarea').value,'My edited message');
 h.setCopyFail(true);await h.root.querySelector('[data-share-link]').onclick();assert.match(h.root.querySelector('[data-share-feedback]').textContent,lang==='it'?/non riuscita/:/Could not copy/);
 h.context.lang=lang==='it'?'en':'it';h.controller.repaint();assert.notEqual(h.root.querySelector('textarea').value,'My edited message');
 h.context.propertyId='p2';h.controller.repaint();assert.equal(h.root.innerHTML,'');
 console.log('PASS '+lang+' '+origin+': actual selection/copy/message edits/refresh/language and property invalidation');
}
const h=harness();h.db.ota_reservations=[fixture(),fixture({id:'block',entry_type:'block'}),fixture({id:'cancelled',booking_code:'CANCEL',status:'cancelled'}),fixture({id:'deleted',deleted_at:'2026-01-01'}),fixture({id:'test',is_test:true}),fixture({id:'echo',covered_by_reservation_id:'r1'}),fixture({id:'other',property_id:'p2'}),fixture({id:'missing',booking_code:null}),fixture({id:'past',booking_code:'PAST',checkout_date:'2020-01-01',checkin_date:'2019-12-30'})];
h.db.checkins=[{id:'c1',property_id:'p1',booking_code:'WALKIN',name:'Walk',surname:'In',guest_type:'head',submitted_at:'2026-01-01',arrival_date:'2099-10-14',departure_date:'2099-10-17'},{id:'c2',property_id:'p1',booking_code:'CANCEL',submitted_at:'2026-01-01'},{id:'c3',property_id:'p2',booking_code:'FOREIGN',submitted_at:'2026-01-01'}];
await h.controller.load();assert.equal(h.controller.getState().rows.length,4);assert.deepEqual(h.assigned,['missing']);
assert.equal(h.root.querySelectorAll('#shareBooking option').length,3);
await h.controller.load('PAST');assert.equal(h.controller.getState().scope,'all');assert.equal(h.controller.getState().selected,'past');
await h.controller.load('NOT-FOUND');assert.equal(h.root.querySelector('textarea'),null,'never share another booking on a failed deep link');
h.setFail(true);await h.controller.load();assert.ok(h.root.querySelector('[data-share-retry]'));h.setFail(false);await h.root.querySelector('[data-share-retry]').onclick();assert.ok(h.root.querySelector('textarea'));
h.db.ota_reservations=[];h.db.checkins=[];await h.controller.load();assert.equal(h.root.querySelector('textarea'),null);assert.match(h.root.textContent,/No bookings/);
const paged=harness();paged.db.ota_reservations=Array.from({length:501},(_,i)=>fixture({id:'r'+i,booking_code:'C'+i}));await paged.controller.load();assert.equal(paged.controller.getState().rows.length,501);assert.ok(paged.queries.some(q=>q.from===500));
const race=harness();let release;race.setPause(new Promise(r=>release=r));const old=race.controller.load();race.context.propertyId='p2';race.setPause(null);await race.controller.load();release();await old;assert.equal(race.controller.getState().property,'p2');assert.equal(race.root.querySelector('textarea'),null);
const demo=harness();demo.context.mode='demo';demo.db.ota_reservations=[fixture({is_test:true,booking_code:'DEMO-A'}),fixture({id:'test2',is_test:true,booking_code:'TEST-X'})];await demo.controller.load();assert.equal(demo.controller.getState().rows.length,1);
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');assert.ok(!source.includes('function generateBookingCode('));assert.ok(!source.includes('id="pastBookingCodes"'));assert.equal((source.match(/onclick="openBookingShare\(decodeURIComponent\(this.dataset.shareCode\)\)"/g)||[]).length,2);
for(const m of source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
console.log('PASS exclusions, check-in-only booking, stable missing-code path, explicit past selection, missing selection, pagination, errors/retry, empty, races, demo and entry-point/inline gates');
