// Opt-in live Phase 4 gate. Runs inside the isolated demo build so secrets
// never need to leave Vercel. Uses actual Auth JWTs, hosted handlers and Storage.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readEnvironment } from '../lib/environment.mjs';
const require = createRequire(import.meta.url);
const { computeReadiness } = require('../lib/onboarding-readiness.js');

export async function runHostGate(env = process.env) {
  const cfg = readEnvironment(env);
  assert.equal(cfg.mode, 'demo');
  assert.equal(cfg.projectRef, 'wmegnnlmcrabndyzywmj');
  assert.equal(env.VERCEL_PROJECT_ID, 'prj_MafDkEOAUye8uC9M8Mtb993vFagy');
  const target = new URL(env.ROUND51_HOST_GATE_ORIGIN);
  assert.equal(target.protocol, 'https:');
  assert.equal(target.origin, env.ROUND51_HOST_GATE_ORIGIN);
  assert.ok(target.hostname.startsWith('welcomebnb-demo-') && target.hostname.endsWith('-giginoparruccas-projects.vercel.app'), 'Owned isolated preview only');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const checks = [];
  const pass = label => { checks.push(label); console.log('PASS Phase4 ' + label); };
  async function request(url, { method = 'GET', body, token = key, publicClient = false, headers = {} } = {}) {
    const r = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: publicClient ? cfg.publicKey : key, Authorization: `Bearer ${token}`, ...headers,
        ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}) });
    const text = await r.text(); let data; try {data=JSON.parse(text);} catch {data=text;}
    return {ok:r.ok,status:r.status,data};
  }
  const db = (path, opts) => request(cfg.supabaseUrl + path, opts);
  const hosted = (path, body, token) => request(target.origin + path, {method:'POST',body,token:token || cfg.publicKey,publicClient:true,headers:{Origin:target.origin}});
  const expect = (r,label) => assert.ok(r.ok, label + ': HTTP ' + r.status);
  const owners = [];
  const propertyId = randomUUID();
  const photoPath = 'id-photos/round51-gate-' + propertyId + '.png';
  let booking, normalId, photoUploaded=false, propertyCreated=false;
  const sessionId='round51-gate-'+propertyId;
  try {
    for (const email of ['presenter.daniele@example.com','presenter.probe@example.com']) {
      const password = createHmac('sha256',env.GUEST_TOKEN_SECRET).update('round50-presenter-v1:'+email).digest('base64url')+'aA1!';
      const login = await db('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password},token:cfg.publicKey,publicClient:true});
      expect(login,'Real host password login'); owners.push({id:login.data.user.id,token:login.data.access_token});
    }
    const [owner,other] = owners;
    pass('actual authenticated host logins');
    const property={id:propertyId,owner_id:owner.id,name:'FACSIMILE Round 51 disposable gate',is_test:true,city:'Ostuni',region:'Puglia',cir_code:'ITFACSIMILE000051',wifi_name:'FACSIMILE WiFi',wifi_password:'FAKE',welcome_message_it:'FACSIMILE accoglienza',checkin_instructions_it:'FACSIMILE arrivo',alloggiati_autofile_mode:'off'};
    expect(await db('/rest/v1/properties',{method:'POST',body:property,token:owner.token,publicClient:true}),'Host creates own disposable property'); propertyCreated=true;
    const state={user_id:owner.id,property_id:propertyId,first_seen_at:new Date().toISOString()};
    expect(await db('/rest/v1/host_onboarding?on_conflict=user_id,property_id',{method:'POST',body:state,token:owner.token,publicClient:true,headers:{Prefer:'resolution=ignore-duplicates'}}),'Initial checklist view');
    const create=await hosted('/api/guest-token',{action:'test_booking',property_id:propertyId},owner.token);expect(create,'Host creates test booking');booking=create.data.booking;
    assert.equal(booking.is_test,true);assert.equal(booking.platform,'direct');assert.equal(booking.raw.onboarding_test,true);assert.match(booking.booking_code,/^WB-TEST/);
    const again=await hosted('/api/guest-token',{action:'test_booking',property_id:propertyId},owner.token);expect(again,'Repeat host click');assert.equal(again.data.booking.id,booking.id);
    const cross=await hosted('/api/guest-token',{action:'test_booking',property_id:propertyId},other.token);assert.equal(cross.status,403);
    pass('host-owned direct test mint, reuse and cross-owner denial');
    const mint=await hosted('/api/guest-token',{property_id:propertyId,booking_code:booking.booking_code,session_id:sessionId,is_test:false});expect(mint,'Guest mint');assert.equal(mint.data.is_test,true);
    const token=mint.data.token;
    pass('booking row forces test mode despite false client flag');
    const pre=await hosted('/api/guest',{action:'property'},token);expect(pre,'Guest property before check-in');assert.ok(!pre.data.property.wifi_password);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
    const upload=await fetch(cfg.supabaseUrl+'/storage/v1/object/documents/'+photoPath,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{apikey:cfg.publicKey,Authorization:'Bearer '+cfg.publicKey,'Content-Type':'image/png'},body:png});assert.ok(upload.ok,'Real fictional photo upload: '+upload.status);photoUploaded=true;
    const inserted=await hosted('/api/guest',{action:'checkin_insert',record:{guest_type:'single',surname:'FACSIMILE',name:'TEST',sex:'F',date_of_birth:'1980-01-01',place_of_birth:'Paris',birth_province:'EE',birth_country:'France',citizenship:'France',document_type:'passport',document_number:'FACSIMILE-ONLY',doc_issue_place:'France',arrival_date:booking.checkin_date,departure_date:booking.checkout_date,nights:1,docs_status:'completed',id_photo_path:photoPath}},token);expect(inserted,'Guest completes check-in');
    const testId=inserted.data.id;
    const rows=await db('/rest/v1/checkins?id=eq.'+testId+'&select=id,is_test,booking_code');expect(rows,'Stored test identity');assert.equal(rows.data[0].is_test,true);
    const list=await hosted('/api/guest',{action:'checkin_list'},token);expect(list,'Guest welcome-back');assert.equal(list.data.guests.length,1);assert.equal(list.data.guests[0].id,testId);
    const post=await hosted('/api/guest',{action:'property'},token);expect(post,'Guest access after completion');assert.equal(post.data.property.wifi_password,'FAKE');
    const obPath='/rest/v1/host_onboarding?user_id=eq.'+owner.id+'&property_id=eq.'+propertyId+'&select=*';
    let ob=await db(obPath,{token:owner.token,publicClient:true});expect(ob,'Owner reads checklist');assert.ok(ob.data[0].test_checkin_done_at);
    const readiness=computeReadiness({property,hasTestCheckin:!!ob.data[0].test_checkin_done_at,onboardingState:ob.data[0]});assert.equal(readiness.steps.find(s=>s.id==='test').done,true);
    expect(await db('/rest/v1/host_onboarding?on_conflict=user_id,property_id',{method:'POST',body:{...state,first_seen_at:new Date().toISOString()},token:owner.token,publicClient:true,headers:{Prefer:'resolution=ignore-duplicates'}}),'Checklist refresh');
    ob=await db(obPath,{token:owner.token,publicClient:true});assert.equal(Date.parse(ob.data[0].first_seen_at),Date.parse(state.first_seen_at));
    pass('guest completion, gated access, welcome-back and durable checklist step');
    const normal=await db('/rest/v1/checkins',{method:'POST',body:{property_id:propertyId,booking_code:'ROUND51-NORMAL',is_test:false,surname:'FACSIMILE',name:'NORMAL',date_of_birth:'1980-01-01',place_of_birth:'Paris',citizenship:'France',document_number:'FACSIMILE',guest_type:'single',arrival_date:booking.checkin_date,departure_date:booking.checkout_date},headers:{Prefer:'return=representation'}});expect(normal,'Normal control row');normalId=normal.data[0].id;
    const claimed=await db('/rest/v1/rpc/claim_autofile_rows',{method:'POST',body:{p_property:propertyId,p_ids:[testId,normalId]}});expect(claimed,'Actual claim RPC');assert.deepEqual(claimed.data,[normalId]);
    const audit=await db('/rest/v1/alloggiati_filing_log?checkin_ids=cs.'+encodeURIComponent('{'+testId+'}')+'&select=id');expect(audit,'Test filing audit');assert.equal(audit.data.length,0);
    const notifications=await db('/rest/v1/notification_log?property_id=eq.'+propertyId+'&select=id');expect(notifications,'Test notification audit');assert.equal(notifications.data.length,0);
    const queue=await db('/rest/v1/storage_purge_queue?path=eq.'+encodeURIComponent(photoPath)+'&select=queued_at');expect(queue,'Immediate photo queue');assert.equal(queue.data.length,1);assert.ok(Date.parse(queue.data[0].queued_at)<=Date.now());
    const ownPhoto=await db('/storage/v1/object/authenticated/documents/'+photoPath,{token:owner.token,publicClient:true});expect(ownPhoto,'Owner reads existing photo');
    const foreignPhoto=await db('/storage/v1/object/authenticated/documents/'+photoPath,{token:other.token,publicClient:true});assert.ok(!foreignPhoto.ok);
    const badDelete=await hosted('/api/guest-token',{action:'test_booking_delete',property_id:propertyId,booking_code:booking.booking_code},other.token);assert.equal(badDelete.status,404);
    pass('real-only claim, zero test filings/notifications and private photo isolation');
    const deleted=await hosted('/api/guest-token',{action:'test_booking_delete',property_id:propertyId,booking_code:booking.booking_code},owner.token);expect(deleted,'Actual host deletes test');assert.equal(deleted.data.ok,true);assert.equal(deleted.data.storage.deleted,1);assert.equal(deleted.data.storage.failed,0);
    const gone=await db('/storage/v1/object/authenticated/documents/'+photoPath);assert.ok(!gone.ok,'Actual photo must no longer exist');photoUploaded=false;
    const goneQueue=await db('/rest/v1/storage_purge_queue?path=eq.'+encodeURIComponent(photoPath)+'&select=id');expect(goneQueue,'Queue cleared');assert.equal(goneQueue.data.length,0);
    const goneTest=await db('/rest/v1/checkins?id=eq.'+testId+'&select=id');assert.equal(goneTest.data.length,0);
    const goneBooking=await db('/rest/v1/ota_reservations?id=eq.'+booking.id+'&select=id');assert.equal(goneBooking.data.length,0);
    const survives=await db('/rest/v1/checkins?id=eq.'+normalId+'&select=id');assert.equal(survives.data.length,1);
    ob=await db(obPath,{token:owner.token,publicClient:true});assert.ok(ob.data[0].test_checkin_done_at);
    const expired=await hosted('/api/guest-token',{property_id:propertyId,booking_code:booking.booking_code,session_id:sessionId+'-expired',is_test:false});assert.equal(expired.status,410);
    pass('actual application photo deletion, cleared queue/rows, normal survival and durable completion');
    pass('deleted test link cannot become a real booking');
    return {passed:true,checks,origin:target.origin};
  } finally {
    if (photoUploaded) expect(await db('/storage/v1/object/documents',{method:'DELETE',body:{prefixes:[photoPath]}}),'Fictional photo cleanup');
    expect(await db('/rest/v1/storage_purge_queue?path=eq.'+encodeURIComponent(photoPath),{method:'DELETE'}),'Fictional queue cleanup');
    if (propertyCreated) {
      for (const table of ['analytics_events','chat_messages','api_usage','checkins','ota_reservations','host_onboarding']) expect(await db('/rest/v1/'+table+'?property_id=eq.'+propertyId,{method:'DELETE'}),'Fictional '+table+' cleanup');
      expect(await db('/rest/v1/properties?id=eq.'+propertyId,{method:'DELETE'}),'Disposable property cleanup');
    }
    for (const owner of owners) await db('/auth/v1/logout?scope=local',{method:'POST',body:{},token:owner.token,publicClient:true});
    console.log('PASS Phase4 disposable probes cleaned; presenter accounts retained');
  }
}
