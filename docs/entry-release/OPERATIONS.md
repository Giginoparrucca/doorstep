# Entry instructions after check-in — operations

Existing/new properties remain OFF until their host deliberately enables the
setting. Do not activate live properties as a deployment step.

## Host setup

1. Open Property, choose Edit, and place entry secrets only in Access/check-in
   instructions, fixed/booking lockbox fields or the assigned room door code.
2. Enable the completed-check-in restriction. Review welcome text, house rules,
   recommendations, attachments and automated messages for copied secrets;
   confirm the review. The software cannot detect every arbitrary copy.
3. Optional: set an arrival-day release time and a valid property timezone.
   Wi-Fi follows the same entry gate. Address, directions and host contact remain
   available. Save applies to the whole page; Cancel restores the saved values.
4. Open Entry status on a reservation or a booking group. Confirm every required
   guest, including minors. A standalone/share-link booking also needs a confirmed
   count/date contract. Unknown totals never silently become one.
5. Status shows incomplete with submitted/expected count, scheduled with property
   time, completed, manual, or needs review. Fix ambiguous room assignments and
   invalid/cancelled bookings; manual release does not override these boundaries.
6. Release access explicitly bypasses completion AND time for this booking.
   Restore automatic re-applies the current roster/time rules. Both use the current
   version, have immutable audit evidence, and fail if auditing fails. Previously
   viewed/copied codes cannot be recalled; this feature never rotates a lock.

## Admin support

Admin view begins read-only. Editing becomes available only after a verified
Auth identity and successful impersonation audit. Missing/failed/delayed audit,
changed property or changed user keeps it read-only.

The database checks current confirmed-user/admin membership, never browser
metadata. Admin roster/release/restore writes the existing admin log and immutable
entry audit in the same transaction using the real admin actor. Either audit
failure rolls back that mutation. Reusing a successful request is idempotent;
a changed/stale request needs a fresh status. Owner behavior is preserved.

The host status endpoint authenticates a Supabase JWT through a scoped RPC,
then uses the same server loader/policy as guest delivery. Its response contains
status/counts/versions only, not guest records, photos, documents or entry codes.
Do not add private-schema/API grants to work around an authorization failure.

## Guest and conversation behavior

Access rechecks after a save, focus/resume, reconnect, other-tab invalidation,
and modest visible-page/scheduled timers. Pending/failed reads clear dedicated
secrets. Timers and client claims never unlock. See `REFRESH.md`.

For opted-in/previously protected properties, an access refresh invalidates active
conversation responses and clears old conversation memory; current permitted
saved host replies are reloaded through the provenance gate. AI/guest historical
text remains withheld because browser-originated text cannot prove which access
snapshot produced it. Ask the concierge again for a fresh answer. Ordinary OFF
properties retain their existing conversation behavior. Old protected rows never
become public just because the host turns the setting OFF.

## Pause and rollback

Set deployment environment `ENTRY_RELEASE_UI_ENABLED=false` and build/deploy the
current secure source. This pauses activation/config changes and manual roster/
release controls while preserving saved property settings, existing guest policy,
private history, submissions, audits and physical codes. Status/support remains
available. Restore `true` (or remove the variable) and rebuild only after checks.
This is an optional operational pause; deployment does not change its value.

Never revert to a pre-Round-66 backend or drop the entry migrations to roll back:
that would remove the server boundary. Keep the shared policy/gateway/chat/RPC
protection and guest cache clearing. If necessary hold entry closed with host
support. No rollback step should delete guest submissions, audit evidence or old
codes, rotate a real lock, or automatically disable a protected property's setting.

## Release and evidence

Run the whole `npm run test:all` gate and current-head CI. New migrations require
actual production HTTP schema-drift success with the exact required name, through
the reviewed-main Production workflow. After deployment verify the exact commit,
public assets and `npm run test:live`. Source/READY status is not a test result.

`entry-round66-release.test.mjs` is a fictional pilot through actual signed
handlers, real disposable PostgreSQL, atomic guest saves, admin audits, host
status, property/keybox/check-in-list/history and AI upstream context. It covers
1-of-3/final completion, manual release/restore, reopening, time, cancellation,
forged scope and pause-mode protected delivery. Browser suites separately execute
the actual complete guest page and host form/dialog/functions at IT/EN mobile/
desktop, including races and failure paths. No real host activation, real guest
write, actual provider call or authenticated hosted pilot is implied by these
synthetic checks. Production smoke is read-only; skips remain explicit.

## Round 66 acceptance map (29 October 2026)

| Acceptance | Executable evidence |
|---|---|
| Shared booking/roster policy, complete current required guests, time/DST, invalid scope | `entry-release-policy.test.mjs`, `entry-submission-validation.test.mjs`, `entry-release-storage.test.mjs`, `entry-release-loader.test.mjs` |
| Atomic writes, retries, reopened/deleted guests, scope/room isolation and all code projections | `entry-atomic-submissions.test.mjs`, `entry-round66-release.test.mjs`, `round66-fixed-code.test.mjs` |
| Real owner/admin authorization, audit failure rollback, paired actors, stale/idempotent override | `entry-host-audit.test.mjs`, `entry-release-storage.test.mjs` |
| Host opt-in review, page-wide edit/save/cancel, errors, timezone, pause | `property-edit-browser.test.mjs`, `unsaved-forms-browser.test.mjs`, `round66-host-console-optin.test.mjs` |
| Booking status, explicit counts, release/restore, read-only admin and scope races | `entry-host-status-browser.test.mjs`, `admin-edit-audit-browser.test.mjs`, `admin-access-browser.test.mjs` |
| Guest incomplete/completed/scheduled state, no premature codes in DOM/storage, refresh/back/offline/tabs | `entry-submission-browser.test.mjs`, `round66-fixed-code-browser.test.mjs`, `guest-entry-refresh-browser.test.mjs`, `guest-entry-refresh.test.mjs` |
| Forged AI context, protected instructions/history, stale active streams and old Q&A | `entry-release-chat-directive.test.mjs`, `entry-chat-history.test.mjs`, `entry-chat-history-browser.test.mjs`, `guest-entry-refresh-browser.test.mjs`, `entry-round66-release.test.mjs` |
| UI pause preserves existing protected delivery, codes and data | `environment.test.mjs`, `property-edit-browser.test.mjs`, `entry-host-status-browser.test.mjs`, `entry-round66-release.test.mjs` |
| Compliance unchanged, direct anonymous access denied, production schema installed | Full-suite serializer byte goldens; `round65-grant-probes.test.live.mjs`; protected `schema-drift.test.live.mjs` with exact required migration names |
| Guest links/reminders and arbitrary copied host content | Source inventory confirms host share/reminder paths send guest links rather than dedicated codes; mandatory activation content review covers arbitrary prose/attachments that software cannot certify |

The first eight rows execute isolated fictional fixtures, including actual SQL,
handlers and browser code as stated above. They do not certify a real hosted
owner/admin session. Deployment, HTTP drift and live-smoke run evidence belongs
in CHANGELOG; owner approval waiting is never a passing drift result.
