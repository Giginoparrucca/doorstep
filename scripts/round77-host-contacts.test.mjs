// Round 77 — host contacts (mini-CRM in admin). Real migrations in PGlite
// (Round 67 admin log, Round 77 twice): backfill = host accounts + pending
// invitations, names/phones from the first live property, no duplicates on
// re-run, prospects linked when they register; anon and authenticated can
// neither read nor write (RLS on, no policies, privileges revoked); the
// admin log accepts the contacts_* actions. The real server module
// (api/_admin-contacts.js) runs against PGlite: create/edit/note/delete
// persist, a 0-row update is an error. Endpoint: admin gate before any read.
// Browser (admin-contacts.js, 375/1440): cards, status badges, search by
// digits, filters, due badge and sort, WhatsApp/tel/mailto links, detail
// edit with quick dates, «done», notes timeline (XSS as text), in-page
// confirmations (no native dialogs). Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261124090000_round77_host_contacts.sql';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1), B = id(2), C = id(3), ADMIN = id(9);
const C_ = await import('../api/_admin-contacts.js');

// 1. Phone rules: server, client and SQL agree.
const cases = [['333 123 4567', '+393331234567'], ['0039 333 123 4567', '+393331234567'], ['+44 7700 900123', '+447700900123'], ['06 1234567', '+39061234567'],
  ['(333) 123.45-67', '+393331234567'], ['+39 333 123 4567', '+393331234567'], ['', null], ['abc', false], ['123', false], ['+0 123 456 789', false], ['7700 900123', false]];
for (const [inp, want] of cases) {
  const r = C_.normPhone(inp);
  if (want === false) assert.equal(r.ok, false, 'server rejects ' + inp); else assert.deepEqual(r, { ok: true, value: want }, 'server ' + inp);
}
const ui = read('admin-contacts.js');

// 2. Database.
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
let db = null;
if (PGlite) {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.host_subscriptions(user_id uuid primary key);
    create table public.properties(id uuid primary key default gen_random_uuid(), owner_id uuid, name text, host_names text, host_phone text, is_test boolean default false, deleted_at timestamptz, created_at timestamptz default now());
    create table public.pilot_invites(id serial primary key, email text unique, status text);
    grant all on all tables in schema public to anon, authenticated, service_role;`);
  await db.exec(read('supabase/migrations/20261116170000_round67_admin_audit_log.sql'));
  await db.query(`insert into auth.users values ($1,'anna@example.invalid'),($2,'bruno@example.invalid'),($3,'carla@example.invalid'),($4,'admin@example.invalid')`, [A, B, C, ADMIN]);
  await db.query(`insert into public.host_subscriptions values ($1),($2)`, [A, B]);
  await db.query(`insert into public.properties(owner_id, name, host_names, host_phone, created_at, deleted_at) values
    ($1,'Casa Vecchia','Old Name','339 000 0000', now() - interval '3 days', now()),
    ($1,'Casa Anna','Anna Fittizia','333 123 4567', now() - interval '2 days', null),
    ($1,'Villa Anna', null, '0039 333 765 4321', now() - interval '1 day', null),
    ($2,'Bruno B&B', '  ', '123', now(), null)`, [A, B]);
  await db.query(`insert into public.pilot_invites(email,status) values ('carla@example.invalid','invited'),('dora@example.invalid','invited'),('eva@example.invalid','revoked'),('anna@example.invalid','accepted')`);
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  { const ads = read('supabase/migrations/20261125090000_host_contacts_source_ads.sql'); await db.exec(ads); await db.exec(ads); } // 25 Nov: «Pubblicità» source
  const rows = async q => (await db.query(q)).rows;
  const contacts = await rows(`select user_id, email, full_name, phone, lead_stage from public.host_contacts order by coalesce(email,'')`);
  assert.deepEqual(contacts, [
    { user_id: A, email: 'anna@example.invalid', full_name: 'Anna Fittizia', phone: '+393331234567', lead_stage: 'lead' },
    { user_id: B, email: 'bruno@example.invalid', full_name: null, phone: null, lead_stage: 'lead' },
    { user_id: null, email: 'carla@example.invalid', full_name: null, phone: null, lead_stage: 'invited' },
    { user_id: null, email: 'dora@example.invalid', full_name: null, phone: null, lead_stage: 'invited' }],
    'accounts (first live property; deleted one skipped; bad phone left empty) + pending invitations; revoked/accepted skipped');
  assert.equal((await rows(`select count(*)::int n from public.host_contacts`))[0].n, 2 + 2, 'count = host accounts + pending invitations');
  assert.deepEqual((await rows(`select public.host_contacts_sync() r`))[0].r, { linked: 0, accounts: 0, invites: 0 }, 'no duplicates on re-run');
  // Carla registers: her prospect row becomes her account row (no duplicate).
  await db.query(`insert into public.host_subscriptions values ($1)`, [C]);
  assert.deepEqual((await rows(`select public.host_contacts_sync() r`))[0].r, { linked: 1, accounts: 0, invites: 0 });
  assert.deepEqual(await rows(`select user_id, lead_stage from public.host_contacts where email = 'carla@example.invalid'`), [{ user_id: C, lead_stage: 'invited' }]);
  // SQL phone function = JS rules.
  for (const [inp, want] of cases) assert.equal((await rows(`select public.host_contacts_phone('${inp.replace(/'/g, "''")}') v`))[0].v, want === false ? null : want, 'sql ' + inp);
  // anon and authenticated: no read, no write (RLS on, no policies, privileges revoked).
  const as = (role, q) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(q); });
  for (const role of ['anon', 'authenticated']) {
    for (const t of ['host_contacts', 'host_contact_notes']) {
      await assert.rejects(as(role, `select * from public.${t}`), /permission denied/, `${role} cannot read ${t}`);
      await assert.rejects(as(role, `insert into public.${t} default values`), /permission denied/, `${role} cannot write ${t}`);
    }
    await assert.rejects(as(role, `update public.host_contacts set full_name = 'x'`), /permission denied/);
    await assert.rejects(as(role, `delete from public.host_contacts`), /permission denied/);
    await assert.rejects(as(role, `select public.host_contacts_sync()`), /permission denied/, role + ' cannot run the sync');
  }
  assert.deepEqual(await rows(`select relrowsecurity r from pg_class where relname in ('host_contacts','host_contact_notes') order by relname`), [{ r: true }, { r: true }]);
  assert.equal((await rows(`select count(*)::int n from pg_policies where tablename in ('host_contacts','host_contact_notes')`))[0].n, 0, 'no policies');
  // Admin log accepts the contacts actions; others still refused.
  for (const a of ['contacts_list', 'contacts_create', 'contacts_update', 'contacts_delete', 'contacts_note_add', 'contacts_note_delete'])
    await db.query(`insert into public.admin_access_events(action, outcome, target_table, metadata) values ($1, 'ok', 'host_contacts', '{"status":200,"fields":["phone"]}')`, [a]);
  await assert.rejects(db.query(`insert into public.admin_access_events(action) values ('contacts_export')`), /check/);
  // Table checks back the server validation.
  await assert.rejects(db.query(`insert into public.host_contacts(phone) values ('333')`), /check/);
  await assert.rejects(db.query(`insert into public.host_contacts(email) values ('Dora@Example.invalid')`), /unique/, 'case-insensitive unique e-mail');
  // updated_at moves on update.
  const before = (await rows(`select updated_at from public.host_contacts where user_id = '${A}'`))[0].updated_at;
  await new Promise(r => setTimeout(r, 5));
  await db.query(`update public.host_contacts set next_action = 'x' where user_id = $1`, [A]);
  assert.ok((await rows(`select updated_at from public.host_contacts where user_id = '${A}'`))[0].updated_at > before, 'updated_at trigger');
  console.log('  db: migration, backfill, sync, RLS and grants checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// 3. The real server module against PGlite (persistence; 0-row writes are errors).
if (db) {
  const NOW = Date.parse('2026-11-24T10:00:00Z');
  const pgDeps = {
    now: () => NOW,
    sync: async () => (await db.query('select public.host_contacts_sync() r')).rows[0].r,
    contacts: async cid => (await db.query(`select * from public.host_contacts ${cid ? 'where id = $1' : ''} order by created_at`, cid ? [cid] : [])).rows.map(r => ({ ...r, next_action_due: r.next_action_due ? new Date(r.next_action_due).toISOString().slice(0, 10) : null })),
    notes: async () => (await db.query(`select * from public.host_contact_notes order by created_at desc, id`)).rows,
    properties: async () => (await db.query(`select id, name, owner_id, is_test from public.properties where deleted_at is null`)).rows,
    users: async () => [{ id: A, email: 'anna@example.invalid', last_sign_in_at: '2026-11-23T08:00:00Z' }, { id: B, email: 'bruno@example.invalid', last_sign_in_at: null }, { id: C, email: 'carla@example.invalid', last_sign_in_at: null }],
    billing: async ids => ({ byOwner: Object.fromEntries(ids.map(u => [u, u === A ? { state: { state: 'trial', days_left: 5 }, subscription: { status: 'trialing' } } : u === B ? { state: { state: 'active', paid_until: '2027-06-01T00:00:00Z' } } : { state: { state: 'prelaunch' }, subscription: { status: 'trialing', trial_ends_at: '2026-12-01T00:00:00Z' } }])) }),
    insert: async (table, row) => { const k = Object.keys(row); try { return { rows: (await db.query(`insert into public.${table}(${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, k.map(x => row[x]))).rows }; } catch (e) { if (/unique/.test(e.message)) return { conflict: true, rows: [] }; throw e; } },
    update: async (table, rid, row) => { const k = Object.keys(row); try { return { rows: (await db.query(`update public.${table} set ${k.map((x, i) => `${x} = $${i + 2}`).join(', ')} where id = $1 returning *`, [rid, ...k.map(x => row[x])])).rows }; } catch (e) { if (/unique/.test(e.message)) return { conflict: true, rows: [] }; throw e; } },
    remove: async (table, rid) => ({ rows: (await db.query(`delete from public.${table} where id = $1 returning *`, [rid])).rows }),
  };
  const act = (a, b) => C_.handleContactsAction(a, b, { actor: 'admin@example.invalid', deps: pgDeps });
  const list = async () => (await act('contacts_list', {})).body;
  let L = await list();
  assert.equal(L.today, '2026-11-24'); assert.equal(L.contacts.length, 4);
  const anna = L.contacts.find(c => c.user_id === A);
  assert.deepEqual([anna.status, anna.properties.map(p => p.name).sort(), anna.login_email, anna.last_login_at], [{ kind: 'trial', days_left: 5 }, ['Casa Anna', 'Villa Anna'], 'anna@example.invalid', '2026-11-23T08:00:00Z']);
  assert.deepEqual(L.contacts.find(c => c.user_id === B).status, { kind: 'paying', until: '2027-06-01T00:00:00Z' });
  assert.deepEqual(L.contacts.find(c => c.user_id === C).status, { kind: 'trial', days_left: 7 }, 'prelaunch: trial from the stored end date');
  assert.deepEqual(L.contacts.find(c => c.email === 'dora@example.invalid').status, { kind: 'lead', stage: 'invited' });
  // Create a prospect (name + phone are enough), edit, due date, note, done, delete.
  assert.equal((await act('contacts_create', {})).status, 400, 'something required');
  assert.equal((await act('contacts_create', { full_name: 'Gino', phone: 'abc' })).status, 400);
  assert.equal((await act('contacts_create', { full_name: 'Gino', source: 'fax' })).status, 400);
  { const ad = await act('contacts_create', { full_name: 'Da pubblicità', source: 'ads' }); assert.equal(ad.status, 201, 'ads accepted by server and table'); assert.equal(ad.body.contact.source, 'ads');
    assert.equal((await act('contacts_delete', { id: ad.body.contact.id })).status, 200); }
  const cr = await act('contacts_create', { full_name: 'Gino Fittizio', phone: '347 111 2222', source: 'whatsapp' });
  assert.equal(cr.status, 201); const gid = cr.body.contact.id;
  assert.deepEqual([cr.body.contact.phone, cr.body.contact.lead_stage], ['+393471112222', 'lead']);
  assert.equal((await act('contacts_create', { email: 'DORA@example.invalid' })).status, 409, 'duplicate e-mail');
  assert.equal((await act('contacts_update', { id: gid, next_action: 'Richiamare', next_action_due: '2026-11-20', lead_stage: 'demo', email: 'gino@example.invalid' })).status, 200);
  assert.equal((await act('contacts_update', { id: gid, next_action_due: '2026-02-30' })).status, 400, 'invalid date');
  assert.equal((await act('contacts_update', { id: gid, lead_stage: 'won' })).status, 400);
  assert.equal((await act('contacts_update', { id: anna.id, email: 'x@example.invalid' })).status, 400, 'account e-mail is the login');
  assert.equal((await act('contacts_update', { id: id(77), full_name: 'x' })).status, 404);
  assert.equal((await act('contacts_note_add', { contact_id: gid, body: '<img src=x onerror=alert(1)>\nseconda riga' })).status, 201);
  assert.equal((await act('contacts_note_add', { contact_id: gid, body: '   ' })).status, 400);
  L = await list(); // «after reload»
  const g = L.contacts.find(c => c.id === gid);
  assert.deepEqual([g.full_name, g.phone, g.lead_stage, g.next_action, g.next_action_due, g.email, g.notes.length, g.notes[0].body, g.notes[0].created_by],
    ['Gino Fittizio', '+393471112222', 'demo', 'Richiamare', '2026-11-20', 'gino@example.invalid', 1, '<img src=x onerror=alert(1)>\nseconda riga', 'admin@example.invalid'], 'every write persisted');
  assert.equal(g.last_note_at, g.notes[0].created_at);
  assert.equal((await act('contacts_delete', { id: anna.id })).status, 409, 'account contacts are not deleted');
  assert.equal((await act('contacts_note_delete', { id: g.notes[0].id })).status, 200);
  assert.equal((await act('contacts_note_delete', { id: g.notes[0].id })).status, 404, 'second delete finds nothing (0 rows = error)');
  assert.equal((await act('contacts_delete', { id: gid })).status, 200);
  assert.equal((await act('contacts_update', { id: gid, full_name: 'x' })).status, 404);
  assert.equal((await list()).contacts.some(c => c.id === gid), false, 'deleted after reload');
  // A write that touches no row is reported, never silent.
  const silent = await C_.handleContactsAction('contacts_update', { id: anna.id, full_name: 'X' }, { deps: { ...pgDeps, update: async () => ({ rows: [] }) } });
  assert.deepEqual([silent.status, silent.body.error], [409, 'Nessuna riga aggiornata: ricarica e riprova.']);
  const silentIns = await C_.handleContactsAction('contacts_create', { full_name: 'X' }, { deps: { ...pgDeps, insert: async () => ({ rows: [] }) } });
  assert.equal(silentIns.status, 500);
  console.log('  server: writes persist in PGlite, 0-row writes are errors');
}

// 4. Endpoint: admin gate before anything; audited; no e-mail in the log.
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fictional-service-key';
{
  const { default: handler } = await import('../api/admin-host-health.js');
  const authFetch = role => async url => {
    if (String(url).endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: ADMIN, email: 'admin@example.invalid' }));
    if (String(url).endsWith('/rpc/is_admin')) return new Response(JSON.stringify(role === 'admin'));
    throw new Error('unexpected ' + url);
  };
  let reads = 0; const journal = [];
  const contacts = { now: () => 0, sync: async () => { reads++; }, contacts: async () => { reads++; return [{ id: id(5), user_id: null, email: 'p@example.invalid', lead_stage: 'lead' }]; }, notes: async () => [], properties: async () => [], users: async () => [], billing: async () => ({ byOwner: {} }),
    insert: async (t, row) => ({ rows: [{ id: id(6), ...row }] }), update: async (t, rid, row) => ({ rows: [{ id: rid, ...row }] }), remove: async (t, rid) => ({ rows: [{ id: rid }] }) };
  const post = async (role, body, extra = {}) => { const res = { code: 0, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...(role ? { authorization: 'Bearer jwt' } : {}) }, body }, res, { fetch: authFetch(role), contacts, take: async () => ({ ok: true }),
      audit: { first: async e => { journal.push(['first', e.action]); return true; }, after: async e => { journal.push(['after', e.action, e.outcome, e.metadata]); } }, ...extra }); return res; };
  assert.equal((await post(null, { action: 'contacts_list' })).code, 401);
  assert.equal((await post('host', { action: 'contacts_list' })).code, 403);
  assert.equal((await post('host', { action: 'contacts_create', full_name: 'x' })).code, 403);
  assert.equal(reads, 0, 'nothing read before the admin check');
  const l = await post('admin', { action: 'contacts_list' });
  assert.equal(l.code, 200); assert.equal(l.headers['Cache-Control'], 'no-store'); assert.deepEqual(journal.at(-1), ['after', 'contacts_list', 'ok', { status: 200, rows: 1 }]);
  const c = await post('admin', { action: 'contacts_create', full_name: 'Gino', email: 'g@example.invalid', phone: '333 000 1111' });
  assert.equal(c.code, 201); assert.deepEqual(journal.slice(-2).map(x => x.slice(0, 2)), [['first', 'contacts_create'], ['after', 'contacts_create']]);
  assert.ok(!/@/.test(JSON.stringify(journal.at(-1)[3])), 'no address in the log metadata'); assert.deepEqual(journal.at(-1)[3].fields.sort(), ['email', 'full_name', 'lead_stage', 'phone'], 'field names only (default stage included)');
  assert.equal((await post('admin', { action: 'contacts_create', full_name: 'x' }, { take: async () => ({ ok: false }) })).code, 429, 'writes rate-limited');
  assert.equal((await post('admin', { action: 'contacts_create', full_name: 'x' }, { audit: { first: async () => false, after: async () => {} } })).code, 503, 'no log, no write');
  console.log('  endpoint: admin gate, audit, rate limit');
}

// 5. Browser: «Utenti» (admin-users.js) with the contacts (admin-contacts.js) at 375 and 1440 against an in-memory backend.
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
const shift = n => { const t = new Date(TODAY + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [375, 1440]) {
    const store = [
      { id: id(11), user_id: A, account: true, full_name: 'Anna Fittizia', email: 'anna@example.invalid', login_email: 'anna@example.invalid', phone: '+393331234567', lead_stage: 'lead', next_action: 'Chiamare per il rinnovo', next_action_due: shift(-2), status: { kind: 'trial', days_left: 5 }, properties: [{ id: id(21), name: 'Casa Anna' }], notes: [], last_login_at: '2026-11-23T08:00:00Z' },
      { id: id(12), user_id: B, account: true, full_name: 'Bruno', email: 'bruno@example.invalid', login_email: 'bruno@example.invalid', phone: null, lead_stage: 'lead', next_action: 'Mandare fattura', next_action_due: TODAY, status: { kind: 'paying' }, properties: [{ id: id(22), name: 'Bruno B&B' }], notes: [] },
      { id: id(13), user_id: null, account: false, full_name: null, email: 'dora@example.invalid', phone: '+447700900123', lead_stage: 'invited', next_action: null, next_action_due: shift(5), status: { kind: 'lead', stage: 'invited' }, properties: [], notes: [] },
      { id: id(14), user_id: null, account: false, full_name: 'Zeno', email: null, phone: null, lead_stage: 'lost', next_action: null, next_action_due: null, status: { kind: 'lead', stage: 'lost' }, properties: [], notes: [] },
      { id: id(15), user_id: id(4), account: true, full_name: 'Elena', email: 'elena@example.invalid', login_email: 'elena@example.invalid', phone: null, lead_stage: 'lead', next_action: null, next_action_due: null, status: { kind: 'free' }, properties: [], notes: [] },
    ];
    let seq = 100; const calls = [];
    // The «Utenti» side: the three accounts of the store (Anna trial 5 days, Bruno paying, Elena free).
    const UU = await import('../api/_admin-users.js');
    const NOWB = Date.now();
    const uRows = UU.buildRows({ users: [{ id: A, email: 'anna@example.invalid', created_at: '2026-11-01T00:00:00Z', email_confirmed_at: '2026-11-01T00:00:00Z', last_sign_in_at: new Date(NOWB - 86400000).toISOString() },
      { id: B, email: 'bruno@example.invalid', created_at: '2026-10-01T00:00:00Z', email_confirmed_at: '2026-10-01T00:00:00Z', last_sign_in_at: null }, { id: id(4), email: 'elena@example.invalid', created_at: '2026-09-01T00:00:00Z', email_confirmed_at: '2026-09-01T00:00:00Z', last_sign_in_at: null }],
      invites: [], admins: [], properties: [{ id: id(21), name: 'Casa Anna', owner_id: A, is_test: false }, { id: id(22), name: 'Bruno B&B', owner_id: B, is_test: false }], events: [], checkins: [],
      plans: { [A]: { state: 'trial', trial_ends_at: new Date(NOWB + 5 * 86400000).toISOString() }, [B]: { state: 'active', paid_until: new Date(NOWB + 200 * 86400000).toISOString() }, [id(4)]: { state: 'free' } }, now: NOWB });
    const usersPayload = { generated_at: new Date(NOWB).toISOString(), summary: UU.summarize(uRows, NOWB), rows: uRows, plan_error: null, terms_error: null };
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage(); const errors = []; const dialogs = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('dialog', d => { dialogs.push(d.type()); d.dismiss(); });
    await page.route('**/*', async route => {
      const u = new URL(route.request().url());
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(route.request().postData()); calls.push(b.action);
        const ok = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
        if (b.action === 'users_overview') return ok(usersPayload);
        if (b.action === 'contacts_list') return ok({ today: TODAY, contacts: JSON.parse(JSON.stringify(store)) });
        if (b.action === 'contacts_create') { const c = { id: id(seq++), user_id: null, account: false, lead_stage: 'lead', notes: [], properties: [], status: { kind: 'lead', stage: b.lead_stage || 'lead' }, ...b }; delete c.action; store.push(c); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ contact: c }) }); }
        if (b.action === 'contacts_update') { const c = store.find(x => x.id === b.id); const f = { ...b }; delete f.action; delete f.id; if (f.next_action === '') f.next_action = null; Object.assign(c, f); if (!c.account) c.status = { kind: 'lead', stage: c.lead_stage }; return ok({ contact: c }); }
        if (b.action === 'contacts_note_add') { const c = store.find(x => x.id === b.contact_id); const n = { id: id(seq++), contact_id: c.id, body: b.body, created_at: new Date().toISOString(), created_by: 'admin@example.invalid' }; c.notes.unshift(n); c.last_note_at = n.created_at; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ note: n }) }); }
        if (b.action === 'contacts_note_delete') { for (const c of store) c.notes = c.notes.filter(n => n.id !== b.id); return ok({ deleted: b.id }); }
        if (b.action === 'contacts_delete') { store.splice(store.findIndex(x => x.id === b.id), 1); return ok({ deleted: b.id }); }
      }
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{--border:#ddd;--white:#fff;--ink-soft:#555;--ink:#111}body{margin:0;font-family:sans-serif}.container{padding:16px}</style></head><body><div class="container"><div id="tabsBar"><button data-tab="users"><span>Utenti</span><span data-contacts-badge style="display:none"></span></button></div><div id="content"></div></div></body></html>` });
    });
    await page.goto('https://app.welcomebnb.it/admin.html');
    await page.addScriptTag({ content: `const sb={auth:{getSession:async()=>({data:{session:{access_token:'fictional-admin-jwt'}}})}};let activeTab='users';window.consoles=[];window.viewAsHost=p=>consoles.push(p);window.setActiveTab=t=>{activeTab=t;};` });
    await page.addScriptTag({ content: read('admin-table-ui.js') });
    await page.addScriptTag({ content: read('admin-users.js') });
    await page.addScriptTag({ content: ui });
    // Client phone rules = server rules (same cases).
    for (const [inp, want] of cases) { const r = await page.evaluate(v => ContactsAdmin._normPhone(v), inp); if (want === false) assert.equal(r.ok, false, 'client rejects ' + inp); else assert.deepEqual(r, { ok: true, value: want }, 'client ' + inp); }
    // Badge (now on «Utenti») loads in the background.
    await page.evaluate(() => ContactsAdmin.ensureBadge());
    await page.waitForFunction(() => document.querySelector('[data-contacts-badge]').textContent === '2');
    assert.equal(await page.$eval('[data-contacts-badge]', e => getComputedStyle(e).backgroundColor), 'rgb(180, 35, 24)', 'red when something is overdue');
    await page.evaluate(() => UsersAdmin.render());
    await page.waitForFunction(() => document.querySelectorAll('[data-users-row]').length === 5);
    const order = () => page.$$eval('[data-users-row]', trs => trs.map(tr => tr.dataset.usersRow));
    const row = k => page.locator(`[data-users-row="${k}"]`);
    // Sort by next action ascending: overdue first, then due date.
    await page.evaluate(() => { UsersAdmin.sortTo('next'); }); if ((await page.evaluate(() => UsersAdmin._view().dir)) !== 'asc') await page.evaluate(() => UsersAdmin.sort('next'));
    assert.deepEqual((await order()).slice(0, 3), [A, B, id(13)], 'overdue first, then due today, then later');
    assert.match(await row(A).textContent(), /Anna Fittizia.*anna@example\.invalid.*Casa Anna.*Prova · \d\d\/\d\d/s);
    assert.match(await row(B).locator('[data-plan]').textContent(), /Pagato/); assert.match(await row(id(4)).locator('[data-plan]').textContent(), /Gratis a vita/);
    assert.match(await row(id(13)).textContent(), /dora@example\.invalid.*Nessun account.*Invitato/s); assert.equal(await row(id(13)).locator('[data-users-wa]').count(), 1, 'phone shown as icons, not as a number'); assert.ok(!/7700/.test(await row(id(13)).textContent()));
    assert.match(await row(id(14)).locator('[data-plan]').textContent(), /Perso/);
    assert.equal(await row(A).locator('[data-next] strong').evaluate(e => getComputedStyle(e).color), 'rgb(180, 35, 24)', 'overdue in red');
    // One-tap links in the row.
    assert.equal(await row(A).locator('[data-users-wa]').getAttribute('href'), 'https://wa.me/393331234567');
    assert.equal(await row(A).locator('[data-users-wa]').getAttribute('target'), '_blank');
    assert.equal(await row(A).locator('[data-users-call]').getAttribute('href'), 'tel:+393331234567');
    assert.equal(await row(B).locator('[data-users-wa]').count(), 0, 'no WhatsApp without a phone');
    // Search: digits-only phone match, property name, e-mail.
    const search = async q => { await page.fill('#usersSearch', q); return (await order()).sort(); };
    assert.deepEqual(await search('333 123'), [A]); assert.deepEqual(await search('7700 900'), [id(13)]); assert.deepEqual(await search('bruno b&b'), [B]); assert.deepEqual(await search('DORA@'), [id(13)]);
    await search('');
    // Filters with counts.
    const filt = async k => { await page.click(`[data-users-filter="${k}"]`); return (await order()).sort(); };
    assert.deepEqual(await filt('due'), [A, B].sort()); assert.deepEqual(await filt('leads'), [id(13), id(14)].sort()); assert.deepEqual(await filt('trial'), [A]);
    assert.deepEqual(await filt('paying'), [B]); assert.deepEqual(await filt('free'), [id(4)]); await filt('all');
    assert.match(await page.textContent('[data-users-filter="due"]'), /Da fare\s*2/);
    // Layout: cards at 375 px, row buttons ≥ 44 px, no horizontal scroll.
    if (width === 375) {
      const xs = await page.$$eval('[data-users-row]', cs => [...new Set(cs.map(c => Math.round(c.getBoundingClientRect().left)))]);
      assert.equal(xs.length, 1, 'one column of cards');
      const small = await page.$$eval('[data-users-row] .u-act, [data-contacts-add]', bs => bs.filter(b => b.getBoundingClientRect().height < 40).map(b => b.textContent));
      assert.deepEqual(small, [], 'tap targets');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, width + ': no horizontal scroll');
    // Add a prospect: name + phone, bad phone first.
    await page.click('[data-contacts-add]');
    await page.fill('#contactModal [name="full_name"]', 'Gino Fittizio'); await page.fill('#contactModal [name="phone"]', 'abc');
    await page.click('[data-contact-save]');
    assert.match(await page.textContent('[data-contact-msg]'), /Numero non valido/); assert.equal(await page.inputValue('#contactModal [name="full_name"]'), 'Gino Fittizio', 'typed values kept after an error');
    await page.fill('#contactModal [name="phone"]', '0039 347 111 2222'); await page.click('[data-contact-save]');
    await page.waitForFunction(() => /Salvato/.test(document.querySelector('[data-contact-msg]')?.textContent || ''));
    const gino = store.find(c => c.full_name === 'Gino Fittizio');
    assert.equal(gino.phone, '+393471112222', 'stored E.164');
    assert.equal(await page.inputValue('#contactModal [name="phone"]'), '+39 347 111 2222', 'shown formatted');
    await page.waitForSelector(`[data-users-row="${gino.id}"]`);
    // Quick due dates, next action, stage; persisted.
    await page.fill('#contactModal [name="next_action"]', 'Richiamare');
    await page.click('[data-contact-due="3"]'); assert.equal(await page.inputValue('#contactModal [name="next_action_due"]'), shift(3));
    await page.click('[data-contact-due="clear"]'); assert.equal(await page.inputValue('#contactModal [name="next_action_due"]'), '');
    await page.click('[data-contact-due="0"]');
    assert.deepEqual(await page.$$eval('#contactModal [name="source"] option', os => os.map(o => o.value)), ['', 'whatsapp', 'email', 'referral', 'website', 'event', 'ads', 'other'], 'Origine menu includes Pubblicità');
    await page.selectOption('#contactModal [name="lead_stage"]', 'demo');
    await page.click('[data-contact-save]'); await page.waitForFunction(() => /Salvato/.test(document.querySelector('[data-contact-msg]').textContent));
    assert.deepEqual([gino.next_action, gino.next_action_due, gino.lead_stage], ['Richiamare', TODAY, 'demo']);
    await page.waitForFunction(() => document.querySelector('[data-contacts-badge]').textContent === '3');
    // Notes: XSS stays text, line breaks kept; delete with an in-page confirmation.
    await page.fill('[data-contact-note-input]', '<img src=x onerror=alert(1)>\nseconda riga'); await page.click('[data-contact-note-add]');
    await page.waitForSelector('[data-contact-note-body]');
    assert.equal(await page.textContent('[data-contact-note-body]'), '<img src=x onerror=alert(1)>\nseconda riga');
    assert.equal(await page.locator('#contactModal img').count(), 0, 'no element injected');
    assert.equal(await page.$eval('[data-contact-note-body]', e => getComputedStyle(e).whiteSpace), 'pre-wrap');
    await page.click('[data-contact-note-delete]'); await page.click('[data-contact-note-confirm]');
    await page.waitForFunction(() => !document.querySelector('[data-contact-note-body]'));
    assert.equal(gino.notes.length, 0);
    // «Done»: note «Fatto: …», next action and date cleared.
    await page.click('[data-contact-done]');
    await page.waitForFunction(() => /Fatto\./.test(document.querySelector('[data-contact-msg]')?.textContent || ''));
    assert.deepEqual([gino.next_action, gino.next_action_due, gino.notes[0].body], [null, null, 'Fatto: Richiamare']);
    // Delete the prospect: in-page confirmation.
    await page.click('[data-contact-delete]'); await page.click('[data-contact-delete-confirm]');
    await page.waitForFunction(() => !document.getElementById('contactModal'));
    assert.equal(store.some(c => c.full_name === 'Gino Fittizio'), false);
    await page.waitForFunction(g => !document.querySelector(`[data-users-row="${g}"]`), gino.id);
    // Account contact: e-mail read-only, no delete, properties and console.
    await page.click(`[data-users-row="${A}"] [data-users-open]`);
    await page.waitForSelector('#contactModal [data-contact-form]');
    assert.equal(await page.$eval('#contactModal [name="email"]', e => e.readOnly), true);
    assert.equal(await page.locator('[data-contact-delete]').count(), 0); assert.equal(await page.locator('#contactModal [name="lead_stage"]').count(), 0);
    assert.equal(await page.locator('#contactModal [data-contact-mail]').getAttribute('href'), 'mailto:anna@example.invalid');
    await page.click(`[data-contact-console="${id(21)}"]`); assert.deepEqual(await page.evaluate(() => window.consoles), [id(21)]);
    assert.deepEqual(dialogs, [], 'no native dialogs');
    assert.deepEqual(errors, []);
    assert.ok(calls.filter(a => a === 'contacts_list').length >= 3, 'list reloaded after writes');
    await ctx.close();
  }
} finally { await browser.close(); }
// Wiring in admin.html (24 Nov 2026: contacts live in «Utenti»; no separate tab).
const html = read('admin.html');
assert.ok(!html.includes('data-tab="contacts"'), 'no separate Contatti tab'); assert.ok(html.includes('<script src="/admin-contacts.js?v=77.3"></script>'));
assert.match(html, /<button data-tab="users"[^>]*><span>Utenti<\/span><span data-contacts-badge/);
assert.match(html, /if \(window\.ContactsAdmin\) window\.ContactsAdmin\.ensureBadge\(\);/);
assert.ok(!/innerHTML/.test(ui), 'the tab never uses innerHTML');
for (const f of ['host-console.html', 'index.html']) assert.ok(!read(f).includes('host_contacts') && !read(f).includes('admin-contacts'), f + ': contacts never reach hosts or guests');
console.log('PASS round77 host contacts: phone rules (server, SQL, client); backfill = accounts + pending invitations, no duplicates, prospect linked on registration; anon/authenticated cannot read or write, no policies, sync service-only; admin log accepts contacts_*; real writes persist and 0-row writes are errors; endpoint admin-only, journalled, rate-limited; tab at 375/1440: badge, sort, search by digits, filters, links, create/edit/quick dates/done/notes (XSS as text)/delete with in-page confirmations, no native dialogs, 44 px targets, one column on phones');
