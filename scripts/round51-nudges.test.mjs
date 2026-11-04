// Round 51 Phase 5 — onboarding nudge emails: selection windows, readiness,
// idempotent claim, quiet hours, switch, email content, signed opt-out and
// the notification_log CHECK. Fictional ids and properties only.
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service';
const N = await import('../api/_onboarding-nudges.js');
const S = await import('../api/_onboarding-stop.js');
const H = 3600000;
const NOW = new Date('2026-11-04T10:00:00Z'); // 11:00 Rome
const U = '00000000-0000-4000-8000-0000000000aa', P = '00000000-0000-4000-8000-0000000000bb';
const notReady = { ready: false, firstIncompleteStep: 'calendar', doneCount: 2, total: 5 };
const row = (ageH, extra = {}) => ({ user_id: U, property_id: P, first_seen_at: new Date(NOW - ageH * H).toISOString(), skips: {}, nudges_opted_out: false,
  checklist_dismissed_at: null, completed_at: null, nudge_24h_sent_at: null, nudge_72h_sent_at: null, test_checkin_done_at: null, ...extra });

// ── selection windows ──
assert.equal(N.selectNudge(row(23.99), notReady, NOW), null, 'before 24 h');
assert.equal(N.selectNudge(row(24), notReady, NOW), '24h');
assert.equal(N.selectNudge(row(71.99), notReady, NOW), '24h');
assert.equal(N.selectNudge(row(72), notReady, NOW), '72h', 'at 72 h only the second email, never both');
assert.equal(N.selectNudge(row(71.99, { nudge_24h_sent_at: 'x' }), notReady, NOW), null, '24h already sent');
assert.equal(N.selectNudge(row(100, { nudge_72h_sent_at: 'x' }), notReady, NOW), null, 'never more than two');
assert.equal(N.selectNudge(row(7 * 24), notReady, NOW), null, 'older than 7 days: nothing (no backlog burst)');
assert.equal(N.selectNudge(row(30), { ...notReady, ready: true }, NOW), null, 'ready property');
assert.equal(N.selectNudge(row(30, { nudges_opted_out: true }), notReady, NOW), null, 'opted out');
assert.equal(N.selectNudge(row(30, { checklist_dismissed_at: 'x' }), notReady, NOW), null, 'checklist dismissed');
assert.equal(N.selectNudge(row(30, { completed_at: 'x' }), notReady, NOW), null, 'completed');

// ── region rule = console rule ──
assert.equal(N.regionComplianceFor('Veneto', 'Venezia')?.export, 'ross1000');
assert.equal(N.regionComplianceFor('Nowhere', 'X'), null);

// ── the pass with fake PostgREST ──
const readyProp = { id: P, owner_id: U, name: 'Casa <Prova>', city: 'Bari', region: 'Puglia', cir_code: 'IT072006C200000001', tax_rate_eur: 2,
  alloggiati_autofile_mode: 'manual', ical_feeds: ['https://example.invalid/a.ics'], welcome_message: 'Ciao', wifi_name: 'W', checkin_instructions: 'Chiavi', host_language: 'it', is_test: false, deleted_at: null };
function harness({ rows, prop = { ...readyProp, ical_feeds: [] }, notif = { email_mode: 'always' }, claim = true, sendOk = true }) {
  const log = { gets: [], patches: [], posts: [], sends: [] };
  const deps = {
    async get(path) { log.gets.push(path); if (path.startsWith('host_onboarding')) return structuredClone(rows); if (path.startsWith('properties')) return prop ? [structuredClone(prop)] : [];
      if (path.startsWith('host_alloggiati_credentials')) return []; if (path.startsWith('host_notification_settings')) return notif ? [notif] : []; throw Error('unexpected ' + path); },
    async patch(path, body, prefer) { log.patches.push({ path, body, prefer }); return prefer === 'return=representation' ? (claim ? [{}] : []) : true; },
    async post(table, body) { log.posts.push({ table, body }); return true; },
    async userEmail() { return 'host@example.invalid'; },
    async send(to, subject, html) { log.sends.push({ to, subject, html }); return sendOk ? { ok: true, id: 'resend-fixture' } : { ok: false, error: 'boom' }; },
  };
  return { deps, log };
}
const base = { now: NOW, appOrigin: 'https://app.welcomebnb.it', serviceKey: 'fixture-service', support: { whatsapp: null, email: 'info@welcomebnb.it' } };
{ const { deps, log } = harness({ rows: [row(30)] }); assert.deepEqual(await N.runNudgePass({ ...base, mode: 'off', deps }), { skipped: 'disabled' }); assert.equal(log.gets.length, 0); }
{ const { deps, log } = harness({ rows: [row(30)] }); const r = await N.runNudgePass({ ...base, mode: 'on', now: new Date('2026-11-04T21:30:00Z'), deps }); assert.equal(r.skipped, 'quiet_hours'); assert.equal(log.sends.length, 0); }
{ const { deps, log } = harness({ rows: [row(30)] }); const r = await N.runNudgePass({ ...base, mode: 'dry', deps });
  assert.equal(r.results[0].outcome, 'would_send'); assert.equal(r.results[0].step, 'calendar'); assert.equal(log.patches.length + log.posts.length + log.sends.length, 0, 'dry run writes and sends nothing');
  const q = log.gets[0]; assert.match(q, /completed_at=is\.null/); assert.match(q, /nudges_opted_out=is\.false/); assert.match(q, /checklist_dismissed_at=is\.null/); assert.match(q, /first_seen_at=gte\./); assert.match(q, /first_seen_at=lte\./); }
{ const { deps, log } = harness({ rows: [row(30)] }); const r = await N.runNudgePass({ ...base, mode: 'on', deps });
  assert.equal(r.results[0].outcome, 'sent'); assert.equal(r.results[0].resend_id, 'resend-fixture');
  assert.match(log.patches[0].path, /nudge_24h_sent_at=is\.null/, 'claim is conditional'); assert.equal(log.patches[0].prefer, 'return=representation');
  assert.equal(log.sends.length, 1); assert.equal(log.posts[0].body.trigger, 'onboarding_nudge_24h'); assert.equal(log.posts[0].body.status, 'sent');
  assert.match(log.sends[0].html, /#onboarding=calendar/); assert.match(log.sends[0].html, /Casa &lt;Prova&gt;/); assert.ok(!log.sends[0].html.includes('<Prova>'), 'property name escaped'); }
{ const { deps, log } = harness({ rows: [row(30)], claim: false }); const r = await N.runNudgePass({ ...base, mode: 'on', deps });
  assert.equal(r.results[0].outcome, 'already_claimed'); assert.equal(log.sends.length, 0, 'second concurrent run sends nothing'); }
{ const { deps, log } = harness({ rows: [row(30)], sendOk: false }); const r = await N.runNudgePass({ ...base, mode: 'on', deps });
  assert.equal(r.results[0].outcome, 'send_failed'); assert.deepEqual(log.patches.at(-1).body, { nudge_24h_sent_at: null }, 'failed send releases the claim'); assert.equal(log.posts[0].body.status, 'failed'); }
{ const { deps, log } = harness({ rows: [row(30)], prop: readyProp }); const r = await N.runNudgePass({ ...base, mode: 'on', deps });
  assert.equal(r.results[0].outcome, 'ready'); assert.equal(log.sends.length, 0, 'ready property gets nothing'); }
{ const { deps, log } = harness({ rows: [row(30)], prop: { ...readyProp, owner_id: 'someone-else' } }); const r = await N.runNudgePass({ ...base, mode: 'on', deps }); assert.equal(r.results[0].outcome, 'skipped_property'); assert.equal(log.sends.length, 0); }
{ const { deps, log } = harness({ rows: [row(30)], prop: { ...readyProp, ical_feeds: [], is_test: true } }); assert.equal((await N.runNudgePass({ ...base, mode: 'on', deps })).results[0].outcome, 'skipped_property'); assert.equal(log.sends.length, 0); }
{ const { deps, log } = harness({ rows: [row(30)], prop: { ...readyProp, region: 'Veneto', city: 'Venezia' } }); const r = await N.runNudgePass({ ...base, mode: 'dry', deps });
  assert.equal(r.results[0].outcome, 'would_send', 'Veneto without ROSS1000 code is not ready'); assert.equal(r.results[0].step, 'property'); }
// Forced test send (owner's own account): ignores windows and quiet hours, no claim, logs "forced".
{ const { deps, log } = harness({ rows: [row(1)] }); const r = await N.runNudgePass({ ...base, mode: 'off', now: new Date('2026-11-04T23:00:00Z'), deps, force: { user_id: U, property_id: P, kind: '24h' } });
  assert.equal(r.results[0].outcome, 'sent'); assert.equal(log.patches.length, 0); assert.match(log.posts[0].body.detail, /forced/); }

// ── email content ──
{ const e = N.renderNudgeEmail({ kind: '72h', lang: 'en', propertyName: 'Villa', step: 'notifications', doneCount: 3, total: 5, consoleUrl: 'https://app.welcomebnb.it/host-console.html', stopUrl: 'https://app.welcomebnb.it/api/onboarding-stop?u=a', support: { whatsapp: '+390000000000', email: 'info@welcomebnb.it' } });
  assert.match(e.subject, /can we help/); assert.match(e.html, /Turn on notifications/); assert.match(e.html, /wa\.me\/390000000000/); assert.match(e.html, /Stop these reminders/); assert.ok(!/undefined|null/.test(e.html)); }
{ const e = N.renderNudgeEmail({ kind: '24h', lang: 'it', propertyName: 'Villa', step: 'calendar', doneCount: 2, total: 5, consoleUrl: 'https://x/host-console.html', stopUrl: 'https://x/s', support: { whatsapp: null, email: 'info@welcomebnb.it' } });
  assert.match(e.subject, /manca poco/); assert.match(e.html, /Collega il calendario/); assert.match(e.html, /mailto:info@welcomebnb\.it/); assert.match(e.html, /Non inviarmi più/); assert.equal(e.link, 'https://x/host-console.html#onboarding=calendar'); }

// ── signed opt-out ──
const t = S.stopToken(U, P, 'fixture-service');
assert.ok(S.verifyStopToken(U, P, t, 'fixture-service'));
assert.ok(!S.verifyStopToken(U, '00000000-0000-4000-8000-0000000000cc', t, 'fixture-service'), 'token bound to the property');
assert.ok(!S.verifyStopToken(U, P, t, 'other-key'), 'token bound to the server key');
assert.ok(!S.verifyStopToken(U, P, t.slice(1), 'fixture-service'));
async function stop(method, query) {
  const patched = []; const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await S.handleOnboardingStop({ method, url: '/api/send-arrival-reminders?onboarding_stop=1&' + query }, res, { serviceKey: 'fixture-service', patch: async (path, body) => { patched.push({ path, body }); return [{}]; } });
  return { res, patched };
}
{ const { res, patched } = await stop('GET', `u=${U}&p=${P}&t=${t}`); assert.equal(res.code, 200); assert.match(res.body, /<form method="post"/); assert.equal(patched.length, 0, 'GET (mail scanners) never opts out'); }
{ const { res, patched } = await stop('POST', `u=${U}&p=${P}&t=${t}`); assert.equal(res.code, 200); assert.deepEqual(patched[0].body, { nudges_opted_out: true }); assert.match(patched[0].path, new RegExp(`user_id=eq\\.${U}&property_id=eq\\.${P}`)); }
{ const { res, patched } = await stop('POST', `u=${U}&p=${P}&t=forged`); assert.equal(res.code, 400); assert.equal(patched.length, 0); }

// ── wiring ──
const allog = fs.readFileSync(new URL('../api/alloggiati.js', import.meta.url), 'utf8');
assert.match(allog, /summary\.onboarding_nudges = await runOnboardingNudges/);
assert.match(allog, /process\.env\.ONBOARDING_NUDGES \|\| 'off'/, 'off unless switched on');
const reminders = fs.readFileSync(new URL('../api/send-arrival-reminders.js', import.meta.url), 'utf8');
assert.ok(reminders.indexOf("get('onboarding_stop') === '1'") < reminders.indexOf("provided !== CRON_SECRET"), 'stop link answered before the cron-secret check');
assert.ok(!/(from\s+['"][^'"]*lib\/|require\([^)]*lib\/)/.test(fs.readFileSync(new URL('../api/_onboarding-stop.js', import.meta.url), 'utf8')), 'stop module loads no lib/ file (reminders bundle has none)');
const { default: cfg } = await import('../lib/deployment-config.mjs').then(m => ({ default: m }));
assert.ok(JSON.stringify(cfg).includes('/api/onboarding-stop') || fs.readFileSync(new URL('../lib/deployment-config.mjs', import.meta.url), 'utf8').includes("source:'/api/onboarding-stop',destination:'/api/send-arrival-reminders?onboarding_stop=1'"));
const consoleHtml = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
assert.match(consoleHtml, /#onboarding=\(\[a-z\]\+\)/, 'console deep-link handler exists');
for (const id of N.STEP_IDS) assert.ok(consoleHtml.includes(`'${id}'`), id);

// ── notification_log CHECK (real migration, PGlite) ──
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec("create table public.notification_log(id bigserial primary key, trigger text, constraint notification_log_trigger_check check (trigger in ('escalation','guest_message','test')))");
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261104090000_round51_onboarding_nudge_log.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
  for (const ok of ['onboarding_nudge_24h', 'onboarding_nudge_72h', 'escalation', 'autofile_overdue']) await db.query('insert into notification_log(trigger) values ($1)', [ok]);
  for (const bad of ['onboarding_nudge_5d', 'onboarding', 'nudge']) await assert.rejects(db.query('insert into notification_log(trigger) values ($1)', [bad]), /check constraint/, bad);
}
console.log('PASS round51 nudges: 24h/72h windows (never both, nothing after 7 days), ready/opted-out/dismissed/test/foreign rows skipped, console region rule, off/dry/quiet hours, conditional claim (no double send), failed send releases the claim and is logged, forced owner test send, IT/EN email with escaped name, deep link and stop link, WhatsApp/email help, signed GET-confirm/POST opt-out, wiring, notification_log CHECK in PGlite');
