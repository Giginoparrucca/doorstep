// Round 51 Phase 6 — admin readiness report equals computeReadiness run
// independently on the same rows with the console's input shape
// (host-onboarding.js _loadReadinessInputs). Fictional rows only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service';
const require = createRequire(import.meta.url);
const Readiness = require('../lib/onboarding-readiness.js');
const Regional = require('../lib/regional-exports.js');
const Allog = require('../lib/alloggiati-records.js');
const { readinessReport } = await import('../api/_onboarding-nudges.js');

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const full = { city: 'Bari', region: 'Puglia', cir_code: 'IT072006C200000001', tax_rate_eur: 2, ical_feeds: ['https://example.invalid/a.ics'], welcome_message: 'Ciao', wifi_name: 'W', checkin_instructions: 'Chiavi', alloggiati_autofile_mode: 'live' };
const props = [
  { id: id(1), owner_id: id(101), name: 'Ready house', ...full },                                       // creds + notifications → ready
  { id: id(2), owner_id: id(102), name: 'No calendar', ...full, ical_feeds: [] },                         // stuck on calendar
  { id: id(3), owner_id: id(103), name: 'Veneto', ...full, region: 'Veneto', city: 'Venezia' },             // ROSS1000 code missing
  { id: id(4), owner_id: id(104), name: 'Empty' },                                                         // nothing, no onboarding row
  { id: id(5), owner_id: id(105), name: 'Direct only', ...full, ical_feeds: [], alloggiati_autofile_mode: 'manual' }, // skip direct_only + manual Alloggiati
];
const rows = [
  { user_id: id(101), property_id: id(1), first_seen_at: '2026-10-20T10:00:00Z', completed_at: '2026-10-21T10:00:00Z', test_checkin_done_at: '2026-10-21T09:00:00Z', skips: {}, checklist_dismissed_at: null, nudge_24h_sent_at: null, nudge_72h_sent_at: null, nudges_opted_out: false },
  { user_id: id(102), property_id: id(2), first_seen_at: '2026-10-25T10:00:00Z', completed_at: null, test_checkin_done_at: null, skips: {}, checklist_dismissed_at: null, nudge_24h_sent_at: '2026-10-26T10:00:00Z', nudge_72h_sent_at: null, nudges_opted_out: false },
  { user_id: id(103), property_id: id(3), first_seen_at: '2026-11-03T10:00:00Z', completed_at: null, test_checkin_done_at: null, skips: { step_decisions: { test: 'dismissed' } }, checklist_dismissed_at: null, nudge_24h_sent_at: null, nudge_72h_sent_at: null, nudges_opted_out: true },
  { user_id: id(105), property_id: id(5), first_seen_at: '2026-10-28T10:00:00Z', completed_at: null, test_checkin_done_at: null, skips: { direct_only: true }, checklist_dismissed_at: null, nudge_24h_sent_at: null, nudge_72h_sent_at: null, nudges_opted_out: false },
  { user_id: id(999), property_id: id(2), first_seen_at: '2026-10-01T10:00:00Z', skips: {} },  // another user's row for property 2: ignored
];
const creds = [{ property_id: id(1), verified_at: '2026-10-20T11:00:00Z' }, { property_id: id(2), verified_at: null }, { property_id: id(3), verified_at: null }];
const settings = [{ host_id: id(101), push_enabled: true }, { host_id: id(102), email_mode: 'always' }, { host_id: id(103), email_mode: 'off' }, { host_id: id(105), telegram_enabled: true }];
const reads = [];
const get = async path => { reads.push(path); const t = path.split('?')[0];
  return structuredClone({ properties: props, host_onboarding: rows, host_alloggiati_credentials: creds, host_notification_settings: settings }[t]); };

const report = await readinessReport({ get });
assert.equal(reads.length, 4, 'four reads, not one per property');
assert.match(reads.find(r => r.startsWith('properties')), /deleted_at=is\.null&is_test=is\.false/);
assert.ok(!reads.some(r => /credentials_enc|utente|password|wskey/.test(r)), 'never reads credential material');
assert.equal(report.length, props.length);

// Independent recomputation with the console's input shape.
const regionFor = (region, city) => { const r = Regional.regions[region]; if (!r) return null; if (!r.byProvince) return r; const c = Allog.lookupPoliceCode(city); const ppp = c && c.length === 9 ? c.slice(3, 6) : null; return (ppp && r.byProvince[ppp]) || r.fallback; };
for (const p of props) {
  const ob = rows.find(r => r.user_id === p.owner_id && r.property_id === p.id) || null;
  const c = creds.find(x => x.property_id === p.id);
  const expected = Readiness.computeReadiness({ property: p, taxRules: Array.isArray(p.tax_rules) ? p.tax_rules : [],
    alloggiatiCreds: c ? { configured: true, verified_at: c.verified_at || null } : null,
    notificationSettings: settings.find(n => n.host_id === p.owner_id) || null, hasTestCheckin: !!(ob && ob.test_checkin_done_at),
    onboardingState: ob || { skips: {} }, regionCompliance: regionFor(p.region, p.city) });
  const got = report.find(r => r.property_id === p.id);
  assert.equal(got.ready, expected.ready, p.name + ' ready'); assert.equal(got.done, expected.doneCount, p.name + ' done');
  assert.equal(got.first_incomplete, expected.firstIncompleteStep, p.name + ' first step');
  assert.deepEqual(got.steps.map(s => [s.id, s.done, [...s.missing]]), expected.steps.map(s => [s.id, !!s.done, [...(s.missing || [])]]), p.name + ' steps');
  assert.equal(got.first_seen_at, ob ? ob.first_seen_at : null);
}
const by = n => report.find(r => r.property_id === id(n));
assert.equal(by(1).ready, true);
assert.equal(by(2).first_incomplete, 'calendar'); assert.equal(by(2).nudge_24h_sent_at, '2026-10-26T10:00:00Z'); assert.equal(by(2).first_seen_at, '2026-10-25T10:00:00Z', "the owner's row, not another user's");
assert.ok(by(3).steps[0].missing.includes('ross1000_codice'), 'Veneto needs the ROSS1000 code'); assert.equal(by(3).nudges_opted_out, true); assert.equal(by(3).steps[3].skipped, true);
assert.equal(by(4).ready, false); assert.equal(by(4).first_incomplete, 'property'); assert.equal(by(4).first_seen_at, null, 'never saw the checklist');
assert.equal(by(5).steps[1].done, true, 'direct_only skips the calendar'); assert.ok(!by(5).steps[0].missing.includes('alloggiati'), 'manual mode satisfies Alloggiati');
console.log(`PASS round51 readiness report: ${report.length} properties, each equal to an independent computeReadiness with the console's inputs (steps, missing fields, first step, ready); owner's onboarding row only; region rule (Veneto ROSS1000), skips and step decisions, manual Alloggiati; four reads, no credential material`);
