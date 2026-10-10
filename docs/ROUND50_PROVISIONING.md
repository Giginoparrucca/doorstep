# Round 50 Phase 2 - provisioning checkpoint

Status: in progress — handed from GPT to Claude on 2026-10-10. The demo Supabase
project exists and matches the baseline (28 RLS tables, private documents and
receipts, zero auth users / storage objects / vault secrets, no cron schema).
The demo Vercel project exists but has no deployment, env configuration, repo
link or domain. This is a reviewable schema preparation checkpoint, not a
shipped operational phase.

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

### Baseline reproducibility fingerprint

Both migrations are tracked in `supabase_migrations.schema_migrations` and
can be re-applied byte-for-byte on a clean project. SHA-256 of each migration
body:

| Version | Name | bytes | sha256 |
|---|---|---|---|
| `20261009070108` | `round50_demo_baseline` | 82643 | `2a8b2ecdf1a159c39e39845557c91dc27216b553f35a3d34cd279bd7b3cc594f` |
| `20261009070254` | `round50_demo_privilege_hardening` | 970 | `3feed9b43ecba130c1a23575b9685119ff4638940de9abda86dea9bf48375697` |

Supabase branches require the Pro plan; the Doorstep org is on Free, so a
hosted disposable rebuild is deferred until a different owner-approved path
(a scratch second project OR a Supabase CLI local run against a disposable
Docker Postgres with the Supabase stack extensions) is used. The fingerprints
above let a later rebuild assert reproducibility without exposing the private
SQL body.

## Agent continuation

1. Verify new project name, ref, organization and region; reject production.
   **Done**: `wmegnnlmcrabndyzywmj` matches, baseline is applied, both migrations
   fingerprinted above.
2. Apply the empty baseline through an authorized management connection.
   **Done**: both migrations are tracked in Supabase's own `schema_migrations`.
3. Run security advisors and fix findings. Test a clean rebuild in a disposable
   isolated database before marking Phase 2 shipped.
   **Advisors run**; five residual warnings each confirmed as internal-gated
   via negative probes. Clean rebuild deferred pending disposable env.
4. Create independent guest-token and demo-only secrets; configure invite-only
   Auth with demo site/redirect origins and private storage.
   **Owner action required** — see §1 above.
5. Create the separate Vercel demo project and environment; remove cron scheduling
   for that project before its first production-target deployment. Do not copy
   production secrets or deploy unchanged production cron configuration.
   **Project exists; env + repo link + cron disable are owner actions in §§1-2
   above.**
6. Connect `demo.welcomebnb.it`, verify DNS or prepare the exact missing record.
   **Owner action if registrar access is unavailable — see §3.**
7. Test Auth, guest gateway/tokens, private upload/read, cross-owner denial,
   cross-environment rejection and public phone/QR access.
   **Pending**: requires the deployed Vercel origin with env vars populated.
8. Record evidence/PR/deployment and mark Phase 2 shipped only after every gate;
   proceed automatically to Phase 3.

No production DDL/DML was executed for this checkpoint. No hosted Phase 2 tests
beyond the SQL-side probes above are claimed. Phases 3-6 remain pending.
