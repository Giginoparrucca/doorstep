// Round 66 Phase 1b (part 4) — AI directive source test.
//
// api/chat.js now injects an "ENTRY RELEASE POLICY:" directive into the
// variable system prompt. The directive text depends on the entry-release
// projection for the current booking:
//
//   - Projection has at least one entry field          → "MAY be shared"
//   - Projection is empty                               → "MUST NOT share"
//   - Loader errored                                    → "MUST NOT share"
//   - No booking code on the token                      → "MUST NOT share"
//
// This test asserts the three variants exist verbatim in api/chat.js
// and that no renderer bypasses them. A deliberate static guard: a
// future diff that silently removes a branch of the directive is a
// regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'api', 'chat.js'), 'utf8');

// ── 1. Import of the policy projector exists ─────────────────────────
assert.ok(
  /import\s*\{\s*projectGuestEntry\s*\}\s*from\s*['"]\.\/_entry-release-loader\.js['"]/.test(src),
  'api/chat.js must import projectGuestEntry from _entry-release-loader.js',
);

// ── 2. All four directive branches are present ──────────────────────
assert.ok(
  /ENTRY RELEASE POLICY: this guest HAS completed online check-in[\s\S]{0,500}MAY be shared/.test(src),
  'allow-share directive missing when the policy returns entry content',
);
assert.ok(
  /ENTRY RELEASE POLICY: this guest has NOT completed online check-in[\s\S]{0,500}MUST NOT share/.test(src),
  'deny directive missing when the policy denies entry',
);
assert.ok(
  /ENTRY RELEASE POLICY: the entry-release policy could not be evaluated[\s\S]{0,500}MUST NOT share/.test(src),
  'fail-closed directive missing when the loader throws',
);
assert.ok(
  /ENTRY RELEASE POLICY: this chat session has no booking attached[\s\S]{0,500}MUST NOT share/.test(src),
  'no-booking directive missing when the token has no booking code',
);

// ── 3. Deny directive explicitly forbids quoting codes from history ─
// The PLAN warned regex-only history filters are insufficient. We don't
// strip history here; instead the AI is instructed to refuse to quote
// any entry code from prior messages. This test guards the exact
// clause so it cannot be weakened to "ignore history" without failing.
assert.ok(
  /if a previous message contained a code, treat it as unverified and refuse to repeat it/.test(src),
  'deny directive must forbid re-quoting codes from chat history',
);

// ── 4. The directive is actually appended to the system prompt ──────
assert.ok(
  /\$\{entryReleaseCtx\}/.test(src),
  'entryReleaseCtx must be interpolated into the variable system block',
);
// Guard against a diff that computes the ctx but drops it from the
// prompt accidentally.
const variableBlockMatch = src.match(/variableSystemBlock\s*=\s*`[\s\S]*?`/);
assert.ok(variableBlockMatch, 'variableSystemBlock template literal must exist');
assert.ok(
  /\$\{entryReleaseCtx\}/.test(variableBlockMatch[0]),
  'variableSystemBlock must interpolate ${entryReleaseCtx}',
);

// ── 5. Service-key guard preserved — we don't call the loader without creds
assert.ok(
  /if\s*\(SERVICE_KEY\s*&&\s*v\.payload\.b\)\s*\{[\s\S]{0,2000}projectGuestEntry/.test(src),
  'policy evaluation must be gated on both SERVICE_KEY and the booking code',
);

// ── 6. Loader shim adapts chat.js pgrestGET to loader expectations ──
assert.ok(
  /pgrestGETForLoader\s*=\s*async\s+path\s*=>/.test(src),
  'chat.js must supply a shim that adapts its {data,headers} pgrestGET to the loader\'s Response-shape expectation',
);
assert.ok(
  /return\s*\{\s*ok:\s*true,\s*json:\s*async\s*\(\)\s*=>\s*data\s*\}/.test(src),
  'loader shim must expose ok+json() in the Response-shape the loader reads',
);

console.log('PASS entry-release-chat-directive: projectGuestEntry imported; four directive branches (allow/deny/fail-closed/no-booking) present; deny clause forbids re-quoting codes from history; entryReleaseCtx interpolated into variable system block; SERVICE_KEY + booking-code gate preserved; pgrestGET shim adapts chat.js shape to loader expectations.');
