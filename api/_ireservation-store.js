import { supabaseAuthHeaders } from './_supabase-auth.js';
// Service-only gateway to a private schema. It never logs database error bodies.
import { IresError } from './_ireservation-core.js';
export function createStore({ url, serviceKey, transport = fetch, rpc = 'ireservation_state' }) {
  if (!['ireservation_state','ireservation_compare_state'].includes(rpc) || !url || !serviceKey) throw new IresError('storage_unavailable');
  return { async call(operation, payload) {
    let response;
    try { response = await transport(`${url}/rest/v1/rpc/${rpc}`, {
      method: 'POST', headers: { ...supabaseAuthHeaders(serviceKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_operation: operation, p_payload: payload }), signal: AbortSignal.timeout(12000), redirect: 'error' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (data?.error === 'conflict') throw new IresError('connection_changed', 409);
      if (data?.error === 'forbidden') throw new IresError('property_forbidden', 403);
      if (data?.error || !data || typeof data !== 'object') throw new Error();
      return data;
    } catch (error) { if (error instanceof IresError) throw error; throw new IresError('storage_unavailable'); }
  } };
}
