// Explicit, production-server-only probe against the provider's approved test
// calendar. No guest/reservation records are read or written; output is counts.
import { randomUUID } from 'node:crypto';
import { createReadClient, connectionContext, seal, IresError } from '../api/_ireservation-core.js';
import { createStore } from '../api/_ireservation-store.js';
export async function runReadProbe(env = process.env, dependencies = {}) {
  if (env.IRESERVATION_LIVE_PROBE !== 'true' || env.VERCEL_ENV !== 'production' ||
      (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== 'prj_YKcEpRmd5OmVSkLGzBrTDs4gP751') ||
      env.IRESERVATION_TEST_CALENDAR_ID !== '330' || env.IRESERVATION_TEST_PROPERTY_USERNAME !== 'testtesttest') {
    throw new IresError('probe_scope_invalid');
  }
  if (!env.IRESERVATION_TEST_PROPERTY_PASSWORD || !env.SUPABASE_SERVICE_ROLE_KEY) throw new IresError('probe_configuration_missing');
  // Scope override is local to this explicit probe; deployed runtime gate stays off.
  const probeEnv = { ...env, IRESERVATION_ENABLED: 'true' };
  const store = (dependencies.storeFactory || createStore)({ url: 'https://jcjwaqqabgwqhhzhfbts.supabase.co', serviceKey: env.SUPABASE_SERVICE_ROLE_KEY });
  const client = (dependencies.clientFactory || createReadClient)({ store, env: probeEnv });
  const row = { property_id: '00000000-0000-4000-8000-000000000330', owner_id: '00000000-0000-4000-8000-000000000330',
    calendar_id: 330, version: randomUUID() };
  row.secret = seal({ propertyUsername: env.IRESERVATION_TEST_PROPERTY_USERNAME, propertyPassword: env.IRESERVATION_TEST_PROPERTY_PASSWORD }, connectionContext(row, client.config), probeEnv);
  const rooms = await client.rooms(row), distributors = await client.distributors();
  return { passed: true, calendarId: 330, rooms: rooms.length, distributors: distributors.length };
}
