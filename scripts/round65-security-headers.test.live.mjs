// Read-only post-deployment gate; explicitly opt in so PR CI never checks old assets.
import assert from 'node:assert/strict';
import {securityHeaders} from '../lib/security-headers.mjs';
const origin=process.env.SECURITY_SMOKE_ORIGIN;
if(!origin){console.error('SKIP SECURITY_SMOKE_ORIGIN not set (post-deployment headers)');process.exit(77);}
assert.equal(new URL(origin).protocol,'https:');
for(const path of ['/','/host-console.html','/admin.html','/api/guest','/api/csp-report']){
 const res=await fetch(new URL(path,origin),{signal:AbortSignal.timeout(20000)});
 assert.ok([200,401,405].includes(res.status),path+': '+res.status);
 for(const {key,value}of securityHeaders)assert.equal(res.headers.get(key),value,path+' '+key);
 await res.body?.cancel();
}
console.log('PASS production guest/host/admin/API report-only CSP, immediate framing/base/object protection, HSTS, nosniff, referrer and camera-compatible permissions headers');
