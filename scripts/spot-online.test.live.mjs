// Read-only release smoke: public production assets and fictional XML generation.
// Explicit origin avoids testing old production code during a pre-merge CI run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const origin=process.env.SPOT_SMOKE_ORIGIN;
if(!origin){console.error('SKIP SPOT_SMOKE_ORIGIN not set (post-deployment release smoke)');process.exit(77);}
const base=new URL(origin);assert.equal(base.protocol,'https:');
const files=['host-console.html','host-regional-exports.js','lib/regional-exports.js','lib/alloggiati-records.js','host-guides.js'];
const remote={};
for(const file of files){
 const url=new URL('/'+file,base);url.searchParams.set('release','round61');
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,file);
 remote[file]=await response.text();assert.equal(remote[file],fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),file+' must match tested source');
}
const sandbox=vm.createContext({TextEncoder,Intl,Date});
for(const file of ['lib/alloggiati-records.js','lib/regional-exports.js'])vm.runInContext(remote[file],sandbox,{filename:file});
const fixture=JSON.parse(fs.readFileSync(new URL('./golden/synthetic/spot-online-fixtures.json',import.meta.url)));
for(const startup of [false,true]){
 const result=sandbox.RegionalExports.generate({...structuredClone(fixture),startup,allog:sandbox.AllogRecords});
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));
 assert.equal(result.files[0].content,fs.readFileSync(new URL('./golden/synthetic/spot-online'+(startup?'-startup':'')+'-expected.xml',import.meta.url),'utf8'));
}
console.log('PASS SPOT production smoke: five public assets match tested source; hosted serializer produces normal/startup goldens. No real guest data read or writes.');
