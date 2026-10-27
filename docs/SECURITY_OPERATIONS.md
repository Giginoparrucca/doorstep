# Round 65 security operations handoff

## Verified on 26 October 2026

- Phases 1–4 and 5a/6 are deployed. See CHANGELOG for the tested trees, PRs and production deployment evidence.
- Vercel project `welcomebnb`: `SUPABASE_SERVICE_ROLE_KEY` is already **sensitive**, targeted only to **production**, with no branch/custom-environment targets. Verified through metadata with decryption disabled; no secret value was retrieved or changed.
- The GitHub owner UI showed and confirmed dependency graph, Dependabot alerts and automatic security-update PRs enabled. Existing secret and push protection remained on.
- Private vulnerability reporting is enabled and persisted after reload. Existing GitHub Environment `Production` now requires reviewer `Giginoparrucca`, prohibits administrator bypass and permits only branch `main` (one branch, zero tags), verified after reload. Owner has now populated Environment secret `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`; its name was verified without reading its value. Owner-approved main run [40309968215](https://github.com/Giginoparrucca/doorstep/actions/runs/40309968215) passed all five production gates (5/0/2).
- The local workspace/browser briefly disconnected after PR #212 merged and then returned. Connected-service verification confirmed its production SHA, headers, SRI tags and exact hosted SDK bytes; local regression resumes for Phase 7. Evidence screenshots are in `docs/security/`.

## Prepared protected smoke workflow

`.github/workflows/production-security.yml` is manual-only and checks the invoking ref is main and repository variable `ROUND65_PRODUCTION_ENV_READY` is exactly true. It is inactive otherwise. The owner-provisioned environment and readiness flag are now verified; the first owner-approved run passed. The distinct Environment secret name `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY` maps to the existing runtime variable `SUPABASE_SERVICE_ROLE_KEY`; the old repository-wide secret of the latter name cannot silently satisfy this workflow. It checks out that trusted SHA, installs locked dependencies before placing the credential in the final step, requires a non-empty credential, and runs the read-only live suite against production. No provider probe, reset or real guest operation is enabled.

This readiness variable is a deployment gate, **not a substitute for protection rules**. Do not set it until the Environment and secret have been verified. Merely naming an Environment in YAML can create one without the intended protections.

## Smallest remaining account actions

1. The owner Environment protections are already configured and verified as described above. Preserve them. Self-review remains unchecked so the sole owner can manually approve a run initiated under their account; an agent must not approve the run or bypass the requirement.
2. **Completed 26 October:** populate existing Environment `Production` with secret name `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY`. Its value must be the compatible production server credential, entered by the owner through the secret-entry interface; copying the existing credential to this protected slot can precede separately coordinated rotation. Do not paste keys in chat, issues, source or screenshots. Existing repository secret values cannot be read back from GitHub.
3. **Completed 26 October:** after verifying the Environment rules, set repository variable `ROUND65_PRODUCTION_ENV_READY=true`. Run the prepared manual workflow from main, approve its Environment review as owner, and require grants/schema-drift/header/SPOT/tax passes. Missing secrets must fail; a skipped workflow is not a pass.
4. **Completed 26 October:** PR #219 merged and deployed; full local/CI 83/0/3 and public live 3/0/4. Owner removed the old repository-level secret; fresh GitHub UI confirms no repository secrets and the protected Environment secret remains. Owner-approved main run [40311200329](https://github.com/Giginoparrucca/doorstep/actions/runs/40311200329) passed 5/0/2, including production grants/schema drift. PR regression retains full offline/browser and credential-free public hosted/anonymous checks; privileged checks stay in the reviewed main-only manual workflow. Keep these controls. Migration phases still require actual production grants/drift evidence before closure. This copy/removal is not production key rotation.
5. Private vulnerability reporting is already enabled and verified. SECURITY.md publishes that channel and the existing info@ fallback; the dedicated alias remains unverified.
6. Create/forward and verify `security@welcomebnb.it`, then update SECURITY.md. No email has been sent by this task.

## Coordinate server-key replacement

See [SECURITY_KEY_ROTATION.md](SECURITY_KEY_ROTATION.md) for the source/production consumer inventory, header preparation, owner entry and rollback/legacy-key gates.

The original plan's “reset service_role key” instruction is not a safe stand-alone rotation procedure. Legacy anon/service_role JWT keys share signing-key dependencies. Current Supabase guidance supports staged migration to publishable and secret keys, which can be managed independently. Read the current project/key state before choosing the procedure.

Inventory Vercel handlers, trusted CI probes and any Supabase cron/webhook/Vault consumers. Verify how each sends `apikey` and bearer authorization; new secret keys are not JWTs, so do not blindly substitute one in a JWT-only path. Test the chosen replacement without revoking the old credential. Coordinate owner credential creation/entry and a quiet window; record consumer names and successful checks, never values.

Update Vercel production and the protected GitHub Environment, deploy, pass live role/grant/schema and guest/host checks, and only then revoke/deactivate the replaced key after all consumers are confirmed. Plan rollback before revocation. Do not rotate the JWT signing secret or invalidate public anon/session credentials as an unreviewed shortcut. On 27 October the owner reported updating the CI Environment secret to the existing modern `default` key. Run 40431137141 at ac82f75 is awaiting owner approval; no modern-key pass is yet verified. Vercel remains unchanged and legacy API keys remain enabled. The new Auth-admin/Storage live gate requires a subsequent fresh main run; do not rerun an old SHA and call it coverage of the new gate. No agent-created key, revocation or JWT-signing reset is claimed.

## CSP and final release gates

The observation period began 2026-10-26 09:26 UTC. Phase 5b review is no earlier than **2026-11-02 09:26 UTC**, with actual flow/log evidence per [SECURITY_CSP_WATCH.md](SECURITY_CSP_WATCH.md). Elapsed time or empty logs alone do not pass it. There is no unattended monitor.

Round 65 remains open until the account/key gates above, reviewed CSP enforcement and final whole-suite/protected live release evidence are complete. Preserve Claude's Phase 1 attribution and the separate Round 63/66 work. Do not delete the original handoff branch while the round is open.

## Primary references

- [Supabase key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [GitHub protected environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [GitHub private reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)
