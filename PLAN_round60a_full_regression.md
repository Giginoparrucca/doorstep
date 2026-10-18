# Round 60a — Full regression suite and coverage gaps

Runs **before** Round 60 (B&B rooms). Goal: every future round proves that the
whole product still works, including areas it did not touch. No product
behaviour changes in this round.

## Phase 1 — one command for everything

- Add a dependency-free runner `scripts/run-tests.mjs` and npm scripts:
  - `npm test` — every offline test (`scripts/*.test.mjs`, plus the Python
    schema-parse test if Python is available; report it as skipped otherwise).
  - `npm run test:browser` — every `*-browser.test.mjs` and other Chromium
    suites, IT/EN at 390/1280px as each suite already defines.
  - `npm run test:live` — read-only production/demo smoke (`demo-live-smoke`
    and similar). Never writes guest data.
  - `npm run test:all` — `test` + `test:browser`.
- Discovery is automatic (glob), so a new test file is included without editing
  the runner. Tests are classified by filename/convention, documented in the
  runner header; a test that needs secrets or network it doesn't have must
  report **skipped with the reason**, never pass silently.
- Output: one summary line per file (pass / fail / skipped + reason) and totals;
  non-zero exit on any failure.
- Gate: `npm run test:all` runs green on current main, and the summary is pasted
  into the CHANGELOG. Any pre-existing failure found here is fixed or recorded
  as a named blocker before Phase 2.

## Phase 2 — fill coverage gaps

Inventory first: list every API endpoint, shared lib and host/guest feature
against the tests that exercise it; add the table to the CHANGELOG. Known gaps
from a filename scan (confirm in the inventory):

1. **Alloggiati `.txt` golden files.** Today `golden-check.mjs` depends on a
   gitignored real-PII fixture. Replace with **synthetic, committed fixtures**
   covering: Italian guest, foreign-born guest (two blank spaces in
   *provincia*), group leader + family members, multi-night and one-night
   stays, document types. Commit expected output and compare byte-for-byte.
   Same approach for ROSS1000 XML and each regional format in
   `lib/regional-exports.js`.
2. **Tourist tax** — calculation (rate, max nights, age exemptions, rulesets)
   and the PayTourist CSV export, with golden output.
3. **Guest chat** (`api/chat.js`, chat path in `api/guest.js`) — guest message
   stored, AI reply path mocked, escalation and de-escalation, cross-property
   isolation (a token for property A can never read property B's chat).
4. **Host notifications** (`api/_notify-host.js`) — trigger rules, throttle,
   channel selection and email fallback, with push/Telegram/Resend mocked;
   assert no guest data in any payload.
5. **iCal sync server endpoint** (`api/ical-sync.js`) — parsing Airbnb /
   Booking / Vrbo samples, cancellations, echo/coverage, idempotent re-sync.
6. **Arrival reminders** (`api/send-arrival-reminders.js`) — who gets a
   reminder, when, dedup, and language.
7. **Document scanning** (`api/scan-document.js`) — request validation, rate
   limit, Anthropic call mocked; photo retention purge queued.

All new tests are offline and mock external services (Supabase via a local
fake or recorded responses, Anthropic, Telegram, Resend, web-push, OTAs).
No secrets, no live writes.

- Gate: every gap above has at least one passing test or a CHANGELOG entry
  explaining why it can't be tested offline; `npm run test:all` green.

## Phase 3 — make it permanent

- Add the "Full regression" rule to `AGENTS.md` (already drafted in this round's
  commit) and reference it from `RELEASE.md`.
- Add `npm run test:all` to the PR template / release checklist if one exists.
- Update CHANGELOG with the final pass/skip counts and the coverage table.

Out of scope: refactoring product code beyond what a test needs to be
importable (any such change must be behaviour-neutral and called out).
