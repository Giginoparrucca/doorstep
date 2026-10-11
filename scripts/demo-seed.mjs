#!/usr/bin/env node
// Round 50 Phase 3 — opt-in demo fixture seeder.
//
// Runs ONLY inside the demo build (readEnvironment() checks APP_ENV=demo,
// DEMO_SUPABASE_PROJECT_REF, VERCEL_PROJECT_ID). Rejects the production
// project ref before any mutation. Idempotent: all writes are upserts on
// the stable UUIDs declared in lib/demo-fixtures.mjs, so running twice
// produces the same canonical state.
//
// Logs no secrets. The service-role key is read once from env and never
// echoed. Each upsert prints the table name and count.
import assert from 'node:assert/strict';
import { readEnvironment, publicConfiguration } from '../lib/environment.mjs';
import { buildManifest, romeToday, deriveCheckinId, deriveChatId, deriveAnalyticsId, DEMO_PROJECT_REF } from '../lib/demo-fixtures.mjs';

const DEMO_VERCEL_PROJECT_ID = 'prj_MafDkEOAUye8uC9M8Mtb993vFagy';

export async function runSeed(env = process.env, { today = romeToday(), fetchImpl = fetch, logger = console.log } = {}) {
  const cfg = readEnvironment(env);
  assert.equal(cfg.mode, 'demo', 'Seeder requires demo mode');
  assert.equal(cfg.projectRef, DEMO_PROJECT_REF, 'Seeder requires the dedicated demo project');
  assert.equal(env.VERCEL_PROJECT_ID, DEMO_VERCEL_PROJECT_ID, 'Seeder requires the dedicated Vercel project');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(serviceKey && serviceKey.length > 30, 'Service role key missing');

  const manifest = buildManifest(today);
  logger(`PASS environment: demo mode, project ${cfg.projectRef}, reset day ${manifest.today}`);

  const api = async (path, { method = 'GET', body, extraHeaders = {} } = {}) => {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    };
    const r = await fetchImpl(cfg.supabaseUrl + path, {
      method, headers, redirect: 'error', signal: AbortSignal.timeout(20000),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) throw new Error(`${method} ${path} → HTTP ${r.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    return data;
  };

  const upsert = async (table, rows, { onConflict = 'id' } = {}) => {
    if (!rows.length) return 0;
    await api(`/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST', body: rows,
      extraHeaders: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    return rows.length;
  };

  // 1. Properties.
  const propertyRows = manifest.properties.map(p => ({
    id: p.id, owner_id: p.ownerId, name: p.name, property_type: p.property_type,
    address: p.address, city: p.city, zip: p.zip, region: p.region, country: p.country,
    checkin_time: p.checkin_time, checkout_time: p.checkout_time,
    access_method: p.access_method, keybox_code: p.keybox_code,
    wifi_name: p.wifi_name, wifi_password: p.wifi_password,
    host_names: p.host_names, host_phone: p.host_phone, host_email: p.host_email,
    welcome_message_it: p.welcome_message_it, welcome_message_en: p.welcome_message_en,
    checkin_instructions_it: p.checkin_instructions_it, checkin_instructions_en: p.checkin_instructions_en,
    checkout_instructions_it: p.checkout_instructions_it, checkout_instructions_en: p.checkout_instructions_en,
    transport_info_it: p.transport_info_it, transport_info_en: p.transport_info_en,
    tax_rate_eur: p.tax_rate_eur, tax_max_nights: p.tax_max_nights, tax_max_nights_basis: p.tax_max_nights_basis,
    tax_exempt_under_age: p.tax_exempt_under_age, tax_source_note: p.tax_source_note,
    rooms_available: p.rooms_available, beds_available: p.beds_available,
    alloggiati_autofile_mode: p.alloggiati_autofile_mode,
    is_test: p.is_test, timezone: p.timezone, host_language: p.host_language,
  }));
  logger(`PASS properties: upserted ${await upsert('properties', propertyRows)}`);

  // 2. Recommendations.
  const recoRows = manifest.recommendations.map(r => ({
    id: r.id, property_id: r.property_id, category: r.category, name: r.name,
    desc_en: r.desc_en, desc_it: r.desc_it, tags: r.tags, image_url: r.image_url,
    sort_order: r.sort_order, address: r.address, is_test: r.is_test,
  }));
  logger(`PASS recommendations: upserted ${await upsert('recommendations', recoRows)}`);

  // 3. Rules.
  const ruleRows = manifest.rules.map(r => ({
    id: r.id, property_id: r.property_id, icon: r.icon,
    title_it: r.title_it, title_en: r.title_en, desc_it: r.desc_it, desc_en: r.desc_en,
    is_important: r.is_important, sort_order: r.sort_order,
  }));
  logger(`PASS rules: upserted ${await upsert('rules', ruleRows)}`);

  // 4. OTA reservations (one per scenario).
  const otaRows = manifest.scenarios.map(s => ({
    id: s.ota_id, property_id: s.property_id, platform: 'manual', uid: `demo:${s.code}`,
    entry_type: 'reservation', status: 'active', booking_code: s.code,
    guest_name: s.guest_name, guest_count: s.guest_count,
    checkin_date: s.checkin_date, checkout_date: s.checkout_date,
    contact_phone: null, contact_email: null, is_test: true,
    summary: `[DEMO] ${s.code} — ${s.demonstration}`,
  }));
  logger(`PASS ota_reservations: upserted ${await upsert('ota_reservations', otaRows)}`);

  // 5. Check-ins (only for scenarios with_checkin=true). Each gets a
  // stable ID derived from the ota_id suffix. Group members land as
  // additional checkin rows sharing the booking_code.
  const checkinRows = [];
  for (const s of manifest.scenarios) {
    if (!s.with_checkin) continue;
    const base = {
      property_id: s.property_id, booking_code: s.code,
      arrival_date: s.checkin_date, departure_date: s.checkout_date,
      nights: s.nights, docs_status: 'completed', is_test: true,
      submitted_at: `${s.checkin_date}T15:30:00+02:00`,
    };
    const lead = s.checkin || {};
    checkinRows.push({
      id: deriveCheckinId(s.ota_id),
      ...base, guest_type: lead.guest_type || 'single',
      surname: lead.surname || s.guest_name.split(' ')[0], name: lead.name || 'Demo',
      sex: 'M', date_of_birth: '1990-01-01', place_of_birth: 'DEMO', citizenship: 'DEMO',
      document_type: 'passport', document_number: lead.document_number || 'FACSIMILE',
      alloggiati_status: lead.alloggiati_status || 'pending',
    });
    for (const member of (s.group_members || [])) {
      checkinRows.push({
        id: member.id, ...base, guest_type: member.guest_type || 'group_member',
        surname: member.surname, name: member.name, sex: 'M',
        date_of_birth: '1990-01-01', place_of_birth: 'DEMO', citizenship: 'DEMO',
        document_type: 'passport', document_number: member.document_number || 'FACSIMILE',
        alloggiati_status: 'pending',
      });
    }
  }
  logger(`PASS checkins: upserted ${await upsert('checkins', checkinRows)}`);

  // 6. Chat seeds. created_at is derived from the scenario arrival time
  // + offset_minutes; stable id derived from booking + ordinal.
  const chatRows = [];
  for (const [index, c] of manifest.chat.entries()) {
    const scenario = manifest.scenarios.find(s => s.code === c.booking_code);
    if (!scenario) continue;
    const t = new Date(`${scenario.checkin_date}T12:00:00+02:00`);
    t.setUTCMinutes(t.getUTCMinutes() + c.offset_minutes);
    chatRows.push({
      id: deriveChatId(index),
      property_id: scenario.property_id, booking_code: scenario.code,
      sender: c.sender, message: c.message, is_escalated: !!c.is_escalated,
      is_test: true, created_at: t.toISOString(),
    });
  }
  logger(`PASS chat_messages: upserted ${await upsert('chat_messages', chatRows)}`);

  // 7. Analytics events.
  const analyticsRows = [];
  for (const [index, e] of manifest.analytics.entries()) {
    const scenario = manifest.scenarios.find(s => s.code === e.booking_code);
    if (!scenario) continue;
    const t = new Date(`${scenario.checkin_date}T12:00:00+02:00`);
    t.setUTCMinutes(t.getUTCMinutes() + e.offset_minutes);
    analyticsRows.push({
      id: deriveAnalyticsId(index),
      property_id: scenario.property_id, booking_code: scenario.code,
      event_type: e.event_type, event_data: e.event_data || {},
      session_id: `demo-${scenario.code}`, is_test: true, created_at: t.toISOString(),
    });
  }
  logger(`PASS analytics_events: upserted ${await upsert('analytics_events', analyticsRows)}`);

  logger('PASS demo seed: idempotent manifest applied');
  return {
    today: manifest.today, properties: propertyRows.length,
    recommendations: recoRows.length, rules: ruleRows.length,
    ota_reservations: otaRows.length, checkins: checkinRows.length,
    chat_messages: chatRows.length, analytics_events: analyticsRows.length,
    publicConfig: publicConfiguration(cfg),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(await runSeed()); }
  catch (error) { console.error('FAIL ' + error.message); process.exitCode = 1; }
}
