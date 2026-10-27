// Hotfix 2026-10-27 — regression guard for the invite/recovery password-set
// modal and the stuck-email guidance.
//
// Background: iOS Safari / Chrome mobile treat the native `prompt()` dialog
// as a password-collection input and silently inject a Keychain-generated
// password. Our previous invite handler called `prompt("Imposta la tua
// password…")`, accepted whatever came back (incl. the invisible autofill),
// and signed the user in with a password they didn't know existed. Separately,
// Supabase's default SMTP rate-limits password-reset emails to roughly
// 2 per recipient per hour, and the sender often lands in Gmail spam — so
// users clicking "forgot password" never got the email and had no fallback.
//
// This test enforces:
//   1. No native `prompt(` call survives in the invite/recovery handler.
//   2. The replacement helper `window.promptForNewPassword` exists.
//   3. The modal uses two `<input type="password" autocomplete="new-password">`
//      fields (defence against silent single-field autofill).
//   4. The `forgotPassword()` and `firstTimeSetup()` success messages
//      include a visible fallback to `info@welcomebnb.it` so stuck users
//      have a human escape hatch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'host-console.html'), 'utf8');

// ── 1. No raw prompt() for password collection in the auth handler ──────
// The regression we are preventing: a `prompt("…password…")` inside the
// SIGNED_IN / PASSWORD_RECOVERY branch. Grep for `prompt(` in a window that
// also mentions `updateUser` nearby — a precise test that still permits
// future unrelated prompt() calls elsewhere in the file.
const authHandlerStart = src.indexOf('async function handleHostAuthEvent');
assert.ok(authHandlerStart > 0, 'handleHostAuthEvent function must exist');
const authHandlerEnd = src.indexOf('onAuthStateChange', authHandlerStart);
assert.ok(authHandlerEnd > authHandlerStart, 'auth handler region must end before onAuthStateChange binding');
const authRegion = src.slice(authHandlerStart, authHandlerEnd);
assert.ok(
  !/\bprompt\s*\(/.test(authRegion),
  'handleHostAuthEvent must not call native prompt() — iOS/Android keychains silently autofill it. Use promptForNewPassword modal instead.',
);

// ── 2. The replacement helper exists and is wired up ────────────────────
assert.ok(
  /window\.promptForNewPassword\s*=\s*function/.test(src),
  'window.promptForNewPassword helper must be defined',
);
assert.ok(
  /await\s+window\.promptForNewPassword\(/.test(authRegion),
  'handleHostAuthEvent must await window.promptForNewPassword() instead of prompt()',
);

// ── 3. Modal uses two password fields with autocomplete=new-password ───
const helperStart = src.indexOf('window.promptForNewPassword');
const helperEnd = src.indexOf('async function handleHostAuthEvent', helperStart);
assert.ok(helperEnd > helperStart, 'helper must appear before the auth handler');
const helperSrc = src.slice(helperStart, helperEnd);

// The modal must build type="password" inputs with autocomplete="new-password".
// We count mkField() invocations rather than the inner `inp.type = 'password'`
// — the field factory is a reusable closure, so there is exactly one
// assignment-site but it fires once per call.
assert.ok(
  /\.type\s*=\s*['"]password['"]/.test(helperSrc),
  'modal field factory must set input.type = "password"',
);
assert.ok(
  /autocomplete['"]?\s*,\s*['"]new-password['"]/.test(helperSrc),
  'modal must set autocomplete="new-password" — flags the inputs to password managers as a create-new-password form, not a login',
);
// Two fields (new + confirm) make silent single-field autofill user-visible.
// Count distinct mkField() CALLS, not definitions.
const fieldCalls = (helperSrc.match(/mkField\s*\(/g) || []).length;
// one definition + two call sites = 3 matches total
assert.ok(
  fieldCalls >= 3,
  `modal must build two password fields via mkField() calls (saw ${fieldCalls} occurrences incl. the definition); two fields defeat silent single-field autofill`,
);

// Modal must enforce a confirm-match before resolving — the second input is
// not decorative.
assert.ok(
  /p1\s*!==\s*p2/.test(helperSrc) || /password.*mismatch|non coincid/i.test(helperSrc),
  'modal must require the two password fields to match before resolving',
);

// ── 4. Stuck-email guidance surfaces the human fallback ────────────────
// Both forgotPassword() and firstTimeSetup() success messages must mention
// info@welcomebnb.it so a user who never receives the Supabase email has a
// human escape hatch (Supabase's default SMTP rate-limits + Gmail spam).
const forgotStart = src.indexOf('async function forgotPassword');
assert.ok(forgotStart > 0, 'forgotPassword function must exist');
const forgotEnd = src.indexOf('async function firstTimeSetup', forgotStart);
assert.ok(forgotEnd > forgotStart, 'firstTimeSetup must come after forgotPassword');
const forgotSrc = src.slice(forgotStart, forgotEnd);
assert.ok(
  /info@welcomebnb\.it/.test(forgotSrc),
  'forgotPassword() success message must mention info@welcomebnb.it as a fallback',
);
assert.ok(
  /spam/i.test(forgotSrc),
  'forgotPassword() must mention checking the spam folder',
);

const firstTimeStart = src.indexOf('async function firstTimeSetup');
assert.ok(firstTimeStart > 0, 'firstTimeSetup function must exist');
// Search ahead a bounded distance for its body.
const firstTimeSrc = src.slice(firstTimeStart, firstTimeStart + 4000);
assert.ok(
  /info@welcomebnb\.it/.test(firstTimeSrc),
  'firstTimeSetup() success message must mention info@welcomebnb.it as a fallback',
);
assert.ok(
  /spam/i.test(firstTimeSrc),
  'firstTimeSetup() must mention checking the spam folder',
);

// ── 5. Admin UI exposes "Link accesso" (Copy link) for accepted users ──
// A user who already accepted the invite and now cannot sign in needs a
// direct magic-link; the backend's generate_link action falls back to
// type=magiclink on email_exists at api/admin-invite-host.js:198. Without
// a UI button exposing it, the admin has no way to produce one.
const adminSrc = fs.readFileSync(path.resolve(here, '..', 'admin.html'), 'utf8');
assert.ok(
  /inv\.status\s*!==\s*['"]revoked['"][^]*?opsCopyInviteLink/.test(adminSrc),
  'admin.html must expose the Copy link / Link accesso button for every non-revoked invite status (invited AND accepted), so an accepted-but-stuck host can get a direct magic-link bypass of the stuck Supabase email',
);

console.log('PASS round67-password-modal: no prompt() in auth handler; promptForNewPassword modal exists with two autocomplete="new-password" fields + confirm-match; forgotPassword and firstTimeSetup success messages name info@welcomebnb.it + spam-folder fallback; admin UI exposes direct-link button for accepted users.');
