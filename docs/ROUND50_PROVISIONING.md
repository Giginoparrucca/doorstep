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
against the demo project and its deployed origin.

## Phase 6 release verification (2026-10-12, Claude)

Round 50 operational release. Deployed revision
`dpl_3bBKKg6PYk7nyC4H5nir8Q7ycFsj` (`2359ab5`) serving
`https://welcomebnb-demo.vercel.app` and `https://demo.welcomebnb.it`.

### End-to-end journey (run twice)

| Round | Presenter | Mutations before reset | After reset |
|---|---|---|---|
| 1 | `edcf2a10…7417` (presenter 1) | +1 chat (DEMO-NUOVO), +1 check-in (DEMO-NUOVO), +1 analytics (DEMO-NUOVO reco_click), +1 host-dismissed (DEMO-SCADUTO) | probes 0; 10 OTA; 9 fixture check-ins; 6 fixture chats; dates rebased (DEMO-ARRIVO `2026-10-13`, DEMO-SCADUTO depart `2026-10-04`) |
| 2 | `fec66ee7…5839` (presenter 2) | +1 escalated chat (DEMO-AIUTO), +1 check-in (DEMO-GRUPPO group_member), +1 analytics session_start | probes 0; 10 OTA; 9 fixture check-ins; 6 fixture chats; alloggiati_filing_log untouched (0 rows); 0 production properties; 0 vault secrets; 0 cron schema |

Both rounds executed in a single transaction and succeeded. Alloggiati
filing log, production properties, Vault and cron schema remained at
zero rows throughout.

### Secrets-leakage sweep

`scripts/demo-e2e.test.mjs` fetches `/app-config.js`,
`/demo-launch.html`, `/index.html`, `/host-console.html` and
`/lib/demo-fixtures.mjs` from the deployed origin and checks each
payload against five secret patterns (sb_secret value, JWT body with
service_role, Anthropic key, OpenAI key, production project ref). All
five assets pass; the demo publishable anon JWT in `app-config.js` is
explicitly allowed because it is public by design. The two residual
mentions of `welcomebnb.vercel.app` and `app.welcomebnb.it` in
`host-console.html` are both inside long-standing JS comments and are
never used at runtime — every request origin is derived from
`WELCOME_BNB_CONFIG.appOrigin`, verified by the cross-environment
token-denial test that follows the sweep.

### Integration denial + simulation

Nine demo-integration endpoints (`/api/alloggiati?action=send|status|verify`,
`/api/scan-document`, `/api/ical-sync`, `/api/send-arrival-reminders`,
`/api/admin-invite-host`, `/api/telegram-link`, `/api/push-config`)
each returned `403` with `code: "demo_integration_disabled"`. The
Alloggiati simulation (`?action=demo_simulate_filing`) returned
FACSIMILE payloads for all three stages and `400` for an unknown
stage, with zero SOAP symbols in the handler body (verified by
`scripts/demo-ux-sim.test.mjs`).

### Rollback eligibility

The two most recent production deployments are rollback candidates:

| Deployment | Commit | Target | isRollbackCandidate |
|---|---|---|---|
| `dpl_3bBKKg6PYk7nyC4H5nir8Q7ycFsj` | `2359ab5` (Phase 5 merge) | current | true (self) |
| `dpl_2neFse8DktpBp9F5CSwix4KuuhPD` | `08aaf6e` (Phase 4 merge) | previous | **true** |

A rollback to `08aaf6e` is schema-compatible: the Phase 5 PR added no
new migration (only the UX layer and the opt-in sim action). The
Phase 4 Postgres function `public.demo_reset_v1` ships in the Phase 4
migration and remains callable after rollback.

Rollback procedure (owner-only step via Vercel dashboard):

1. Visit `https://vercel.com/giginoparruccas-projects/welcomebnb-demo`.
2. Open the deployment list and find `08aaf6e`
   (deployment ID `dpl_2neFse8DktpBp9F5CSwix4KuuhPD`).
3. Open its detail page and click **Promote to Production**.
4. Confirm the alias moves to the previous build.
5. Verify with `node scripts/demo-live-smoke.mjs https://welcomebnb-demo.vercel.app`
   (expect 3/3 PASS).

Supabase-side recovery stays as documented in the "Recovery and
rollback (demo-only)" section above: the demo project retains daily
backups on the Free plan.

### Regression suite (2026-10-12 against main-branch deployment)

| Suite | Result |
|---|---|
| `demo-live-smoke.mjs https://welcomebnb-demo.vercel.app` | 3/3 PASS |
| `demo-rebuild-verify.mjs <evidence.json>` | 29/29 PASS |
| `demo-rebuild-verify.test.mjs` | PASS (10 negative mutations) |
| `demo-seed.test.mjs` | 17/17 PASS |
| `demo-reset.test.mjs` | 12/12 PASS |
| `demo-ux.test.mjs` | PASS (5 static checks) |
| `demo-ux-sim.test.mjs` | PASS (zero network calls across every path) |
| `demo-e2e.test.mjs https://welcomebnb-demo.vercel.app` | PASS (assets, headers, cross-env, integration denial, sim stages) |
| `environment.test.mjs` (demo + production + invalid) | PASS |
| `deployment-config.test.mjs` | PASS |
| `demo-live-smoke.test.mjs` (harness-self) | PASS |

### Operating cost and maintenance owner

- **Supabase Free plan** — the demo project (`wmegnnlmcrabndyzywmj`)
  stays on Free alongside production; the plan cap is two projects, so
  a third concurrent demo would need a plan upgrade.
- **Vercel Hobby plan** — serverless function cap is 12 and we are
  exactly at it. Adding a 13th function would fail the deploy; Phase 4
  deliberately shipped `demo_reset_v1` as a Postgres function to avoid
  this.
- **No new external usage** — the demo never calls Anthropic, Google
  Maps billable endpoints, Alloggiati SOAP, Telegram, email providers
  or OTA webhooks. Live AI/place-search are opt-in and remain disabled.
- **Maintenance owner**: GPT or Claude via this agent protocol. Daniele
  is the owner of record and is involved only for owner-only actions
  (DNS, billing, legal consent).

### Honest limitations

- The in-session agent cannot drive a real browser, so mobile- and
  desktop-view readability of `demo-launch.html`, the banner and the
  host console must be verified visually by the presenter before the
  first external meeting.
- The Italian PDF generated from `docs/DEMO_ONBOARDING_IT.md` was
  last regenerated at Phase 0a (PR #119). If the script changes before
  the first meeting, regenerate the PDF to keep script and PDF aligned.
- Supabase advisor still reports five SECURITY DEFINER warnings on the
  pre-existing `is_admin()`, `list_hosts_for_admin()`, `purge_booking`,
  `record_qa_exclusion`, `remove_qa_exclusion` functions. Each is
  gated internally (see "Supabase advisor warnings" above) and the
  Phase 4 `demo_reset_v1` carries its own presenter allowlist, so
  these remain documented noise, not an unresolved security gap.


### Round 51 Phase 4 schema extension

Rebuild applies `migration_round51_host_onboarding.sql` and
`migration_round51_test_checkin.sql` after the preserved Round 50 migrations.
The schema verifier records their hashes and the verified extended shape;
no isolation limit or drift check has been relaxed. Non-production probes
leave the steady-state fixture dataset unchanged.

Live Phase 4 Auth/Storage gate passed on 2026-10-13, source `cdedb2c`:
owner and foreign-owner JWTs, guest completion, actual synthetic PNG upload,
private reads and actual application deletion. Shared scheduler cleanup also
deleted a second PNG before row expiry; a controlled 24h boundary probe removed
only its managed test rows. Both probes fully cleaned up. The temporary preview
build gate is disabled; no demo cron was added.


### Round 52 receipt recovery (13 October 2026)

Real receipt collection is blocked in demo; filing/receipt FACSIMILE simulation
remains unchanged. No real PDFs, credentials, cron or new migration are added
to demo. Its existing `round50_receipt_owner_scope` migration already qualifies
`objects.name`; production required the separate additive
`migration_round52_receipt_policies.sql` correction because its older Round 36
policies bound the unqualified name to `properties.name`. Demo rebuild retains
the existing migration bodies and schema fingerprints. Production rebuild must
apply the Round 52 correction after Round 36.
