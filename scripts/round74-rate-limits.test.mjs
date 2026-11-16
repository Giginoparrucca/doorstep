// Round 74 Phase 5 — audit WBNB-Y002: limits keyed on server-controlled
// identity, reserved atomically, with safe behaviour when the counter store
// is down. Real migration in PGlite (rate_take, ai_month_tokens) wired to the
// actual handlers (guest-token mint, guest check-in writes, chat limits).
// Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GUEST_TOKEN_SECRET = 'fictional-round74-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { PGlite } = await import('@electric-sql/pglite');
const RL = await import('../api/_rate-limit.js');
const { signGuestToken } = await import('../api/_guest-token.js');
const { default: guestToken } = await import('../api/guest-token.js');
const { default: guest } = await import('../api/guest.js');
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', P2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

// ── Migration ──
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create table public.api_usage(id serial primary key, property_id uuid, session_id text, endpoint text, input_tokens int, output_tokens int, created_at timestamptz default now());`);
const mig = read('supabase/migrations/20261116130000_round74_rate_limits.sql');
await db.exec(mig); await db.exec(mig);
const takeDb = async (scope, key, limit, win = 3600) => (await db.query('select public.rate_take($1,$2,$3,$4) r', [scope, key, win, limit])).rows[0].r;
// Parallel requests at the limit: exactly the limit passes.
const results = await Promise.all(Array.from({ length: 25 }, () => takeDb('t', 'k', 10)));
assert.equal(results.filter(r => r.allowed).length, 10, 'exactly 10 of 25 parallel requests pass');
assert.deepEqual(results.map(r => r.hits).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1), 'each request reserved its own slot');
assert.equal((await takeDb('t', 'other', 10)).allowed, true, 'other key independent');
assert.equal((await takeDb('t2', 'k', 10)).allowed, true, 'other scope independent');
await db.query(`update public.rate_counters set window_start = window_start - interval '2 hours'`);
assert.equal((await takeDb('t', 'k', 10)).allowed, true, 'next window starts fresh');
await db.query(`insert into public.rate_counters values ('old','x', now() - interval '3 days', 5)`);
await takeDb('t', 'prune', 10);
assert.equal((await db.query(`select count(*)::int n from public.rate_counters where scope='old'`)).rows[0].n, 0, 'old windows pruned');
await assert.rejects(db.query(`select public.rate_take('t', null, 3600, 10)`), /invalid arguments/);
// Monthly AI tokens: summed in the database, this month and this property only.
await db.query(`insert into public.api_usage(property_id, endpoint, input_tokens, output_tokens, created_at) values
  ($1,'chat',100,50,now()), ($1,'scan',30,null,now()), ($1,'chat',999,999, now() - interval '40 days'), ($2,'chat',7,7,now())`, [P, P2]);
assert.equal(Number((await db.query('select public.ai_month_tokens($1) n', [P])).rows[0].n), 180);
for (const role of ['anon', 'authenticated']) for (const f of ['rate_take(text,text,integer,integer)', 'ai_month_tokens(uuid)'])
  assert.equal((await db.query(`select has_function_privilege('${role}','public.${f}','EXECUTE') a`)).rows[0].a, false, `${role} ${f}`);
assert.equal((await db.query(`select has_table_privilege('anon','public.rate_counters','SELECT') a`)).rows[0].a, false);

// ── Module: keys and failure modes ──
const req = (ip, sid) => ({ headers: { 'x-real-ip': ip, 'x-session': sid } });
assert.equal(RL.addressKey(req('192.0.2.1', 'a')), RL.addressKey(req('192.0.2.1', 'b')), 'session does not change the key');
assert.notEqual(RL.addressKey(req('192.0.2.1')), RL.addressKey(req('192.0.2.2')));
assert.match(RL.addressKey(req('192.0.2.1')), /^ip:[0-9a-f]{32}$/); assert.ok(!RL.addressKey(req('192.0.2.1')).includes('192.0.2.1'));
assert.equal(RL.addressKey({ headers: { 'x-forwarded-for': '192.0.2.1, 10.0.0.2' } }), RL.addressKey(req('192.0.2.1')));
const down = { fetch: async () => { throw new Error('store down'); } };
assert.equal((await RL.take('s', 'k', { limit: 5, onFailure: 'closed' }, down)).ok, false, 'closed → refuse');
assert.equal((await RL.take('s', 'k', { limit: 5, onFailure: 'open' }, down)).ok, true, 'open → allow');
RL._resetMemoryLimiter();
const bounded = []; for (let i = 0; i < 7; i++) bounded.push((await RL.take('s', 'k', { limit: 5 }, down)).ok);
assert.deepEqual(bounded, [true, true, true, true, true, false, false], 'bounded fallback keeps the same limit per instance');

// ── Handlers wired to the real function ──
let storeDown = false;
const originalFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes('/rpc/rate_take')) {
    if (storeDown) return new Response('down', { status: 503 });
    const a = JSON.parse(init.body); return Response.json(await takeDb(a.p_scope, a.p_key, a.p_limit, a.p_window_seconds));
  }
  if (url.includes('/rpc/ai_month_tokens')) return Response.json(Number((await db.query('select public.ai_month_tokens($1) n', [JSON.parse(init.body).p_property])).rows[0].n));
  if (url.includes('/rpc/billing_access_state')) return Response.json({ state: 'prelaunch' });
  if (url.includes('/properties?')) return Response.json(url.includes('ai_monthly_token_cap') ? [{ ai_monthly_token_cap: 200 }] : [{ id: P, owner_id: null, region: null, invoice_required: false }]);
  if (url.includes('/rest/v1/api_usage') && init.method === 'POST') return new Response(null, { status: 201 });
  if (url.includes('/rest/v1/api_usage?')) return new Response('[]', { headers: { 'content-range': '0-0/0' } });
  return Response.json([]);
};
const call = async (handler, body, ip, auth) => { let status = 200, out;
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...(ip ? { 'x-real-ip': ip } : {}), ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body },
    { setHeader() {}, status(n) { status = n; return this; }, json(v) { out = v; return this; }, end() { return this; }, write() {} });
  return { status, body: out }; };
try {
  // Mint: 60 per address per hour whatever the session ID.
  await db.exec('delete from public.rate_counters');
  for (let i = 0; i < 60; i++) assert.equal((await call(guestToken, { property_id: P, session_id: 'fresh-' + i }, '198.51.100.5')).status, 200, 'mint ' + i);
  assert.equal((await call(guestToken, { property_id: P, session_id: 'brand-new' }, '198.51.100.5')).status, 429, '61st from one address');
  assert.equal((await call(guestToken, { property_id: P, session_id: 'x' }, '198.51.100.6')).status, 200, 'another address unaffected');
  // Counter store down: bounded per instance, not unlimited.
  storeDown = true; RL._resetMemoryLimiter();
  let ok = 0; for (let i = 0; i < 65; i++) if ((await call(guestToken, { property_id: P, session_id: 'down-' + i }, '198.51.100.7')).status === 200) ok++;
  assert.equal(ok, 60, 'store down: still capped at 60 per address');
  storeDown = false;
  // Check-in writes: 120 per address and 60 per booking per hour.
  await db.exec('delete from public.rate_counters');
  const tok = b => signGuestToken({ p: P, s: 'fictional', ...(b ? { b } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }).token;
  const write = (b, ip) => call(guest, { action: 'checkin_update', id: '11111111-1111-4111-8111-111111111111', fields: { surname: 'X' } }, ip, tok(b));
  let refused = 0; for (let i = 0; i < 61; i++) if ((await write('BOOK-1', '192.0.2.' + (i % 200))).status === 429) refused++;
  assert.equal(refused, 1, 'per-booking cap (60) holds across many addresses');
  await db.exec('delete from public.rate_counters');
  refused = 0; for (let i = 0; i < 121; i++) if ((await write('BOOK-' + i, '192.0.2.99')).status === 429) refused++;
  assert.equal(refused, 1, 'per-address cap (120) holds across bookings');
  // Store down: ordinary check-in writes continue, bounded.
  storeDown = true; RL._resetMemoryLimiter();
  assert.notEqual((await write('BOOK-Z', '192.0.2.200')).status, 429, 'check-in not blocked by a limiter outage');
  storeDown = false;
  // Analytics events capped per address.
  await db.exec('delete from public.rate_counters');
  await db.query(`insert into public.rate_counters select 'event_address', $1, to_timestamp(floor(extract(epoch from now())/3600)*3600), 600`, [RL.addressKey(req('192.0.2.150'))]);
  assert.equal((await call(guest, { action: 'track_event', event_type: 'guest_open' }, '192.0.2.150', tok('BOOK-1'))).status, 429, 'event cap');
} finally { global.fetch = originalFetch; }
// Chat/scan: address cap first, monthly total from the database (no row fetch).
for (const f of ['api/chat.js', 'api/scan-document.js']) {
  const src = read(f);
  assert.match(src, /await take\('(chat|scan)_address', addressKey\(req\)/, f + ' address cap');
  assert.match(src, /rpc\/ai_month_tokens/, f + ' monthly sum in the database');
  assert.ok(!/select=input_tokens,output_tokens/.test(src), f + ' no unpaginated usage fetch');
}
assert.ok(!/checkMintRateLimit|MINT_HOURLY_LIMIT_PER_SESSION/.test(read('api/guest-token.js')), 'old session-keyed mint limiter removed');
console.log('PASS round74 rate limits (WBNB-Y002): rate_take reserves slots atomically (exactly 10 of 25 parallel pass), windows/keys/scopes independent, old windows pruned, ai_month_tokens sums this month and property in the database, both service_role only; keys from a hashed client address (session ID irrelevant, raw IP never stored); failure modes closed/open/bounded; mint 60 per address regardless of session and still 60 when the store is down; check-in writes 60 per booking and 120 per address, never blocked by a limiter outage; analytics capped; chat/scan address cap + monthly sum in the database; old session limiter removed');
