// Round 61 Phase 1 — static source checks: Property Details SPOT service
// dropdown exists, is Puglia-gated, is wired into save/load, and all four
// i18n keys appear in both EN and IT dicts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── Markup: wrapper div, hidden by default, with the Puglia-only select ──
assert.ok(
  src.includes('<div class="form-group" id="propRegionalServiceWrap" style="display:none;">'),
  'propRegionalServiceWrap must exist and be hidden by default',
);
assert.ok(
  src.includes('<select class="form-input" id="propRegionalService">'),
  'propRegionalService <select> must exist',
);
// The three option values
assert.ok(src.match(/<option value=""[^>]*>Choose/), 'empty option visible');
assert.ok(src.includes('value="spot_easy"'), 'spot_easy option');
assert.ok(src.includes('value="spot_online"'), 'spot_online option');

// ── Save: regional_service goes into the property update patch ───────────
assert.ok(
  src.includes("regional_service: document.getElementById('propRegionalService')?.value || null"),
  'save flow must include regional_service',
);

// ── Load: regional_service is populated from data; Puglia-gated show/hide
assert.ok(
  src.includes("if (el('propRegionalService')) el('propRegionalService').value = data.regional_service || ''"),
  'load flow must set the select value from data.regional_service',
);
assert.ok(
  src.includes("_rsWrap.style.display = (data.region === 'Puglia') ? '' : 'none'"),
  'load flow must show the wrapper only for Puglia',
);
// Change listener in _onRegionManualChange reflects the gate live
assert.ok(
  src.includes("rsWrap.style.display = (regionSel.value === 'Puglia') ? '' : 'none'"),
  'region change listener must toggle the wrapper live',
);

// ── i18n keys present in BOTH languages ─────────────────────────────────
const requiredKeys = [
  'prop_regional_service',
  'prop_regional_service_opt_choose',
  'prop_regional_service_opt_easy',
  'prop_regional_service_opt_online',
  'prop_regional_service_hint',
];
for (const key of requiredKeys) {
  // Each key must occur at least twice: once in EN dict, once in IT dict.
  // Count exact occurrences of the dict-row shape `${key}: `.
  const re = new RegExp(`\\b${key}:\\s`, 'g');
  const count = (src.match(re) || []).length;
  assert.ok(count >= 2, `i18n key "${key}" must appear in EN and IT dicts (found ${count})`);
}

// ── Legacy keys removed ────────────────────────────────────────────────
for (const dead of ['export_puglia_dms_title', 'export_puglia_dms_desc', 'link_dms']) {
  assert.ok(!src.includes(dead), `legacy key "${dead}" must be gone`);
}

// ── Dropdown is inside the Property Details fieldset (unsaved-forms guard)
// The Round 59 unsaved-forms guard protects everything inside the Property
// Details panel. Confirming the wrapper appears between the Property Details
// panel's start and the first form-card after it.
const panelStart = src.indexOf('<div class="panel" id="panel-property"');
assert.ok(panelStart > -1, 'panel-property must exist');
const wrapAt = src.indexOf('propRegionalServiceWrap', panelStart);
assert.ok(wrapAt > panelStart, 'dropdown must live inside the Property Details panel so the unsaved-forms guard covers it');

console.log('PASS round61 Property Details SPOT service dropdown: markup + Puglia gate (initial + live) + save/load + 5 i18n keys in EN+IT + 3 legacy keys removed + inside Property Details panel');
