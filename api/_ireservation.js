// Action-routed through ical-sync to preserve the existing 12-function budget.
import { randomUUID } from 'node:crypto';
import { applyCors } from './_cors.js';
import { rejectInvalidEnvironment, rejectDemoIntegration, SUPABASE_URL, SUPABASE_ANON_KEY } from './_environment.js';
import { configuration, seal, connectionContext, createReadClient, IresError, safeError } from './_ireservation-core.js';
import { createStore } from './_ireservation-store.js';
import { comparisonAction } from './_ireservation-comparison-actions.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (code, status = 400) => { throw new IresError(code, status); };
function status(row) {
  return { configured: !!row?.secret, calendar_id: row?.calendar_id ?? null, version: row?.version ?? 'none',
    mode: row?.verified_at ? 'compare' : 'disabled', verified_at: row?.verified_at ?? null, last_error: row?.last_error ?? null };
}
export function createConnectionHandler({ env = process.env, transport = fetch, store: suppliedStore, comparisonStore } = {}) {
  return async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (rejectInvalidEnvironment(res) || rejectDemoIntegration(res, 'ireservation')) return;
    const origin = req.headers?.origin || req.headers?.Origin;
    if (!applyCors(req, res) && origin) return res.status(403).json({ code: 'origin_forbidden' });
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ code: 'post_required' });
    try {
      const config = configuration(env);
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 16384) bad('request_invalid');
      const action = req.query?.action;
      if (!['status','save','verify','disconnect','catalog','save_mapping','compare'].includes(action)) bad('action_invalid');
      const propertyId = body.property_id;
      if (typeof propertyId !== 'string' || !UUID.test(propertyId)) bad('property_invalid');
      const header = req.headers?.authorization || req.headers?.Authorization;
      if (typeof header !== 'string' || !/^Bearer \S+$/.test(header)) bad('authentication_required', 401);
      const userResponse = await transport(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: header }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!userResponse.ok) bad('authentication_required', 401);
      const user = await userResponse.json();
      if (typeof user?.id !== 'string' || !UUID.test(user.id) || user.is_anonymous === true) bad('authentication_required', 401);
      const store = suppliedStore || createStore({ url: SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, transport });
      // RPC checks current property ownership again on every read/write/stamp.
      const identity = { property_id: propertyId, owner_id: user.id };
      const row = await store.call('connection_get', identity);
      if (action === 'status') return res.status(200).json(status(row));
      if (body.version !== (row.version || 'none')) bad('connection_changed', 409);
      if (['catalog','save_mapping','compare'].includes(action)) return res.status(200).json(await comparisonAction({action,body,row,identity,store,env,transport,comparisonStore}));
      if (action === 'disconnect') {
        const saved = await store.call('connection_disconnect', { ...identity, expected: body.version, version: randomUUID() });
        return res.status(200).json(status(saved));
      }
      if (action === 'save') {
        if (!Number.isInteger(body.calendar_id) || body.calendar_id <= 0) bad('calendar_invalid');
        if (typeof body.propertyUsername !== 'string' || !body.propertyUsername.trim() || body.propertyUsername.length > 1024) bad('credentials_invalid');
        let password = body.propertyPassword;
        if (password === '' && row.secret && row.calendar_id === body.calendar_id) {
          const { unseal } = await import('./_ireservation-core.js');
          password = unseal(row.secret, connectionContext(row, config), env).propertyPassword;
        }
        if (typeof password !== 'string' || !password || password.length > 4096) bad('credentials_invalid');
        const next = { ...identity, calendar_id: body.calendar_id, version: randomUUID() };
        const secret = seal({ propertyUsername: body.propertyUsername.trim(), propertyPassword: password }, connectionContext(next, config), env);
        const saved = await store.call('connection_save', { ...next, secret, expected: body.version });
        return res.status(200).json(status(saved));
      }
      if (!row.secret) bad('credentials_missing');
      let errorCode = null, count = 0;
      try { count = (await createReadClient({ store, env, transport }).rooms(row)).length; }
      catch (error) { errorCode = safeError(error).code; }
      // Rotation/disconnect during verification cannot stamp the replacement row.
      const saved = await store.call('connection_verify', { ...identity, expected: row.version, error: errorCode });
      return res.status(200).json({ ...status(saved), verified: !errorCode, room_count: errorCode ? null : count });
    } catch (error) {
      const safe = safeError(error); return res.status(safe.status).json({ code: safe.code });
    }
  };
}
export const handleConnection = createConnectionHandler();
