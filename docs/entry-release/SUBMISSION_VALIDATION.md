# Round 66 Phase 1c — saved guest validation and binding

This continues the already approved Round 66. It does not close the remaining
chat/history, rollout, admin and complete-browser-journey gates in the plan.

## Write contract

The signed guest gateway calls service-only `entry_access_submit_checkin`.
OFF returns an explicit `enabled:false`; only this verified result selects the
legacy write. A timeout, absent RPC, bad response or rejection cannot select it.

For ON, the database serializes the booking with the same advisory lock used by
host roster/release RPCs. A unique active reservation supplies dates and the
guest-count floor. An unknown count never defaults to one. Standalone bookings
use a previously owner-confirmed contract; guests cannot create that authority.
Current reservation changes invalidate stale identity/release state.

The check-in row and stable roster-slot binding commit or roll back together.
A random submission ID and ordinal identify a logical guest. The same request
returns the original acknowledgement, without inserting another row or clearing
a later reopen flag. Reusing its identity with different fields or a retired
slot fails. Competing identities for the same slot fail. No name matching is
used. The browser retains only random request IDs in session storage; guest
details, uploads and access codes are not stored there by this feature.

The response carries the authoritative required count so the client continues
the correct number of forms. A correction to a saved guest uses the existing
scoped update route and retains its binding. Save responses carry no entry code.

## Read contract

Service-only `get_entry_access_booking_snapshot` reads the current property,
reservation, active slots/bindings, full saved guest fields, scoped document
storage evidence and room assignments in one STABLE database snapshot. This
replaces the ON loader's synthesized validation and photo flags. The raw fields
remain server-side and are not sent to the guest/model or logged.

`validatePersistedEntrySubmission` runs for every current bound row on every
sensitive read. Invalid required fields, reopened/deleted rows and missing
required photos cannot qualify. Valid corrections produce fresh revision
evidence. Portal filing, receipt and tax status are irrelevant to eligibility.
The existing scan is optional; the new trusted slot `photo_required` default
preserves that rule. When required, evidence needs both an existing documents
object and the exact property/check-in upload prefix. A browser `docs_status`
flag or unrelated existing object cannot satisfy it.

The shared guest renderer is reused after completion to retrieve fresh property
access, and clears old fixed/rotating/row/room values on a denial or read error.
This is not a claim that focus/resume, second-tab or scheduled-time refresh is
complete; those broader journeys remain in the Round 66 plan.

## Verification and operational limits

`entry-atomic-submissions.test.mjs` executes the actual migrations, role grants,
save adapter, snapshot loader, validator and policy in disposable PGlite. It
covers rollback (including first-booking creation), stable retries, slot
conflicts, 1-of-3/final unlock, current edits/reopen/deletion, count growth,
standalone authority, scoped storage evidence, schedule and cancellation.
It is not a multi-connection PostgreSQL load/deadlock test.

The actual gateway insert is tested for trusted scope, transactional writes,
legacy behavior and fail-closed RPC errors. Chromium tests exercise actual
client retry/edit/refresh helpers over fictional HTTP at IT/EN mobile/desktop.
Full CI and production migration/drift/deployment evidence belong in CHANGELOG.

Existing unbound historical check-ins are not matched to slots by name or
silently marked complete. They require explicit roster reconciliation or the
existing audited host release. No property is automatically opted in. Keep the
secure backend boundary when rolling back UI; do not revert to synthesized
validation or expose codes to make an incomplete booking appear operational.
