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
