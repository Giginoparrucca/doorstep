# WelcomeBnB - permanent agent instructions

These instructions apply throughout the repository to GPT, Claude and any other
agent working on the project.

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

## Agent-owned execution

GPT or Claude performs all authorized technical work and routine verification,
including configuration, provisioning, secrets, migrations, fixtures, PRs,
deployments, tests, fixes, documentation and cleanup. Continue automatically
between phases after their gates pass; do not ask Daniele to run tools or approve
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
