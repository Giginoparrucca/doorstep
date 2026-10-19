// Round 61 Phase 1b — static source checks for the regional-tile routing.
// Verifies host-regional-exports.js reads property.regional_service, that
// the Puglia tile label and dialog variant are both branched on it, that
// the Round 58 chooser persists its pick back to properties.regional_service,
// and that host-console.html loads lib/cin.js and runs the auto-detect
// cascade on Puglia properties with no saved choice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const regional = fs.readFileSync(path.resolve(here, '..', 'host-regional-exports.js'), 'utf8');
const console_ = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── host-regional-exports.js: tile label branches on regional_service ───
assert.ok(
  /ctx\.property\s*&&\s*ctx\.property\.regional_service/.test(regional),
  'tile reads ctx.property.regional_service',
);
assert.ok(
  /svc\s*===\s*['"]spot_online['"]\s*\?\s*['"]SPOT Online CSV['"]/.test(regional),
  'spot_online label is "SPOT Online CSV" (interim until Phase 2 XML)',
);
assert.ok(
  /svc\s*===\s*['"]spot_easy['"]\s*\?\s*['"]SPOT Easy TXT['"]/.test(regional),
  'spot_easy label is "SPOT Easy TXT" (unchanged from Round 58)',
);
// Null service falls through to a "pick first" label.
assert.ok(
  /SPOT \(scegli servizio\).*SPOT \(choose service\)/.test(regional),
  'null service shows "SPOT (choose service)" in both languages',
);

// ── Dialog variant: saved vs ask ───────────────────────────────────────
// Saved: hidden input carries the preset format + a "change" link.
assert.ok(
  /data-saved-service/.test(regional),
  'saved-service display element present when regional_service is set',
);
assert.ok(
  /<input type="hidden" data-format value="/.test(regional),
  'saved-service branch preselects the format via a hidden input',
);
// Ask: chooser has data-persist-service so the edit handler saves back.
assert.ok(
  /data-persist-service/.test(regional),
  'chooser has data-persist-service marker so edit handler saves back',
);

// ── Edit handler persists the pick to properties.regional_service ─────
assert.ok(
  /t\.hasAttribute\('data-persist-service'\)/.test(regional),
  'edit handler checks for data-persist-service',
);
assert.ok(
  /svc\s*=\s*t\.value===['"]ps['"]\?['"]spot_easy['"]\s*:\s*t\.value===['"]summary['"]\?['"]spot_online['"]/.test(regional),
  'edit handler maps ps→spot_easy and summary→spot_online',
);
assert.ok(
  /ctx2\.sb\.from\('properties'\)\.update\(\{regional_service:svc\}\)\.eq\('id',ctx2\.property\.id\)/.test(regional),
  'edit handler fires the Supabase update to persist the choice',
);

// ── host-console.html: lib/cin.js script tag with versioned asset ─────
assert.ok(
  console_.includes('<script src="/lib/cin.js?v=61.1"></script>'),
  'host-console.html loads lib/cin.js with ?v=61.1',
);

// ── Property load auto-detects Puglia null service ────────────────────
assert.ok(
  /if \(data\.region === 'Puglia' && !data\.regional_service && typeof Cin !== 'undefined'\)/.test(console_),
  'property load auto-detects Puglia + null service via Cin.detectService',
);
assert.ok(
  /Cin\.detectService\(data\)/.test(console_),
  'calls Cin.detectService on the loaded property',
);
assert.ok(
  /detected\.source === 'cin' \|\| detected\.source === 'property_type'/.test(console_),
  'only auto-saves confident cases (cin or property_type)',
);
assert.ok(
  /sb\.from\('properties'\)\.update\(\{ regional_service: detected\.service \}\)/.test(console_),
  'auto-save fires the Supabase update',
);
// Toast must mention both languages' labels + the detection source.
assert.ok(
  /rilevato automaticamente/.test(console_) && /auto-detected/.test(console_),
  'auto-save toast is bilingual',
);

console.log('PASS round61 tile routing: Puglia label branches on regional_service, dialog variant has saved + ask paths, chooser persists back via data-persist-service, host-console loads lib/cin.js and auto-detects on property load');
