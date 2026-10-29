import { loadEntryReleaseSnapshot } from './_entry-release-loader.js';
import { evaluateEntryRelease } from './_entry-release-policy.js';
import { SUPABASE_URL } from './_environment.js';
import { supabaseAuthHeaders } from './_supabase-auth.js';

// Supabase validates the user's JWT; the RPC enforces current owner/admin
// membership and audits admin access. Raw snapshot/PII never leaves this route.
export async function hostEntryState(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Vary','Authorization, Origin');
  const auth=req.headers.authorization || req.headers.Authorization;
  if(typeof auth!=='string'||!auth.startsWith('Bearer '))return res.status(401).json({error:'Host authentication required'});
  const b=req.body||{},key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return res.status(503).json({error:'Entry status unavailable'});
  if(typeof b.property_id!=='string'||typeof b.booking_code!=='string'||typeof b.is_test!=='boolean')return res.status(400).json({error:'Invalid booking scope'});
  try {
    const r=await fetch(`${SUPABASE_URL}/rest/v1/rpc/entry_access_host_state`,{method:'POST',
      headers:{...supabaseAuthHeaders(key),Authorization:auth,'Content-Type':'application/json'},
      body:JSON.stringify({p_property_id:b.property_id,p_booking_code:b.booking_code,p_is_test:b.is_test})});
    if(!r.ok)return res.status([401,403].includes(r.status)?403:503).json({error:'Entry status unavailable'});
    let data=await r.json();if(Array.isArray(data))data=data[0];
    if(!data||typeof data.enabled!=='boolean')throw Error('Invalid host state');
    const raw=data.snapshot;
    const snapshot=raw?await loadEntryReleaseSnapshot({propertyId:b.property_id,bookingCode:b.booking_code,isTest:b.is_test,
      sessionValidUntil:new Date(Date.now()+60000).toISOString(),
      pgrestGET:async path=>({ok:true,json:async()=>path.startsWith('properties?')?[raw.property_snapshot]:path.startsWith('ota_reservations?')?(raw.reservation_snapshot?[raw.reservation_snapshot]:[]):path.startsWith('checkins?')?raw.current_rows:raw.room_snapshot?[raw.room_snapshot]:[]}),
      callRPC:async()=>({ok:true,json:async()=>raw})}):null;
    const policy=snapshot?evaluateEntryRelease(snapshot):{state:data.enabled?'unavailable':'disabled',reason:data.enabled?'unknown_roster':'policy_off',allow_entry:false,submitted:null,expected:null,release_at:null};
    const summary=data.summary?Object.fromEntries(['booking_id','state_version','identity_version','roster_version','expected_count','released_manually','audit_id','reservation_id','arrival_date','departure_date'].map(k=>[k,data.summary[k]])):null;
    const reservation=data.reservation?Object.fromEntries(['id','guest_count','checkin_date','checkout_date'].map(k=>[k,data.reservation[k]])):null;
    return res.status(200).json({reservation,entry_release:{...policy,release_timezone:snapshot?.property.entry_timezone||null},summary});
  }catch(_){return res.status(503).json({error:'Entry status unavailable'});}
}
