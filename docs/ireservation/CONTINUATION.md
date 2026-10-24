# Continue Round 63 — developer / Claude / GPT guide

**As of 24 October 2026: Phases 1–2 verified; manual comparison shipped. Native imports are not live.**
Start at [the plan](../../PLAN_round63_ireservation_native_api.md),
[provider facts](API_REFERENCE.md), [sanitized schema](schema.snapshot.json) and
[operations](OPERATIONS.md). Phases 1–2 are complete (latest verification below); Phases 3–6 remain gated. Availability phase
5 is provider-blocked. Documentation publication is not an API smoke test.

## First actions in the next implementation session

1. Read repository AGENTS.md and CHANGELOG top-to-bottom; fetch remote main and
   inspect current in-flight ownership. Preserve earlier tables/attribution.
   Daniele confirmed Round 63 implementation on 24 October; it is now open.
   Do not request that confirmation again. Phase 2 shipped in PR #197. Phase 3 needs the real-property pilot and provider
   contract evidence below before cutover; do not silently activate it.
2. Inspect the local calendar/security entry points below. Use the repository's
   established server/database/auth boundaries; plan new tables and routes only
   after checking current runtime/function limits and release configuration.
3. Recheck official schema URLs/version against the snapshot. Obtain secrets
   through the restricted handover in OPERATIONS. Do not search by secret value,
   echo them into shell commands or save request/response dumps. Never copy a
   raw correspondence export or original PDF into Git. Missing secure access is
   a named blocker; continue with synthetic client/tenant-isolation tests.
4. Reuse the verified Phase 1 client and its tests; do not redo provisioning. Provision only
   in the appropriate environment; preview/demo must not inherit production
   property credentials. The demo integration restrictions remain mandatory.
   Secure test property 330 reads must be explicitly recorded, never inferred
   from mocked tests or a docs-root 403 response.
5. Resolve date window/completeness, timezone/ordering and inventory mapping
   questions before enabling affected Phase 2/3 behavior. Maintain a provider
   question/answer record with nonsecret facts and date. Provider messages require
   human authorization; no message has been sent in this documentation task.
6. Advance phase-by-phase only after full regression + phase-specific evidence,
   CI and deployment/live checks where applicable. Record status, exact commits,
   skips/blockers and next action in CHANGELOG on every handoff.

## Repository map (reviewed on main a2ec7c5)

| File / area | Why it matters |
|---|---|
| `api/ical-sync.js` | Inbound cron/manual sync, scoped UID/source metadata, legacy adoption, cancellation sweep; also outbound iCal feed. Do not let old sweeps cancel native rows. |
| `lib/calendar-roundtrip.js` | Current origin/echo and same-room logic; confirm exports at implementation time. |
| `host-console.html` | Calendar room filters, direct bookings/blocks, Settings feed assignments, Sync now and all-date feedback; preserve Calendar's protection against stale hidden Settings writes. |
| `migration_round26_ical_sync.sql` | Current ota_reservations shape, UID uniqueness, grants/RLS. |
| `migration_round45_direct_reservations.sql` | Host-only contact/notes, booking codes, covered echo links and direct/block behavior. |
| `supabase/migrations/20261018100000_round60_bnb_rooms.sql` | property_rooms, room scoping and existing room constraints. |
| `api/alloggiati.js`, `api/_alloggiati-crypto.js` | Existing encrypted-secret/auth patterns to review; use a distinct iReservation key and tenant-bound AAD. |
| `api/_environment.js`, `app-config.js` | Demo/production separation; no external integration writes from demos. |
| `api/send-arrival-reminders.js`, `api/guest.js` | Imported rows must not create duplicate reminders or leak private API data through guest routes. |
| `host-guides.js` | Update actual IT/EN host guides only when the connection UI exists; bump guide version and check targets per RELEASE. |
| `scripts/run-tests.mjs`, `.github/workflows/regression.yml` | Full regression discovery and required CI; add tests to the suite, not a one-off manual script. |
| `scripts/schema-drift.test.live.mjs` | Any new migration must be applied and independently verified against production before claiming it shipped. |
| `RELEASE.md`, `CHANGELOG.md`, `AGENTS.md` | Publication, status/ownership, regression and rollback contract. |

Existing regression families to extend: `ical-sync-parse`, `calendar-roundtrip`,
`calendar-feed-assignment`, `calendar-sync-settings`, `rooms-calendar-static`,
`rooms-sync`, `guest-links`, `guest-room`, `share-reminder`, `auth-lifecycle`,
`admin-access` and `unsaved-forms`. Filenames evolve; inspect current scripts and
runner discovery rather than assuming the list is exhaustive. New proposed
`ireservation-*.test.mjs` files must use fictional data/transport and join the full
suite. Live tests need explicit configuration and exit 77 with a safe reason
when unavailable, never an automatic pass.

## Required synthetic cases and pilot evidence

- Initial login vs refresh, missing/null replacement refresh token, expiry skew,
  worker races, 401 then one refresh, repeated auth failure, malformed/null body,
  nonzero body with HTTP 200, 429 budget exhaustion, 500 and bounded read retries.
- Two tenants with colliding remote IDs; every read/write/config/status route
  denies cross-property and anon access; tenant-swapped ciphertext fails. Rotation
  invalidates stale workers, and no secret appears in logs, browser or artifacts.
- Room/property type mapping, duplicate room labels, repeated room IDs and
  multi-room bookings; explicit unsupported allocation quarantine. Native room
  IDs must be proven separately from legacy iCal category IDs.
- I/U upsert, D cancellation, duplicate/out-of-order/cross-window rows, equal
  timestamp conflicts, unknown status, nullable data, stale connection version,
  incomplete response and empty listing. No missing-row cancellation. Preserve
  guest link/check-in identity and protect host-owned fields.
- Compare mode yields **zero calendar/booking-code/check-in writes**, despite
  cron/manual concurrency. A scoped cutover/rollback drill proves exactly one
  writer, stable local UUIDs/links and no duplicate reminders or OTA echoes.
- For future writes, I omits ID; U complete replacement; D exact mapped direct
  ID; provider rejects unavailable inventory atomically. Ambiguous accepted-I
  timeout stays outcome_unknown until remote reconciliation proves the outcome;
  multiple HTTP attempts must never create a second reservation.
- For future availability, zeros create only owned blocks; positive complete
  evidence reopens only those blocks. Partial failures never reopen inventory;
  room-type totals are not blindly projected onto physical units. No fabricated
  guest booking as a closure workaround.

Pilot record: exact source revision, environment, permitted property/scope,
credential version (no values), query windows, completeness findings, stable
identity/mapping evidence, discrepancy counts, before/after fingerprints,
cutover/rollback run IDs and full test totals. Do not commit guest PII or raw
provider/feed payloads. Use tenant-private evidence storage for sensitive probes.

## Host guide content to ship with the UI

Explain in both IT/EN: where to find calendarId and set distinct property
credentials; that passwords are write-only and how to rotate/disconnect; explicit
room mapping and unresolved inventory; compare mode vs active API reads; fetched
all-date counts vs current month; last attempt vs last successful complete sync;
stale/auth/quota/mapping error recovery; iCal source handover and no immediate
real-time guarantee. Explain that current reservation reads do not import owner
availability closures. Do not advertise native availability or two-way writes
until the corresponding phase has separately passed its gates. The Phase 2 Settings guide is now bilingual and names the actual connection,
mapping and comparison controls; do not advertise later sync controls.

## Handoff checklist

Report: phase/subphase + model owner; implemented vs planned; exact commit/PR;
full regression and phase tests with skips; production migration lookup if any;
CI/deployment/live evidence where applicable; secret provisioning status without
values; provider questions resolved/unresolved; last complete comparison and
rollback status; smallest next action. A paused/blocked capability must be stated
explicitly, not buried in an implementation summary.

## Implementation checkpoint — 24 October 2026

Daniele approved starting Round 63 after the host-impact recap. Phase 1 is now
in progress. Implemented backend scope (Phase 1a): `api/_ireservation-core.js`
(AAD encryption and read-only partner client), `_ireservation-store.js` (durable
state gateway), `_ireservation.js` (owner-only connection actions). Routed through
`POST /api/ical-sync?integration=ireservation&action=status|save|verify|disconnect`
to retain the existing 12-function budget. No host form, mapping, scheduler,
calendar import, availability read or provider reservation-write method yet.
The global `IRESERVATION_ENABLED` gate defaults off. Preview/demo are rejected.

`supabase/migrations/20261024074843_round63_ireservation_secure_state.sql` adds
private connections, encrypted partner tokens, rolling request accounting and a
service-only RPC with ownership rechecks, compare-and-swap and refresh leases.
`ireservation_private` has no schema/table grants for browser or service roles;
only the narrow service-only definer RPC accesses it. RLS with no policies is
intentional default deny, not an invitation to grant browser access. Synthetic
state/permission probes in `scripts/ireservation-state-probe.sql` passed against
demo and production, in transactions that roll back. PR #195 CI subsequently passed the protected production schema-drift lookup.
Backend Phase 1a was published as merge a2332048b27e47a09e6313285b5efc6f2221a54f;
the full Phase 1 remains partial until secure provisioning and live API checks pass.

Connection requests carry property_id. Save/verify/disconnect also require the
current `version` returned by status (`none` for first save). Save takes integer
`calendar_id`, `propertyUsername`, `propertyPassword`; empty password retains the
existing value only for the same calendar. All successful browser responses are
masked; verification returns only status and room count. Disconnect clears the
ciphertext and rotates version; transferred ownership fails closed pending
operator re-onboarding. Only property owners can configure this first backend;
admin view alone gives no credential access.

No partner secrets were provisioned by this phase; existing deployment values could
not be inspected. No authenticated provider probe is
claimed. Vercel team access currently returns 403; a consent link was offered to
Daniele. Resume with that scope authorized, provision secrets through the secure
operations workflow, and run the opt-in `scripts/ireservation-read.test.live.mjs`
against test calendar 330. It requires `IRESERVATION_LIVE_PROBE=true`, the documented
test identifiers/password and partner/storage keys. It prints counts only and
never saves reservations. The normal live runner skips this test unless opted
in; do not interpret a skip as a live API pass. Finish Phase 1 before Phase 2.

Publication evidence: PR #195; full local and PR CI regression 59 passed / 0 failed / 3 prerequisite skips. PR CI live suite 1/0/4 includes a passing production schema-drift check. Post-deployment public route reports integration_disabled (503); local production smoke 2/0/3. The authenticated provider probe remains skipped, not passed. See CHANGELOG for exact run/deployment IDs and skip reasons.


### Phase 1b provisioning checkpoint

Vercel team access was authorized, followed by Daniele's explicit approval to
store partner/test credentials and a generated encryption key as production
Secrets in project welcomebnb. The variables are now provisioned for Production
only; `IRESERVATION_ENABLED=false` and `IRESERVATION_WRITES_ENABLED=false` remain.
A recovery copy of the generated encryption key is held locally in ignored
`.env.local` with owner-only permissions (0600); no partner/test password was
written there. Never print or commit that file. Use approved private recovery
storage when moving development machines.

The repository's `vercel.mjs` config takes precedence over a deployment-level
build command. The first rebuild therefore did not execute the probe; READY was
not counted as a provider test pass. `scripts/build-config.mjs` now has an
explicit `IRESERVATION_BUILD_PROBE=true` opt-in to the shared test-property-only
`scripts/ireservation-read-probe.mjs`. It uses the existing server role in the
protected production build without exporting that key. The probe refuses other
projects/environments/calendars, returns only counts, never modifies reservations,
and keeps the deployed runtime gate false. Turn the build-probe flag off after
verification so ordinary builds do not make partner requests. Record the actual
provider result/deployment before marking Phase 1 complete.


### Phase 1 completed — protected real provider read (historical gate)

PR #196 merged as 1a08e70fbc9fae6dd5254222c41e7b5ff2c223ec after CI passed
full regression 60/0/3 and protected schema lookup (CI live 1/0/4). Production
build dpl_nisyTTsZJHphA1tqN5fMsSXMSXMe actually ran the shared client with the
approved test credentials: **7 rooms, 5 distributors**, 3 accounted requests.
No guest/reservation/calendar writes, zero property connections, one encrypted
partner token record. The one-time build flag is false again; runtime and writes
remain false. Production gate returns integration_disabled. Local post-deploy
smoke 2/0/3; its standalone provider skip is separate from the passing real build
probe. The earlier 403/provisioning blockers are resolved. Phase 2 is now owned
by GPT-6; build mapping/comparison only, not cutover.


## Phase 2 implementation checkpoint

Owner-only Settings UI is in `host-ireservation.js`, loaded by host-console.
`api/_ireservation-compare.js` normalizes and minimizes reservation reads;
`_ireservation-comparison-actions.js` orchestrates the explicit mapping and shadow
report through service-only `ireservation_compare_state`. The CLI-generated
`20261024084140_round63_ireservation_comparison.sql` stores private mappings and
20 latest reports, never edits OTA/check-in data. No import/scheduler/cutover.
The earlier Phase 1 paragraphs are historical checkpoints, superseded by its
completed gate and the latest CHANGELOG evidence.

Tests: comparison normalization/mapping/status/conflicts/no cancellation and full
action→client→provider fixture→final-CAS integration; all new actions deny tenant/
anonymous misuse. New real Chromium suite covers IT/EN at390/1280px, save errors,
dirty cancel, mapping confirmation, malicious label/reference text, late responses
on property change, owner/admin gates and actual Settings guide missingTargets=[].
`scripts/ireservation-comparison-probe.sql` independently exercises database
ownership/CAS/grants/range/rotation/deleted-room/report constraints in a rollback
transaction, comparing OTA, check-in and booking-link-related fingerprints.

Next cutover gate: an owner must configure the real property's distinct channel-
manager credentials in the secure form and explicitly confirm physical room
mappings. A real-property pilot discrepancy review and provider answers about
range overlap/completeness/pagination, timezone/order and multi-unit allocation
are still missing. Do not guess these or switch off iCal. Phase 3 cannot safely
activate from the test calendar counts. Prepare provider questions, but do not
send them without authorization. Availability remains provider-blocked; outbound
I/U/D is future independent work. Keep can_cutover=false until the recorded pilot,
identity adoption, single-writer and rollback gates actually pass.


### Phase 2 verified release — 24 October

PR #197 / merge `8620372c45e804e43574484b629e257e3fce8c4b`; CI run40082742907
passed full62/0/3 and production drift (live1/0/4). Local full62/0/3 and post-deploy
live2/0/3; exact skips and SQL fingerprint evidence are in CHANGELOG. Production
`dpl_2vvhznxunAddc2TVtBqHbGhQZrHo` READY, exact public UI bytes verified. Real
protected provider probe:7 rooms/5 distributors/8 reservations; no calendar writes.
Runtime manual comparison enabled; build probe off; provider writes off. No real
property connection or mapping exists yet. No authenticated owner pilot claimed.

Continue at the named Phase 3 owner/provider gate, not a new Round. The existing
real property's private credentials must be entered through the secure owner form,
then mappings and discrepancies reviewed. Do not put test330 credentials on a
real property or claim date completeness from test counts. Unknown API semantics
and absence of published availability remain explicit blockers. No secrets belong
in this guide, source examples, scripts, logs, issues or CHANGELOG.
