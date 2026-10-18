// Shared test scaffolding only. Unexpected network calls fail closed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function fixtureEnvironment() {
  // Never reuse credentials from the invoking shell.
  for (const name of ['APP_ENV', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
    'VERCEL_PROJECT_NAME', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL', 'VERCEL_URL']) delete process.env[name];
  Object.assign(process.env, {
    APP_ENV: 'production', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    GUEST_TOKEN_SECRET: 'fixture-token-secret-for-offline-tests-only',
    ANTHROPIC_API_KEY: 'fixture-anthropic', RESEND_API_KEY: 'fixture-resend',
    CRON_SECRET: 'fixture-cron', TELEGRAM_BOT_TOKEN: 'fixture-telegram',
  });
}

export function response() {
  return {
    code: 200, headers: {}, chunks: [],
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    json(body) { this.body = body; return this; },
    write(chunk) { this.chunks.push(chunk); },
    end(chunk) { if (chunk) this.chunks.push(chunk); this.ended = true; return this; },
  };
}

export async function call(handler, body, { token, method = 'POST', url = '/', headers = {} } = {}) {
  const res = response();
  await handler({ method, url, body, headers: {
    origin: 'https://app.welcomebnb.it', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers,
  } }, res);
  return res;
}

export const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });

export function mockNetwork(route) {
  const original = globalThis.fetch;
  const calls = [], unexpected = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const request = { url, method: options.method || 'GET', headers: options.headers || {},
      body: options.body ? JSON.parse(options.body) : undefined, options };
    calls.push(request);
    let result;
    try { result = await route(request); }
    catch (error) {
      // Application code often catches transport errors. A failed assertion
      // inside the fake must still fail this suite at teardown.
      unexpected.push(error.stack || String(error));
      throw error;
    }
    if (result === undefined) {
      unexpected.push(request.method + ' ' + url);
      throw Error('Unexpected offline request: ' + unexpected.at(-1));
    }
    return result;
  };
  return { calls, restore() { globalThis.fetch = original; assert.deepEqual(unexpected, []); } };
}

// Extract and execute actual inline functions; no copied implementation.
export function hostFunctions(names, globals = {}) {
  const source = readFileSync(new URL('../../host-console.html', import.meta.url), 'utf8');
  const context = vm.createContext({ Date, console, ...globals });
  for (const name of names) {
    const start = source.indexOf('function ' + name + '(');
    assert.ok(start >= 0, 'Missing host function ' + name);
    let end = source.indexOf('\n}', start);
    for (; end >= 0; end = source.indexOf('\n}', end + 2)) {
      const candidate = source.slice(start, end + 2);
      try { new vm.Script(candidate); } catch { continue; }
      vm.runInContext(candidate, context);
      break;
    }
    assert.ok(end >= 0, 'Cannot parse host function ' + name);
  }
  return context;
}

// The small subset of PostgREST filters used by the reminder fixtures.
// Unknown operators throw so the fake cannot silently broaden queries.
export function filterRows(rows, params) {
  return rows.filter(row => [...params].every(([key, filter]) => {
    if (['select', 'order', 'limit', 'offset'].includes(key)) return true;
    if (filter === 'is.null') return row[key] == null;
    if (filter === 'not.is.null') return row[key] != null;
    if (filter.startsWith('in.(')) return filter.slice(4, -1).replaceAll('"', '').split(',').includes(String(row[key]));
    const dot = filter.indexOf('.'), op = filter.slice(0, dot), value = filter.slice(dot + 1), actual = String(row[key]);
    if (op === 'eq' || op === 'is') return actual === value;
    if (op === 'neq') return actual !== value;
    if (op === 'gte') return actual >= value;
    if (op === 'gt') return actual > value;
    if (op === 'lt') return actual < value;
    throw Error('Unsupported fixture filter: ' + key + '=' + filter);
  }));
}
