import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_PUBLIC_KEY, PRODUCTION_REF, readEnvironment } from '../lib/environment.mjs';

assert.match(PRODUCTION_PUBLIC_KEY, /^sb_publishable_/);
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(new URL('../app-config.js', import.meta.url), 'utf8'), context);
assert.equal(context.window.WELCOME_BNB_CONFIG.publicKey, PRODUCTION_PUBLIC_KEY);
assert.equal(readEnvironment({}).publicKey, PRODUCTION_PUBLIC_KEY);
// The new public key must not change the Supabase project or user-session key.
assert.equal(context.window.WELCOME_BNB_CONFIG.projectRef, PRODUCTION_REF);
const calls = [];
const fakeUser = '00000000-0000-4000-8000-000000000001';
const jwt = 'e30.' + Buffer.from(JSON.stringify({ sub: fakeUser, aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url') + '.' + Buffer.from('SYNTHETIC').toString('base64url');
const client = createClient(`https://${PRODUCTION_REF}.supabase.co`, PRODUCTION_PUBLIC_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: async (url, options) => {
    const headers = new Headers(options.headers);
    calls.push({ url: String(url), headers });
    const auth = String(url).endsWith('/auth/v1/user');
    return new Response(JSON.stringify(auth ? { id: fakeUser, aud: 'authenticated' } : []), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } },
});
assert.equal(client.auth.storageKey, `sb-${PRODUCTION_REF}-auth-token`);
await client.from('properties').select('id');
assert.equal(calls[0].headers.get('apikey'), PRODUCTION_PUBLIC_KEY);
assert.equal(calls[0].headers.get('authorization'), `Bearer ${PRODUCTION_PUBLIC_KEY}`);
const session = await client.auth.setSession({ access_token: jwt, refresh_token: 'SYNTHETIC' });
assert.equal(session.error, null);
await client.from('properties').select('id');
assert.equal(calls.at(-1).headers.get('apikey'), PRODUCTION_PUBLIC_KEY);
assert.equal(calls.at(-1).headers.get('authorization'), `Bearer ${jwt}`);
assert.ok(calls.every(c => new URL(c.url).hostname === `${PRODUCTION_REF}.supabase.co`));
console.log('PASS public-key configuration and pinned SDK: production project/session storage unchanged, public API key retained with explicit user JWT; fictional transport only');
