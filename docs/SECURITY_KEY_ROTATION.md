# Production API-key replacement — Round 65

**Protected replacement-key verification — 27 October 2026:** owner-approved main run [40450034237](https://github.com/Giginoparrucca/doorstep/actions/runs/40450034237), job `122010353999`, SHA `6f178130086b22877a9553dec33e149f39aa8dcf`: **PASS 6 / FAIL 0 / SKIP 2**. Actual production grants/dry-run calls, Auth-admin/Storage GET authorization, schema drift, security headers, SPOT and tax pass. Only demo origin/provider opt-in skip. The owner reports entering the modern `default` secret; successful authorization is independently verified, while key format remains owner-reported because the runner suppresses passing test stdout and no credential value was retrieved. Prior run 40431137141 was cancelled. Vercel metadata is still unchanged (sensitive, production-only; updatedAt 1787729237074), so application-key cutover is not complete. Production project: `jcjwaqqabgwqhhzhfbts`; demo remains separate.

## Verified consumer inventory

| Consumer | Credential and request boundary | Replacement gate |
|---|---|---|
| Vercel production project welcomebnb | Sensitive, production-only `SUPABASE_SERVICE_ROLE_KEY`; metadata checked without decryption | Owner enters a named new server secret, production deployment and read-only live checks |
| GitHub manual production-security.yml | Environment Production / `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`; reviewer, main-only, no admin bypass | Owner enters its named CI secret and approves main run; grants/schema drift must pass |
| api/guest.js and api/guest-token.js | Privileged REST/RPC; signed guest scope; guest-token also sends host JWT separately | Synthetic secret/legacy gateway tests; retain signed scope and host JWT |
| api/alloggiati.js, _alloggiati-receipts.js, _alloggiati-support.js | REST, RPC and document storage; provider credentials are separate | Synthetic collector and compliance suites; no real submission probe |
| api/ical-sync.js | Service REST for cron/export; user JWT REST for host sync | Preserve explicit user JWT, cron/export gates, parser and cancellation fixtures |
| api/chat.js and api/scan-document.js | Privileged REST/RPC; guest/host auth separate | Existing chat isolation/document tests and synthetic key headers |
| api/admin-invite-host.js | Auth admin + privileged REST, host authentication first | Retain auth-admin key headers and existing admin/host tests; do not create real users as a probe |
| api/parse-tax-delibera.js, api/push-config.js | Privileged REST/RPC after host JWT check | Synthetic host token/rate-limit and tax suites |
| api/telegram-link.js, api/telegram-webhook.js, api/_notify-host.js, api/send-arrival-reminders.js | Privileged REST/storage; Telegram, mail, push and cron credentials separate | Existing synthetic notification/reminder suites; no messages sent by tests |
| api/_ireservation-store.js via _ireservation.js / comparison actions | Private-schema RPC gateway | Synthetic transport key-header test; preserve provider activation gate |
| scripts/round65-grant-probes.test.live.mjs and scripts/schema-drift.test.live.mjs | Reviewed CI read-only/dry-run production REST probes | Support new API-key header, no bearer when key is opaque; run with owner-provisioned CI key |
| Browser clients and lib/environment.mjs | Still use legacy production public anon key; host/user JWTs remain independent | Public-key migration and cached-client inventory before legacy API keys may be disabled |
| Local/demo/operator scripts | Some still send legacy key as bearer or use their own SDK/config | Audit the exact tool before use with a new key; never point demo tools at production |

## Actual database metadata inspection

Read-only SQL inspected classifications and names, never cron command bodies, request payloads, secret values or Vault decrypted values.

- Three active jobs: `welcomebnb_daily_purge` (0 2 * * *), `welcomebnb_daily_qa_capture` (30 1 * * *), and `alloggiati-autofile-tick` (*/10 * * * *). These are pg_cron UTC schedules, not local-time instructions.
- First two have no network/Vault/embedded JWT/server-key reference in their commands.
- Alloggiati job targets the Vercel Alloggiati API, references Vault and has no embedded JWT/server-key reference. Its Vault secret name is `autofile_cron_secret`, separate from the Supabase server API key. Do not change it in this operation.
- Vault contains one secret, the cron secret above. No decrypted value was accessed.
- Edge Functions list is empty. `supabase_functions.hooks` does not exist. No public/private function source matches net.http/http_post/http_get. This covers inspected database state, not external tools unknown to the repository.

## Header compatibility

All direct backend service-key consumers above use api/_supabase-auth.js. Legacy JWT API keys retain the existing apikey + Bearer headers. For `sb_secret_` or `sb_publishable_` API keys used as their own bearer, only apikey is emitted. An explicitly supplied user JWT remains in Authorization. The helper constructs headers only; it does not authorize a request or weaken tenant/guest/cron checks. Protected live probes use the same rule.

Current Supabase migration guidance sends opaque keys on apikey, not as bearer JWTs. Documentation has varying platform compatibility notes; this implementation relies on apikey-only for an opaque key and retains actual user JWTs. Do not depend on gateway translation of a secret in Authorization.

## Staged owner handoff and acceptance

1. After code/CI/deployment gates pass, the owner opens production Settings > API Keys and creates named secret keys for Vercel production and trusted CI. Keep existing keys active. Credential creation/entry stays in owner interfaces; never paste values in chat/source, screenshots or command arguments.
2. First replace only GitHub Production Environment secret SUPABASE_PRODUCTION_SERVICE_ROLE_KEY with the named CI key. Invoke production security smoke from main and approve its Environment review. Require grants/schema/header/SPOT/tax and Auth-admin/Storage passes before touching the application credential. The additional `scripts/round65-service-access.test.live.mjs` gate is auto-discovered by the live runner and requires a fresh main run after this change lands. Preserve the Environment protections and record only names/metadata. Then the owner can enter a separate named key into Vercel production SUPABASE_SERVICE_ROLE_KEY, preserving sensitive/production-only scope.
3. Deploy main, approve the protected main workflow and require all six read-only production checks to pass. The Auth-admin/Storage gate makes GET requests, cancels response bodies without parsing/logging them, rejects non-200 or non-JSON responses and reports only key classification. Verify new-key authorization with these probes, plus guest/host behavior; the ordinary five checks alone do not cover every service. No real Alloggiati send/calendar sync/notifications are validation probes.
4. If a new key fails, restore the existing compatible key through owner secret interfaces and redeploy, while legacy keys still work. Do not log old/new values. Leave the failed new key unused and review its later removal with owner confirmation.
5. A separate public publishable-key migration must replace every built-in fallback/browser entrypoint and inventory cached clients/local operators before disabling legacy API keys. **The current browser still needs legacy anon. Do not disable the legacy API-key switch or reset the JWT signing secret in this server-only stage.** Server cutover alone does not revoke the old service-role credential.
6. When every legacy consumer is migrated and tested, owner deactivates legacy API keys using the provider's supported control, with documented rollback. JWT signing-key rotation is a separate operation. Delete a named modern key only after its replacement is proven and owner confirms irreversible removal.

## Evidence and remaining gates

The protected credential move and repository-secret retirement are already complete: owner-approved run 40311200329, live 5/0/2, and GitHub UI shows no repository secrets. Do not repeat that setup.

This preparation is not completed key rotation. New-key live verification, legacy-consumer migration/deactivation, security mailbox verification and reviewed CSP observation remain actual release gates. CSP review is no earlier than 2 November 2026 at 17:26 Singapore, with actual flow/log evidence.

Sources checked 26 October 2026:
- https://supabase.com/changelog.md (including current breaking-change index; no TLS/cipher settings changed)
- https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://supabase.com/docs/guides/getting-started/api-keys
