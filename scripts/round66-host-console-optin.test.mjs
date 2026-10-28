// Round 66 Phase 2b — host-console opt-in UI static guard.
//
// Enforces that host-console.html exposes the "Show entry instructions
// only after check-in is complete" toggle, the conditional
// release-time / timezone picker, and threads the three columns
// (entry_checkin_required, entry_release_time, entry_release_timezone)
// through BOTH the save payload and the load/populate flow. Any diff
// that silently drops a piece of this wiring fails the test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── 1. DOM — the opt-in checkbox + conditional release-time controls exist ──
assert.ok(
  /id="propEntryCheckinRequired"[\s\S]{0,400}onchange="onToggleEntryCheckinRequired\(\)"/.test(src),
  'opt-in checkbox must have onchange=onToggleEntryCheckinRequired()',
);
assert.ok(
  /data-h="prop_entry_checkin_required"/.test(src),
  'opt-in label must use the prop_entry_checkin_required i18n key',
);
assert.ok(
  /id="propEntryReleaseWrap"/.test(src),
  'release-time wrapper div must exist (hidden until opt-in is on)',
);
assert.ok(
  /id="propEntryReleaseTimeEnabled"[\s\S]{0,400}onchange="onToggleEntryReleaseTime\(\)"/.test(src),
  'release-time sub-toggle must have its own onchange handler',
);
assert.ok(
  /<input\s+type="time"\s+id="propEntryReleaseTime"/.test(src),
  'release-time input must be <input type="time" id="propEntryReleaseTime">',
);
assert.ok(
  /id="propEntryReleaseTimezone"[\s\S]{0,1000}<option value="Europe\/Rome"/.test(src),
  'timezone picker must offer Europe/Rome as a selectable value',
);

// ── 2. i18n — all six keys exist in BOTH English and Italian maps ──
const requiredKeys = [
  'prop_entry_checkin_required',
  'prop_entry_checkin_required_hint',
  'prop_entry_release_time_label',
  'prop_entry_release_time',
  'prop_entry_release_tz',
  'prop_entry_release_time_hint',
];
for (const key of requiredKeys) {
  const count = (src.match(new RegExp(`${key}\\s*:`, 'g')) || []).length;
  assert.ok(count >= 2, `i18n key ${key} must appear in both EN and IT maps (saw ${count})`);
}

// ── 3. Save payload threads all three columns ──
assert.ok(
  /entry_checkin_required:\s*!!document\.getElementById\('propEntryCheckinRequired'\)/.test(src),
  'save payload must read entry_checkin_required from propEntryCheckinRequired checkbox',
);
assert.ok(
  /entry_release_time:\s*\(\(\)\s*=>\s*\{[\s\S]*?propEntryReleaseTime/.test(src),
  'save payload must read entry_release_time from propEntryReleaseTime',
);
assert.ok(
  /entry_release_timezone:\s*\(\(\)\s*=>\s*\{[\s\S]*?propEntryReleaseTimezone/.test(src),
  'save payload must read entry_release_timezone from propEntryReleaseTimezone',
);

// ── 4. Save handler clears time + tz when the opt-in is off ──
// The DB CHECK requires time+tz to be set or null together; the save
// code must honour that regardless of what the user left in the input.
assert.ok(
  /if\s*\(!document\.getElementById\('propEntryCheckinRequired'\)\?\.checked\)\s*return\s+null/.test(src),
  'save handler must send null for entry_release_time when the opt-in checkbox is off',
);

// ── 5. HH:MM format gate matches the DB CHECK ──
assert.ok(
  /\/\^\(\?:\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\//.test(src),
  'client-side HH:MM regex must match the server-side CHECK',
);

// ── 6. Load/populate — the three columns flow back from the response ──
assert.ok(
  /propEntryCheckinRequired[\s\S]{0,80}data\.entry_checkin_required/.test(src),
  'load handler must populate propEntryCheckinRequired from data.entry_checkin_required',
);
assert.ok(
  /data\.entry_release_time\s*&&\s*data\.entry_release_timezone/.test(src),
  'release-time sub-toggle must be checked only when both columns are present',
);
assert.ok(
  /propEntryReleaseTimezone[\s\S]{0,250}data\.entry_release_timezone/.test(src),
  'load handler must populate propEntryReleaseTimezone from data.entry_release_timezone',
);

// ── 7. Toggle handlers exist as named functions ──
assert.ok(
  /function\s+onToggleEntryCheckinRequired\s*\(\)/.test(src),
  'onToggleEntryCheckinRequired() function must be defined',
);
assert.ok(
  /function\s+onToggleEntryReleaseTime\s*\(\)/.test(src),
  'onToggleEntryReleaseTime() function must be defined',
);

// ── 8. Clearing the opt-in cascades: the release-time sub-toggle resets ──
assert.ok(
  /if\s*\(!enabled\)\s*\{[\s\S]{0,200}propEntryReleaseTimeEnabled[\s\S]{0,100}checked\s*=\s*false/.test(src),
  'turning the opt-in off must also uncheck the release-time sub-toggle',
);

console.log('PASS round66-host-console-optin: opt-in checkbox + release-time controls present; six i18n keys in EN + IT; save payload threads entry_checkin_required/entry_release_time/entry_release_timezone with null-cascading when the opt-in is off; HH:MM regex matches the DB CHECK; load handler populates all three columns; toggle handlers defined.');
