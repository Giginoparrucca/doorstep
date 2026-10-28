// Round 66 Phase 2c — guest-side locked/scheduled card static guard.
//
// api/guest.js:doProperty now returns `entry_release: { state, reason,
// allow_entry, submitted, expected, release_at }` on every property
// response that carries a bookingCode. index.html reads this and
// overrides the access_method text + hides lockboxCodesWrap when the
// policy denies entry. Tests the entire wiring from server to UI:
//
//   1. doProperty populates entry_release from evaluateGuestEntryRelease
//   2. The guest UI reads r.data.entry_release
//   3. Both IT and EN messages exist for both locked and scheduled
//   4. The lockboxCodesWrap element is forced hidden on deny
//
// A diff that silently drops a layer of this wiring fails here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guestApi = fs.readFileSync(path.resolve(here, '..', 'api', 'guest.js'), 'utf8');
const index = fs.readFileSync(path.resolve(here, '..', 'index.html'), 'utf8');
const loader = fs.readFileSync(path.resolve(here, '..', 'api', '_entry-release-loader.js'), 'utf8');

// ── 1. Loader exports evaluateGuestEntryRelease ─────────────────────
assert.ok(
  /export\s+async\s+function\s+evaluateGuestEntryRelease\s*\(/.test(loader),
  'loader must export evaluateGuestEntryRelease(opts)',
);
assert.ok(
  /no_snapshot/.test(loader),
  'loader must return an unavailable fallback with reason=no_snapshot',
);

// ── 2. doProperty imports and calls evaluateGuestEntryRelease ───────
assert.ok(
  /import\s*\{[^}]*evaluateGuestEntryRelease[^}]*\}\s*from\s*['"]\.\/_entry-release-loader\.js['"]/.test(guestApi),
  'api/guest.js must import evaluateGuestEntryRelease',
);
assert.ok(
  /resp\.entry_release\s*=\s*\{[\s\S]{0,500}state:\s*policy\.state[\s\S]{0,500}release_at:\s*policy\.release_at/.test(guestApi),
  'doProperty must attach entry_release to the response',
);
assert.ok(
  /state:\s*'unavailable',\s*reason:\s*'policy_error'/.test(guestApi),
  'doProperty must fall closed to unavailable/policy_error on loader throws',
);

// ── 3. Guest UI reads entry_release from the response ────────────────
assert.ok(
  /r\?\.data\?\.entry_release/.test(index),
  'index.html must read r.data.entry_release',
);
assert.ok(
  /er\.state\s*===\s*'locked'/.test(index),
  'index.html must branch on er.state===locked',
);
assert.ok(
  /er\.state\s*===\s*'scheduled'/.test(index),
  'index.html must branch on er.state===scheduled',
);
assert.ok(
  /!er\.allow_entry/.test(index),
  'index.html must gate the override on !er.allow_entry so legacy_available keeps rendering today',
);

// ── 4. Guest-facing strings exist for both languages and both states ─
assert.ok(
  /Completa il check-in online per visualizzare le istruzioni di accesso/.test(index),
  'IT locked message must be present verbatim',
);
assert.ok(
  /Complete online check-in to view your entry instructions/.test(index),
  'EN locked message must be present verbatim',
);
assert.ok(
  /Le istruzioni di accesso saranno disponibili dalle \$\{timeStr\}/.test(index),
  'IT scheduled message template must be present verbatim',
);
assert.ok(
  /Your entry instructions will be available from \$\{timeStr\}/.test(index),
  'EN scheduled message template must be present verbatim',
);
assert.ok(
  /Istruzioni di accesso non disponibili\. Contatta il tuo host/.test(index),
  'IT unavailable fallback must be present',
);
assert.ok(
  /Entry instructions unavailable\. Please contact your host/.test(index),
  'EN unavailable fallback must be present',
);

// ── 5. The lockbox codes block is explicitly hidden on deny ─────────
assert.ok(
  /lcw\.style\.display\s*=\s*'none'/.test(index),
  'guest UI must force lockboxCodesWrap hidden when policy denies entry',
);

// ── 6. The scheduled branch uses Date.parse() of release_at, not a raw
//    client timestamp — the server is authoritative on release_at.
assert.ok(
  /new Date\(er\.release_at\)/.test(index),
  'scheduled branch must build the wall-clock from the server-returned er.release_at',
);

// ── 7. Phase 2f — "manual" release path. When the host has clicked
// "Rilascia accesso" the policy returns state=manual with allow_entry=true.
// The guest UI must render a visible chip under the access-method line so
// the guest sees the released confirmation, and the lockbox tile must
// keep rendering (not hidden) because the code IS available.
assert.ok(
  /er\.state === 'manual'.*er\.allow_entry/s.test(index),
  'guest UI must branch on state=manual + allow_entry',
);
assert.ok(
  /Il tuo host ha rilasciato il codice di accesso/.test(index),
  'IT manual-release chip must be present verbatim',
);
assert.ok(
  /Your host has released the access code/.test(index),
  'EN manual-release chip must be present verbatim',
);
assert.ok(
  /entry-released-note/.test(index),
  'manual-release chip must carry its own CSS class so a repeat render does not stack',
);

// ── 8. Phase 2f — fixed keybox_code must flow through doProperty so the
// guest's _resolveLockboxCodes can read propData.keybox_code. For every
// property today the code was absent from the server response (never in
// PROPERTY_PUBLIC_FIELDS), so fixed-code properties quietly rendered
// an empty lockbox tile. Lock that in now:
assert.ok(
  /const PROPERTY_PUBLIC_FIELDS = \[[\s\S]*?'keybox_code'[\s\S]*?\];/.test(guestApi),
  'PROPERTY_PUBLIC_FIELDS must include keybox_code',
);
assert.ok(
  /const PROPERTY_POST_CHECKIN_FIELDS = new Set\(\[[\s\S]*?'keybox_code'[\s\S]*?\]\)/.test(guestApi),
  'PROPERTY_POST_CHECKIN_FIELDS must gate keybox_code behind the entry-release policy',
);

console.log('PASS round66-guest-entry-release: loader exports evaluateGuestEntryRelease with no_snapshot fallback; doProperty attaches entry_release with fail-closed policy_error; guest UI reads r.data.entry_release and branches on state (locked/scheduled/unavailable); IT + EN strings present for all three deny states; lockboxCodesWrap hidden on deny; scheduled uses server-authoritative release_at.');
