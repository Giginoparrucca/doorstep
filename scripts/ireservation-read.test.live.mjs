// Explicit opt-in, test-property-only read probe. Never prints payloads/secrets.
import { randomUUID } from 'node:crypto';
import { createReadClient, connectionContext, seal, safeError } from '../api/_ireservation-core.js';
import { createStore } from '../api/_ireservation-store.js';
if (process.env.IRESERVATION_LIVE_PROBE !== 'true') {
  console.error('SKIP iReservation test-property read probe requires explicit IRESERVATION_LIVE_PROBE=true and secure provisioning');process.exit(77);
}
const required=['IRESERVATION_PARTNER_USERNAME','IRESERVATION_PARTNER_PASSWORD','IRESERVATION_API_KEY','IRESERVATION_ENC_KEY','SUPABASE_SERVICE_ROLE_KEY','IRESERVATION_TEST_PROPERTY_PASSWORD'];
if (required.some(k=>!process.env[k])) {console.error('SKIP iReservation secure test configuration incomplete');process.exit(77);}
try {
 if(process.env.IRESERVATION_TEST_CALENDAR_ID!=='330'||process.env.IRESERVATION_TEST_PROPERTY_USERNAME!=='testtesttest')throw Error();
 const store=createStore({url:'https://jcjwaqqabgwqhhzhfbts.supabase.co',serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY});
 const client=createReadClient({store});
 const row={property_id:'00000000-0000-4000-8000-000000000330',owner_id:'00000000-0000-4000-8000-000000000330',calendar_id:330,version:randomUUID()};
 row.secret=seal({propertyUsername:process.env.IRESERVATION_TEST_PROPERTY_USERNAME,propertyPassword:process.env.IRESERVATION_TEST_PROPERTY_PASSWORD},connectionContext(row,client.config));
 const rooms=await client.rooms(row),distributors=await client.distributors();
 console.log(`PASS iReservation authorized test-property reads: ${rooms.length} rooms, ${distributors.length} distributors; no reservations saved or calendar writes`);
} catch(error) {console.error('FAIL iReservation test-property read probe: '+safeError(error).code);process.exit(1);}
