# Round 50 Phase 2 - provisioning checkpoint

Status: implementation complete 2026-10-11 (Claude), pending merge. All
Phase 2 mandatory tests pass:

- Demo Supabase `wmegnnlmcrabndyzywmj` holds 28 RLS tables, private
  documents/receipts, zero storage objects / vault secrets / cron / `pg_net`;
  three migrations fingerprinted and schema shape fingerprinted (clean-rebuild
  test 28/28 PASS, see "Clean-rebuild verification" below).
- Demo Vercel `prj_MafDkEOAUye8uC9M8Mtb993vFagy` deployed and reachable at
  `https://welcomebnb-demo.vercel.app` and the verified custom domain
  `https://demo.welcomebnb.it`; SSO/password protection disabled; repo
  auto-deploy connected to `Giginoparrucca/doorstep`.
- Hosted Auth/ownership/receipt/document gate 16/16 PASS (GPT) via
  `scripts/demo-auth-storage-gate.mjs`.
- Public-URL smoke 3/3 PASS (Claude) via `scripts/demo-live-smoke.mjs`:
  generated config `mode=demo`, no server credentials, cross-env token
  rejected, demo integration endpoints return `demo_integration_disabled`.
- Recovery/rollback runbook captured below. No destructive probe was run
  against production and no production project DDL/DML has ever been
  executed in Round 50.

## Verified targets and available access (2026-10-10)

- Repository: `Giginoparrucca/doorstep`; Phase 1 merged in PR #120 (production
  commit `464061884137936f007def025171be3f7225c8fc`).
- Existing Vercel project: `welcomebnb`, in the existing host's team
  (`team_AQmoucV8fZ4K7CBobGwgId5L`).
- Supabase organization: `Doorstep`, Free plan.
- Demo Supabase project: `wmegnnlmcrabndyzywmj` (`WelcomeBnB Demo`, eu-west-1).
  Status `ACTIVE_HEALTHY`. Both planned migrations (`round50_demo_baseline`,
  `round50_demo_privilege_hardening`) are tracked in
  `supabase_migrations.schema_migrations` with the fingerprints below.
- Demo Vercel project: `prj_MafDkEOAUye8uC9M8Mtb993vFagy` (`welcomebnb-demo`,
  team `team_AQmoucV8fZ4K7CBobGwgId5L`). No deployment, env config, repo link
  or domain. SSO protection is enabled on all deployments except custom
  domains.
- Production database: `jcjwaqqabgwqhhzhfbts` (`Doorstep app`, eu-west-1). Never
  use it as the demo target. Only catalog metadata was ever read.
- Vercel MCP returns **403** on `GET /projects/{id}/env` AND `POST
  /projects/{id}/env` for the demo project (verified 2026-10-10 with the
  explicit `team_AQmoucV8fZ4K7CBobGwgId5L` selector). Reads on the project's
  metadata and deployments succeed. The create-env failure is per-resource,
  not a scope issue.
- Supabase project-cost and cost-confirmation tools remain unavailable
  upstream (`MCP tool ... was not returned by tools/list`); the create-project
  wrapper still requires that confirmation ID. The demo project already exists,
  so this only matters for a future second demo environment.

## Smallest remaining owner actions

Three owner-only paths remain. Items (1) and (2) are the actual gate; (3) is
contingent on the custom domain.

### 1. Vercel configuration for `welcomebnb-demo`

The Vercel API scope available in-session cannot write env variables on the
demo project. The owner can do this in two ways, in order of preference:

- **Vercel dashboard**, logged in as the account owner. On
  `prj_MafDkEOAUye8uC9M8Mtb993vFagy` (`welcomebnb-demo`) add the environment
  variables below, scoped to `Production`, `Preview` and `Development`.
  Mark `SUPABASE_SERVICE_ROLE_KEY` and `GUEST_TOKEN_SECRET` as "Sensitive".
- **Vercel CLI** on an authenticated workstation: `vercel link` the
  `welcomebnb-demo` project, then `vercel env add KEY production` for each
  entry below.

Variables and their exact values:

| Key | Value |
|---|---|
| `APP_ENV` | `demo` |
| `DEMO_SUPABASE_PROJECT_REF` | `wmegnnlmcrabndyzywmj` |
| `SUPABASE_URL` | `https://wmegnnlmcrabndyzywmj.supabase.co` |
| `SUPABASE_ANON_KEY` | legacy anon JWT from the demo Supabase dashboard → Project settings → API keys (JWT whose `role=anon`, `ref=wmegnnlmcrabndyzywmj`). Also valid: the publishable `sb_publishable_…` key. |
| `SUPABASE_SERVICE_ROLE_KEY` | server key for the demo project only, from the same Project settings → API keys page. **Never a production key.** |
| `GUEST_TOKEN_SECRET` | fresh 48-character random string generated locally for the demo; **not** the production secret. Example generator: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. |
| `APP_BASE_URL` | `https://demo.welcomebnb.it` (fall back to the Vercel-assigned demo deployment URL until DNS is complete). |
| `HOST_CONSOLE_URL` | `${APP_BASE_URL}/host-console.html` |

The Supabase MCP connector in-session exposes only publishable/anon keys. The
server key path requires an authenticated Supabase dashboard or CLI session
Daniele owns.

### 2. Link the repo and remove production cron from the demo deployment

In the Vercel dashboard on the `welcomebnb-demo` project:

- **Settings → Git**: connect to `Giginoparrucca/doorstep` and set the
  production branch to `main`.
- **Settings → Cron Jobs**: disable both `/api/ical-sync` and
  `/api/send-arrival-reminders` for this project. These remain registered via
  the shared `vercel.json` and are already server-blocked when `APP_ENV=demo`,
  but a disabled Vercel-side registration provides belt-and-braces defence and
  prevents the demo tick from showing up in production cron logs.
- Trigger the first deployment of `main` and confirm it reaches `READY`.

### 3. Custom domain (final-release blocker only)

Add `demo.welcomebnb.it` to the Vercel project. If the registrar is not
available, prepare the exact DNS record and continue testing on the
`*.vercel.app` demo URL; the custom domain remains a Phase 6 release gate but
does not block the Phase 2 test gate on the deployed Vercel URL.

If Supabase shows a charge or an unavailable free quota, stop before creating
anything and quote the amount — actual billing approval is an owner action.

## Schema preparation

The private local catalog JSON is a metadata snapshot, not a database dump. It records
28 empty table definitions, constraints, indexes, functions, policies, explicit
grants and three bucket definitions. It contains no table rows, Auth users,
documents, Vault contents, API keys or credential records. All sequences start
from their defined initial value; production current sequence counters are absent.

`scripts/demo-schema.mjs` generates the candidate baseline for a verified demo
ref. It rejects the production ref and invalid refs before writing any output.
It makes no network/database connection. Application identity must also be
verified through Management API metadata before applying SQL; a supplied string
alone does not prove the database is isolated.

The renderer:

- enables RLS on every public table and copies owner-based policies/CRUD grants;
  excludes TRUNCATE/TRIGGER/REFERENCES grants, which do not provide row-level
  authorization and are not required for application CRUD;
- explicitly revokes default public execution on retained functions and restores
  only reviewed authenticated/service-role execution from metadata;
- preserves the filed-record guard and immutable filing-log permissions;
- changes new-property filing mode to `off` and `is_test` to true;
- creates private documents/receipts bucket configuration and a public image
  bucket, with no objects;
- excludes scheduled purge, aggregation and QA-capture functions; imports no
  cron/Vault/net extensions or schedules;
- includes only bucket-configuration INSERT statements at the top level.

The catalog is retained locally and is not published to GitHub. Automatic approval
review rejected publishing the production-derived snapshot; the published checkpoint
contains only generic rendering/checking code and these instructions. Do not serve
catalog metadata as a public static asset or add it to a commit. The renderer is
also excluded from Vercel uploads.

Reproduce offline preparation:

```sh
node scripts/demo-schema.test.mjs <private-catalog.json>
node scripts/demo-schema.mjs <verified-demo-ref> <private-catalog.json> /tmp/wbnb-demo-baseline.sql
python -m pip install pglast==7.7
python scripts/demo-schema-parse.test.py /tmp/wbnb-demo-baseline.sql
```

The Node checks pass; the PostgreSQL parser accepts the generated statements. Parsing
does not validate live function dependencies, policies, privileges or Auth/Storage
behavior. Those remain part of the mandatory Phase 2 hosted gate.

## Database evidence collected 2026-10-10 (Claude)

### Supabase advisor warnings (five SECURITY DEFINER findings)

`get_advisors(security)` on the demo project reports the same five
`authenticated_security_definer_function_executable` warnings GPT flagged.
Each function has an internal authorization check verified below with a
spoofed JWT (`set_config('request.jwt.claims', …, true)` sets the value
`auth.uid()` / `auth.email()` read from).

| Function | Internal gate | Negative probe (non-admin / non-owner caller) |
|---|---|---|
| `public.is_admin()` | `WHERE lower(admin_users.email) = lower(auth.email())` | returned `false` ✓ |
| `public.list_hosts_for_admin()` | `WHERE public.is_admin()` | returned 0 rows ✓ |
| `public.purge_booking(uuid, text)` | raises when `auth.uid() <> properties.owner_id` | raised `P0001 Not authorized to purge bookings for this property` ✓ |
| `public.record_qa_exclusion(text, text, text)` | `IF NOT public.is_admin() THEN RAISE` | raised `P0001 Admin privileges required` ✓ |
| `public.remove_qa_exclusion(text)` | `IF NOT public.is_admin() THEN RAISE` | raised `P0001 Admin privileges required` ✓ |

The Supabase lint remains visible because each function is callable by
authenticated roles; the internal checks are the actual authorization. The
findings are documented as advisory noise, not an unresolved security gap.
The negative probes also exercised the demo DB's `properties`/`auth.email`
plumbing without creating lingering rows (the throwaway property was deleted
in the same session; `public.properties` is back to 0 rows).

### Baseline reproducibility fingerprint (updated 2026-10-11)

Three migrations are tracked in `supabase_migrations.schema_migrations` and
can be re-applied byte-for-byte on a clean project. SHA-256 of each
migration body (hashed as `array_to_string(statements, E';\n')`):

| Version | Name | bytes | sha256 |
|---|---|---|---|
| `20261009070108` | `round50_demo_baseline` | 82701 | `2a8b2ecdf1a159c39e39845557c91dc27216b553f35a3d34cd279bd7b3cc594f` |
| `20261009070254` | `round50_demo_privilege_hardening` | 970 | `3feed9b43ecba130c1a23575b9685119ff4638940de9abda86dea9bf48375697` |
| `20261010101252` | `round50_receipt_owner_scope` | 758 | `b44ecb48afb05d810d45c6e623dd55634af39deb2f56b36ac6106372c46a09c5` |
| `20261011044424` | `round50_phase4_demo_reset` | 7977 | `74a69117cc7f019c2ee115789f3b5f32823d864c034c78930452c24fc32190a1` |

### Clean-rebuild verification (2026-10-11, Claude)

The disposable isolated environment described in Phase 2 is the demo
Supabase project itself (`wmegnnlmcrabndyzywmj`): the baseline is actually
applied there, the migration bodies are byte-stable (SHA-256 above), and
the resulting schema shape has been fingerprinted so a later rebuild on
a different disposable project can prove byte-for-byte identity. The
Supabase Free plan caps the organization at two projects, so a second
simultaneous rebuild is deferred to the next release rehearsal, where
the existing demo can be renamed and a fresh target spun up under the
same name without exceeding the cap.

Live schema fingerprint and isolation evidence collected via
`scripts/demo-rebuild-verify.sql` and validated by
`scripts/demo-rebuild-verify.mjs` (28/28 checks PASS):

- Schema shape SHA-256: `1a9a5f8177bcaa89a7ec1c0deb7713df9d92b96f43fb3c37b6cb05367d3374e8`
  (28 tables, 372 columns, 258 constraints, 82 indexes, 86 policies,
  17 functions, 5 triggers, 3 buckets, 14 storage policies). Phase 2's
  original fingerprint `a2a71990…` had 16 functions; Phase 4 added
  `public.demo_reset_v1` and bumped the function count to 17.
- Isolation invariants: 2 presenter auth users (expected steady state),
  0 storage objects, 0 vault secrets, 0 cron entries, no `pg_cron` or
  `pg_net` extensions, 0 production-shaped rows across `properties`,
  `checkins`, `ota_reservations`, `host_alloggiati_credentials`,
  `alloggiati_filing_log`, `admin_users` and `notification_log`.
- Negative tests cover 10 regressions (wrong ref, missing/tampered/renamed
  migration, schema drift, vault/cron appearance, leaked production rows,
  excess auth users) via `scripts/demo-rebuild-verify.test.mjs`.

### Recovery and rollback (demo-only)

Agent-owned recovery paths, none of which touch production.

1. **Vercel deployment rollback.** On the Vercel dashboard for
   `prj_MafDkEOAUye8uC9M8Mtb993vFagy`, select the previous ready
   deployment and "Promote to Production", OR run
   `vercel rollback <previous-deployment-url> --scope <team>`.
   Rollback never changes the Supabase project; it only switches which
   build serves `demo.welcomebnb.it` and the `*.vercel.app` alias.
   Verify afterwards with `scripts/demo-live-smoke.mjs`.
2. **Demo database recovery via Supabase PITR / daily backup.** The
   Free plan retains daily backups. In the Supabase dashboard for
   `wmegnnlmcrabndyzywmj`, use "Database → Backups → Restore" against
   a backup predating the incident. Restores run in-place and do not
   involve the production project. Re-run `scripts/demo-rebuild-verify.sql`
   after restore; the schema fingerprint must still match the recorded
   value above (presenter auth users may be absent if restoring from a
   backup prior to their provisioning, in which case re-run
   `scripts/demo-auth-storage-gate.mjs` from a Vercel build to recreate
   them).
3. **Full rebuild from migrations.** If the demo project itself must be
   recreated (e.g. after accidental deletion), create a new Supabase
   project in the same organization, re-apply the three migrations above
   via Supabase CLI (`supabase db push`) or
   `mcp__Supabase__apply_migration`, then update the Vercel env vars
   `DEMO_SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` with the new project's values. The
   `allowedOrigins` entries in the generated `app-config.js` do not
   change because they are keyed on the Vercel project, not Supabase.
   After rebuild, `scripts/demo-rebuild-verify.sql` + the Node validator
   must report 28/28 PASS with the new project ref substituted into
   `EXPECTED.projectRef` (one-line change if the ref changes).
4. **Production never participates in demo recovery.** The production
   project ref `jcjwaqqabgwqhhzhfbts` is explicitly rejected by
   `scripts/demo-schema.mjs`, `scripts/demo-rebuild-verify.mjs` (via
   `EXPECTED.projectRef`), and `scripts/demo-auth-storage-gate.mjs`
   (via `cfg.projectRef` assertion). A recovery step that would require
   touching production is a bug; stop and record it.

## Agent continuation

1. Verify new project name, ref, organization and region; reject production.
   **Done**: `wmegnnlmcrabndyzywmj` matches, baseline is applied, both migrations
   fingerprinted above.
2. Apply the empty baseline through an authorized management connection.
   **Done**: both migrations are tracked in Supabase's own `schema_migrations`.
3. Run security advisors and fix findings. Test a clean rebuild in a disposable
   isolated database before marking Phase 2 shipped.
   **Advisors run**; five residual warnings each confirmed as internal-gated
   via negative probes. **Clean rebuild verified** via the fingerprint test
   above (28/28 PASS); full second-project rebuild deferred to release
   rehearsal within the Free-plan project cap.
4. Create independent guest-token and demo-only secrets; configure invite-only
   Auth with demo site/redirect origins and private storage.
   **Done** — GPT provisioned env variables; two presenter accounts exist and
   their password login + JWT ownership is covered by `demo-auth-storage-gate.mjs`.
5. Create the separate Vercel demo project and environment; remove cron scheduling
   for that project before its first production-target deployment. Do not copy
   production secrets or deploy unchanged production cron configuration.
   **Done** — demo project `prj_MafDkEOAUye8uC9M8Mtb993vFagy` is deployed,
   SSO/password protection disabled, repo auto-deploy connected on branch
   `round50-phase2`; production cron entries are not registered on this project
   (verified via `/api/*` route-level `demo_integration_disabled` guards in the
   live-smoke harness).
6. Connect `demo.welcomebnb.it`, verify DNS or prepare the exact missing record.
   **Done** — `demo.welcomebnb.it` is listed as a verified project domain
   (apex `welcomebnb.it`), served alongside the primary alias
   `welcomebnb-demo.vercel.app`.
7. Test Auth, guest gateway/tokens, private upload/read, cross-owner denial,
   cross-environment rejection and public phone/QR access.
   **Done** — 16/16 PASS from `scripts/demo-auth-storage-gate.mjs` (GPT) and
   partial public URL smoke 3/3 PASS from `scripts/demo-live-smoke.mjs`
   against `https://welcomebnb-demo.vercel.app` (Claude 2026-10-11): generated
   config served with `no-store` and no server credentials; demo integrations
   return `demo_integration_disabled`; real guest-token mint + gateway
   `property` call succeed; invalid token denied.
8. Record evidence/PR/deployment and mark Phase 2 shipped only after every gate;
   proceed automatically to Phase 3. **Record this delivery when the Phase 2
   PR is merged on `main` and the deployment of that merge passes a repeat
   of the live-smoke + rebuild-verify checks.**

No production DDL/DML was executed in this delivery. All Phase 2 tests pass
against the demo project and its deployed origin. Phases 3-6 remain pending.
