// Explicit post-deployment gate: no token, guest records, AI/provider calls or writes.
// PR CI runs against the previous production build, so the new-route gate needs
// its own origin and is enabled after the matching deployment is READY.
import assert from 'node:assert/strict';
const origin = process.env.CHAT_SMOKE_ORIGIN;
if (!origin) { console.error('SKIP CHAT_SMOKE_ORIGIN not set (post-deployment chat startup)'); process.exit(77); }
const base = new URL(origin);
assert.equal(base.protocol, 'https:');
for (const [method, expected] of [['GET', 405], ['POST', 401]]) {
  const response = await fetch(new URL('/api/chat', base), {
    method, headers: { Origin: base.origin, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ messages: [{ role: 'user', content: 'Fictional unauthenticated startup probe' }] }) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  assert.equal(response.status, expected, `chat startup ${method} must reach request/auth gate`);
  const result = await response.json();
  assert.equal(result.error, method === 'GET' ? 'POST only' : 'Invalid or missing guest token');
}
console.log('PASS hosted chat module startup: GET method gate and unauthenticated POST auth gate; no AI call or data write.');
