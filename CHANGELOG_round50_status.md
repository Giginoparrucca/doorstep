# Round 50 - current implementation handoff

This short status file supplements CHANGELOG.md.

| Phase | Status | Evidence |
| --- | --- | --- |
| 1 | shipped - PR #120 - GPT | Required checks passed |
| 2a | partial draft - PR #121 - GPT | Offline renderer and syntax tests passed |
| 2 | in-progress - GPT (handoff from Claude 2026-10-10) | Claude's database probes and smoke-test draft retained; complete hosted test gate pending |
| 3-6 | pending | Previous phase gates must pass first |

GPT resumes under Daniele's instruction after Claude reached its usage limit. Phase 2 remains incomplete. Preserve Claude's evidence and attribution.

Automatic approval review previously rejected publication of detailed operational notes. This supplement records generic phase status only.

Resumption checkpoint: deployment configuration now selects schedules by environment; smoke checks fail on generic errors and require actual guest token/gateway success. Local regression checks passed. Full hosted Phase 2 gate remains pending.

Hosted provisioning checkpoint: demo configuration and server secrets are saved; dedicated deployment is READY; invite-only signup and exact demo Auth redirects are configured. Unit regressions pass. Public guest access approved and enabled; served configuration and real guest token/gateway/integration-denial smoke passed; custom-domain DNS remains external. Presenter accounts, complete hosted isolation tests, clean rebuild and recovery remain pending. Phase 2 is not shipped.

An opt-in, positive-project-guarded build runner now provisions fictional presenter accounts through the supported Auth API and tests actual JWT ownership and private-object access. It emits no secrets. Hosted execution pending.
