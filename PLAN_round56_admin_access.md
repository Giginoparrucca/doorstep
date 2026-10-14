# Round 56 — Reliable admin support access

## Problem and scope
Opening another host's console from admin can land on the login screen. Current
entry opens a new browser tab after asynchronous authentication/audit work. Keep
support navigation in the existing authenticated browser surface, with a return
to admin control. No credentials/tokens in URLs, opener messages or copied storage.

The host's auth event callback currently performs nested authenticated RPC and
password updates. Defer event work outside the synchronous callback to avoid
Supabase lock contention; current SDK fixture sign-in alone did not reproduce a
hang, so this is hardening rather than a claimed complete diagnosis of the user's
browser state. Preserve the target property query through password setup.

## Phase 1
- Validate the source user/admin before navigating, retaining the audited action.
- Same-origin, same-tab host console URL, preserving p/admin parameters. Return to
  admin via same-origin link rather than window.close.
- Authenticate normally on destination; independently verify admin before the
  target property query. Never trust URL flags, user metadata or the source page.
- Activate existing read-only state before language/form initialization, retain
  final read-only rendering, and prevent automatic language persistence in support
  view. No changes to RLS, accounts, session TTLs, passwords or production records.
- Move async auth event work outside the auth callback; retain invite/recovery
  behavior and same-origin selected-property redirect after password setup.

## Gate and release
Execute actual source functions with missing/expired sessions, non-admin and valid
admin, log failure, property scope, target preservation and read-only ordering.
Real browser flow with the actual Supabase browser SDK and fictional intercepted
Auth/REST: admin sign-in, same-tab navigation, persisted session on target, login
when truly absent, non-admin denial and auth callbacks. No production credentials
or guest records in fixtures. Run canonical links, Share, environment, calendar,
onboarding and receipt regressions. Merge to main under standing authorization;
verify exact hosted admin/host source and canonical config. Record PR, commit,
test evidence and remaining limitations in CHANGELOG. Revert source commit to
rollback; no migration required.
