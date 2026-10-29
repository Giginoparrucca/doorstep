// Round 66 Phase 2d — manual-release button + handler static guard.
//
// Verifies that host-console.html exposes a "Release access" button on
// every booking row when the property has opted in, and that the handler
// calls both entry_access_confirm_roster and entry_access_set_release
// via the Supabase client with the right fields.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── 1. Button exists and is gated on the opt-in column ──────────────
assert.ok(
  /propertyData\?\.entry_checkin_required\s*===\s*true/.test(src),
  'release button must only render when propertyData.entry_checkin_required === true',
);
assert.ok(
  /onclick="releaseEntryManually\(/.test(src),
  'button must dispatch to releaseEntryManually',
);
// data-attributes carry everything the RPC call needs so no fetch is
// required between the click and the server call
for (const attr of ['data-booking-code', 'data-arrival', 'data-departure', 'data-is-test', 'data-reservation-id', 'data-expected-count']) {
  assert.ok(src.includes(attr + '='), `button must carry ${attr}`);
}

// ── 2. The IT and EN labels and tooltip text are present ──────────
assert.ok(/Rilascia accesso/.test(src), 'IT button label present');
assert.ok(/Release access/.test(src), 'EN button label present');
assert.ok(
  /scavalca il check-in richiesto; l\\'azione sarà registrata nell\\'audit/.test(src),
  'IT tooltip must explain the override is audited',
);
assert.ok(
  /bypasses the check-in requirement; the action is recorded in the audit log/.test(src),
  'EN tooltip must explain the override is audited',
);

// ── 3. Handler function exists and calls both RPCs ──────────────────
assert.ok(
  /async\s+function\s+releaseEntryManually\s*\(/.test(src),
  'releaseEntryManually function must be defined',
);
assert.ok(
  /async\s+function\s+restoreAutomaticRelease\s*\(/.test(src),
  'restoreAutomaticRelease function must be defined (Phase 2d "Restore automatic" button)',
);
assert.ok(
  /p_release:\s*false/.test(src),
  'restoreAutomaticRelease must call set_release with p_release=false',
);
assert.ok(
  /onclick="restoreAutomaticRelease\(/.test(src),
  'Restore button must dispatch to restoreAutomaticRelease',
);
assert.ok(/Ripristina automatico/.test(src), 'IT restore button label present');
assert.ok(/Restore automatic/.test(src), 'EN restore button label present');
assert.ok(
  /sb\.rpc\('entry_access_confirm_roster'/.test(src),
  'handler must call entry_access_confirm_roster to ensure booking row exists',
);
assert.ok(
  /sb\.rpc\('entry_access_set_release'/.test(src),
  'handler must call entry_access_set_release to flip released_manually',
);

// ── 4. Request IDs are generated per call (idempotency keys) ───────
const randomUuidHits = (src.match(/window\.crypto\.randomUUID\(\)/g) || []).length;
assert.ok(randomUuidHits >= 2, `must generate two separate request IDs (one per RPC); saw ${randomUuidHits}`);

// ── 5. state_version from confirm_roster is passed into set_release ─
assert.ok(
  /const\s+stateVersion\s*=\s*summary\.state_version/.test(src),
  'handler must pass the confirm_roster state_version through to set_release',
);
assert.ok(
  /p_expected_version:\s*stateVersion/.test(src),
  'set_release call must use expected_version from the confirm_roster response',
);

// ── 6. Explicit confirmation dialog with audit disclosure ──────────
assert.ok(
  /scavalca il requisito di check-in e l’orario di rilascio e sarà registrata in modo immutabile/.test(src),
  'IT confirmation dialog must warn about the audited override',
);
assert.ok(
  /bypasses the check-in and release-time requirements and is recorded immutably/.test(src),
  'EN confirmation dialog must warn about the audited override',
);

// ── 7. Error handling for both RPC steps ──────────────────────────
assert.ok(
  /if\s*\(roster\.error\)/.test(src),
  'handler must check roster.error and surface it',
);
assert.ok(
  /if\s*\(release\.error\)/.test(src),
  'handler must check release.error and surface it',
);

// ── 8. Guard against incomplete booking data ──────────────────────
assert.ok(
  /!bookingCode\s*\|\|\s*!arrival\s*\|\|\s*!departure/.test(src),
  'handler must guard against missing booking fields',
);

// ── 9. The reservation SELECT that feeds this button must pull
// guest_count + is_test so the RPC's "Reservation does not match
// roster" check doesn't 500 for every booking whose guest_count>1
// (seen in pilot — Daniele 2026-10-28 on trulloverdeulivo@gmail.com).
assert.ok(
  /\.select\('id,[^']*\bguest_count\b[^']*\bis_test\b[^']*booking_code[^']*'\)/.test(src)
  || /\.select\('id,[^']*\bis_test\b[^']*\bguest_count\b[^']*booking_code[^']*'\)/.test(src),
  'the ota_reservations SELECT that feeds the booking panel must include both guest_count and is_test — otherwise entry_access_confirm_roster rejects every click',
);

console.log('PASS round66-manual-release: button rendered only when entry_checkin_required=true; IT+EN labels & audit-disclosure tooltip; handler calls confirm_roster + set_release via sb.rpc; separate randomUUID request IDs; state_version threaded between the two RPCs; audit-disclosure confirm dialog in both languages; roster/release error paths both surfaced; incomplete-data guard.');
