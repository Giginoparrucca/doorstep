#!/usr/bin/env node
// Round 50 Phase 3 live-seed verifier. Opt-in. Runs only inside the demo
// build. Confirms the ten canonical scenarios are present in the demo
// database, each with the right dates relative to the chosen reset day,
// and that the seven-day action-board boundary places DEMO-SCADUTO and
// DEMO-NOSHOW outside while DEMO-RECENTE and DEMO-PARTENZA stay inside.
// Logs no secrets.
import assert from 'node:assert/strict';
import { readEnvironment } from '../lib/environment.mjs';
import { buildManifest, romeToday, DEMO_PROJECT_REF } from '../lib/demo-fixtures.mjs';

const DEMO_VERCEL_PROJECT_ID = 'prj_MafDkEOAUye8uC9M8Mtb993vFagy';
const ACTION_BOARD_WINDOW_DAYS = 7;

export async function verifySeed(env = process.env, { today = romeToday(), fetchImpl = fetch, logger = console.log } = {}) {
  const cfg = readEnvironment(env);
  assert.equal(cfg.mode, 'demo', 'Verify requires demo mode');
  assert.equal(cfg.projectRef, DEMO_PROJECT_REF, 'Verify requires the dedicated demo project');
  assert.equal(env.VERCEL_PROJECT_ID, DEMO_VERCEL_PROJECT_ID, 'Verify requires the dedicated Vercel project');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(key && key.length > 30, 'Service role key missing');
  const manifest = buildManifest(today);

  const api = async (path, extraHeaders = {}) => {
    const r = await fetchImpl(cfg.supabaseUrl + path, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...extraHeaders },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}: ${text}`);
    return text ? JSON.parse(text) : [];
  };

  // 1. All ten OTA scenarios present with the right dates.
  const otas = await api(`/rest/v1/ota_reservations?booking_code=like.DEMO-*&select=booking_code,checkin_date,checkout_date,guest_count&order=booking_code`);
  const byCode = Object.fromEntries(otas.map(o => [o.booking_code, o]));
  for (const s of manifest.scenarios) {
    const row = byCode[s.code];
    assert.ok(row, `scenario ${s.code} missing from ota_reservations`);
    assert.equal(row.checkin_date,  s.checkin_date,  `${s.code}: checkin_date drift`);
    assert.equal(row.checkout_date, s.checkout_date, `${s.code}: checkout_date drift`);
    assert.equal(row.guest_count,   s.guest_count,   `${s.code}: guest_count drift`);
  }
  assert.equal(otas.length, manifest.scenarios.length, `expected ${manifest.scenarios.length} ota rows, got ${otas.length}`);
  logger(`PASS ota_reservations: ${otas.length} scenarios with correct dates`);

  // 2. Check-ins exist for every with_checkin scenario; group members
  // land under the group lead's booking_code; DEMO-NOSHOW has none.
  const checkins = await api(`/rest/v1/checkins?booking_code=like.DEMO-*&select=booking_code,guest_type,surname&order=booking_code,guest_type`);
  const grouped = checkins.reduce((acc, c) => (acc[c.booking_code] = (acc[c.booking_code] || 0) + 1, acc), {});
  for (const s of manifest.scenarios) {
    const expected = s.with_checkin ? 1 + (s.group_members?.length || 0) : 0;
    assert.equal(grouped[s.code] || 0, expected, `${s.code}: expected ${expected} checkins, got ${grouped[s.code] || 0}`);
  }
  logger(`PASS checkins: ${checkins.length} rows (${Object.keys(grouped).length} scenarios have check-ins; DEMO-NOSHOW has 0 as required)`);

  // 3. Seven-day action-board boundary.
  const todayDate = new Date(`${today}T00:00:00Z`).getTime();
  const daysSince = iso => (todayDate - new Date(`${iso}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000);
  const outside = ['DEMO-SCADUTO','DEMO-NOSHOW'];
  const inside  = ['DEMO-RECENTE','DEMO-PARTENZA'];
  for (const code of outside) assert.ok(daysSince(byCode[code].checkout_date) >  ACTION_BOARD_WINDOW_DAYS, `${code}: must be outside action-board window`);
  for (const code of inside)  assert.ok(daysSince(byCode[code].checkout_date) <= ACTION_BOARD_WINDOW_DAYS, `${code}: must be inside action-board window`);
  logger(`PASS action-board window: SCADUTO/NOSHOW outside, RECENTE/PARTENZA inside`);

  // 4. Chat + analytics seeds exist, labelled is_test=true.
  const chats = await api(`/rest/v1/chat_messages?booking_code=like.DEMO-*&select=booking_code,sender,is_escalated,is_test&order=created_at`);
  for (const c of chats) assert.equal(c.is_test, true, 'chat seed must be is_test=true');
  assert.equal(chats.length, manifest.chat.length);
  const escalated = chats.find(c => c.booking_code === 'DEMO-AIUTO' && c.is_escalated);
  assert.ok(escalated, 'DEMO-AIUTO must contain an escalated message');
  logger(`PASS chat_messages: ${chats.length} rows, DEMO-AIUTO escalation present`);

  const events = await api(`/rest/v1/analytics_events?booking_code=like.DEMO-*&select=booking_code,event_type,is_test`);
  for (const e of events) assert.equal(e.is_test, true, 'analytics seed must be is_test=true');
  assert.equal(events.length, manifest.analytics.length);
  logger(`PASS analytics_events: ${events.length} rows`);

  // 5. Properties: Casa Demo WelcomeBnB and Trullo Fico Vicino with
  // correct owners and demo-only guards (is_test=true, autofile off).
  const properties = await api(`/rest/v1/properties?id=in.(${manifest.properties.map(p => p.id).join(',')})&select=id,owner_id,name,is_test,alloggiati_autofile_mode`);
  for (const p of manifest.properties) {
    const row = properties.find(r => r.id === p.id);
    assert.ok(row, `property ${p.name} missing`);
    assert.equal(row.owner_id, p.ownerId, `${p.name}: owner mismatch`);
    assert.equal(row.is_test, true, `${p.name}: is_test must stay true`);
    assert.equal(row.alloggiati_autofile_mode, 'off', `${p.name}: autofile must be off`);
  }
  logger(`PASS properties: ${properties.length} with correct owners, is_test, autofile off`);

  // 6. No production rows crept in.
  const prodRows = await api(`/rest/v1/properties?is_test=eq.false&select=id`);
  assert.equal(prodRows.length, 0, 'no production-shaped properties');
  logger(`PASS no production rows in demo database`);

  logger('PASS Phase 3 live-seed verification');
  return { today, scenarios: otas.length, checkins: checkins.length, chats: chats.length, events: events.length, properties: properties.length };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(await verifySeed()); }
  catch (error) { console.error('FAIL ' + error.message); process.exitCode = 1; }
}
