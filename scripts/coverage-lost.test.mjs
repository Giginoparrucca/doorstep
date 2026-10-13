// Exercise the real warning renderer: an expired OTA echo is not a lost future block.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const start=source.indexOf('async function renderCoverageLostBanner()');
const end=source.indexOf('\n}',start)+2;
let checkout='2026-10-13',directExists=true;
const echo={id:'echo',platform:'airbnb',coverage_lost_at:'2026-10-13T04:14:43Z',covered_by_reservation_id:'direct'};
const query=kind=>new Proxy({}, {get(_,key) {
  if(key==='then') return resolve=>resolve({data:kind==='direct'?(directExists?[{id:'direct',guest_name:'Fixture',checkin_date:'2026-10-10',checkout_date:checkout,status:'active'}]:[]):[echo]});
  return arg=>query(key==='in'?'direct':kind);
}});
class Clock extends Date {constructor(...args){super(...(args.length?args:['2026-10-13T12:00:00Z']));}}
const context=vm.createContext({propertyId:'fixture',hostLang:'it',Date:Clock,Intl,console,APP_CONFIG:{mode:'production'},sb:{from:()=>query('echo')}});
vm.runInContext(source.slice(start,end),context);
for(checkout of ['2026-10-12','2026-10-13']) assert.equal(await context.renderCoverageLostBanner(),'');
checkout='2026-10-14';assert.match(await context.renderCoverageLostBanner(),/Fixture/);
context.hostLang='en';assert.match(await context.renderCoverageLostBanner(),/Fixture/);
directExists=false;assert.equal(await context.renderCoverageLostBanner(),'');
// Rome has crossed midnight while UTC is still on the previous date.
class Midnight extends Date {constructor(...args){super(...(args.length?args:['2026-10-12T22:30:00Z']));}}
directExists=true;checkout='2026-10-13';context.Date=Midnight;assert.equal(await context.renderCoverageLostBanner(),'');
console.log('PASS no past/checkout-day warning, future risk retained, deleted booking hidden, Rome midnight boundary');
