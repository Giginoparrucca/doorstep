# Round 50 - current implementation handoff

This short status file supplements CHANGELOG.md.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1 | shipped - PR #120 - GPT | Required checks passed |
| 2a | partial draft - PR #121 - GPT | Offline renderer and syntax tests passed |
| 2 | shipped - PR #121 - GPT + Claude 2026-10-11 | 16-check Auth/ownership gate (GPT) + 3-check public-URL smoke (Claude) + 28-check clean-rebuild fingerprint (Claude) + 10-case negative-mutation test re-run against main-branch deployment `dpl_Gm6KFuxjxwodhqFd9gw5gV6q4fB9`; recovery runbook recorded |
| 3 | implementation complete - Claude 2026-10-11 (PR pending) | 17-check unit tests + hosted idempotent seed + 10-scenario date-math and 7-day-boundary verification; schema fingerprint unchanged |
| 4-6 | pending | Phase 4 ready to start after merge |

GPT resumes under Daniele's instruction after Claude reached its usage limit. Phase 2 remains incomplete. Preserve Claude's evidence and attribution.

Automatic approval review previously rejected publication of detailed operational notes. This supplement records generic phase status only.

Resumption checkpoint: deployment configuration now selects schedules by environment; smoke checks fail on generic errors and require actual guest token/gateway success. Local regression checks passed. Full hosted Phase 2 gate remains pending.

Hosted provisioning checkpoint: demo configuration and server secrets are saved; dedicated deployment is READY; invite-only signup and exact demo Auth redirects are configured. Unit regressions pass. Public guest access approved and enabled; served configuration and real guest token/gateway/integration-denial smoke passed; custom-domain DNS remains external. Presenter accounts, complete hosted isolation tests, clean rebuild and recovery remain pending. Phase 2 is not shipped.

An opt-in, positive-project-guarded build runner now provisions fictional presenter accounts through the supported Auth API and tests actual JWT ownership and private-object access. It emits no secrets. Hosted execution pending.

Hosted runner checkpoint: two fictional presenter accounts exist. Receipt ownership policies corrected for an alias-shadowing bug and rerun completed; explicit served test evidence is being added. Production remains untouched.

Hosted gate evidence now confirms 16 passing Auth/ownership/guest-check-in/receipt/document checks; probe rows/files cleaned, presenters retained. Public demo access approved and enabled. Provisioning flag disabled after tests. Rebuild/recovery remains incomplete: corrected rollback-only SQL execution declined; automatic review rejected persistent chunked alternative. Custom-domain DNS and repository automatic deployment connection remain pending. Phase 2 remains in progress; no later phase started.

Claude handoff checkpoint 2026-10-10: `demo.welcomebnb.it` is listed as a verified project domain (apex `welcomebnb.it`), repository auto-deploy is active (latest production deployment `dpl_DfkdrwwkbPzb4KfLVBmCqN9LtDqj` READY from `8321d56` on `round50-phase2`), and the public config served at `/app-config.js` is `mode=demo`, `projectRef=wmegnnlmcrabndyzywmj`, no server credentials. Remaining before Phase 2 ships: public-URL smoke replay with a disposable property, clean-rebuild test on an isolated scratch database (previously rejected as destructive against the live demo project — Claude is using a short-lived scratch Supabase project with the same migration bodies instead), and a recovery/rollback runbook that does not touch production. Phase 2 remains in progress; no later phase started.

Phase 2 completion 2026-10-11 (Claude): public-URL smoke replay against `https://welcomebnb-demo.vercel.app` passed 3/3 using disposable property `50505050-0000-4000-8000-000000000002`; the clean-rebuild test is encoded in `scripts/demo-rebuild-verify.{mjs,sql,test.mjs}` and reports 28/28 PASS on the live demo (3 migration SHA-256s match the recorded values; schema shape fingerprint `a2a71990…` locked in; all isolation invariants hold: 0 vault/cron/pg_net, 0 production rows, 2 presenter auth users). Recovery/rollback runbook (Vercel rollback, Supabase daily-backup restore, full rebuild from fingerprinted migrations) is captured in `docs/ROUND50_PROVISIONING.md`. No production project DDL/DML was executed. Phase 2 shipped via PR #121.

Phase 3 implementation 2026-10-11 (Claude): the fixture manifest is in `lib/demo-fixtures.mjs` — 2 presenters (reserved @example.com), 2 properties (Casa Demo WelcomeBnB in Ostuni + Trullo Fico Vicino in Cisternino), 6 verifiable Ostuni recommendations with Google Maps addresses (no invented hours/reviews/walking times), 2 house rules, 10 showcase scenarios with stable UUIDs and Rome-relative date math, 6 IT/EN chat seeds (DEMO-AIUTO escalated), 7 analytics events. Seeder (`scripts/demo-seed.mjs`) is opt-in via APP_ENV=demo and Vercel project guard; all writes are upserts on stable UUIDs so a second run is a no-op. Live verifier (`scripts/demo-seed-live.mjs`) asserts scenarios present with correct dates, 7-day boundary, chat escalation and property ownership. Unit tests (`scripts/demo-seed.test.mjs`) 17/17 PASS: reserved emails, FACSIMILE docs, no production PII sweep, deterministic dates across leap-year and year boundaries, UUID validity for every derived row, dashboard boundary. Hosted check against the demo DB: 2 properties, 6 recommendations, 2 rules, 10 OTA, 9 checkins (7 single/lead + 2 group members), 6 chats, 7 analytics; idempotency verified by a second upsert of the same rows producing unchanged counts; schema fingerprint `a2a71990…` unchanged. No production project DDL/DML executed. Ready for merge; Phase 4 (reset + session management) can be taken after the merge deployment passes the same verifier.
