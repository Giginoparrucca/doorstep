import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { parseHTML } from 'linkedom';
import { readEnvironment, PRODUCTION_ORIGIN } from '../lib/environment.mjs';
const source = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
const fn = name => {
  let start = source.indexOf('function ' + name + '(');
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}\n', start) + 2);
};
for (const stale of ['https://welcomebnb.vercel.app', 'https://old-preview.vercel.app']) {
  assert.equal(readEnvironment({APP_BASE_URL:stale}).appOrigin, PRODUCTION_ORIGIN);
}
for (const origin of [PRODUCTION_ORIGIN, 'https://demo.welcomebnb.it']) {
 for (const lang of ['en','it']) {
  const {document} = parseHTML('<html><body><div id="pastBookingCodes"></div><div id="pastCodesTable"></div><div id="bookingCodeDisplay"></div><div id="guestLink"></div><div id="bookingLinkSection"></div><textarea id="preArrivalTemplate">Hello {guest_link}</textarea><div id="apartmentLink"></div></body></html>');
  const original = 'https://welcomebnb.vercel.app/?b=OLD%26CODE&p=original-property&test=1#stay';
  const saved = [{code:'OLD&CODE',link:original,created:'2026-10-01'}];
  let persisted = JSON.stringify(saved);
  const copied=[], qrs=[],opened=[];
  const ctx = vm.createContext({URL,document,APP_ORIGIN:origin,hostLang:lang,propertyId:'selected-property',propertyData:{name:'Example'},
   safe:s=>String(s??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll("'",'&#39;'),
   localStorage:{getItem:()=>persisted,setItem:(k,v)=>{persisted=v;}},
   navigator:{clipboard:{writeText:async v=>copied.push(v)}},renderQR:u=>qrs.push(u),
   window:{open:u=>opened.push(u)},toast:()=>{},track:()=>{},setTimeout:()=>{}});
  for(const name of ['currentSavedGuestLink','renderPastCodes','copyReservationLink','generateBookingCode','initQRPanel','copyLink','copyTemplate','openPreviewAsGuest']) vm.runInContext(fn(name),ctx);
  ctx.renderPastCodes();
  const button=document.querySelector('button');
  assert.equal(button.disabled,false);
  await ctx.copyReservationLink(button.dataset.guestLink,button);
  const copiedOld=new URL(copied.at(-1));
  assert.equal(copiedOld.origin,origin);
  assert.equal(copiedOld.searchParams.get('b'),'OLD&CODE');
  assert.equal(copiedOld.searchParams.get('p'),'original-property');
  assert.equal(copiedOld.searchParams.get('test'),'1');assert.equal(copiedOld.hash,'#stay');
  assert.equal(JSON.parse(persisted)[0].link,original,'saved data retained');
  assert.equal(ctx.currentSavedGuestLink('broken'),'');
  assert.equal(ctx.currentSavedGuestLink('javascript:alert(1)'),'');
  ctx.initQRPanel();assert.equal(qrs.at(-1),origin+'/?p=selected-property');
  ctx.generateBookingCode();ctx.copyLink();ctx.copyTemplate();
  const generated=new URL(copied.at(-2));assert.equal(generated.origin,origin);
  assert.equal(generated.searchParams.get('p'),'selected-property');
  assert.match(copied.at(-1),new RegExp(origin.replaceAll('.','\\.')));
  assert.equal(qrs.at(-1),generated.href);
  ctx.openPreviewAsGuest();assert.equal(new URL(opened.at(-1)).origin,origin);
 }
}
const admin=fs.readFileSync(new URL('../admin.html',import.meta.url),'utf8');
assert.ok(admin.includes('href="${APP_CONFIG.appOrigin}/?p=${encodeURIComponent(p.id)}"'));
for(const html of [source,admin,fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')]) {
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(m[1].trim()) new vm.Script(m[1]);
}
console.log('PASS guest links: stale overrides, saved booking/property parameters, real copy/template/QR/preview functions in production/demo and EN/IT; admin and inline syntax.');
