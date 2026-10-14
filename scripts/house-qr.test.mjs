import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import qrcode from 'qrcode-generator';import {parseHTML} from 'linkedom';
const source=fs.readFileSync(new URL('../host-share.js',import.meta.url),'utf8');
for(const origin of ['https://app.welcomebnb.it','https://demo.welcomebnb.it'])for(const lang of ['it','en']){
 const {document}=parseHTML('<html><body><div id="house"></div></body></html>');const copied=[];
 const W={qrcode,navigator:{clipboard:{writeText:async s=>copied.push(s)}},open:()=>null};vm.runInContext(source,vm.createContext({window:W,URL,console,Intl,Date,Map,Set}));
 const context={origin,lang,propertyId:'p&1',property:{name:'Casa <img src=x onerror=alert(1)>'}};const root=document.getElementById('house');const c=W.HostShare.createHouse({root,context:()=>context});c.render();
 const expected=origin+'/?p=p%261';assert.equal(root.querySelector('[data-house-url]').getAttribute('href'),expected);assert.ok(root.querySelector('svg'));await root.querySelector('[data-house-copy]').onclick();assert.equal(copied.at(-1),expected);
 root.querySelector('[data-house-print]').onclick();assert.match(root.querySelector('[data-house-feedback]').textContent,lang==='it'?/bloccata/:/blocked/);
 const html=W.HostShare.printDocument(context.property.name,expected,root.querySelector('svg').outerHTML);const printed=parseHTML(html).document;assert.equal(printed.querySelector('img'),null);assert.equal(printed.querySelector('h1').textContent,context.property.name);assert.ok(!html.includes('?b='));assert.ok(!html.includes('test='));assert.equal(printed.querySelector('a').getAttribute('href'),expected);
 const old=root.querySelector('[data-house-copy]');context.propertyId='p2';await old.onclick();assert.equal(copied.length,1,'stale property action invalidated');c.render();assert.equal(root.querySelector('[data-house-url]').getAttribute('href'),origin+'/?p=p2');
 W.qrcode=()=>{throw Error('unavailable');};c.render();assert.ok(root.querySelector('[data-house-print]').hasAttribute('disabled'));assert.ok(root.querySelector('[data-house-download]').hasAttribute('disabled'));await root.querySelector('[data-house-copy]').onclick();assert.equal(copied.at(-1),origin+'/?p=p2');
}
console.log('PASS actual house QR/render/copy/print markup in IT/EN, production/demo, property switches, malicious names, no booking/test parameters, blocked windows and failed QR rendering');
