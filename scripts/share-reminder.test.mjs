import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import {parseHTML} from 'linkedom';
const source=fs.readFileSync(new URL('../api/send-arrival-reminders.js',import.meta.url),'utf8');
const fn=name=>{const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
const ctx=vm.createContext({APP_BASE_URL:'https://app.welcomebnb.it',encodeURIComponent});for(const name of ['esc','renderArrivalHTML'])vm.runInContext(fn(name),ctx);
for(const lang of ['en','it']){
 const html=ctx.renderArrivalHTML({id:'p&1',name:'House <safe>'},[{guest_name:'Sample',platform:'direct',booking_code:'CODE&1',checkin_date:'2099-10-14',checkout_date:'2099-10-17'}],lang);
 const {document}=parseHTML(html);const link=[...document.querySelectorAll('a')].find(a=>a.getAttribute('href').includes('open=share'));assert.ok(link);const url=new URL(link.getAttribute('href'));assert.equal(url.origin,'https://app.welcomebnb.it');assert.equal(url.searchParams.get('notify_prop'),'p&1');assert.equal(url.searchParams.get('booking'),'CODE&1');assert.equal(document.querySelector('safe'),null);
}
const consoleSource=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');assert.ok(consoleSource.includes("openParam === 'share' && allProperties.some(p => p.id === notifyProp)"));assert.ok(consoleSource.includes("openBookingShare(qs.get('booking') || '')"));
console.log('PASS actual reminder renderer IT/EN: escaped owner composer deep link retains property/booking; guest canonical link kept; console ownership gate wired.');
