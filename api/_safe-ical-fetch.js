// Round 65 Phase 4. Validate DNS AND pin the verified address for the actual
// TLS connection. A preflight followed by ordinary fetch would permit DNS
// rebinding. New connections/redirects are checked independently; no pooling.
import {lookup as dnsLookup} from 'node:dns/promises';
import {request as httpsRequest} from 'node:https';
import {BlockList,isIP} from 'node:net';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';

const denied=new BlockList();
for(const [ip,bits]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
 ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
 ['192.88.99.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied.addSubnet(ip,bits,'ipv4');
denied.addAddress('168.63.129.16','ipv4'); // Azure platform virtual address
for(const [ip,bits]of [['::',96],['64:ff9b::',96],['64:ff9b:1::',48],['100::',64],['2001::',32],
 ['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],
 ['fc00::',7],['fe80::',10],['fec0::',10],['ff00::',8]])denied.addSubnet(ip,bits,'ipv6');
const PUBLIC_ERRORS=new Set(['blocked_private_network','timeout','http_error','parse_error','unreachable']);
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
export class FeedNetworkError extends Error {
 constructor(code){super(PUBLIC_ERRORS.has(code)?code:'unreachable');this.name='FeedNetworkError';this.code=this.message;}
}
export function isPublicAddress(address){
 if(typeof address!=='string'||address.includes('%'))return false;
 const family=isIP(address);
 return family!==0&&(family!==6||globalV6.check(address,'ipv6'))&&!denied.check(address,family===4?'ipv4':'ipv6');
}
export function feedErrorCode(error){return error instanceof FeedNetworkError?error.code:'parse_error';}
function fail(code){throw new FeedNetworkError(code);}
function abortable(promise,signal){
 if(signal.aborted)return Promise.reject(new FeedNetworkError('timeout'));
 return new Promise((resolve,reject)=>{
  const aborted=()=>reject(new FeedNetworkError('timeout'));
  signal.addEventListener('abort',aborted,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',aborted));
 });
}
export async function resolvePublicFeed(input,{lookup=dnsLookup,signal=new AbortController().signal}={}){
 let url;try{url=new URL(input);}catch{fail('blocked_private_network');}
 if(url.protocol!=='https:'||url.username||url.password||String(input).length>8192)fail('blocked_private_network');
 const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'').toLowerCase();
 if(!host||host==='localhost'||host.endsWith('.localhost'))fail('blocked_private_network');
 let addresses;
 if(isIP(host))addresses=[{address:host,family:isIP(host)}];
 else{
  try{addresses=await abortable(lookup(host,{all:true,verbatim:true}),signal);}
  catch(e){if(e instanceof FeedNetworkError)throw e;fail('unreachable');}
 }
 if(!Array.isArray(addresses)||!addresses.length)fail('unreachable');
 if(addresses.some(a=>!a||!isPublicAddress(a.address)))fail('blocked_private_network');
 const address=addresses[0].address;
 return {url,host,address,family:isIP(address),addresses:addresses.map(a=>({address:a.address,family:isIP(a.address)}))};
}

function oneRequest(target,{request,signal,maxBytes}){
 return new Promise((resolve,reject)=>{
  let settled=false,req;
  const abort=()=>{done(new FeedNetworkError('timeout'));req?.destroy();};
  const done=(error,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  if(signal.aborted){reject(new FeedNetworkError('timeout'));return;}
  signal.addEventListener('abort',abort,{once:true});
  const errorCode=error=>error instanceof FeedNetworkError?error:new FeedNetworkError(signal.aborted?'timeout':'unreachable');
  const pinnedLookup=(hostname,options,callback)=>{
   if(typeof options==='function'){callback=options;options={};}
   if(hostname.replace(/\.$/,'').toLowerCase()!==target.host)return callback(new FeedNetworkError('blocked_private_network'));
   if(options?.all)callback(null,target.addresses);
   else callback(null,target.address,target.family);
  };
  try{
   req=request(target.url,{method:'GET',hostname:target.host,
    family:isIP(target.host)?target.family:undefined,autoSelectFamily:true,autoSelectFamilyAttemptTimeout:250,
    lookup:pinnedLookup,agent:false,rejectUnauthorized:true,
    servername:isIP(target.host)?undefined:target.host,signal,
    headers:{'User-Agent':'WelcomeBnB-iCal-Sync/1 (+https://welcomebnb.app)','Accept-Encoding':'gzip, deflate, br'}},response=>{
     response.on('error',error=>done(errorCode(error)));
     const status=response.statusCode||0;
     if([301,302,303,307,308].includes(status)){
      const location=response.headers.location;response.destroy();
      if(!location)return done(new FeedNetworkError('http_error'));
      return done(null,{location});
     }
     if(status<200||status>=300){response.destroy();return done(new FeedNetworkError('http_error'));}
     if(Number(response.headers['content-length'])>maxBytes){response.destroy();return done(new FeedNetworkError('parse_error'));}
     const encoding=String(response.headers['content-encoding']||'identity').trim().toLowerCase();
     const decompress={gzip:createGunzip,deflate:createInflate,br:createBrotliDecompress}[encoding];
     if(!decompress&&encoding!=='identity'){response.destroy();return done(new FeedNetworkError('parse_error'));}
     const stream=decompress?decompress():response;
     let wireBytes=0,decodedBytes=0;const chunks=[];
     response.on('aborted',()=>done(new FeedNetworkError('unreachable')));
     response.on('data',chunk=>{wireBytes+=chunk.length;if(wireBytes>maxBytes){done(new FeedNetworkError('parse_error'));req.destroy();}});
     stream.on('error',()=>{req.destroy();done(new FeedNetworkError('parse_error'));});
     stream.on('data',chunk=>{
      if(settled)return;
      decodedBytes+=chunk.length;
      if(decodedBytes>maxBytes){done(new FeedNetworkError('parse_error'));req.destroy();if(stream!==response)stream.destroy();return;}
      chunks.push(Buffer.from(chunk));
     });
     stream.on('end',()=>done(null,{text:Buffer.concat(chunks).toString('utf8')}));
     if(stream!==response)response.pipe(stream);
    });
   req.on('error',error=>done(errorCode(error)));req.end();
  }catch(error){done(errorCode(error));}
 });
}

export async function fetchPublicIcal(input,ms=10000,{lookup=dnsLookup,request=httpsRequest,maxBytes=5*1024*1024}={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),ms);
 try{
  let url=input;
  for(let redirects=0;redirects<=2;redirects++){
   const target=await resolvePublicFeed(url,{lookup,signal:controller.signal});
   const result=await oneRequest(target,{request,signal:controller.signal,maxBytes});
   if(result.text!==undefined)return result.text;
   if(redirects===2)fail('http_error');
   try{url=new URL(result.location,target.url).href;}catch{fail('http_error');}
  }
 }finally{clearTimeout(timer);}
}
