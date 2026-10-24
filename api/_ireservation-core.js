// Round 63 Phase 1: server-only read client. No provider write method exists here.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readEnvironment } from '../lib/environment.mjs';

const BASE = 'https://api.ireservation.it';
export class IresError extends Error {
  constructor(code, status = 503) { super(code); this.name = 'IresError'; this.code = code; this.status = status; }
}
export function safeError(error) {
  return error instanceof IresError ? { code: error.code, status: error.status } : { code: 'integration_unavailable', status: 503 };
}
function fail(code, status) { throw new IresError(code, status); }
function integer(value, fallback, max) {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) fail('configuration_invalid');
  return n;
}
function key(env, id) {
  if (!/^v[1-9][0-9]*$/.test(id)) fail('encryption_unavailable');
  const raw = env[id === 'v1' ? 'IRESERVATION_ENC_KEY' : `IRESERVATION_ENC_KEY_${id.toUpperCase()}`];
  if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) fail('encryption_unavailable');
  const bytes = Buffer.from(raw, 'base64');
  if (bytes.length !== 32) fail('encryption_unavailable');
  return bytes;
}
export function configuration(env = process.env) {
  let app;
  try { app = readEnvironment(env); } catch { fail('configuration_invalid'); }
  if (app.demo) fail('demo_integration_disabled', 403);
  // Preview is not an approved partner environment; never inherit production auth.
  if (env.VERCEL_ENV && env.VERCEL_ENV !== 'production') fail('environment_not_enabled');
  if (env.IRESERVATION_ENABLED !== 'true') fail('integration_disabled');
  if ((env.IRESERVATION_BASE_URL || BASE) !== BASE) fail('configuration_invalid');
  const username = env.IRESERVATION_PARTNER_USERNAME, password = env.IRESERVATION_PARTNER_PASSWORD, apiKey = env.IRESERVATION_API_KEY;
  if (![username, password, apiKey].every(v => typeof v === 'string' && v.length > 0 && v.length <= 4096)) fail('configuration_missing');
  if (/[\r\n]/.test(apiKey)) fail('configuration_invalid');
  const keyId = env.IRESERVATION_ENC_KEY_ID || 'v1'; key(env, keyId);
  return { base: BASE, environment: app.mode, username, password, apiKey, keyId,
    scope: createHash('sha256').update(JSON.stringify([app.mode, username])).digest('hex'),
    authScope: createHash('sha256').update(JSON.stringify([app.mode, username, password, apiKey])).digest('hex'),
    daily: integer(env.IRESERVATION_DAILY_BUDGET, 4500, 5000),
    rate: integer(env.IRESERVATION_RATE_PER_SECOND, 5, 5),
    burst: integer(env.IRESERVATION_BURST, 10, 10) };
}
// Fixed-order AAD binds tenant, environment, calendar, credential kind/version.
function aad(context) {
  const fields = ['environment', 'ownerId', 'propertyId', 'calendarId', 'kind', 'version'];
  if (fields.some(k => context[k] === undefined || context[k] === null || String(context[k]) === '')) fail('encryption_context_invalid');
  return Buffer.from(JSON.stringify(['ireservation', ...fields.map(k => String(context[k]))]));
}
export function seal(value, context, env = process.env) {
  const keyId = env.IRESERVATION_ENC_KEY_ID || 'v1';
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(env, keyId), nonce);
  cipher.setAAD(aad(context));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { keyId, nonce: nonce.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function unseal(value, context, env = process.env) {
  try {
    if (!value || Buffer.from(value.nonce, 'base64').length !== 12 || Buffer.from(value.tag, 'base64').length !== 16) fail('credentials_unreadable');
    const cipher = createDecipheriv('aes-256-gcm', key(env, value.keyId), Buffer.from(value.nonce, 'base64'));
    cipher.setAAD(aad(context)); cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.data, 'base64')), cipher.final()]).toString('utf8'));
  } catch { fail('credentials_unreadable'); }
}
export function connectionContext(row, config) {
  return { environment: config.environment, ownerId: row.owner_id, propertyId: row.property_id,
    calendarId: row.calendar_id, kind: 'property', version: row.version };
}
function tokenContext(config, version) {
  return { environment: config.environment, ownerId: 'partner', propertyId: config.authScope,
    calendarId: 'partner', kind: 'token', version };
}
function validateTokens(result) {
  if (!result || typeof result.token !== 'string' || !result.token || result.token.length > 16384 ||
      !Number.isInteger(result.expiresIn) || result.expiresIn < 60 || result.expiresIn > 86400 ||
      (result.refreshToken != null && (typeof result.refreshToken !== 'string' || !result.refreshToken || result.refreshToken.length > 16384))) fail('provider_response_invalid');
}
// Store must implement atomic, durable operations (see _ireservation-store.js).
export function createReadClient({ store, env = process.env, transport = fetch, now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const config = configuration(env);
  async function send(path, body, token) {
    if (!['/v1/oauth2/authorizations', '/rooms', '/distributors', '/reservations'].includes(path)) fail('operation_not_allowed', 400);
    const budget = await store.call('reserve', { scope: config.scope, daily: config.daily, rate: config.rate, burst: config.burst });
    if (!budget.allowed) fail(budget.reason === 'rate' ? 'rate_paused' : 'quota_paused', 429);
    let response;
    try {
      response = await transport(config.base + path, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { 'x-api-key': config.apiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    } catch { fail('provider_unreachable'); }
    let data;
    try {
      // Bound response processing; never echo provider payloads or error text.
      if (Number(response.headers.get('content-length')) > 2_000_000) fail('provider_response_invalid');
      const reader = response.body.getReader(); let size = 0; const chunks = [];
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length;
        if (size > 2_000_000) { await reader.cancel(); fail('provider_response_invalid'); } chunks.push(Buffer.from(part.value)); }
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { data = null; }
    const code = data?.code;
    if (response.status === 429 || code === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? Math.ceil((Date.parse(retry) - now()) / 1000) : NaN;
      // Unknown reset: pause all partner traffic conservatively for 24h.
      const pauseSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.max(1, seconds)) : 86400;
      await store.call('pause', { scope: config.scope, seconds: pauseSeconds }); fail('quota_paused', 429);
    }
    if (response.status === 401 || code === 401) fail('provider_unauthorized', 401);
    if (response.status >= 500 || code === 500) fail('provider_unavailable');
    if (!response.ok) fail('provider_rejected');
    if (!data || !Number.isInteger(code)) fail('provider_response_invalid');
    if (code !== 0) fail('provider_rejected');
    return data;
  }
  async function access(rejectedToken = null) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const state = await store.call('token_get', { scope: config.authScope });
      if (state.auth_blocked) fail('partner_auth_blocked');
      let tokens = null;
      if (state.secret) tokens = unseal(state.secret, tokenContext(config, state.version), env);
      // A different worker may have replaced the rejected token already.
      if (tokens?.token && Date.parse(state.expires_at) > now() + 30000 && tokens.token !== rejectedToken) return tokens.token;
      const lease = randomUUID();
      const claimed = await store.call('token_claim', { scope: config.authScope, version: state.version, lease });
      if (!claimed.claimed) { await sleep(100); continue; }
      try {
        const body = tokens?.refreshToken ? { refreshToken: tokens.refreshToken } : { username: config.username, password: config.password };
        const started = now(); const data = await send('/v1/oauth2/authorizations', body); validateTokens(data.result);
        const next = { token: data.result.token, refreshToken: data.result.refreshToken ?? tokens?.refreshToken ?? null };
        const version = randomUUID(), expiresAt = new Date(started + data.result.expiresIn * 1000).toISOString();
        const result = await store.call('token_finish', { scope: config.authScope, lease, previous: state.version, version,
          secret: seal(next, tokenContext(config, version), env), expires_at: expiresAt });
        if (!result.saved) fail('auth_lease_lost');
        return next.token;
      } catch (error) {
        const code = safeError(error).code;
        await store.call('token_fail', { scope: config.authScope, lease, blocked: code === 'provider_unauthorized' });
        throw error;
      }
    }
    fail('auth_busy');
  }
  async function read(path, parameters) {
    let token = await access(); let data;
    try { data = await send(path, parameters ? { lang: 'en', parameters } : undefined, token); }
    catch (error) {
      if (safeError(error).code !== 'provider_unauthorized') throw error;
      token = await access(token); // Exactly one coordinated refresh/retry for a read.
      data = await send(path, parameters ? { lang: 'en', parameters } : undefined, token);
    }
    return data;
  }
  return { config,
    async rooms(connection) {
      const credentials = unseal(connection.secret, connectionContext(connection, config), env);
      const data = await read('/rooms', { calendarId: connection.calendar_id, ...credentials });
      if (!Array.isArray(data.results) || data.results.some(r => !Number.isInteger(r.id) || !['room','property'].includes(r.type) || typeof r.name !== 'string')) fail('provider_response_invalid');
      return data.results.map(({ id, type, name }) => ({ id, type, name }));
    },
    async reservations(connection, range) {
      const { windowRange, normalizeReservations } = await import('./_ireservation-compare.js');
      const dates = windowRange(range.fromDate, range.toDate);
      const credentials = unseal(connection.secret, connectionContext(connection, config), env);
      const data = await read('/reservations', { calendarId: connection.calendar_id, ...credentials, ...dates });
      return normalizeReservations(data.results?.reservations);
    },
    async distributors() {
      const data = await read('/distributors');
      if (!Array.isArray(data.results) || data.results.some(r => !Number.isInteger(r.idDistributor) || typeof r.nameDistributor !== 'string')) fail('provider_response_invalid');
      return data.results.map(({ idDistributor, nameDistributor }) => ({ idDistributor, nameDistributor }));
    },
  };
}
