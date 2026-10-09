# Round 50 Phase 2 - provisioning checkpoint

Status: in progress. The dedicated demo projects are not created. This is a
reviewable schema preparation checkpoint, not a shipped operational phase.

## Verified targets and available access

- Repository: `Giginoparrucca/doorstep`; Phase 1 merged in PR #120.
- Existing Vercel project: `welcomebnb`, in the existing host's team.
- Supabase organization: `Doorstep`, Free plan.
- Existing production database: `Doorstep app`, eu-west-1. Never use it
  as the demo target. Only catalog metadata was read for this checkpoint.
- Supabase project-cost and cost-confirmation tools fail upstream with
  `MCP tool ... was not returned by tools/list`. The create-project wrapper
  requires the unavailable confirmation ID. Do not fabricate an ID or interpret
  published generic pricing as a project-specific quote.
- Vercel project/deployment lookup works without optional team selectors, while
  explicit selectors and the combined protected-fetch wrapper return 403.
  Verify account/project IDs after every response; never use another default
  account simply to avoid that error.

## Smallest remaining owner action if provisioning tools remain unavailable

Create one **empty** Supabase project named **WelcomeBnB Demo** in the existing
**Doorstep** organization, region **West EU (Ireland / eu-west-1)**, using its Free
plan allowance. Do not choose an upgrade or import data. Set the database password
privately in Supabase; never paste credentials into chat. Provide only the project
reference (or its dashboard URL). The agent performs schema, keys, auth, hosting,
fixtures and all subsequent technical work once the new project is accessible.

If Supabase shows a charge or unavailable free quota, stop before creation and
provide the quoted amount. Actual billing approval is an owner action.

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

## Agent continuation

1. Verify new project name, ref, organization and region; reject production.
2. Apply the empty baseline through an authorized management connection. Capture
   migration history with the supported Supabase CLI workflow when available.
3. Run security advisors and fix findings. Test a clean rebuild in a disposable
   isolated database before marking Phase 2 shipped.
4. Create independent guest-token and demo-only secrets; configure invite-only
   Auth with demo site/redirect origins and private storage.
5. Create the separate Vercel demo project and environment; remove cron scheduling
   for that project before its first production-target deployment. Do not copy
   production secrets or deploy unchanged production cron configuration.
6. Connect `demo.welcomebnb.it`, verify DNS or prepare the exact missing record.
7. Test Auth, guest gateway/tokens, private upload/read, cross-owner denial,
   cross-environment rejection and public phone/QR access.
8. Record evidence/PR/deployment and mark Phase 2 shipped only after every gate;
   proceed automatically to Phase 3.

No production DDL/DML was executed for this checkpoint. No hosted Phase 2 tests
are claimed. Phases 3-6 remain pending.
