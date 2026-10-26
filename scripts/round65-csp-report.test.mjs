import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import handler,{summarizeReport} from '../api/csp-report.js';
const report={'csp-report':{'document-uri':'https://app.welcomebnb.it/host-console.html?token=PRIVATE',
 'effective-directive':'script-src-elem','blocked-uri':'https://private.example.invalid/path?key=PRIVATE','script-sample':'PRIVATE guest detail'}};
assert.deepEqual(summarizeReport(report),{page:'host',directive:'script-src-elem',resource:'external'});
assert.equal(summarizeReport({'csp-report':{...report['csp-report'],'document-uri':'https://foreign.invalid/'}}),null);
assert.equal(summarizeReport({'csp-report':{...report['csp-report'],'effective-directive':'PRIVATE'}}),null);
const logs=[],info=console.info;console.info=(...args)=>logs.push(args);
async function call({method='POST',headers={},body=report,stream}={}){
 const req=stream?Readable.from(stream):{};Object.assign(req,{method,headers:{'content-type':'application/csp-report',...headers}});if(!stream)req.body=body;
 const res={headers:{},status(code){this.code=code;return this},setHeader(k,v){this.headers[k]=v},end(){return this}};
 await handler(req,res);assert.equal(res.headers['Cache-Control'],'no-store');return res.code;
}
try{
 assert.equal(await call(),204);assert.equal(await call({body:JSON.stringify(report)}),204);
 assert.equal(await call({stream:[JSON.stringify(report)]}),204);
 for(const [opts,status]of [[{method:'GET'},405],[{headers:{'sec-fetch-site':'cross-site'}},403],
  [{headers:{origin:'https://foreign.invalid'}},403],[{headers:{'content-type':'text/plain'}},415],
  [{headers:{'content-length':'99999'}},413],[{body:'x'.repeat(4097)},413],[{stream:['x'.repeat(4097)]},413],
  [{body:'invalid json'},400],[{body:{}},400]])assert.equal(await call(opts),status);
 for(let i=0;i<70;i++)assert.equal(await call(),204);
 assert.equal(logs.length,60,'per-instance diagnostic volume capped');
 assert.ok(!JSON.stringify(logs).includes('PRIVATE'));assert.ok(!JSON.stringify(logs).includes('example.invalid'));
}finally{console.info=info;}
console.log('PASS CSP bounded body/origin/method handling, sanitized fixed-enum diagnostics and log-volume cap; no guest URLs/tokens/sample text retained');
