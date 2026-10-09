# Round 50 - Demo environment and host onboarding

Date: 9 October 2026. Implementation status: planned, not yet provisioned.
Planning owner: GPT. Implementation owner: GPT or Claude, as recorded in CHANGELOG.md.
Technical documentation is in English. The presenter script and its PDF remain in Italian.

## Outcome

A permanent demo at `demo.welcomebnb.it`, running the same application code as
production with a separate database and entirely fictional guest data. Presenters
can demonstrate the guest journey and host console, then restore the initial state.

Deliver the working environment, presenter accounts, guest links/QR codes,
repeatable fixtures, clearly labelled simulations and the Italian
[onboarding script](docs/DEMO_ONBOARDING_IT.md). The PDF is generated from that
script; both must match whenever the script changes.
Documentation delivery does not mean the environment is operational.

## Execution ownership and autonomy

GPT or Claude owns every technical activity: discovery, implementation, project
creation through available access, environment configuration, secrets generation,
schema setup, seed data, deployments, test execution, fixes, PRs, merges,
verification, PDF updates and CHANGELOG maintenance.

Proceed through the phases in order without asking Daniele to approve routine
choices, run SQL, generate secrets, deploy, test, reset data or maintain documents.
After each test gate passes, record the evidence and continue to the next phase.
If tests fail, fix the phase and rerun the relevant checks before advancing.
Do not add a manual handoff when the agent has sufficient authorized access.

Daniele is involved only when strictly necessary: an account-owner-only login or
MFA action, permissions the agent cannot obtain, an actual billing approval, a DNS
change without accessible registrar controls, or a legal consent/signature that
must be performed by the responsible person. First complete all independent work,
try the authorized tools, and prepare the exact smallest remaining action. Record
why it is blocked and what access or action resolves it; do not delegate a whole
phase. Do not treat elapsed time or an unanswered question as approval.

Presenting the demo and agreeing a real host's onboarding details remain human
activities. Technical preparation, smoke checks and cleanup are agent-owned.
This protocol directs active work; it does not imply background execution when
no agent session or explicit automation is running.

## Architecture and operating constraints

- Separate Vercel and Supabase projects, with independent keys, accounts and
  storage. One source repository; no permanently divergent copy of the app.
- Deploy approved revisions and record the source commit. Apply versioned schema
  changes to the appropriate environments without copying production data.
- Build a verified schema-only baseline: tables, functions, triggers, grants,
  RLS, buckets and storage policies. Old migrations contain manual operations;
  do not replay them blindly or import production schedules or secrets.
- Real login, authorization, guest check-in, host dashboard and host/guest chat.
  Label external-service simulations at the point where they occur.
- Existing `?test=1` is not the showcase environment: it hides activity from host
  views and changes guest behavior. In the isolated demo database, fixtures must
  appear through the normal application filters. Track fixture identity separately;
  preserve the production meaning of `is_test`.
- No real Questura SOAP calls, Alloggiati credentials, OTA feeds or notifications
  to real hosts/guests. Enforce restrictions on the server, not just in the UI.
- AI and place search may be live with dedicated credentials, measured usage and
  limits. Use a declared demo location and verifiable real places with Maps links.
  Never invent walking times, opening hours or reviews for presentation purposes.
- First release supports one onboarding session at a time. Parallel presentations
  require independent datasets or session isolation before they are enabled.

## Delivery protocol and test gates

Read CHANGELOG.md top-to-bottom before every phase. Change its row from `pending`
to `in-progress - <model>` and commit before starting. Use the prefix
`Round 50 Phase N · ` for commits; use the actual subphase number for partial work.

Every implementation phase follows this sequence:

1. Implement that phase's scope and prepare rollback/recovery where applicable.
2. Run its mandatory tests against the actual result, not just the code draft.
3. Fix failures and rerun the affected tests. Run broader checks only when needed.
4. Record revision, environment, test commands/probes, results, limits and PR in
   CHANGELOG.md. A deployment alone is not a passing test.
5. Merge the complete phase and verify its deployment if that phase has one.
   Mark `shipped - PR #N - <model>` only when all acceptance criteria are covered.
6. Automatically take ownership of the next phase. If blocked, record the blocker
   and continue independent authorized work; do not mark an incomplete phase shipped.

Required test evidence is a compact reproducible record. Never store secrets or
personal data in logs, PR descriptions or CHANGELOG.md. Documentation-only edits
need content/link/render checks, not unnecessary runtime tests.

| Phase | Scope | Mandatory gate before the next phase |
|---|---|---|
| 0 / 0a | Plan, ownership rules, Italian script/PDF | Content, links, status consistency, PDF text and visual inspection |
| 1 | Environment configuration and server guards | Missing/mismatched config fails closed; blocked integrations cannot execute; production configuration regression checks |
| 2 | Projects, schema, auth, storage and deployment | Demo login/guest API/storage work; owner isolation holds; no production data/secrets/schedules imported |
| 3 | Fictional fixtures and showcase scenarios | Seed repeatability, relationship integrity, correct dashboard visibility and boundary dates |
| 4 | Reset and session management | Two complete resets, authorization/project guards, concurrency and failure recovery |
| 5 | Demo UX and labelled simulations | Real host/guest messaging, fake external calls, demo-only links and AI/place checks |
| 6 | End-to-end verification and release | Entire Italian script executed, mobile/desktop checks, production isolation and rollback verified |

## Phase 0 / 0a - Planning and presenter materials

- Maintain the current-round table, preserve Round 49's history, and link the plan.
- Keep the plan and permanent AGENTS.md instructions in English.
- Keep the presenter script in Italian and generate a legible PDF from it.
- Define agent ownership and mandatory tests between implementation phases.

Gate: resolve internal links; verify every phase has scope/tests/evidence; compare
PDF text with the script and visually inspect every rendered page. Record the
planning PR separately. Operational phases remain pending until implemented.

## Phase 1 - Configuration and server-side demo guards

- Inventory hardcoded database URLs, public keys, production fallbacks and links
  across guest/host/admin pages, APIs, guides, manifests, workers and notifications.
- Replace hardcoded frontend configuration with an environment-specific public
  configuration generated at deployment, or an equivalent verified mechanism.
  Expose only the Supabase URL/public key; keep service keys and secrets server-side.
- Define `APP_ENV=demo`, expected demo project ref, application origin and explicit
  CORS origins. Missing or inconsistent demo configuration must fail closed;
  never fall back to the production database or application URL.
- Guard Alloggiati, notifications, invitations, OTA sync/export and incoming
  integration webhooks on the server. Browser parameters cannot enable live calls.
  Set demo autofile default to `off`; even a crafted `live` request cannot call SOAP.
- Generate independent guest-token and AI credentials where authorized. Never
  copy the production Vault, cron secret, encrypted credentials or recipients.
- Scope browser cache/tokens by environment; preserve production behavior.
- Check the Vercel plan's function cap before adding endpoints; reuse a suitable
  dispatcher where necessary. Do not introduce a wildcard Vercel CORS rule.

Mandatory tests:
- Unit/probe cases for valid demo config, missing values and mismatched project ref.
- Direct API attempts to bypass demo guards for each external integration, with
  mocked outbound transports asserting zero real calls.
- Generated frontend config contains only public values; all demo links use demo origin.
- Relevant production config, guest-token and check-in regression checks still pass.

Exit: guarded build works locally/through an isolated test harness. Actual hosted
project setup is Phase 2; do not claim deployed isolation before it is tested.

## Phase 2 - Provisioning and reproducible schema

- Inspect accessible projects/plans, limits and costs. Create dedicated demo
  Supabase/Vercel projects using agent tools; record IDs, region and ownership.
- Build/apply the schema-only baseline and migrations, including explicit grants,
  owner-scoped RLS and private storage policies. No production row dump.
- Exclude production cron jobs: autofile, email dispatch, QA capture and purge.
  Document any demo-only maintenance job independently.
- Configure Vercel variables and repository connection, deploy, connect
  `demo.welcomebnb.it`, and complete DNS through available authorized controls.
  If registrar access is unavailable, prepare the exact DNS record for Daniele
  and continue testing on the assigned demo deployment URL.
- Configure demo-only Supabase Auth site/redirect URLs, invite-only access and
  named presenter accounts. Keep credentials out of the repository.
- Host/admin access requires authentication. Guest links/QR must work on a phone
  without an unrelated deployment-protection sign-in wall.
- Document and verify recovery/rollback without affecting production.

Mandatory tests:
- Login, token mint, guest gateway and private upload/read using fictional probes.
- Owner can access their rows; a second owner cannot read/change them. Guest tokens
  are scoped; cross-environment tokens are rejected.
- Inspect schema/grants/buckets and scheduled jobs; verify no production data,
  credentials or schedules were imported and backend/frontend refs match.
- HTTPS, Auth redirects and guest QR URL work on the deployed demo origin.
- Clean rebuild of the baseline in an isolated disposable environment succeeds;
  verify recovery without executing a destructive production probe.

Exit: functioning isolated demo foundation. Custom-domain completion remains a
blocker to final release if DNS is unfinished, even if the temporary URL works.

## Phase 3 - Fictional seed data and scenarios

- Version a repeatable seed/fixture manifest with stable IDs, reserved example
  emails, non-operational phone numbers and invented guest/document details.
- Create **Casa Demo WelcomeBnB** with authorized imagery, IT/EN content, example
  Wi-Fi/access details, rules and explicitly illustrative tourist-tax settings.
- Add a second fictional property for switching and ownership checks.
- Add 5-6 verifiable real recommendations around a declared demo location, with
  Maps links and sources. Do not invent current hours, reviews or route duration.
- Populate ten booking scenarios with dates relative to the reset day in Rome.
  Keep OTA/check-in dates, nights, booking codes and linked events consistent.

| Stable scenario | Relative date | Demonstration |
|---|---|---|
| DEMO-ARRIVO | Arrival tomorrow | Reservation and shareable guest link |
| DEMO-NUOVO | Arrival today; no check-in | Complete interactive guest journey |
| DEMO-SOGGIORNO | Arrived yesterday; leaves in 3 days | Active stay and guest details |
| DEMO-AIUTO | Current stay | Host help request and reply |
| DEMO-GRUPPO | Arrival today; 3 guests | Group lead and members |
| DEMO-CONFORMITA | Arrival yesterday | Simulated filing and sample receipt |
| DEMO-PARTENZA | Departure today | Departure actions |
| DEMO-RECENTE | Departed 3 days ago | Recent activity |
| DEMO-SCADUTO | Departed 8 days ago | Excluded from action board |
| DEMO-NOSHOW | Departed 8 days ago; no check-in | No stale check-in prompt |

- Seed IT/EN conversations, engagement events and an assistance request; label
  prerecorded conversation examples. Prepare a **FACSIMILE - DEMO** document
  image for simulated scanning, without a valid real identity.

Mandatory tests:
- Seed twice: same scenario counts and IDs, no duplicate relations or bookings.
- Validate FK/check constraints, nights, group lead/member relationships and dates.
- Assert scenarios appear in intended views; expired stays/no-shows do not appear
  on the action board. Test the existing seven-day cutoff at its exact boundary.
- Verify fixture content contains no copied production PII or operational credentials.

Exit: complete useful showcase data through normal app filters.

## Phase 4 - Reset and presentation sessions

- Implement presenter-only **Ripristina demo**, authorized on the server with a
  positive demo-project check. Confirmation describes affected demo data.
- Respect immutable Alloggiati audit logs. Use new demo datasets/sessions or a
  documented isolated administrative restore; do not weaken production grants
  or attempt a normal DELETE against the protected audit table.
- Reset bookings, check-ins, chat/escalations, events, dismissals, cooldowns,
  preferences, simulated receipts and session-created files. Preserve accounts.
- Rebase dates in `Europe/Rome`, preserving durations and relations; return a
  completion summary and refreshed guest links.
- Prevent stale client storage from resurrecting old check-ins; invalidate old
  session links/tokens as appropriate. Make reset atomic or recoverable.
- Lock concurrent resets and show which presentation session is active. First
  release is single-session; never reset another presenter's active session.
- Provide an agent-operated prepare/reset/smoke-check command or authenticated
  action so Daniele is not asked to run scripts or reseed the database.

Mandatory tests:
- Modify a full guest journey, reset, then repeat it and reset again; fixture
  state is restored and presenter access remains valid.
- Guest/non-presenter reset is denied; production/mismatched project reset is denied
  in a safe harness, without a destructive request against real production.
- Concurrent resets cannot corrupt state; injected mid-reset failure recovers.
- Test local-storage reuse, old guest links, day/month/year boundaries and Rome DST.

Exit: repeatable onboarding with verified recovery and session handling.

## Phase 5 - Demo UX and simulations

- Persistent Italian demo banner on guest and host pages; launch page with host,
  guest, QR and reset actions. Match actual interface labels in the script.
- Keep all generated links and QR codes on the demo origin after switching/reset.
- Simulated facsimile scanning returns declared fixture data; do not request
  personal documents during onboarding.
- Simulate Alloggiati validation, a correctable rejection, submission and a
  **FACSIMILE** receipt. Server guarantees zero SOAP calls even for live/manual modes.
- Capture notifications in a presenter-visible demo inbox. First release sends
  no external email, Telegram or push; no live invitation dispatch to real users.
- OTA demonstration uses local fixtures; real feeds and outbound sync stay blocked.
- Live AI/place search has dedicated usage limits. Provide clearly labelled
  prerecorded examples for outages; Maps links and uncertainty remain explicit.
- Update affected in-app guides and version strings under the existing guide contract.

Mandatory tests:
- Desktop/mobile guest-to-host escalation and host reply appear through the real
  message flow and polling; the demo inbox captures the expected alert.
- Validation/rejection/success/receipt simulations run with outbound transports
  proving zero SOAP/OTA/email/push/Telegram calls.
- Check link origin after property switching, notifications and reset.
- Walking-distance restaurant query uses the declared location and Maps; current
  facts have sources, and unverified route times are not asserted.
- Test AI failure/budget fallback and confirm examples are visibly prerecorded.

Exit: every live and simulated action in the script works and is clearly labelled.

## Phase 6 - End-to-end release and maintenance

- Agent performs the entire Italian script on desktop and mobile-size browser,
  then repeats the demo after reset. Record the actual deployed revision.
- Verify database, API, storage and all generated links remain isolated; inspect
  requests/logs for unwanted real integrations or production writes.
- Run relevant existing regression checks for affected production code and review
  RLS/grants, public configuration and secrets exposure.
- Verify deploy rollback and data recovery in demo; ensure a stable revision is
  available before future meetings.
- Deliver working URLs, secure presenter access, automatic preparation/cleanup,
  recovery instructions and the refreshed Italian script/PDF.
- Record deployment, PRs, test evidence, observed operating cost, maintenance owner
  and any unavoidable external action in CHANGELOG.md.

Mandatory tests:
- Full QR -> check-in -> AI -> escalation -> host reply -> simulated filing ->
  receipt -> reset journey, twice, plus desktop/mobile navigation and readability.
- Cross-environment token/config checks, no unauthorized outbound calls, no secrets
  in public files; complete all unresolved gates from previous phases.
- Italian PDF matches script, renders cleanly and uses actual released labels/URLs.
- Rollback restores the previous demo revision and its compatible schema/data state.

Exit: mark the Round operational only after every gate passes and custom domain,
access, simulations and reset are complete. Report limitations honestly.

## Deliverables and ongoing ownership

Plan, CHANGELOG.md and AGENTS.md are English; `docs/DEMO_ONBOARDING_IT.md` and its
PDF are Italian. Other deliverables include schema/migrations, fixture manifest,
environment configuration, guarded APIs, reset/prepare operation, launch page,
simulated inbox/receipts and reproducible test evidence.

Before meetings, the agent prepares fixtures, dates, fresh links and smoke checks
when invoked or through an explicitly configured maintenance automation. After
meetings, cleanup follows the session lock rules. Never promise an unattended
reset schedule unless it has actually been configured and verified.

When a demonstrated feature changes, update its fixtures, guide, script/PDF and
CHANGELOG in the same delivery. Promote only verified demo revisions. Activating
a new host's real property is a separate workflow with their correct content,
credentials and required consent; demo receipts never prove real filing.
