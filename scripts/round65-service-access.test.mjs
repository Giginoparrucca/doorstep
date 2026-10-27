import assert from 'node:assert/strict';
import { verifyServiceAccess } from './round65-service-access.test.live.mjs';

for (const key of ['sb_secret_SYNTHETIC_ONLY', 'synthetic.legacy.jwt']) {
  const calls = [];
  let discarded = 0;
  const kind = await verifyServiceAccess(key, async (url, options) => {
    calls.push({ url, options });
    return {
      status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      body: { cancel: async () => { discarded++; } },
      json() { throw new Error('Must not read user or bucket data'); },
      text() { throw new Error('Must not read user or bucket data'); },
    };
  });
  assert.equal(discarded, 2);
  assert.match(kind, key.startsWith('sb_secret_') ? /modern/ : /legacy/);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/auth/v1/admin/users', '/storage/v1/bucket']);
  for (const { url, options } of calls) {
    assert.equal(new URL(url).hostname, 'jcjwaqqabgwqhhzhfbts.supabase.co');
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.apikey, key);
    assert.equal(options.headers.Authorization, key.startsWith('sb_secret_') ? undefined : `Bearer ${key}`);
    assert.equal(options.body, undefined);
  }
}
for (const failingService of [0, 1]) {
  for (const [status, type] of [[401, 'application/json'], [403, 'application/json'], [500, 'application/json'], [200, 'text/html']]) {
    let calls = 0, discarded = 0;
    await assert.rejects(verifyServiceAccess('sb_secret_SYNTHETIC_ONLY', async () => {
      const fail = calls++ === failingService;
      return { status: fail ? status : 200,
        headers: new Headers({ 'content-type': fail ? type : 'application/json' }),
        body: { cancel: async () => { discarded++; } } };
    }), /read-only probe failed/);
    assert.equal(calls, failingService + 1);
    assert.equal(discarded, calls);
  }
}
await assert.rejects(verifyServiceAccess('sb_secret_SYNTHETIC_ONLY', async () => {
  throw new Error('sensitive transport detail');
}), error => !error.message.includes('sensitive') && /failed at transport/.test(error.message));
for (const key of ['', 'sb_publishable_SYNTHETIC_ONLY']) {
  await assert.rejects(verifyServiceAccess(key, () => assert.fail('No network without a server credential')), /server credential/);
}
console.log('PASS read-only Auth/Storage transport: modern/legacy headers, no writes/body reads, body disposal, bounded requests, failures and redacted transport errors');
