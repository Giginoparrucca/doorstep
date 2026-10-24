// Opt-in provider read; never prints payloads, credentials or tokens.
import { safeError } from '../api/_ireservation-core.js';
import { runReadProbe } from './ireservation-read-probe.mjs';
if (process.env.IRESERVATION_LIVE_PROBE !== 'true') {
  console.error('SKIP iReservation test-property read probe requires explicit IRESERVATION_LIVE_PROBE=true and secure provisioning'); process.exit(77);
}
const required=['IRESERVATION_PARTNER_USERNAME','IRESERVATION_PARTNER_PASSWORD','IRESERVATION_API_KEY','IRESERVATION_ENC_KEY','SUPABASE_SERVICE_ROLE_KEY','IRESERVATION_TEST_PROPERTY_PASSWORD'];
if (required.some(k=>!process.env[k])) { console.error('SKIP iReservation secure test configuration incomplete'); process.exit(77); }
try {
  const result=await runReadProbe(process.env);
  console.log(`PASS iReservation authorized test-property reads: ${result.rooms} rooms, ${result.distributors} distributors, ${result.reservations} test reservations; no reservations saved or calendar writes`);
} catch(error) { console.error('FAIL iReservation test-property read probe: '+safeError(error).code); process.exit(1); }
