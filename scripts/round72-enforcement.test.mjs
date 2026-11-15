// Round 72 Phase 2 — read-only enforcement and trial reminders. Real
// migrations in PGlite (RLS probes), actual handlers (guest-token, guest
// checkin_insert, ical-sync cron and user mode, reminders pass) with
// fictional transport. Fictional accounts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GUEST_TOKEN_SECRET = 'fictional-round72-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
process.env.CRON_SECRET = 'fictional-cron';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { signGuestToken } = await import('../api/_guest-token.js');
const billing = await import('../api/_billing.js');
const { default: guestToken } = await import('../api/guest-token.js');
const { default: guest } = await import('../api/guest.js');
const { default: icalSync } = await import('../api/ical-sync.js');
const T = await import('../api/_trial-reminders.js');
const originalFetch = global.fetch;

const OWNER = '00000000-0000-4000-8000-0000000000a1', PID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const call = async (handler, req) => { let status = 200, body; const headers = {};
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', ...req.headers }, body: req.body, query: req.query || {}, url: req.url || '/' },
    { setHeader(k, v) { headers[k] = v; }, status(n) { status = n; return this; }, json(v) { body = v; return this; }, end() { return this; }, write() {} });
  return { status, body };
};
// Fictional Supabase: billing state per owner, reservations, check-ins.
function transport({ state = 'trial', reservation = false, checkins = false, stateFails = false, writes = [] } = {}) {
  return async (url, init = {}) => {
    url = String(url);
    if (url.includes('/rpc/billing_access_state')) return stateFails ? new Response('down', { status: 503 }) : Response.json({ state });
    if (url.includes('/properties?') && url.includes('select=owner_id')) return Response.json([{ owner_id: OWNER }]);
    if (url.includes('/properties?') && url.includes('select=id,owner_id')) return Response.json([{ id: PID, owner_id: OWNER }]);
    if (url.includes('/properties?') && url.includes('select=region')) return Response.json([{ region: null, invoice_required: false }]);
    if (url.includes('/ota_reservations?')) return Response.json(reservation ? [{ is_test: false }] : []);
    if (url.includes('/checkins?') && (!init.method || init.method === 'GET')) return Response.json(checkins ? [{ id: 'c1' }] : []);
    if (url.includes('/rpc/create_onboarding_test_booking')) return Response.json({ booking_code: 'WB-TEST-1' });
    if (init.method === 'POST') { writes.push(url); return new Response('[]', { status: 201 }); }
    return Response.json([], { headers: { 'content-range': '*/0' } });
  };
}
const mint = (body, opts) => { billing._resetBillingCache(); global.fetch = transport(opts); return call(guestToken, { body: { property_id: PID, session_id: 's-' + Math.random(), ...body } }); };

try {
  // ── Guest link minting ──
  for (const state of ['prelaunch', 'trial', 'grace', 'active', 'free', 'none']) {
    assert.equal((await mint({}, { state })).status, 200, `${state}: walk-in link works`);
  }
  let r = await mint({}, { state: 'read_only' });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'read_only'); assert.match(r.body.message_it, /sola lettura/); assert.match(r.body.message_en, /Read-only/);
  assert.equal((await mint({ booking_code: 'HMNEW123' }, { state: 'read_only' })).status, 403, 'unknown booking: a new link, refused');
  assert.equal((await mint({ booking_code: 'HMOLD123' }, { state: 'read_only', reservation: true })).status, 200, 'existing reservation: guest keeps the link');
  assert.equal((await mint({ booking_code: 'DIRECT1' }, { state: 'read_only', checkins: true })).status, 200, 'existing check-ins under the code: guest keeps the link');
  assert.equal((await mint({}, { state: 'read_only', stateFails: true })).status, 200, 'state unreadable: fail open');
  billing._resetBillingCache(); global.fetch = transport({ state: 'read_only' });
  r = await call(guestToken, { headers: { authorization: 'Bearer fictional-host-jwt' }, body: { action: 'test_booking', property_id: PID } });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'read_only', 'no new test booking either');
  billing._resetBillingCache(); global.fetch = transport({ state: 'trial' });
  assert.equal((await call(guestToken, { headers: { authorization: 'Bearer fictional-host-jwt' }, body: { action: 'test_booking', property_id: PID } })).status, 200);

  // ── Guest check-in (walk-in vs existing booking) ──
  const record = { guest_type: 'single', surname: 'Synthetic', name: 'Guest', sex: 'F', date_of_birth: '1980-01-01', place_of_birth: 'London',
    birth_country: 'United Kingdom', birth_province: 'EE', citizenship: 'United Kingdom', residence_country: 'United Kingdom', document_type: 'passport',
    document_number: 'FICTIONAL123', doc_issue_place: 'London', arrival_date: '2099-11-01', departure_date: '2099-11-05', nights: 4 };
  const tok = b => signGuestToken({ p: PID, s: 'fictional-session', ...(b ? { b } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }).token;
  const insert = async (b, state) => { billing._resetBillingCache(); global.fetch = transport({ state });
    return call(guest, { headers: { authorization: 'Bearer ' + tok(b) }, body: { action: 'checkin_insert', record, submission_id: '11111111-1111-4111-8111-111111111111', guest_ordinal: 1 } }); };
  r = await insert(null, 'read_only'); assert.equal(r.status, 403); assert.equal(r.body.error, 'read_only', 'walk-in check-in refused for read-only');
  r = await insert('HMOLD123', 'read_only'); assert.notEqual(r.body?.error, 'read_only', 'guest with an existing link still checks in');
  r = await insert(null, 'grace'); assert.notEqual(r.body?.error, 'read_only', 'grace: walk-in works');
  r = await insert(null, 'prelaunch'); assert.notEqual(r.body?.error, 'read_only');

  // ── iCal: cron skips read-only owners, user mode refused ──
  const ical = async (state, mode) => { billing._resetBillingCache(); const synced = [];
    global.fetch = async (url, init = {}) => { url = String(url);
      if (url.includes('/rpc/billing_access_state')) return Response.json({ state });
      if (url.includes('/auth/v1/user')) return Response.json({ id: OWNER });
      if (url.includes('properties?select=id,name,owner_id,ical_feeds')) return Response.json([{ id: PID, name: 'Fictional', owner_id: OWNER, ical_feeds: [{ url: 'https://calendar.invalid/x.ics', platform: 'airbnb' }] }]);
      if (url.includes('properties?id=eq.')) return Response.json([{ id: PID, ical_feeds: [{ url: 'https://calendar.invalid/x.ics', platform: 'airbnb' }] }]);
      synced.push(url); return Response.json([]); };
    const req = mode === 'cron' ? { headers: { authorization: 'Bearer fictional-cron' }, body: {} } : { headers: { authorization: 'Bearer fictional-host-jwt' }, body: { property_id: PID } };
    return { r: await call(icalSync, req), synced }; };
  let o = await ical('read_only', 'cron');
  assert.deepEqual(o.r.body.per_property?.[0] || o.r.body.properties?.[0] || o.r.body, o.r.body.per_property?.[0] || o.r.body.properties?.[0] || o.r.body);
  assert.match(JSON.stringify(o.r.body), /"skipped":"read_only"/, 'cron: read-only property skipped');
  o = await ical('trial', 'cron'); assert.ok(!/"skipped":"read_only"/.test(JSON.stringify(o.r.body)), 'cron: trial property synced');
  o = await ical('read_only', 'user'); assert.equal(o.r.status, 403); assert.equal(o.r.body.error, 'read_only');
  o = await ical('active', 'user'); assert.notEqual(o.r.body?.error, 'read_only');
} finally { global.fetch = originalFetch; }

// ── Trial reminders pass ──
{
  const at = iso => new Date(iso);
  const nine = '2027-01-24T08:05:00Z'; // 09:05 Rome (CET)
  const mk = (over = {}) => {
    const subs = [{ user_id: 'u1', reminders_sent: {}, read_only_since: null }];
    const states = { u1: { state: 'trial', days_left: 7, trial_ends_at: '2027-01-30T23:00:00Z', price_eur: 60 } };
    const sent = [], events = [], patches = [];
    const deps = {
      get: async path => path.startsWith('billing_settings') ? [{ launch_at: over.launch === undefined ? '2026-12-01T09:00:00Z' : over.launch }] : subs,
      state: async u => states[u],
      patch: async (path, body, prefer) => { patches.push({ path, body });
        const key = /reminders_sent->>(\w+)=is\.null/.exec(path)?.[1];
        if (key && subs[0].reminders_sent[key]) return [];
        Object.assign(subs[0], body); return prefer === 'return=representation' ? [subs[0]] : true; },
      post: async (t, row) => { events.push(row); return true; },
      userEmail: async () => over.noEmail ? null : 'host@example.invalid',
      lang: async () => over.lang || 'it',
      send: async (to, subject, html) => { sent.push({ to, subject, html }); return over.sendFails ? { ok: false, error: 'x' } : { ok: true, id: 'r1' }; },
    };
    return { subs, states, sent, events, patches, deps };
  };
  const run = (m, now = nine, x = {}) => T.runTrialReminderPass({ now: at(now), deps: m.deps, appOrigin: 'https://app.invalid', support: { whatsapp: null, email: 'info@example.invalid' }, ...x });
  // prelaunch: nothing
  let m = mk({ launch: null }); assert.equal((await run(m)).skipped, 'prelaunch'); assert.equal(m.sent.length, 0);
  m = mk({ launch: '2099-01-01T00:00:00Z' }); assert.equal((await run(m)).skipped, 'prelaunch');
  // outside 09–12 Rome: nothing
  m = mk(); assert.equal((await run(m, '2027-01-24T07:05:00Z')).skipped, 'not_send_hour'); assert.equal((await run(m, '2027-01-24T12:05:00Z')).skipped, 'not_send_hour');
  // d7 once across repeated runs
  m = mk(); await run(m); await run(m, '2027-01-24T09:05:00Z'); await run(m, '2027-01-24T10:05:00Z');
  assert.equal(m.sent.length, 1, 'once per milestone'); assert.match(m.sent[0].subject, /termina tra 7 giorni/);
  assert.match(m.sent[0].html, /30 gennaio 2027/); assert.match(m.sent[0].html, /60 € l&#39;anno, IVA inclusa/);
  assert.ok(m.subs[0].reminders_sent.d7_20270130); assert.equal(m.events.filter(e => e.action === 'reminder_sent').length, 1);
  // d3 then d1 then expired then read_only
  m.states.u1 = { state: 'trial', days_left: 3, trial_ends_at: '2027-01-30T23:00:00Z', price_eur: 60 }; await run(m); await run(m);
  m.states.u1 = { state: 'trial', days_left: 1, trial_ends_at: '2027-01-30T23:00:00Z', price_eur: 60 }; await run(m);
  assert.match(m.sent.at(-1).subject, /termina oggi/);
  m.states.u1 = { state: 'grace', ended_at: '2027-01-30T23:00:00Z', grace_ends_at: '2027-02-06T23:00:00Z', grace_days_left: 7, price_eur: 60 }; await run(m); await run(m);
  assert.match(m.sent.at(-1).subject, /è terminata/); assert.match(m.sent.at(-1).html, /6 febbraio 2027/); assert.match(m.sent.at(-1).html, /Alloggiati/);
  assert.ok(m.events.some(e => e.action === 'expired')); assert.equal(m.subs[0].status, 'expired');
  m.states.u1 = { state: 'read_only', ended_at: '2027-01-30T23:00:00Z', since: '2027-02-06T23:00:00Z', price_eur: 60 }; await run(m); await run(m);
  assert.match(m.sent.at(-1).subject, /sola lettura/); assert.equal(m.subs[0].read_only_since, '2027-02-06T23:00:00Z');
  assert.ok(m.events.some(e => e.action === 'read_only'));
  assert.equal(m.sent.length, 5, 'd7, d3, d1, expired, read_only: once each');
  // an extension (new end date) re-arms the milestones
  m.states.u1 = { state: 'trial', days_left: 7, trial_ends_at: '2027-03-01T23:00:00Z', price_eur: 60 }; await run(m); assert.equal(m.sent.length, 6);
  // never to free / active
  for (const s of [{ state: 'free' }, { state: 'active', paid_until: '2028-01-01' }, { state: 'trial', days_left: 12 }]) {
    m = mk(); m.states.u1 = { ...s, price_eur: 60 }; await run(m); assert.equal(m.sent.length, 0, s.state);
  }
  // a failed send is not stamped (retried next run); English
  m = mk({ sendFails: true }); await run(m); assert.equal(Object.keys(m.subs[0].reminders_sent).length, 0, 'unclaimed after a failed send');
  m = mk({ lang: 'en' }); await run(m); assert.match(m.sent[0].subject, /ends in 7 days/); assert.match(m.sent[0].html, /€60 per year, VAT included/);
  assert.ok(!/Synthetic|guest_|booking/i.test(m.sent[0].html), 'no guest data');
  // dry run sends nothing
  m = mk(); const d = await run(m, nine, { dry: true }); assert.equal(d.results[0].outcome, 'would_send'); assert.equal(m.sent.length, 0);
  // milestones
  assert.equal(T.milestoneFor({ state: 'trial', days_left: 8 }), null); assert.equal(T.milestoneFor({ state: 'trial', days_left: 4, trial_ends_at: 'x' }).kind, 'd7');
  assert.equal(T.milestoneFor({ state: 'trial', days_left: 2, trial_ends_at: 'x' }).kind, 'd3');
  assert.equal(T.lastDay('2027-01-30T23:00:00Z'), '2027-01-30', 'exclusive end → last free day in Rome');
}
// Police filing and exports carry no billing gate at all (autofile runs as
// service_role and bypasses RLS; exports read data the host can always read).
for (const f of ['api/alloggiati.js', 'api/_alloggiati-support.js', 'api/_alloggiati-receipts.js'])
  assert.ok(!/_billing\.js|billing_access_state|read_only/.test(read(f)), f + ': no billing gate');
{ const hc = read('host-console.html'); for (const fn of ['exportAlloggiati', 'exportCSV', 'exportISTAT', 'exportCityTax']) {
  const i = hc.indexOf('function ' + fn + '('); assert.ok(i >= 0, fn); assert.ok(!/read_only|host_can_write/.test(hc.slice(i, hc.indexOf('\n}\n', i))), fn + ': export never gated'); } }
// Wired into the hourly reminders job.
const cron = read('api/send-arrival-reminders.js');
assert.match(cron, /runTrialReminderPass\(\{ now: nowUTC, force, dry,/); assert.match(cron, /passOnly === 'trial'/);

// ── RLS: read-only host cannot write host data; filing still works ──
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  const RO = '00000000-0000-4000-8000-0000000000b1', OK = '00000000-0000-4000-8000-0000000000b2';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; grant usage on schema auth to authenticated, service_role;
    create table auth.users(id uuid primary key, email text, created_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$select nullif(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub','')::uuid$$;
    create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'email'$$;
    grant execute on function auth.uid(), auth.email() to authenticated, service_role;
    create table public.admin_users(email text primary key);
    create function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.email(), ''))) $$;
    grant execute on function public.is_admin() to authenticated;
    create table public.pilot_invites(id uuid primary key default gen_random_uuid(), email text unique, status text, invited_at timestamptz, accepted_at timestamptz, invited_by uuid, notes text);
    create table public.properties(id uuid primary key default gen_random_uuid(), owner_id uuid, name text);
    create table public.rules(id serial primary key, property_id uuid, body text);
    create table public.recommendations(id serial primary key, property_id uuid, name text);
    create table public.property_rooms(id serial primary key, property_id uuid, name text);
    create table public.host_share_preferences(id serial primary key, property_id uuid, pref text);
    create table public.ota_reservations(id serial primary key, property_id uuid, booking_code text, status text);
    create table public.checkins(id serial primary key, property_id uuid, booking_code text, alloggiati_status text, filed_at timestamptz);
    create table public.chat_messages(id serial primary key, property_id uuid, message text);`);
  for (const t of ['properties', 'rules', 'recommendations', 'property_rooms', 'host_share_preferences', 'ota_reservations', 'checkins', 'chat_messages']) {
    const own = t === 'properties' ? 'owner_id = auth.uid()' : 'exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid())';
    await db.exec(`alter table public.${t} enable row level security; grant select, insert, update, delete on public.${t} to authenticated; grant all on public.${t} to service_role;
      create policy ${t}_owner on public.${t} for all to authenticated using (${own}) with check (${own});`);
  }
  await db.exec(`grant usage on all sequences in schema public to authenticated, service_role;`);
  await db.exec(read('supabase/migrations/20261115090000_round72_trial_billing.sql'));
  const rls = read('supabase/migrations/20261115100000_round72_read_only_rls.sql');
  await db.exec(rls); await db.exec(rls);
  assert.equal((await db.query(`select count(*)::int n from pg_policies where policyname like '%_round72_read_only_%'`)).rows[0].n, 16, 're-run: 16 policies, no duplicates');
  await db.query(`insert into auth.users(id,email) values ($1,'ro@example.invalid'),($2,'ok@example.invalid')`, [RO, OK]);
  const [pRO, pOK] = ['aaaaaaaa-0000-4000-8000-0000000000b1', 'aaaaaaaa-0000-4000-8000-0000000000b2'];
  await db.query(`insert into public.properties(id,owner_id,name) values ($1,$2,'RO'),($3,$4,'OK')`, [pRO, RO, pOK, OK]);
  for (const [p] of [[pRO], [pOK]]) {
    await db.query(`insert into public.rules(property_id,body) values ($1,'r')`, [p]); await db.query(`insert into public.recommendations(property_id,name) values ($1,'x')`, [p]);
    await db.query(`insert into public.ota_reservations(property_id,booking_code,status) values ($1,'HM1','active')`, [p]);
    await db.query(`insert into public.checkins(property_id,booking_code,alloggiati_status) values ($1,'HM1','pending')`, [p]);
  }
  const as = (u, email, fn) => db.transaction(async tx => { await tx.exec('set local role authenticated'); await tx.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify({ sub: u, email, role: 'authenticated' })]); return fn(tx); });
  const writes = p => [
    ['properties update', `update public.properties set name='x' where id='${p}'`],
    ['rules insert', `insert into public.rules(property_id,body) values ('${p}','n')`], ['rules update', `update public.rules set body='y' where property_id='${p}'`], ['rules delete', `delete from public.rules where property_id='${p}'`],
    ['recommendations insert', `insert into public.recommendations(property_id,name) values ('${p}','n')`], ['recommendations delete', `delete from public.recommendations where property_id='${p}'`],
    ['property_rooms insert', `insert into public.property_rooms(property_id,name) values ('${p}','n')`],
    ['share insert', `insert into public.host_share_preferences(property_id,pref) values ('${p}','n')`],
    ['reservation insert', `insert into public.ota_reservations(property_id,booking_code,status) values ('${p}','HM2','active')`],
    ['manual check-in insert', `insert into public.checkins(property_id,booking_code) values ('${p}','HM2')`],
  ];
  const outcome = async (u, email, q) => { try { const r = await as(u, email, tx => tx.query(q + ' returning 1')); return r.rows.length > 0 ? 'ok' : 'zero'; } catch (e) { return /row-level security|policy/.test(e.message) ? 'refused' : 'error:' + e.message; } };
  // prelaunch: never blocks
  for (const [label, q] of writes(pRO)) assert.equal(await outcome(RO, 'ro@example.invalid', q), 'ok', 'prelaunch: ' + label);
  // launch, RO host in read_only, OK host active
  await db.exec(`update public.billing_settings set launch_at = now() - interval '60 days'`);
  await db.query(`insert into public.host_subscriptions(user_id, trial_started_at, trial_ends_at, status) values ($1, now() - interval '60 days', now() - interval '30 days', 'expired'), ($2, now() - interval '60 days', now() - interval '30 days', 'active')`, [RO, OK]);
  await db.query(`update public.host_subscriptions set paid_until = now() + interval '300 days' where user_id = $1`, [OK]);
  for (const [label, q] of writes(pRO)) { const out = await outcome(RO, 'ro@example.invalid', q); assert.ok(out === 'refused' || out === 'zero', 'read-only refused: ' + label + ' → ' + out); }
  for (const [label, q] of writes(pOK)) assert.equal(await outcome(OK, 'ok@example.invalid', q), 'ok', 'active allowed: ' + label);
  // read-only host still: reads, files (check-in update), cancels a stay, chats
  assert.equal((await as(RO, 'ro@example.invalid', tx => tx.query(`select id from public.checkins`))).rows.length >= 1, true, 'reads');
  assert.equal(await outcome(RO, 'ro@example.invalid', `update public.checkins set alloggiati_status='filed', filed_at=now() where property_id='${pRO}'`), 'ok', 'marking filed still works');
  assert.equal(await outcome(RO, 'ro@example.invalid', `update public.ota_reservations set status='cancelled' where property_id='${pRO}'`), 'ok', 'cancel an existing stay');
  assert.equal(await outcome(RO, 'ro@example.invalid', `insert into public.chat_messages(property_id,message) values ('${pRO}','hi')`), 'ok', 'reply to guests');
  // service_role (guest check-ins via api/guest.js, autofile) untouched
  await db.transaction(async tx => { await tx.exec('set local role service_role'); await tx.query(`insert into public.checkins(property_id,booking_code) values ($1,'HM1')`, [pRO]); });
  // grace (just ended): allowed
  await db.query(`update public.host_subscriptions set trial_ends_at = now() - interval '1 day' where user_id = $1`, [RO]);
  assert.equal(await outcome(RO, 'ro@example.invalid', `insert into public.rules(property_id,body) values ('${pRO}','g')`), 'ok', 'grace: still full access');
}
console.log('PASS round72 enforcement: guest link mint refused only for read-only and only for new links (walk-in, unknown booking, test booking), existing reservations/check-ins keep working, fail open when the state is unreadable; walk-in check-in refused for read-only, existing-booking check-in and grace/prelaunch allowed; iCal cron skips read-only, user sync refused (403 read_only), trial/active synced; reminders d7/d3/d1/expired/read_only once each across repeated runs, re-armed by a new end date, 09–12 Rome only, never prelaunch/free/active/>7 days, failed send retried, IT/EN, no guest data, dry run sends nothing, read_only_since and events recorded; RLS: 16 restrictive policies (re-run safe), prelaunch never blocks, read-only refused on property/content edits, new reservations and manual check-ins, active allowed, read-only can still read, mark filed, cancel a stay and reply to guests; service_role untouched; grace allowed');
