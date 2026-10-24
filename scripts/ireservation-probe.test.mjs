import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { runReadProbe } from './ireservation-read-probe.mjs';
import { configuration, unseal, connectionContext } from '../api/_ireservation-core.js';
const env={IRESERVATION_LIVE_PROBE:'true',VERCEL_ENV:'production',IRESERVATION_ENABLED:'false',
  IRESERVATION_PARTNER_USERNAME:'fixture-partner',IRESERVATION_PARTNER_PASSWORD:'fixture-partner-secret',IRESERVATION_API_KEY:'fixture-api-key',
  IRESERVATION_ENC_KEY:randomBytes(32).toString('base64'),SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',
  IRESERVATION_TEST_CALENDAR_ID:'330',IRESERVATION_TEST_PROPERTY_USERNAME:'testtesttest',IRESERVATION_TEST_PROPERTY_PASSWORD:'fixture-property-secret'};
let calls=0;const cfg=configuration({...env,IRESERVATION_ENABLED:'true'});
const dependencies={storeFactory:()=>({}),clientFactory:()=>({config:cfg,async rooms(row){calls++;
 assert.equal(row.calendar_id,330);assert.equal(unseal(row.secret,connectionContext(row,cfg),env).propertyPassword,env.IRESERVATION_TEST_PROPERTY_PASSWORD);
 return [{id:1}];},async distributors(){calls++;return [{idDistributor:0},{idDistributor:17}];}})};
for(const patch of [{IRESERVATION_LIVE_PROBE:'false'},{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'another-project'},
 {IRESERVATION_TEST_CALENDAR_ID:'331'},{IRESERVATION_TEST_PROPERTY_USERNAME:'another-user'}, {IRESERVATION_TEST_PROPERTY_PASSWORD:''},{SUPABASE_SERVICE_ROLE_KEY:''}]) {
 await assert.rejects(runReadProbe({...env,...patch},dependencies));assert.equal(calls,0,'invalid probe scope performs no transport');
}
assert.deepEqual(await runReadProbe(env,dependencies),{passed:true,calendarId:330,rooms:1,distributors:2});
assert.equal(calls,2);assert.equal(env.IRESERVATION_ENABLED,'false','explicit probe never enables deployed runtime');
console.log('PASS probe production/project/test-calendar restrictions, encrypted transient credentials, safe count result and unchanged runtime gate');
