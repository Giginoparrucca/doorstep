# Round 50 Phase 1 - Environment configuration

Production and demo use the same code. `lib/environment.mjs` defines the public
contract; `api/_environment.js` validates it at each function cold start. Every
handler rejects invalid configuration before a database or external-service call.

## Configuration

| Variable | Production compatibility | Demo requirement |
|---|---|---|
| `APP_ENV` | Missing means production for existing deployments | Must be `demo`; demo project metadata without it is rejected |
| `DEMO_SUPABASE_PROJECT_REF` | Not used | Dedicated non-production 20-character project ref |
| `SUPABASE_URL` | Existing production URL/default | Exact URL of the demo project |
| `SUPABASE_ANON_KEY` | Existing public key/default | Demo anon JWT or publishable key; legacy ref/role checked |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server key | Independent demo service key; legacy ref/role checked |
| `GUEST_TOKEN_SECRET` | Existing token behavior | Independent secret of at least 32 characters |
| `APP_BASE_URL` | Existing app origin/default | Demo HTTPS origin; production origins rejected |
| `HOST_CONSOLE_URL` | Existing current/legacy production origin | Same demo origin; defaults to its host-console path |
| Vercel project/branch/deployment URLs | Exact origins, as before | Exact demo origins; production domains rejected |

Never copy production secrets into demo. Modern Supabase opaque keys cannot be
bound to a project by decoding them: Phase 2 must verify their actual database
and Auth access. Do not log secret values while configuring them.

## Build and browser

`node scripts/build-config.mjs` generates `app-config.js`, containing only the
explicit public fields. A missing/unsafe demo setting fails the build. Vercel runs
this command using its deployment environment; do not manually generate demo
configuration into a production deployment.

All three pages load `app-config.js` and `app-bootstrap.js` before initializing
Supabase. Missing config, wrong deployment origin or production DB in demo causes
initialization to fail without a production fallback. Demo auth storage has a
separate key, and database changes invalidate demo-only application cache.
Production local-storage migration and current/legacy domains remain supported.

Configuration is served with `no-store`; bootstrap is revalidated. Frontend
configuration and backend configuration come from the same deployment variables.
Vercel statically traces the environment module imports; Phase 1 preview checks
must verify this and the generated static assets before merge.

## Integration inventory and initial guards

| Surface | Phase 1 behavior in demo | Later phase |
|---|---|---|
| Alloggiati status/save/test/send/tick | Entire handler blocked; SOAP transport also refuses demo | Labelled simulations in Phase 5 |
| OTA sync/export, manual and cron | Entire handler blocked | Local fixtures in Phase 5 |
| Invitation/revoke API | Entire handler blocked | Presenter accounts provisioned administratively in Phase 2 |
| Telegram linking/webhook | Entire handler blocked | Remains externally disabled |
| Push configuration/test | Entire handler blocked | Presenter-visible simulated inbox in Phase 5 |
| Scheduled reminder/purge handler | Entire handler blocked | Demo-only maintenance must be configured separately |
| Chat/test/autofile notification helpers | Return without dispatch or network | Simulated inbox in Phase 5 |
| Document scan API | Blocked before any upload reaches AI | Facsimile simulation in Phase 5 |
| Guest gateway and token mint | Real demo database, scoped token flow | Hosted verification in Phase 2 |
| AI chat and tax parsing | Real API with demo DB identity and existing limits | Dedicated AI configuration and live checks in later phases |
| Host guest-link/QR origin | Generated demo origin | UI completion in Phase 5 |
| Manifest/service worker/guides | Existing relative links stay on deployment origin | Demo labels/guide changes in Phase 5 |

The production `vercel.json` cron entries remain unchanged in this shared-code
phase. Phase 2 must deploy a demo config with no production cron registrations;
server guards already reject such calls if scheduled accidentally. Demo Auth must
also prevent invitation/password-reset email delivery to unintended recipients;
configure that on the separate project before sharing any demo accounts.

## Tests and evidence

Run `node scripts/environment.test.mjs` after installing existing dependencies.
The test uses fresh child processes for demo, invalid and production environments
and fetch spies, with no real credentials or network traffic. It exercises actual
handlers/helpers, config generation, browser bootstrap/cache migration, exact CORS
allowlists, legacy key validation and guest-token rejection across fixture secrets.

Also run `node scripts/guest-checkin.test.mjs`,
`node scripts/autofile-due.test.mjs`, API/inline-JS syntax checks and
`git diff --check`. The Alloggiati record builder is unchanged; its due-time
regression has eight cases including DST. Record preview build and HTTP checks
in CHANGELOG before marking Phase 1 shipped.

Rollback: revert the Phase 1 PR as one unit and redeploy the preceding revision.
Do not revert only the generated configuration or HTML changes independently.
There are no database migrations in Phase 1.
