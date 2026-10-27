// Read-only credential compatibility, never user creation or object writes.
import { pathToFileURL } from 'node:url';
import { PRODUCTION_REF } from '../lib/environment.mjs';
import { supabaseAuthHeaders } from '../api/_supabase-auth.js';

export async function verifyServiceAccess(key, request = fetch) {
  if (!key || key.startsWith('sb_publishable_')) throw new Error('A server credential is required');
  const services = [
    ['Auth admin', '/auth/v1/admin/users?page=1&per_page=1'],
    ['Storage', '/storage/v1/bucket'],
  ];
  for (const [name, path] of services) {
    let response;
    try {
      response = await request(`https://${PRODUCTION_REF}.supabase.co${path}`, {
        method: 'GET', headers: supabaseAuthHeaders(key),
        redirect: 'error', signal: AbortSignal.timeout(20000),
      });
    } catch {
      // Never echo transport errors: they may contain request credentials.
      throw new Error(`${name} read-only probe failed at transport`);
    }
    const status = response.status;
    const json = /application\/json/i.test(response.headers.get('content-type') || '');
    // Do not parse, log, retain or return users, bucket names or error bodies.
    await response.body?.cancel();
    if (status !== 200 || !json) throw new Error(`${name} read-only probe failed (HTTP ${status}, JSON ${json})`);
  }
  return key.startsWith('sb_secret_') ? 'modern secret' : 'legacy server key';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.error('SKIP read-only Auth/Storage probes need SUPABASE_SERVICE_ROLE_KEY');
    process.exitCode = 77;
  } else {
    try {
      const kind = await verifyServiceAccess(key);
      console.log(`PASS production Auth admin and Storage read-only authorization (${kind}); response bodies discarded`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
