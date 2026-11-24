// 17 Nov 2026 — admin home «Utenti» (api/_admin-users.js + users_overview on
// /api/admin-host-health): rows per account, registration, trial/plan,
// activity levels and counts, invited-only addresses, test/admin flags,
// summary tiles; admin gate before any read; journalled. Fictional data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'fictional-service-key';
const U = await import('../api/_admin-users.js');
const NOW = Date.parse('2026-11-17T10:00:00Z'), D = 86400000, iso = ms => new Date(ms).toISOString();
assert.equal(U.activityLevel(null, NOW), 'never');
assert.equal(U.activityLevel(iso(NOW - 2 * D), NOW), 'active');
assert.equal(U.activityLevel(iso(NOW - 7 * D), NOW), 'active');
assert.equal(U.activityLevel(iso(NOW - 8 * D), NOW), 'slowing');
assert.equal(U.activityLevel(iso(NOW - 31 * D), NOW), 'inactive');
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b', C = '00000000-0000-4000-8000-00000000000c', T = '00000000-0000-4000-8000-00000000000d', ADM = '00000000-0000-4000-8000-00000000000e';
const users = [
  { id: A, email: 'Anna@example.invalid', created_at: iso(NOW - 10 * D), email_confirmed_at: iso(NOW - 10 * D), last_sign_in_at: iso(NOW - 1 * D) },
  { id: B, email: 'bruno@example.invalid', created_at: iso(NOW - 60 * D), email_confirmed_at: iso(NOW - 60 * D), last_sign_in_at: iso(NOW - 40 * D) },
  { id: C, email: 'carla@example.invalid', created_at: iso(NOW - 1 * D), email_confirmed_at: null, last_sign_in_at: null, invited_at: iso(NOW - 1 * D) },
  { id: T, email: 'test@example.invalid', created_at: iso(NOW - 5 * D), email_confirmed_at: iso(NOW - 5 * D), last_sign_in_at: iso(NOW - 1 * D) },
  { id: ADM, email: 'admin@example.invalid', created_at: iso(NOW - 300 * D), email_confirmed_at: iso(NOW - 300 * D), last_sign_in_at: iso(NOW) },
];
const properties = [{ id: 'p1', name: 'Casa Anna', owner_id: A, is_test: false }, { id: 'p2', name: 'Villa Anna', owner_id: A, is_test: false }, { id: 'p3', name: 'Bruno B&B', owner_id: B, is_test: false }, { id: 'pt', name: 'Prova', owner_id: T, is_test: true }];
const events = [
  { user_id: A, created_at: iso(NOW - 1 * D) }, { user_id: A, created_at: iso(NOW - 1 * D + 3600e3) }, { user_id: A, created_at: iso(NOW - 3 * D) }, { user_id: A, created_at: iso(NOW - 20 * D) },
  { user_id: B, created_at: iso(NOW - 25 * D) },
];
const checkins = [{ property_id: 'p1' }, { property_id: 'p2' }, { property_id: 'p2' }, { property_id: 'p3' }];
const invites = [{ email: 'carla@example.invalid', status: 'invited', invited_at: iso(NOW - 1 * D) }, { email: 'dora@example.invalid', status: 'invited', invited_at: iso(NOW - 2 * D) }, { email: 'eva@example.invalid', status: 'revoked', invited_at: iso(NOW - 3 * D) }];
const plans = { [A]: { state: 'trial', trial_ends_at: iso(NOW + 5 * D), days_left: 5 }, [B]: { state: 'active', paid_until: iso(NOW + 200 * D) }, [C]: { state: 'prelaunch' }, [T]: { state: 'prelaunch' }, [ADM]: { state: 'free', reason: 'admin' } };
const rows = U.buildRows({ users, invites, admins: [{ email: 'ADMIN@example.invalid' }], properties, events, checkins, plans, now: NOW });
const by = Object.fromEntries(rows.map(r => [r.email.toLowerCase(), r]));
assert.deepEqual(rows.map(r => r.email.toLowerCase()), ['carla@example.invalid', 'dora@example.invalid', 'test@example.invalid', 'anna@example.invalid', 'bruno@example.invalid', 'admin@example.invalid'], 'newest first; revoked invite left out; invited-only address listed');
const a = by['anna@example.invalid'];
assert.deepEqual([a.status, a.activity, a.active_days_7, a.active_days_30, a.checkins_30, a.properties.length, a.plan.state, a.is_admin, a.is_test], ['active_account', 'active', 2, 3, 3, 2, 'trial', false, false]);
assert.equal(a.last_active_at, iso(NOW - 1 * D + 3600e3), 'latest of console event and sign-in');
assert.deepEqual([by['bruno@example.invalid'].activity, by['bruno@example.invalid'].active_days_30, by['bruno@example.invalid'].checkins_30], ['slowing', 1, 1], 'last event 25 days ago beats an older sign-in');
assert.deepEqual([by['carla@example.invalid'].status, by['carla@example.invalid'].confirmed, by['carla@example.invalid'].activity], ['invited', false, 'never']);
assert.deepEqual([by['carla@example.invalid'].registered_at, by['carla@example.invalid'].invited_at], [null, iso(NOW - 1 * D)], 'an invited account is not «registered» until the password exists');
assert.equal(a.registered_at, iso(NOW - 10 * D), 'registered = password created');
assert.deepEqual([by['dora@example.invalid'].user_id, by['dora@example.invalid'].registered_at, by['dora@example.invalid'].status], [null, null, 'invited']);
assert.equal(by['test@example.invalid'].is_test, true); assert.equal(by['admin@example.invalid'].is_admin, true);
assert.deepEqual(U.summarize(rows, NOW), { hosts: 4, registered_30: 1, not_registered: 2, active_7: 1, inactive: 0, trial_ending_7: 1, in_trial: 1, trial_ended: 0, paying: 1, prelaunch: 1, terms_accepted: 0, terms_pending: 2 }, 'test and admin accounts not counted');

// Endpoint: admin gate before any read; journalled.
const { default: handler } = await import('../api/admin-host-health.js');
let reads = 0; const journal = [];
const termsRows = [{ host_id: A, version: 1, created_at: iso(NOW - 1 * D), host_kind: 'business' }, { host_id: A, version: 1, created_at: iso(NOW - 5 * D), host_kind: 'private' }];
const usersDeps = { listUsers: async () => { reads++; return users; }, get: async p => { reads++; return p.startsWith('admin_users') ? [{ email: 'admin@example.invalid' }] : []; },
  getAll: async p => { reads++; return p.startsWith('pilot_invites') ? invites : p.startsWith('properties') ? properties : p.startsWith('analytics_events') ? events : p.startsWith('checkins') ? checkins : p.startsWith('host_terms_acceptances') ? termsRows : []; },
  rpc: async (n, args) => { assert.equal(n, 'billing_access_state'); return plans[args.p_user] || { state: 'none' }; }, now: () => NOW };
const authFetch = role => async url => {
  if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: ADM, email: 'admin@example.invalid' }));
  if (String(url).endsWith('/rpc/is_admin')) return new Response(JSON.stringify(role === 'admin'));
  throw new Error('unexpected ' + url);
};
const post = async (role, auth = 'Bearer jwt') => { const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...(auth ? { authorization: auth } : {}) }, body: { action: 'users_overview' } }, res, { fetch: authFetch(role), users: usersDeps, audit: { first: async () => true, after: async e => journal.push(e) } }); return res; };
assert.equal((await post('admin', null)).code, 401); assert.equal((await post('host')).code, 403); assert.equal(reads, 0, 'nothing read before the admin check');
const r = await post('admin');
assert.equal(r.code, 200); assert.equal(r.headers['Cache-Control'], 'no-store');
assert.equal(r.body.rows.length, 6); assert.equal(r.body.summary.hosts, 4); assert.equal(r.body.plan_error, null); assert.equal(r.body.generated_at, iso(NOW));
assert.deepEqual([journal.at(-1).action, journal.at(-1).metadata], ['host_health_read', { view: 'users', rows: 6 }]);
// Terms are per account: latest acceptance wins; registered without one = pending; invited-only = none.
assert.deepEqual(r.body.rows.find(x => x.user_id === A).terms, { version: 1, accepted_at: iso(NOW - 1 * D), host_kind: 'business' });
assert.equal(r.body.rows.find(x => x.user_id === B).terms, null); assert.equal(r.body.rows.find(x => x.email === 'dora@example.invalid').terms, null);
assert.deepEqual([r.body.summary.terms_accepted, r.body.summary.terms_pending, r.body.terms_error], [1, 1, null]);
// Plan read failing for one account is shown, not hidden.
const r2 = await (async () => { const res = { code: 0, body: null, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer jwt' }, body: { action: 'users_overview' } }, res, { fetch: authFetch('admin'), users: { ...usersDeps, rpc: async (n, a) => { if (a.p_user === B) throw new Error('down'); return plans[a.p_user]; } }, audit: { first: async () => true, after: async () => {} } }); return res; })();
assert.equal(r2.body.plan_error, 'plan_unavailable'); assert.equal(r2.body.rows.find(x => x.user_id === B).plan, null);
// Full billing per row when the billing reader is available.
const r3 = await (async () => { const res = { code: 0, body: null, headers: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer jwt' }, body: { action: 'users_overview' } }, res, { fetch: authFetch('admin'), users: { ...usersDeps, rpc: async () => { throw new Error('rpc not used'); },
    billing: async ids => ({ byOwner: Object.fromEntries(ids.map(id => [id, { state: plans[id], chip: 'x', subscription: { user_id: id }, events: [] }])) }) }, audit: { first: async () => true, after: async () => {} } }); return res; })();
assert.equal(r3.code, 200); assert.equal(r3.body.plan_error, null);
const ra = r3.body.rows.find(x => x.user_id === A);
assert.deepEqual([ra.plan.state, ra.billing.subscription.user_id], ['trial', A], 'row carries plan and the subscription box data');
assert.equal(r3.body.rows.find(x => x.email === 'dora@example.invalid').billing, null, 'invited-only address: no box');
// Wiring: the home tab.
const html = fs.readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
assert.match(html, /let activeTab   = 'users';/); assert.match(html, /<button data-tab="users"[^>]*>Utenti<\/button>\s*<button data-tab="contacts"[^>]*>.*?<\/button>\s*<button data-tab="deepdive"/);
assert.match(html, /if \(activeTab === 'users'\)    return window\.UsersAdmin/);
// 24 Nov 2026: the Pilot tab is gone; its recent-activity feed sits at the bottom of Utenti.
assert.ok(!html.includes('data-tab="pilot"') && !html.includes('function renderPilotTab('), 'no Pilot tab');
assert.match(html, /function renderRecentActivity\(\) \{[\s\S]*?return renderActivityFeed\(propToEmail\);/);
assert.match(fs.readFileSync(new URL('../admin-users.js', import.meta.url), 'utf8'), /root\.renderRecentActivity\(\)/, 'Utenti renders the recent activity');
const overview = html.slice(html.indexOf('function renderHealthOverview('), html.indexOf('function hhTile('));
assert.ok(!overview.includes('renderBillingSettings'), 'billing settings not in the overview');
assert.match(html, /html \+= renderHealthOverview\(\);/, 'Deep dive keeps the overview');
assert.match(fs.readFileSync(new URL('../admin-users.js', import.meta.url), 'utf8'), /root\.renderBillingSettings\(\)/); assert.match(html, /<script src="\/admin-users\.js\?v=9"><\/script>/);
console.log('PASS admin users home: one row per account (newest first, invited-only addresses, revoked left out), registration and password state, trial/plan, last activity from console events and sign-in, active days 7/30, check-ins 30 days, activity levels (active ≤7 d, slowing 8–30, inactive >30, never), test/admin flagged and left out of the counts, summary; endpoint admin-gated before any read, journalled, plan failures shown; «Utenti» is the first and default tab');
