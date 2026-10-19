# Round 60b — Schema-drift guard

**Owner:** Claude Opus 4.7 (confirmed by Daniele 2026-10-19)
**Status:** in-progress

## Why this exists

Round 57 (2026-10-14) committed `supabase/migrations/20261014145714_round57_cover_layout.sql` adding `properties.hero_image_layout`. The CHANGELOG at that round's implementation entry recorded "applied to production" but the DDL **never ran on production**. The regression suite was green and the PR merged because the suite only verifies that committed source agrees with committed migration files; it has never read `supabase_migrations.schema_migrations` on the actual production database.

The bug surfaced 5 days later when Daniele tried to save Property Details on production during Round 60 live testing. Every host attempting the same save during that window hit the same error. Hotfix PR #176 (2026-10-19, commit `0e12dc7`) applied the missing migration via Supabase MCP and recorded the real state.

This round builds a safety net so a committed-but-never-applied migration file cannot ship again without a loud, mandatory signal.

## Scope

Add a prod-schema-aware test to the existing `live` tier, wire it into the `regression` CI workflow, and encode the rule in AGENTS.md so no future round can skip the check by renaming it.

## Non-scope

- No change to how migrations are applied (still manual via Supabase MCP or `apply_migration`).
- No change to the committed migration file format.
- No new secret, no new service, no new infrastructure.
- No retroactive audit of historical rounds — only going forward.
- No live-tier timestamp strictness: a migration file whose committed timestamp differs slightly from the recorded `schema_migrations.version` (e.g. Round 55 where `20261014092200` was recorded as `20261014092424`) must not trip the alarm as long as the migration is applied with its name intact.

## Zero-impact invariant

Rounds whose phase did not add a `supabase/migrations/*.sql` file are unaffected. The guard runs only in the `live` suite — the default `test:all` already includes it, so CI already runs it, but no local `npm test` behavior changes.

## Phases

| Phase | Description | Test gate |
|---|---|---|
| 1 — Live-tier test | `scripts/schema-drift.test.live.mjs` connects to prod with `SUPABASE_SERVICE_ROLE_KEY`, reads `supabase_migrations.schema_migrations`, compares names (not full version strings) against committed `supabase/migrations/*.sql` files. Any committed file whose name has no matching `schema_migrations` row fails the suite. | Live test runs green on main after merge; a deliberate drift (temporary extra migration file in a test fixture) is caught in a unit test asserting the diff logic. |
| 2 — CI wiring + AGENTS.md | Add the live step to `.github/workflows/regression.yml`, gated on `SUPABASE_SERVICE_ROLE_KEY` secret. Add one line to AGENTS.md: a phase that adds a `supabase/migrations/*.sql` file is not shippable until the live test is green on main. | CI workflow lints, PR shows new live step running green; AGENTS.md diff reviewed. |
| 3 — Regression lock | Full `npm run test:all` green; `npm run test:live` green against prod; release note in CHANGELOG. | PASS/FAIL/SKIP totals pasted into CHANGELOG; prod schema signature recorded. |

## Phase 1 — Live-tier test

### What it does

1. Parses `supabase/migrations/` directory for `*.sql` files, extracts the trailing name (everything after the leading 14-digit timestamp and underscore). Example: `20261014145714_round57_cover_layout.sql` → `round57_cover_layout`.
2. Reads `supabase_migrations.schema_migrations` on prod via the service-role REST client (no MCP dependency so CI can run it).
3. For each committed migration name, asserts a `schema_migrations` row exists whose `name` column matches. Timestamp mismatches of under one hour between committed filename and recorded version are tolerated (covers the Round 55 case).
4. Fails with a clear message naming the committed file, the applied names (if any), and the exact `apply_migration` command the operator should run.

### Why the match is on name, not version

The committed timestamp in a filename is when the file was written, not when the migration was applied. Supabase accepts whatever `version` string is inserted. In production right now, Round 55's committed filename is `20261014092200_round55_share_preferences.sql` but its recorded row is `20261014092424`. The migration is correctly applied; the recorded version simply differs from the committed timestamp by about 2.5 minutes because of how it was registered.

Matching on the migration name (the part after the timestamp) survives this and still catches the real failure mode we're guarding against: a committed file whose DDL was never run.

### Test logic unit test

The migration-name-match logic is pure. A separate `scripts/schema-drift.test.mjs` (offline, no network) exercises it with:
- all-applied → no error
- one missing → error naming it
- one extra on prod (unknown name) → no error (we don't delete, we only add)
- timestamp drift under one hour → no error
- two files with the same name → the comparison still passes if both are applied; fails on either one missing

### Secret handling

Reads `SUPABASE_SERVICE_ROLE_KEY` from env. Skipped (exit 77) if the secret is not set — same convention as `scripts/demo-live-smoke.mjs`. On CI the secret is injected via GitHub Actions; locally the test is skipped unless the developer exports it.

## Phase 2 — CI wiring + AGENTS.md

### Workflow change

Add a step to `.github/workflows/regression.yml` after the current `test:all` step:

```yaml
- name: Schema drift check against production
  run: npm run test:live
  env:
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

`test:live` already exists and currently only runs `demo-live-smoke.mjs` (which skips without `DEMO_SMOKE_ORIGIN`). After Phase 1 it will also run the new `schema-drift.test.live.mjs`.

### AGENTS.md one-liner

Append to the "Choosing the next Round" section, as a numbered rule after rule 4:

> 5. A phase that adds a `supabase/migrations/*.sql` file is not shippable until `scripts/schema-drift.test.live.mjs` is green on main. The CHANGELOG line "applied to production" is accepted only when the live test confirms the migration name appears in `supabase_migrations.schema_migrations` on prod.

## Phase 3 — Regression lock + release

- Run `npm run test:all` (full browser + offline suite) → paste totals into CHANGELOG.
- Run `npm run test:live` against prod with secrets exported → paste result.
- Record Round 60b close in CHANGELOG with PR link, merge SHA, and the prod schema signature (count of applied migrations) at close time.

## Acceptance criteria

- A deliberate test (temporary unused migration file) fails CI and names the missing file.
- Removing the test file restores CI to green.
- The AGENTS.md rule is machine-checkable: it names an exact test file.
- No change to how a real migration is applied (still Supabase MCP `apply_migration` or `execute_sql` + manual `schema_migrations` insert).
- Round 57's exact failure mode would have been caught at CI time rather than 5 days after merge.
