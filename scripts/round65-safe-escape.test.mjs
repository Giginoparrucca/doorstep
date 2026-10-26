import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {parseHTML} from 'linkedom';import {deploymentConfig} from '../lib/deployment-config.mjs';
import {securityHeaders,resourcePolicy} from '../lib/security-headers.mjs';
const source=fs.readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const defs=source.split('\n').filter(line=>/const (?:safe|_alloggiatiSafe) = s =>/.test(line));assert.equal(defs.length,12);
const cases=['&<>"\'`/','\');globalThis.pwned=true;//','" onmouseover="alert(1)','<img src=x onerror=alert(1)>','O\'Brien `room` / A&B',null,undefined];
let seed=65;for(let i=0;i<100;i++){let s='';for(let j=0;j<32;j++){seed=(seed*1664525+1013904223)>>>0;s+='abc&<>"\'`/'[seed%10];}cases.push(s);}
for(const def of defs){
 const name=def.includes('_alloggiatiSafe')?'_alloggiatiSafe':'safe';const safe=vm.runInNewContext(def+'\n'+name);
 for(const input of cases){const escaped=safe(input);assert.ok(!/[<>"'`/]/.test(escaped),escaped);
  if(input!=null&&input!==''){
   const {document}=parseHTML('<div id="fixture" data-value="'+escaped+'">'+escaped+'</div>');
   const el=document.getElementById('fixture');assert.equal(el.textContent,input);assert.equal(el.dataset.value,input);assert.equal(el.children.length,0);
  }
 }
}
// HTML entities are decoded before inline handlers compile. Their arguments
// must therefore come from attributes, never from HTML-escaped JS literals.
const tags=[...source.matchAll(/<[a-z][^>]*>/g)].map(x=>x[0]);
const risky=tags.filter(t=>/on\w+="[^"]*\$\{safe\(/.test(t));assert.deepEqual(risky,[]);
const dataHandlers=tags.filter(t=>/data-(?:booking-code|reservation-id|receipt-path|date|guest-link)=/.test(t)&&/onclick=/.test(t));
assert.ok(dataHandlers.length>=12);
for(const tag of dataHandlers){const handler=/onclick="([^"]*)"/.exec(tag)?.[1];if(handler)assert.ok(!handler.includes('${safe('));}
for(const name of ['index.html','admin.html']){
 const html=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
 const changed=name==='index.html'?html.match(/<a href="https:\/\/getwelcomebnb.com"[^>]*>/)?.[0]:html.match(/<a href="\$\{APP_CONFIG.appOrigin\}[^>]*>/)?.[0];
 assert.ok(changed?.includes('rel="noopener noreferrer"'));
}
const headers=deploymentConfig({}).headers;assert.ok(headers.some(r=>r.source==='/(.*)'&&JSON.stringify(r.headers)===JSON.stringify(securityHeaders)));
assert.ok(headers.some(r=>r.source==='/app-config.js'),'existing cache policy retained');
assert.ok(resourcePolicy.includes('report-uri /api/csp-report'));assert.ok(resourcePolicy.includes('wss://*.supabase.co'));
assert.ok(!securityHeaders.find(x=>x.key==='Content-Security-Policy').value.includes('script-src'),'resource restriction remains report-only');
console.log('PASS all 12 escaping helpers, deterministic 100-name fuzz, HTML text/attributes, dynamic handler separation, opener links and preserved deployment settings');
