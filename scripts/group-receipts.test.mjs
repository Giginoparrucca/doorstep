// Round 52 Phase 2: execute real group rendering and receipt interactions.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
const source = readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const fn = name => {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
};
const { document, window } = parseHTML('<html><body><table><tbody id="checkinTable"></tbody></table><span id="checkinCount"></span></body></html>');
const signed = [], opened = [], alerts = [];
const ctx = vm.createContext({ document, window, console, hostLang:'en', propertyData:{}, allCheckins:[],
  h:k=>k, isCheckinGroupCollapsed:()=>false, _renderAutofileRowChip:()=>'',
  sb:{storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{signed.push({bucket,path,ttl});return {data:{signedUrl:'https://fixture.invalid/'+encodeURIComponent(path)}};}})}},
  alert:message=>alerts.push(message), toast:()=>{} });
window.open = (url,target,features) => opened.push({url,target,features});
for (const name of ['_isValidPastDOB','_guestTypeLabel','viewGroupReceipts','renderCheckins','viewGuest']) vm.runInContext(fn(name),ctx);
vm.runInContext('async '+fn('_openAlloggiatiReceipt'),ctx);
const row = (id,extra={})=>({id,property_id:'p1',booking_code:'GROUP',name:'Sample',surname:'Guest',guest_type:'member',date_of_birth:'1980-01-01',arrival_date:'2026-10-10',alloggiati_status:'filed',filed_at:'2026-10-11T12:00:00Z',...extra});
const button = ()=>document.querySelector('.checkin-group-header [data-guide="checkin-receipt-btn"]');
for (const lang of ['en','it']) {
 ctx.hostLang=lang;
 ctx.allCheckins=[row('a'),row('b')];ctx.renderCheckins();
 assert.equal(button().tagName,'LABEL');assert.equal(document.querySelectorAll('input[type="file"]').length,1);
 ctx.allCheckins=[row('a',{receipt_path:'p1/daily.pdf'}),row('b',{receipt_path:'p1/daily.pdf',guest_edited_at:'2026-10-08T00:00:00Z'})];ctx.renderCheckins();
 assert.equal(button().tagName,'BUTTON');assert.match(button().textContent,lang==='it'?/Visualizza ricevuta/:/View receipt/);
 assert.equal(document.querySelectorAll('input[type="file"]').length,0);
 assert.equal(document.querySelectorAll('[data-checkin-group] [data-guide="checkin-receipt-btn"]').length,0);
 assert.match(document.getElementById('checkinTable').textContent,lang==='it'?/ospite ·/:/guest ·/);
 const before=signed.length;await ctx.viewGroupReceipts(button());
 assert.equal(signed.length,before+1);assert.deepEqual(signed.at(-1),{bucket:'receipts',path:'p1/daily.pdf',ttl:300});
 assert.equal(document.getElementById('groupReceiptsModal'),null);
 ctx.viewGuest('a');assert.equal(document.getElementById('guestModalReceiptBox'),null);
 assert.match(document.getElementById('guestDetailModal').textContent,lang==='it'?/intestazione del gruppo/:/group header/);
 assert.equal(signed.length,before+1);document.getElementById('guestDetailModal').remove();
 // Same booking at a different property, and a different booking at this
 // property, must never leak additional PDFs into this group's chooser.
 ctx.allCheckins=[row('a',{receipt_path:'p1/daily.pdf'}),row('b',{receipt_path:"p1/second'&.pdf"}),row('c',{receipt_path:'p1/daily.pdf'}),row('d',{receipt_path:null}),row('x',{property_id:'p2',receipt_path:'p2/other.pdf'}),row('y',{booking_code:'OTHER',receipt_path:'p1/other-booking.pdf'})];
 ctx.renderCheckins();const prior=signed.length;ctx.viewGroupReceipts(button());
 const modal=document.getElementById('groupReceiptsModal');assert.ok(modal);assert.equal(signed.length,prior);
 assert.match(modal.textContent,lang==='it'?/Ricevute del gruppo/:/Group receipts/);
 const choices=modal.querySelectorAll('button');assert.equal(choices.length,3);
 await choices[0].onclick();await choices[1].onclick();assert.equal(signed.length,prior+2);assert.equal(signed.at(-1).path,"p1/second'&.pdf");
 choices[2].onclick();assert.equal(document.getElementById('groupReceiptsModal'),null);
 // Partial attachment still offers group view; no accidental re-upload.
 ctx.allCheckins=[row('a',{receipt_path:'p1/daily.pdf'}),row('b',{alloggiati_status:'correction'})];ctx.renderCheckins();
 assert.equal(button().tagName,'BUTTON');assert.equal(document.querySelectorAll('input[type="file"]').length,0);
 // Legacy guests without a booking code remain singleton groups.
 ctx.allCheckins=[row('solo',{booking_code:null,receipt_path:'p1/solo.pdf'})];ctx.renderCheckins();await ctx.viewGroupReceipts(button());assert.equal(signed.at(-1).path,'p1/solo.pdf');
 ctx.allCheckins=[row('solo',{booking_code:null})];ctx.renderCheckins();assert.equal(button().tagName,'LABEL');
 console.log('PASS '+lang+': shared/multiple/partial/solo receipts, group controls, signing and guest detail isolation');
}
// An upload or next-day attachment swaps the control on the next render.
ctx.allCheckins=[row('a')];ctx.renderCheckins();assert.equal(button().tagName,'LABEL');ctx.allCheckins[0].receipt_path='p1/new.pdf';ctx.renderCheckins();assert.equal(button().tagName,'BUTTON');
// Signing failures surface feedback without opening a public or broken URL.
const count=opened.length;ctx.sb.storage.from=()=>({createSignedUrl:async()=>({error:{message:'denied'}})});await ctx.viewGroupReceipts(button());assert.equal(opened.length,count);assert.equal(alerts.length,1);
console.log('PASS attachment transition and signed-link failure');
// Compile all inline scripts, independently of the fixture execution.
for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if(match[1].trim())new vm.Script(match[1]);
console.log('PASS all host-console inline scripts compile');
