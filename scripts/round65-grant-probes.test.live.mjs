// Read-only RPC probes. Purge/enqueue ALWAYS use p_dry_run:true; consent ALWAYS
// uses p_consent:false. Never insert consents or queue/delete real documents.
import assert from 'node:assert/strict';
import {PRODUCTION_REF,PRODUCTION_PUBLIC_KEY} from '../lib/environment.mjs';
const base=`https://${PRODUCTION_REF}.supabase.co/rest/v1/rpc/`;
const probes=[
 ['purge_old_id_photos',{p_dry_run:true,p_days:null,p_hours:168,p_null_arrival_days:7}],
 ['enqueue_orphan_documents',{p_dry_run:true,p_days:7}],
 ['list_hosts_for_admin',{}],
 ['save_guest_marketing_consent',{p_property_id:'00000000-0000-4000-8000-000000000000',p_booking_code:'SYNTHETIC-NOT-A-BOOKING',p_email:null,p_phone:null,p_consent:false}],
];
async function call(name,body,key){
 return fetch(base+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
}
for(const [name,body]of probes){
 const response=await call(name,body,PRODUCTION_PUBLIC_KEY);
 assert.ok([401,403].includes(response.status),name+' must reject anon (status only; no response data logged)');
 assert.equal((await response.json()).code,'42501',name+' privilege denial');
}
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!service){console.error('SKIP service-role grant probes need SUPABASE_SERVICE_ROLE_KEY; four anonymous denials passed');process.exit(77);}
for(const [name,body]of probes.slice(0,3)){
 const response=await call(name,body,service);assert.equal(response.status,200,name+' dry/read-only service call');
 // Do not log counts or the admin function's response rows.
}
const invalid=await call(probes[3][0],probes[3][1],service);
assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'22023');
console.log('PASS production grants: anon cannot call cron/admin/consent RPCs; server dry/read-only calls remain available; invalid consent rejected before any write.');
