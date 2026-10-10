# Round 50 - current implementation handoff

This short status file supplements CHANGELOG.md.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1 | shipped - PR #120 - GPT | Required checks passed |
| 2a | partial draft - PR #121 - GPT | Offline renderer and syntax tests passed |
| 2 | in-progress - Claude (handoff from GPT 2026-10-10) | GPT shipped hosted provisioning, 16-check Auth/ownership gate, verified `demo.welcomebnb.it`. Claude taking back for clean-rebuild test, recovery documentation and public-URL smoke replay |
| 3-6 | pending | Previous phase gates must pass first |

GPT resumes under Daniele's instruction after Claude reached its usage limit. Phase 2 remains incomplete. Preserve Claude's evidence and attribution.

Automatic approval review previously rejected publication of detailed operational notes. This supplement records generic phase status only.

Resumption checkpoint: deployment configuration now selects schedules by environment; smoke checks fail on generic errors and require actual guest token/gateway success. Local regression checks passed. Full hosted Phase 2 gate remains pending.

Hosted provisioning checkpoint: demo configuration and server secrets are saved; dedicated deployment is READY; invite-only signup and exact demo Auth redirects are configured. Unit regressions pass. Public guest access approved and enabled; served configuration and real guest token/gateway/integration-denial smoke passed; custom-domain DNS remains external. Presenter accounts, complete hosted isolation tests, clean rebuild and recovery remain pending. Phase 2 is not shipped.

An opt-in, positive-project-guarded build runner now provisions fictional presenter accounts through the supported Auth API and tests actual JWT ownership and private-object access. It emits no secrets. Hosted execution pending.

Hosted runner checkpoint: two fictional presenter accounts exist. Receipt ownership policies corrected for an alias-shadowing bug and rerun completed; explicit served test evidence is being added. Production remains untouched.

Hosted gate evidence now confirms 16 passing Auth/ownership/guest-check-in/receipt/document checks; probe rows/files cleaned, presenters retained. Public demo access approved and enabled. Provisioning flag disabled after tests. Rebuild/recovery remains incomplete: corrected rollback-only SQL execution declined; automatic review rejected persistent chunked alternative. Custom-domain DNS and repository automatic deployment connection remain pending. Phase 2 remains in progress; no later phase started.

Claude handoff checkpoint 2026-10-10: `demo.welcomebnb.it` is listed as a verified project domain (apex `welcomebnb.it`), repository auto-deploy is active (latest production deployment `dpl_DfkdrwwkbPzb4KfLVBmCqN9LtDqj` READY from `8321d56` on `round50-phase2`), and the public config served at `/app-config.js` is `mode=demo`, `projectRef=wmegnnlmcrabndyzywmj`, no server credentials. Remaining before Phase 2 ships: public-URL smoke replay with a disposable property, clean-rebuild test on an isolated scratch database (previously rejected as destructive against the live demo project — Claude is using a short-lived scratch Supabase project with the same migration bodies instead), and a recovery/rollback runbook that does not touch production. Phase 2 remains in progress; no later phase started.
