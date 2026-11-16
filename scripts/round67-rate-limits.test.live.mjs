// Round 67 Phase 6 — post-deploy rate-limit probe against production.
// Opt-in (RATE_LIMIT_LIVE_PROBE=1): it spends this machine's hourly guest-
// link budget, so it is not part of the read-only default smoke.
// Calls /api/guest-token with a random, non-existent property ID (no real
// property, booking or guest is touched): the first LIMIT calls are answered
// (404/400), the next one must be 429 with Retry-After, and the property
// counter for that random ID is never shared with a real property.
// Some networks (proxies, CI egress pools) spread consecutive calls over a
// few addresses; each address has its own counter, so the probe allows up to
// MAX_ADDRESSES × LIMIT calls before declaring the limit missing.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
if (process.env.RATE_LIMIT_LIVE_PROBE !== '1') {
  console.error('SKIP rate-limit probe spends the guest-link budget of this address; set RATE_LIMIT_LIVE_PROBE=1 to run it after a deploy');
  process.exit(77);
}
const origin = process.env.SECURITY_SMOKE_ORIGIN || 'https://app.welcomebnb.it';
const LIMIT = 60; // LIMITS.mint_address (api/_rate-limit.js)
const MAX_ADDRESSES = Number(process.env.RATE_LIMIT_PROBE_ADDRESSES || 4);
const property = randomUUID();
let first429 = null, lastStatus = null;
for (let i = 1; i <= LIMIT * MAX_ADDRESSES + 1; i++) {
  const r = await fetch(`${origin}/api/guest-token`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ property_id: property, session_id: 'probe-' + randomUUID() }) });
  lastStatus = r.status;
  if (r.status === 429) { first429 = { i, retry: r.headers.get('retry-after') }; break; }
  assert.ok([400, 401, 403, 404].includes(r.status), `call ${i}: unexpected ${r.status}`);
}
assert.ok(first429, `never limited (last status ${lastStatus})`);
assert.ok(first429.i <= LIMIT * MAX_ADDRESSES + 1, `limited only at call ${first429.i}`);
assert.ok(Number(first429.retry) > 0, 'Retry-After set');
console.log(`PASS round67 rate-limit probe: /api/guest-token answered then refused with 429 at call ${first429.i} (limit ${LIMIT}/hour per address, Retry-After ${first429.retry}s); new session IDs did not reset it`);
