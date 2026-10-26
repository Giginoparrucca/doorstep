import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {fetchPublicIcal,resolvePublicFeed,isPublicAddress,feedErrorCode,FeedNetworkError} from '../api/_safe-ical-fetch.js';

const publicDns=async()=>[{address:'8.8.8.8',family:4},{address:'2606:4700:4700::1111',family:6}];
const rejects=async(p,code)=>assert.rejects(p,e=>e instanceof FeedNetworkError&&e.code===code&&e.message===code);
for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.31.2.3',
 '192.168.1.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.1.2.3','255.255.255.255',
 '168.63.129.16','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','64:ff9b::a00:1','2001::1',
 '2002:7f00:1::','3fff::1','fc00::1','fe80::1','ff02::1','fe00::1','bad','8.8.8.8%lo0'])assert.equal(isPublicAddress(ip),false,ip);
for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888'])assert.ok(isPublicAddress(ip),ip);
let dnsCalls=0,requests=[];
const lookup=async()=>{dnsCalls++;return publicDns();};
function transport(steps){
 return (url,options,callback)=>{
  const step=steps.shift();assert.ok(step,'unexpected connection');requests.push({url,options});
  const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{
   if(step.error){req.emit('error',new Error('PRIVATE TLS/DNS/token detail'));return;}
   if(step.hang)return;
   const res=new PassThrough();res.statusCode=step.status??200;res.headers=step.headers??{};
   req.res=res;callback(res);
   if(!step.bodyHang&&!res.destroyed)res.end(step.body??'BEGIN:VCALENDAR\r\nEND:VCALENDAR');
  });req.destroy=()=>{req.res?.destroy();};return req;
 };
}
for(const url of ['http://8.8.8.8','file:///etc/passwd','https://localhost/x','https://x.localhost./x',
 'https://user:pass@public.test/x','https://127.1/x','https://2130706433/x','https://0177.0.0.1/x',
 'https://[::1]/x','https://[::ffff:7f00:1]/x','https://[fc00::1]/x']){
 await rejects(fetchPublicIcal(url,100,{lookup,request:transport([])}),'blocked_private_network');
}
assert.equal(requests.length,0);assert.equal(dnsCalls,0);
await rejects(resolvePublicFeed('https://public.test',{lookup:async()=>[{address:'8.8.8.8'},{address:'10.0.0.1'}]}),'blocked_private_network');
await rejects(resolvePublicFeed('https://public.test',{lookup:async()=>{throw Error('PRIVATE');}}),'unreachable');
await rejects(resolvePublicFeed('https://public.test',{lookup:async()=>[]}),'unreachable');
await rejects(fetchPublicIcal('https://public.test',10,{lookup:()=>new Promise(()=>{}),request:transport([])}),'timeout');

assert.match(await fetchPublicIcal('https://public.test/feed?secret=fixture',100,{lookup,request:transport([{}])}),/BEGIN:VCALENDAR/);
const opts=requests.at(-1).options;
assert.equal(opts.hostname,'public.test');assert.equal(opts.servername,'public.test');assert.equal(opts.rejectUnauthorized,true);assert.equal(opts.agent,false);
assert.equal(opts.autoSelectFamily,true);
const before=dnsCalls;
opts.lookup('public.test',{all:true},(err,answers)=>{assert.ifError(err);assert.equal(answers.length,2);assert.ok(answers.every(x=>isPublicAddress(x.address)));});
opts.lookup('public.test',{},(err,address,family)=>{assert.ifError(err);assert.equal(address,'8.8.8.8');assert.equal(family,4);});
opts.lookup('other.test',{},err=>assert.equal(err.code,'blocked_private_network'));
assert.equal(dnsCalls,before,'connection lookup uses only the already validated answers');
assert.equal(await fetchPublicIcal('https://public.test/a',100,{lookup,request:transport([
 {status:302,headers:{location:'/b'}},{status:307,headers:{location:'https://other.test/c'}},{body:'OK'}])}),'OK');
for(const location of ['https://169.254.169.254/latest','http://public.test/feed','https://[::1]/'])
 await rejects(fetchPublicIcal('https://public.test',100,{lookup,request:transport([{status:302,headers:{location}}])}),'blocked_private_network');
let rebound=0;
await rejects(fetchPublicIcal('https://public.test',100,{lookup:async()=>++rebound===1?publicDns():[{address:'127.0.0.1'}],
 request:transport([{status:302,headers:{location:'/next'}}])}),'blocked_private_network');
await rejects(fetchPublicIcal('https://public.test',100,{lookup,request:transport(Array.from({length:3},()=>({status:302,headers:{location:'/next'}})))}),'http_error');
for(const step of [{status:500},{status:302}])await rejects(fetchPublicIcal('https://public.test',100,{lookup,request:transport([step])}),'http_error');
await rejects(fetchPublicIcal('https://public.test',100,{lookup,request:transport([{error:true}])}),'unreachable');
for(const step of [{hang:true},{bodyHang:true}])await rejects(fetchPublicIcal('https://public.test',10,{lookup,request:transport([step])}),'timeout');
for(const step of [{body:'0123456789'},{headers:{'content-length':'100'},body:'x'},{headers:{'content-encoding':'unknown'}},
 {headers:{'content-encoding':'gzip'},body:gzipSync('x'.repeat(1000))},{headers:{'content-encoding':'gzip'},body:'invalid'}])
 await rejects(fetchPublicIcal('https://public.test',100,{lookup,request:transport([step]),maxBytes:8}),'parse_error');
for(const [encoding,compress]of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]])
 assert.equal(await fetchPublicIcal('https://public.test',100,{lookup,request:transport([{headers:{'content-encoding':encoding},body:compress('calendar')}])}),'calendar');
assert.equal(feedErrorCode(new Error('PRIVATE server detail')),'parse_error');

// Exercise the real sync pipeline: a blocked sibling feed must suppress the
// whole platform cancellation sweep, even when the first feed parsed normally.
process.env.SUPABASE_SERVICE_ROLE_KEY='fictional-service';
process.env.CRON_SECRET='fictional-cron';
const {default:handler,syncOnePropertyFeeds}=await import('../api/ical-sync.js');
const calls=[];globalThis.fetch=async(url,options={})=>{
 calls.push({url,method:options.method||'GET'});
 return {ok:true,json:async()=>[],text:async()=>''};
};
const feeds=[{platform:'airbnb',url:'https://public.test/feed'},{platform:'airbnb',url:'https://127.0.0.1/private'}];
const result=await syncOnePropertyFeeds('synthetic-property',feeds,'fixture','fixture',{
 fetchFeed:(url,ms)=>fetchPublicIcal(url,ms,{lookup,request:transport([{}])})});
assert.equal(result.errors.length,1);assert.equal(result.errors[0].error,'blocked_private_network');
assert.equal(result.cancelled,0);assert.ok(calls.every(c=>!c.url.includes('/ota_reservations')||c.method==='GET'));
assert.ok(!calls.some(c=>c.url.includes('status=eq.active')),'no sweep after a failed sibling');
for(const cron of [false,true])for(const exception of [false,true]){
 globalThis.fetch=async url=>{
  if(url.includes('/auth/'))return {ok:true,json:async()=>({id:'synthetic-owner'})};
  if(exception)throw Error('PRIVATE database/credential detail');
  return {ok:false,text:async()=>'PRIVATE database/credential detail'};
 };
 const res={status(code){this.code=code;return this},json(body){this.body=body;return this},setHeader(){}};
 await handler({method:'POST',headers:{authorization:'Bearer '+(cron?'fictional-cron':'fixture-owner')},body:{property_id:'fixture'}},res);
 assert.equal(res.code,500);assert.deepEqual(res.body,{error:'database_error'});
}
const source=readFileSync(new URL('../host-console.html',import.meta.url),'utf8');
const helper=source.slice(source.indexOf('function _icalSyncErrorMessage('),source.indexOf('function _icalEscape('));
for(const hostLang of ['it','en']){
 const ctx=vm.createContext({hostLang});vm.runInContext(helper,ctx);
 for(const code of ['blocked_private_network','timeout','http_error','unreachable','parse_error','database_error','ambiguous_feed_ownership'])
  assert.ok(ctx._icalSyncErrorMessage(code).length>10);
 assert.ok(!ctx._icalSyncErrorMessage('<PRIVATE server token>').includes('PRIVATE'));
}
console.log('PASS iCal DNS/redirect pinning, special IPs, limits, timeout, encoding, error folding, platform cancellation and IT/EN messages');
