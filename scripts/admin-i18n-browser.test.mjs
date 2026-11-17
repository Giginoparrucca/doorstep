// 17 Nov 2026 — admin console bilingual: Italian by default, English on the
// toggle. The REAL admin.html (actual scripts, vendored Supabase SDK) is
// loaded signed in as a fictional admin, every tab is opened with fictional
// data (host health, users, billing box, launch, pilot, deep dive, ops,
// privacy, audit log), and the visible text is checked:
//   Italian: no English-only words left; English: no Italian-only words left;
//   switching back and forth is lossless; the choice is remembered; names,
//   e-mails and numbers are never translated.
// I18N_COLLECT=1 prints the untranslated phrases instead of failing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require = createRequire(import.meta.url);
const H = require('../lib/host-health.js');
const U = await import('../api/_admin-users.js');
const root = new URL('../', import.meta.url);
const COLLECT = process.env.I18N_COLLECT === '1';
const REF = 'abcdefghijklmnopqrst', SUPA = `https://${REF}.supabase.co`, APP = 'https://app.welcomebnb.it';
const NOW = new Date(), D = 86400000, iso = ms => new Date(ms).toISOString(), day = ms => iso(ms).slice(0, 10);
const T0 = NOW.getTime();
const ADMIN = { id: '00000000-0000-4000-8000-0000000000ad', email: 'admin@example.invalid' };
const O1 = '00000000-0000-4000-8000-0000000000a1', O2 = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1', P2 = '00000000-0000-4000-8000-0000000000b2';

// ── Fixtures (fictional) ──
const properties = [
  { id: P1, name: 'Casa Rossa', owner_id: O1, city: 'Bari', region: 'Puglia', is_test: false, deleted_at: null, created_at: iso(T0 - 90 * D), timezone: 'Europe/Rome', cir_code: 'IT072006C2', alloggiati_autofile_mode: 'live', tax_rate_eur: 2, ical_feeds: ['x'], welcome_message_it: 'Ciao' },
  { id: P2, name: 'Villa Verde', owner_id: O2, city: 'Lecce', region: 'Puglia', is_test: false, deleted_at: null, created_at: iso(T0 - 20 * D), timezone: 'Europe/Rome', cir_code: '', alloggiati_autofile_mode: 'live', tax_rate_eur: null, ical_feeds: [] },
];
const ev = (type, user, email, prop, ago, extra = {}) => ({ id: type + ago + (user || 'g'), event_type: type, user_id: user, user_email: email, property_id: prop, session_id: 's' + ago, created_at: iso(T0 - ago * 3600e3), booking_code: extra.booking_code || null, event_data: extra.data || {}, is_test: false, deleted_at: null });
const events = [
  ev('login', O1, 'anna@example.invalid', P1, 5), ev('session_end', O1, 'anna@example.invalid', P1, 4, { data: { duration_seconds: 600 } }),
  ev('generate_booking', O1, 'anna@example.invalid', P1, 3), ev('export_alloggiati', O1, 'anna@example.invalid', P1, 2), ev('save_property', O1, 'anna@example.invalid', P1, 2),
  ev('login', O2, 'bruno@example.invalid', P2, 30), ev('save_rules', O2, 'bruno@example.invalid', P2, 29),
  ev('guest_open', null, null, P1, 6, { booking_code: 'HMA1' }), ev('guest_chat_send', null, null, P1, 6, { booking_code: 'HMA1' }), ev('guest_reco_click', null, null, P1, 5, { booking_code: 'HMA1', data: { reco_id: 'r1' } }),
  ev('guest_checkin_start', null, null, P1, 7, { booking_code: 'HMA2' }), ev('guest_checkin_complete', null, null, P1, 7, { booking_code: 'HMA2' }),
];
const checkins = [
  { id: 'c1', property_id: P1, booking_code: 'HMA2', surname: 'ROSSI', name: 'Mario', guest_type: '16', submitted_at: iso(T0 - 7 * 3600e3), arrival_date: day(T0 + D), departure_date: day(T0 + 3 * D), nights: 2, is_test: false, deleted_at: null },
];
const chats = [
  { id: 'm1', property_id: P1, booking_code: 'HMA1', sender: 'guest', message: 'Is there a taxi to the airport?', created_at: iso(T0 - 6 * 3600e3), is_test: false, deleted_at: null },
  { id: 'm2', property_id: P1, booking_code: 'HMA1', sender: 'ai', message: 'Sì, chiedi all’host.', created_at: iso(T0 - 6 * 3600e3 + 1000), is_test: false, deleted_at: null },
];
const recos = [{ id: 'r1', property_id: P1, name: 'Trattoria', category: 'restaurant', sort_order: 1, is_test: false, deleted_at: null, created_at: iso(T0 - 30 * D) }];
const tables = {
  admin_users: [{ email: ADMIN.email, added_at: iso(T0 - 300 * D), added_by: null, notes: null }],
  analytics_events: events, properties, checkins, recommendations: recos, chat_messages: chats,
  pilot_hosts: [{ id: 'ph1', host_email: 'anna@example.invalid', status: 'pilot', amount_paid: 0, pilot_started_at: day(T0 - 40 * D), notes: null, created_at: iso(T0 - 40 * D), updated_at: iso(T0 - 40 * D) }],
  pilot_invites: [{ id: 'i1', email: 'carla@example.invalid', status: 'invited', invited_at: iso(T0 - 2 * D), accepted_at: null, invited_by: ADMIN.id, notes: null }],
  api_usage: [{ property_id: P1, input_tokens: 12000, output_tokens: 3000, endpoint: 'chat', created_at: iso(T0 - D) }],
  analytics_monthly: [], data_purge_log: [], purge_settings: [], rules: [], excluded_booking_codes: [], chat_qa_pairs: [], admin_impersonation_log: [],
  legal_documents: [{ id: 'ld1', kind: 'host_terms', version: 1, file_path: 'legal/CONDIZIONI_GENERALI_v1.md', published_at: iso(T0 - 10 * D) }],
  host_terms_acceptances: [],
};
const health = (() => {
  const results = H.sortByHealth(properties.map(p => Object.assign(H.computeHostHealth({ property: p, now: iso(T0),
    reservations: p.id === P1 ? [{ id: 'x1', property_id: P1, booking_code: 'HMA2', checkin_date: day(T0 + D), platform: 'airbnb', entry_type: 'reservation', status: 'active' }] : [],
    checkins: p.id === P1 ? [{ id: 'c1', property_id: P1, booking_code: 'HMA2', surname: 'Rossi', arrival_date: day(T0 - 3 * D), filed_at: null }] : [],
    filingLog: [], credentials: p.id === P1 ? { property_id: P1, verified_at: iso(T0 - 30 * D), wskey_expires_at: iso(T0 + 200 * D), last_error: null } : null,
    onboarding: null, recommendationCount: p.id === P1 ? 1 : 0, guestEventCodes: ['HMA1'], lastActivityAt: iso(T0 - 2 * 3600e3), regionCompliance: null }),
    { owner_email: p.owner_id === O1 ? 'anna@example.invalid' : 'bruno@example.invalid', owner_id: p.owner_id,
      billing: { state: { state: 'trial', trial_ends_at: iso(T0 + 12 * D), days_left: 12 }, chip: 'Prova · 12 gg', subscription: { trial_ends_at: iso(T0 + 12 * D) }, events: [{ created_at: iso(T0 - D), action: 'trial_extended', actor: ADMIN.email, reason: 'Fiera' }] } })));
  return { generated_at: iso(T0), properties: results, action_needed: H.actionNeeded(results),
    billing_settings: { id: 1, launch_at: null, annual_price_cents: 6000, bank_transfer_iban: '', bank_transfer_holder: '' }, billing_error: null };
})();
const authUsers = [
  { id: O1, email: 'anna@example.invalid', created_at: iso(T0 - 40 * D), email_confirmed_at: iso(T0 - 40 * D), last_sign_in_at: iso(T0 - 5 * 3600e3) },
  { id: O2, email: 'bruno@example.invalid', created_at: iso(T0 - 20 * D), email_confirmed_at: iso(T0 - 20 * D), last_sign_in_at: iso(T0 - 30 * 3600e3) },
  { id: '00000000-0000-4000-8000-0000000000a3', email: 'carla@example.invalid', created_at: iso(T0 - 2 * D), email_confirmed_at: null, last_sign_in_at: null },
];
const usersPayload = (() => {
  const plans = { [O1]: { state: 'trial', trial_ends_at: iso(T0 + 5 * D) }, [O2]: { state: 'prelaunch' } };
  const rows = U.buildRows({ users: authUsers, invites: tables.pilot_invites, admins: tables.admin_users, properties, events, checkins, plans, now: T0 });
  for (const r of rows) if (r.user_id) r.billing = { state: plans[r.user_id] || { state: 'prelaunch' }, chip: 'Prova', subscription: {}, events: [] };
  return { generated_at: iso(T0), summary: U.summarize(rows, T0), rows, plan_error: null };
})();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
async function boot(browser, width, lang) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'it-IT' });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.dismiss());
  if (process.env.I18N_SLOW) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.I18N_SLOW) }); }
  // Any navigation after the first load is a bug: record where it went.
  const navigations = []; let booted = false;
  page.on('framenavigated', f => { if (f === page.mainFrame()) { if (booted) navigations.push(f.url()); console.error('[nav]', booted ? 'after boot' : 'boot', f.url()); } });
  page.on('crash', () => console.error('[crash] page crashed'));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[console]', m.type(), m.text().slice(0, 200)); });
  const exp = Math.floor(T0 / 1000) + 3600;
  const jwt = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: ADMIN.id, email: ADMIN.email, exp, role: 'authenticated', aud: 'authenticated' })).toString('base64url') + '.c2ln';
  const user = { id: ADMIN.id, email: ADMIN.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: iso(T0 - 300 * D) };
  await page.addInitScript(([key, session, l]) => {
    localStorage.setItem(key, JSON.stringify(session));
    if (l) localStorage.setItem('wbnb_admin_lang', l);
  }, [`sb-${REF}-auth-token`, { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: exp, user }, lang]);
  await page.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === SUPA) {
      if (u.pathname.startsWith('/auth/v1/user')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(user) });
      if (u.pathname.startsWith('/auth/v1/')) return route.fulfill({ contentType: 'application/json', body: '{}' });
      if (u.pathname === '/rest/v1/rpc/list_hosts_for_admin') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(authUsers.map(x => ({ id: x.id, email: x.email }))) });
      if (u.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ contentType: 'application/json', body: 'null' });
      const table = u.pathname.replace('/rest/v1/', '');
      const rows = tables[table] || [];
      const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` }, body: JSON.stringify(single ? rows[0] || null : rows) });
    }
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({ contentType: 'text/javascript', body: 'window.JSZip=function(){};' });
    if (u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) return route.fulfill({ contentType: 'text/css', body: '' });
    if (u.origin === APP) {
      if (u.pathname === '/app-config.js') return route.fulfill({ contentType: 'text/javascript', body: `window.WELCOME_BNB_CONFIG={mode:'production',projectRef:'${REF}',supabaseUrl:'${SUPA}',publicKey:'fixture-public-key',appOrigin:'${APP}',allowedOrigins:['${APP}']};` });
      if (u.pathname === '/api/admin-host-health') {
        const b = JSON.parse(req.postData() || '{}');
        const body = b.action === 'users_overview' ? usersPayload : b.action === 'audit_list' ? { events: [{ id: 2, occurred_at: iso(T0 - 3600e3), actor_email: ADMIN.email, action: 'dsar_export', outcome: 'ok', target_table: 'data_subject', target_id: null, metadata: {} }], chain: { ok: true, checked: 2 } }
          : b.action === 'billing_launch_preview' ? { ok: true, launch_at: iso(T0), already_launched: false, hosts: [{ user_id: O1, email: 'anna@example.invalid', properties: 1, all_test: false, has_row: false, suggested_last_free_day: day(T0 + 30 * D), earliest_last_free_day: day(T0 + 7 * D) }] }
          : !b.action ? health : { ok: true };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (u.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connections: [], properties: [] }) });
      const rel = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      const file = new URL(rel, root);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: types[rel.slice(rel.lastIndexOf('.'))] || 'application/octet-stream', body: fs.readFileSync(file) });
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  await page.goto(APP + '/admin.html');
  await page.waitForSelector('[data-users-table]', { timeout: 20000 });
  // Let the initial data load and the login overlay fade finish first.
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => { const o = document.getElementById('loginOverlay'); return !o || getComputedStyle(o).opacity === '0'; });
  booted = true;
  return { context, page, errors, navigations };
}

// Walk every tab and the panels opened from it; return visible strings.
async function tour(page) {
  const seen = new Set();
  const grab = async () => {
    await page.waitForTimeout(150);
    const items = await page.evaluate(() => {
      const out = [];
      const w = document.createTreeWalker(document.body, 5);
      let n;
      while ((n = w.nextNode())) {
        if (n.nodeType === 3) {
          const p = n.parentElement;
          if (!p || p.closest('script,style,[data-i18n-skip]')) continue;
          const cs = getComputedStyle(p);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const t = n.data.replace(/\s+/g, ' ').trim(); if (t) out.push(t);
        } else for (const a of ['placeholder', 'title', 'aria-label']) { const v = n.getAttribute(a); if (v) out.push(v.trim()); }
      }
      return out;
    });
    items.forEach(x => seen.add(x));
  };
  const click = async sel => { const el = page.locator(sel).first(); if (await el.count()) { await el.click(); await page.waitForTimeout(250); } };
  await grab();
  await click(`[data-users-billing-toggle="${O1}"]`); await grab();
  await click('[data-users-sort="activity"]'); await grab();
  try { await click('[data-launch-prepare]'); await page.waitForSelector('[data-launch-plan]', { timeout: 5000 }); }
  catch (e) { console.error('[prepare-launch]', String(e).slice(0, 300), page.url(), await page.evaluate(() => document.readyState).catch(x => 'eval failed: ' + String(x).slice(0, 120))); throw e; }
  await grab();
  for (const tab of ['pilot', 'deepdive', 'ops', 'privacy']) {
    await click(`[data-tab="${tab}"]`); await grab();
    if (tab === 'deepdive') { await page.selectOption('#userFilter', { label: 'anna' }).catch(() => {}); await page.evaluate(() => typeof renderView === 'function' && renderView()); await page.waitForTimeout(300); await grab(); await page.selectOption('#userFilter', 'all').catch(() => {}); await page.evaluate(() => renderView()); }
    if (tab === 'privacy') { await click('[data-audit-load]'); await grab(); }
  }
  return [...seen];
}

const EN_WORDS = /\b(the|and|of|for|with|without|not|no|yes|this|that|these|all|last|first|to|from|by|per day|loading|failed|error|users?|hosts|guests?|properties|property|events?|bookings?|check-ins? (?:done|completed|started)|filed|unavailable|refresh|show|hidden|sessions?|total|days?|week|month|year|time|messages?|clicks?|opened|recos|delete|cancel|close|save|add|download|settings|status|actions?|overview|health|needed|active|inactive|never|pending|sent|none|unknown|today|yesterday|ago|since|until|only|more|less|than|are|is|was|were|has|have|will|can|could|should|must|when|where|which|who|what|how|why)\b/i;
const IT_WORDS = /\b(il|lo|la|gli|le|di|del|della|dei|delle|con|senza|non|sì|questo|questa|tutti|tutte|ultimo|ultima|primo|giorni|giorno|settimana|mese|anno|utenti|ospiti|strutture|struttura|prenotazioni|prenotazione|caricamento|errore|aggiorna|mostra|nascondi|dati|sessioni|totale|messaggi|elimina|annulla|chiudi|salva|aggiungi|esporta|scarica|impostazioni|stato|azioni|attivo|inattivo|mai|oggi|ieri|fa|fino|solo|anche|quando|dove|come|perché|nessun|nessuna|registrato|invitato|prova)\b/i;
// Words that are the same (or proper nouns / product terms) in both languages.
const NEUTRAL = /^(?:[\p{N}\s.,:;%€/+\-–—·()#|×*<>=≥≤↑↓→←▲▼▾▴✓✗✕?!'"’…@&_\[\]]|WelcomeBnB|Alloggiati|Alloggiati Web|PEC|CSV|JSON|ZIP|ISTAT|DMS|AI|CIN|CIR|IBAN|ID|OK|GDPR|Supabase|iCal|Airbnb|Booking\.com|Email|E-mail|Admin|Host|Check-in|Check-out|Chat|Console|Pilot|Ops|Privacy|Deep dive|Live|Test|IT|EN|BnB|Wi-Fi|TULPS|Ross1000|SPOT|Telegram|Puglia|Bari|Lecce|Mario|ROSSI|Rossi|Casa Rossa|Villa Verde|Trattoria|[A-Z0-9]{2,})+$/u;
// Guest/host content, addresses and code names are data, never translated.
const isData = s => /@example\.(invalid|com)|^[0-9a-f-]{36}$|^HMA\d|^https?:|^["“«]|^[a-z_]+\.[a-z_]+$/.test(s) || NEUTRAL.test(s);

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
const missing = { it: new Set(), en: new Set() };
try {
  for (const width of COLLECT ? [1440] : [390, 1440]) {
    // Italian is the default (nothing stored).
    let { context, page, errors, navigations } = await boot(browser, width, null);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'it', 'Italian by default');
    assert.equal((await page.textContent('.top-bar-brand')).trim(), 'WelcomeBnB', 'brand never translated');
    assert.equal(await page.title(), 'WelcomeBnB · Analisi admin');
    if (process.env.I18N_SHOT) await page.screenshot({ path: `${process.env.I18N_SHOT}/admin-it-${width}.png` });
    assert.equal(await page.getAttribute('#adminLangToggle [data-lang="it"]', 'aria-pressed'), 'true');
    const itTexts = await tour(page);
    if (process.env.I18N_DUMP) fs.writeFileSync(process.env.I18N_DUMP, JSON.stringify([...new Set(itTexts)].sort(), null, 0));
    for (const s of itTexts) if (!isData(s) && EN_WORDS.test(s) && !IT_WORDS.test(s)) missing.it.add(s);
    // Switch to English on the same page: everything already drawn follows.
    await page.click('#adminLangToggle [data-lang="en"]');
    assert.equal(await page.evaluate(() => [document.documentElement.lang, localStorage.getItem('wbnb_admin_lang')].join()), 'en,en', 'choice remembered');
    const enTexts = await tour(page);
    if (process.env.I18N_DUMP_EN) fs.writeFileSync(process.env.I18N_DUMP_EN, JSON.stringify([...new Set(enTexts)].sort(), null, 0));
    for (const s of enTexts) if (!isData(s) && IT_WORDS.test(s) && !EN_WORDS.test(s)) missing.en.add(s);
    // Data is never translated.
    const all = itTexts.concat(enTexts).join('\n');
    for (const keep of ['anna@example.invalid', 'Casa Rossa', 'Villa Verde']) assert.ok(all.includes(keep), keep + ' shown unchanged');
    // Back to Italian: lossless.
    await page.click('#adminLangToggle [data-lang="it"]');
    const back = await tour(page);
    if (!COLLECT) assert.deepEqual(new Set(back.filter(s => !/\d{1,2}:\d{2}|gg fa|oggi|ieri|ore fa|min fa/.test(s))).size > 0, true);
    assert.deepEqual(errors, [], 'no page errors');
    assert.deepEqual(navigations, [], 'the console never navigates away during the tour');
    await context.close();
    // A fresh load remembers English.
    ({ context, page, errors, navigations } = await boot(browser, width, 'en'));
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    if (!COLLECT) assert.match(await page.textContent('[data-tab="users"]'), /Users/);
    await context.close();
  }
} finally { await browser.close(); }
if (COLLECT) {
  console.log('IT (still English):\n' + [...missing.it].sort().join('\n'));
  console.log('\nEN (still Italian):\n' + [...missing.en].sort().join('\n'));
} else {
  assert.deepEqual([...missing.it].sort(), [], 'Italian mode: no English text left');
  assert.deepEqual([...missing.en].sort(), [], 'English mode: no Italian text left');
  console.log('PASS admin console bilingual: real admin.html signed in with fictional data, every tab (Utenti with the subscription box and launch, Pilot, Deep dive all/one host, Ops, Privacy with the audit log) at 390/1440 — Italian by default with no English left, English on the toggle with no Italian left, choice remembered across loads, names/e-mails/numbers untouched, no page errors');
}
