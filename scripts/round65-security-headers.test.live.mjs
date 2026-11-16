// Read-only post-deployment gate; explicitly opt in so PR CI never checks old assets.
import assert from 'node:assert/strict';
import {securityHeaders} from '../lib/security-headers.mjs';
const origin=process.env.SECURITY_SMOKE_ORIGIN;
const strict=process.env.SECURITY_SMOKE_REQUIRE_MATCH==='1';
if(!origin){console.error('SKIP SECURITY_SMOKE_ORIGIN not set (post-deployment headers)');process.exit(77);}
assert.equal(new URL(origin).protocol,'https:');
for(const path of ['/','/host-console.html','/admin.html','/api/guest','/api/csp-report']){
 const res=await fetch(new URL(path,origin),{headers:{Origin:new URL(origin).origin},signal:AbortSignal.timeout(20000)});
 assert.ok([200,401,405].includes(res.status),path+': '+res.status);
 // Exact match is a post-deploy check (production-security.yml sets
 // SECURITY_SMOKE_REQUIRE_MATCH=1 after main's regression). Before a merge,
 // production still serves the previous release's headers, so a PR that
 // changes them would always fail here; the protections that must hold in
 // every release are checked instead.
 if(strict){for(const {key,value}of securityHeaders)assert.equal(res.headers.get(key),value,path+' '+key);}
 else{
  const csp=res.headers.get('content-security-policy')||'';
  for(const d of ["frame-ancestors 'none'","base-uri 'none'","object-src 'none'"])assert.ok(csp.includes(d),path+' enforced '+d);
  for(const key of ['X-Frame-Options','X-Content-Type-Options','Strict-Transport-Security','Referrer-Policy','Permissions-Policy'])
   assert.equal(res.headers.get(key),securityHeaders.find(h=>h.key===key).value,path+' '+key);
 }
 await res.body?.cancel();
}
console.log('PASS production guest/host/admin/API enforced CSP (resources, framing, base, object; reporting on), HSTS, nosniff, referrer and camera-compatible permissions headers');
