# WelcomeBnB - permanent agent instructions

These instructions apply throughout the repository to GPT, Claude and any other
agent working on the project.

## Standing publication authorization

Daniele explicitly confirmed on 15 October 2026 that everything he requests in
this project is to be published to public `Giginoparrucca/doorstep` main,
including CHANGELOG updates. This standing authorization includes requested
source changes, tests, plans, guides and changelog/release records, merging to
main and deploying `https://app.welcomebnb.it`. Complete the applicable checks and
publish these together without repeatedly requesting publication permission.

## CHANGELOG and multi-model handoff

1. Before any Round, read CHANGELOG.md top-to-bottom and its specification. The
   `Current round - in-flight` table is authoritative; inspect the current remote
   branch before editing it. Preserve existing phase ownership.
2. Before starting a phase, change `pending` to `in-progress - <model>` and commit.
   Resolve a handoff before taking a phase already owned by another model.
3. Prefix commits with `Round R Phase N · ` using the actual Round and phase.
   Round 49 subjects remain `Round 49 Phase N · `.
4. Update CHANGELOG during work and at every session end: concrete changes, tests,
   PRs, blockers, partial delivery and next step. Include it in the relevant
   delivery; do not wait for a separate request from Daniele.
5. Each implementation phase has a mandatory test gate. Implement, test, fix
   failures, record evidence, merge and verify the deployment where applicable
   before moving to the next phase. Do not claim a passing test from deployment
   status alone. Follow the phase-specific tests in the Round specification.
6. After merge, mark `shipped - PR #N - <model>` only when every phase acceptance
   criterion is covered. Label partial scope explicitly, e.g. `Phase 5a`.
   Documentation, merged code and an operational environment are distinct states.
7. Preserve previous Round tables, PRs and model attribution. Move a completed
   table into visible history when opening a new Round; never erase or renumber
   published phases.
8. If publication/access fails or tests fail, record the real blocker. Never
   invent a merge, deployment, test result or background execution.

## Choosing the next Round

When Daniele says "next round", "continue" or similar without naming one:

1. If the CHANGELOG `Current round - in-flight` table has any phase not yet
   `shipped`, continue that Round from its first unfinished phase.
2. Otherwise take the **first `pending` row** of the CHANGELOG `Planned rounds`
   table (top to bottom). After Daniele confirms it (see "Confirm before every
   new Round" below), open it as the current Round: move the completed
   table into history (rule 7 above), create its phase table from its PLAN file,
   and remove the row from `Planned rounds`. Commit that before any code.
3. If nothing is pending, stop and ask Daniele. Never invent a Round.
4. Whoever writes a new PLAN file adds it to `Planned rounds` in the order it
   must run.

## Confirm before every new Round

Before starting any new Round — whether Daniele said "next round" or named it —
stop and send him a short recap in plain, non-technical language, then wait for
his explicit confirmation. Do not change files, open the Round or commit until he
confirms. The recap covers, in a few lines each:

- **What** the Round is and **why** it matters, in everyday words.
- **What changes** for hosts and guests (or "nothing visible" if internal).
- **What it does not touch.**
- **The phases**, one line each.
- **Anything he may need to do** (owner-only settings, accounts, costs, legal)
  and any risk worth knowing.

If he asks for changes, update the PLAN file and recap again. Once confirmed,
phases inside that Round continue automatically as described under
"Agent-owned execution". Unattended or scheduled runs never start a new Round.

## Full regression (every Round, every phase)

1. Every phase test gate runs the **whole** product test suite
   (`npm run test:all`: all offline tests plus all browser suites), not only the
   tests named in the Round specification. Plan-specific tests are added to the
   full suite; they never replace it.
2. A failure anywhere blocks the merge, including areas the Round did not
   touch. Fix it, or record it in CHANGELOG as a named blocker with Daniele's
   explicit decision; never mark the phase shipped over a red suite.
3. Skipped tests must state why (missing secret, no network). A skip is not a
   pass; list skips in CHANGELOG.
4. Paste the runner's pass/fail/skip totals into CHANGELOG for every phase.
5. After deploying, run `npm run test:live` (read-only smoke) against
   production and record the result.
6. Until `npm run test:all` exists (Round 60a Phase 1), run every
   `scripts/*.test.*` file and every browser suite individually and list each
   result. Once CI exists, a red CI run on the PR blocks the merge.
7. Any new feature, endpoint or export ships with tests that join the full
   suite. Compliance outputs (Alloggiati, SPOT, regional statistics, tourist
   tax) need committed synthetic golden files compared byte-for-byte.
8. A phase that adds a `supabase/migrations/*.sql` file is not shippable
   until `scripts/schema-drift.test.live.mjs` passes against prod. The
   CHANGELOG line "applied to production" is accepted only when that live
   test's RPC lookup returns the migration name — a prose claim without
   that evidence is a Round-57-class drift and must be rejected (Round 60b
   Phase 1).

## Agent-owned execution

GPT or Claude performs all authorized technical work and routine verification,
including configuration, provisioning, secrets, migrations, fixtures, PRs,
deployments, tests, fixes, documentation and cleanup. Continue automatically
between phases of a Round Daniele has confirmed, after their gates pass (a new
Round always needs his confirmation first); do not ask Daniele to run tools or approve
routine decisions when the agent has sufficient authorization and access.

Involve Daniele only for a strictly necessary owner-only action, unavailable
access, actual billing approval or personal/legal consent/signature. First
complete independent work and prepare the smallest concrete remaining action;
explain the observed blocker and record it in CHANGELOG. Do not invent approval
or schedule background work without an active agent/verified automation.

## Round 50

Specification: `PLAN_round50_demo_onboarding.md` (English).
Presenter script: `docs/DEMO_ONBOARDING_IT.md` and its generated PDF (Italian).
Phases 0/0a are documentation; phases 1-6 implement and verify the demo.

Update fixtures, script/PDF and affected guides when the demonstrated behavior
changes. Use an isolated demo database with fictional data. Enforce external
integration restrictions and reset authorization server-side. Never copy real
PII, documents, Vault or credentials into demo, and never weaken production
controls to enable simulations/reset. Every phase must pass its documented tests
before the next starts.

## Round 63 — iReservation developer handover

For iReservation work, start with `PLAN_round63_ireservation_native_api.md`,
`docs/ireservation/API_REFERENCE.md`, `docs/ireservation/OPERATIONS.md` and
`docs/ireservation/CONTINUATION.md`. Phase 0 was documentation only. Daniele confirmed implementation on 24 October
2026; Phase 1 is verified; Phase 2 adds owner-only manual comparison. Native calendar imports remain disabled until the cutover gates pass. Never publish partner username/password/API key, test property
password, bearer/refresh tokens or private iCal URLs/tokens. Retrieve secrets via
the restricted process in OPERATIONS; do not copy correspondence/PDF examples.
