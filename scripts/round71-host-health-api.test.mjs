// Round 71 — api/admin-host-health.js: admin gate (anon / non-admin / admin),
// origin allowlist, no silent empty result on failure, pagination, privacy.
// Fake Supabase; fictional rows.
import assert from 'node:assert/strict';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service';
const { default: handler, sbGetAll } = await import('../api/admin-host-health.js');

const P = '00000000-0000-4000-8000-000000000001', O = '00000000-0000-4000-8000-0000000000a1';
let role = 'admin', failTable = null; const calls = [];
const json = d => ({ ok: true, status: 200, json: async () => d, text: async () => JSON.stringify(d) });
const fetch = async (url, opts = {}) => {
  calls.push(url);
  if (url.endsWith('/auth/v1/user')) return opts.headers.Authorization === 'Bearer valid' ? json({ id: 'u1', email: 'a@example.invalid' }) : { ok: false, status: 401, json: async () => ({}) };
  if (url.endsWith('/rpc/is_admin')) { assert.equal(opts.headers.Authorization, 'Bearer valid', 'is_admin runs with the caller JWT'); return json(role === 'admin'); }
  if (url.includes('/auth/v1/admin/users')) return json({ users: [{ id: O, email: 'host@example.invalid', last_sign_in_at: '2026-11-04T10:00:00Z' }] });
  const table = new URL(url).pathname.split('/').pop();
  if (table === failTable) return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
  const today = new Date().toISOString().slice(0, 10);
  const rows = {
    properties: [{ id: P, name: 'Casa Prova', owner_id: O, timezone: 'Europe/Rome', region: 'Puglia', city: 'Bari', cir_code: 'IT000', tax_rate_eur: 2, ical_feeds: ['x'], welcome_message_it: 'Ciao', alloggiati_autofile_mode: 'live' }],
    ota_reservations: url.includes('created_by=') ? [] : [{ id: 'r1', property_id: P, booking_code: 'B1', checkin_date: today, platform: 'airbnb', entry_type: 'reservation', status: 'active', covered_by_reservation_id: null }],
    checkins: url.includes('filed_at=is.null') ? [] : [{ id: 'c1', property_id: P, booking_code: 'B1', surname: 'Rossi', arrival_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10), filed_at: null, autofile_excluded: false, alloggiati_status: 'pending' }],
    alloggiati_filing_log: [], host_alloggiati_credentials: [], host_onboarding: [], recommendations: [], analytics_events: [],
  }[table];
  if (!rows) throw new Error('unexpected ' + url);
  return json(rows);
};
async function call({ auth, origin = 'https://app.welcomebnb.it', method = 'POST' } = {}) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, headers: { origin, ...(auth ? { authorization: auth } : {}) }, body: {} }, res, { fetch });
  return res;
}

assert.equal((await call({ auth: 'Bearer valid', origin: 'https://evil.example' })).code, 403, 'origin allowlist');
assert.equal((await call({ auth: 'Bearer valid', method: 'GET' })).code, 405);
{ const r = await call(); assert.equal(r.code, 401); assert.match(r.body.error, /sign-in required/); }
{ const r = await call({ auth: 'Bearer forged' }); assert.equal(r.code, 401); }
role = 'host'; calls.length = 0;
{ const r = await call({ auth: 'Bearer valid' }); assert.equal(r.code, 403, 'non-admin host rejected'); assert.ok(!calls.some(u => u.includes('/rest/v1/properties')), 'no data read for a non-admin'); }
role = 'admin';
{ const r = await call({ auth: 'Bearer valid' }); assert.equal(r.code, 200); assert.equal(r.headers['Cache-Control'], 'no-store');
  assert.equal(r.body.properties.length, 1); const p = r.body.properties[0];
  assert.equal(p.owner_email, 'host@example.invalid'); assert.equal(p.filing.overdue.count, 1); assert.equal(p.filing.overdue.rows[0].guest, 'R.');
  assert.ok(!JSON.stringify(r.body).includes('Rossi'), 'surname never leaves the endpoint');
  assert.equal(p.health.color, 'red'); assert.equal(r.body.action_needed[0].property_id, P); }
// A failed read is a 503 with a message, never an empty 200 that looks like "no problems".
for (const t of ['checkins', 'ota_reservations', 'alloggiati_filing_log']) { failTable = t; const r = await call({ auth: 'Bearer valid' }); assert.equal(r.code, 503, t); assert.match(r.body.error, /unavailable/); }
failTable = null;

// Pagination past the 1000-row PostgREST cap.
{ const pages = []; const big = async url => { const off = Number(new URL(url).searchParams.get('offset')); pages.push(off); return json(Array.from({ length: off < 2000 ? 1000 : 7 }, (_, i) => ({ i: off + i }))); };
  const rows = await sbGetAll('analytics_events?select=property_id', { fetch: big }); assert.equal(rows.length, 2007); assert.deepEqual(pages, [0, 1000, 2000]); }
console.log('PASS round71 host health API: origin allowlist, POST only, anon/forged 401, non-admin 403 with no data read, is_admin with the caller JWT, admin 200 no-store payload with owner email and surname initial only, failed reads → 503 (never a silent empty result), pagination past 1000 rows');
