# Round 66 — Server integration contract and delivery inventory

Checkpoint: **Phase 1 foundation and staged persistence**, 26 October 2026. The isolated
policy and current-row validator are not imported by a production route. Roster,
slot, binding and atomic override/audit SQL is tested in disposable PostgreSQL,
but no setting, table, guest workflow, migration or override RPC is operational in production. Activation
must remain unavailable. `PLAN_round66_checkin_access_release.md` remains the
acceptance specification; none of its implementation phases is shipped here.

## Coordination boundary

Original claim baseline: main `3f581f4c51a73c3f548365a7650f772cbd59ddc9`.
During implementation, main advanced to `8288b66` (Round 65 Phase 1 chat XSS
fix, PR #206); it was fast-forwarded into this checkout before the final suite.
Claude's branch was also inspected at `cab5341`. Round 65's owner-check migration
and later security/dependency changes are not present on these inspected heads.
Do not cherry-pick or overwrite Claude's work. Keep the Round 66 policy/test
files independent. Before touching shared routes/pages or applying migrations,
fetch again, incorporate the final Round 65 keybox contract, reconcile its
service-role behavior and serialize migrations/releases. This is an integration
dependency, not a request for Daniele to reconfirm the already approved round.

## Delivery inventory from the inspected source

| Path | Observed behavior | Required integration before opt-in |
|---|---|---|
| `api/guest.js` → `doProperty` | `bookingHasCheckin` counts one row; `access_method` is post-check-in text. Fixed `keybox_code` is currently absent from the property whitelist. | Use authoritative policy for entry text/codes; preserve Wi-Fi's existing behavior; do not broaden fixed-code visibility accidentally. Add no-store. |
| `api/guest.js` → `resolveGuestRoom` | First check-in room wins, then first active reservation room; door code follows one-row completion. | Read all scoped assignments, reject ambiguity/read failure, use shared policy before code projection. |
| `api/guest.js` → `checkin_list` | Returns `keybox_code` in `CHECKIN_READ_FIELDS`. | Strip entry values until policy allows; do not spread raw rows around the projector. |
| `api/guest.js` → `checkin_insert` | Returns ID/code of booking, clears reopen flags, stamps rotating keybox via service-role RPC. Guest rows currently have no trusted roster slot. | Persist validated submission against stable roster slot transactionally; idempotent retry key; do not confuse booking link code with an entry secret. Coordinate keybox RPC caller with Round 65. |
| `api/guest.js` → `checkin_update` | Returns the updated database row and fans main-guest dates to companions. | Positive response whitelist, current-row revalidation and invalidation of old evidence; atomic date/identity changes. |
| `api/guest.js` → `history`/`poll`/`send` | Delivers arbitrary stored chat messages; browser can write bot/system messages. | Protected historical content cannot bypass gate. Quarantine/delay unsafe host/system access messages while locked; preserve guest help. No regex-only guarantee. |
| `api/chat.js` | Trusted token scopes location/recommendations, but `propertyContext`, `stayContext`, and message history come from browser. | Build access context server-side; filter history before model/browser delivery; never give locked secrets to model/tools. Reject forged authority. |
| `index.html` → `fetchReservationKeybox` | Calls `get_reservation_keybox` directly through browser SDK. | Replace with shared server projection; Round 65's owner-only RPC must remain owner-only. |
| `index.html` → `_resolveLockboxCodes` | Reservation code wins, then head check-in; property visibility switches and placeholder filtering. | Preserve switches/precedence; drop first-record fallback; consume only projected entry payload. |
| `index.html` → `buildPropertyContext`, Home, welcome-back | Access text feeds AI; property/room/code state held in browser variables. Booking/session/lookup keys use local/session storage. | Locked/scheduled cards and fresh server refresh; clear old secret-bearing state on switch/upgrade/focus; never cache codes in storage/service worker. |
| `host-console.html` → property editor/room editor/booking check-in details | Fixed/rotating settings, room door codes, guest count on direct reservations, reopen and guest editing already exist. | Page-wide opt-in save/review, trusted roster correction, booking status, audited release/restore; update evidence when required guest rows change. |
| Share/QR and `api/send-arrival-reminders.js` arrival pass | Generates booking links (including booking identity), not entry codes in the inspected arrival template. | Keep links safe; network/assertion tests for generated messages and QR. Review all copy/export templates again on integration baseline. |
| `lib/alloggiati-records.js`, regional/tax exports | Compliance records have independent validation/filing lifecycle. | No changes to their outputs. Entry completion never depends on filing/payment/receipt status. |
| Legacy grants/RPCs, demo/test routes, host replies, reusable Q&A | Independent paths can disclose values despite a hidden guest card. | Inventory live grants/RPCs with read-only checks and protect every path before activation. Verify Q&A does not retain entry secrets. |

The inventory is source inspection, not a live-security audit. Arbitrary secrets
duplicated in prose/attachments require host review; already delivered codes
cannot be recalled. No real guest, code or production record is used in tests.

## Pure policy contract (not a database schema)

`evaluateEntryRelease(snapshot, now)` returns only a state, reason, counts,
release instant and boolean. `projectEntryInstructions(snapshot, now)` evaluates
again and returns a **positive allowlist of entry fields only**. Do not pass
request bodies as snapshots, accept a client decision, or merge raw property,
room, check-in or reservation rows into responses. Neither function authorizes
host actions or verifies HMAC tokens. Callers must perform those checks first.

The server loader, still to implement, must satisfy all of these conditions:

- `scope`: verified, unrevoked session; authoritative property, booking ID/code,
  test flag and absolute session expiry. The existing stay/session validity
  rules supply `booking.valid_until`; the module must never extend them.
- `reads_complete: true`: every necessary read succeeded, all pages were read,
  expected sources are present, and one consistent transaction/snapshot version
  was observed. Independent racing REST reads cannot simply assert this flag.
- `booking.identity_version`: persisted version bound to immutable booking ID,
  booking code, reservation link and arrival/departure identity. Increment when
  these change. Override identity must match; codes cannot transfer to a new
  occupant. Do not reuse booking codes as sole primary keys.
- `roster`: persisted confirmed slots, unique per booking, with a version, source
  and explicit required/photo rules. Host/reservation count is a floor; unknown
  does not mean one. Standalone links require a server-validated persisted
  contract. `server_contract` is a trusted server attestation, never a value
  copied from guest-entered party size or analytics. Current UI guest count is
  insufficient authority. Use existing companion/minor exemptions.
- `submissions`: current persisted row per stable slot. Validate **all current
  required fields and applicable document/photo rules on the server**. Only that
  validator may set `validated`, `validation_version: entry-v1`, photo evidence,
  and matching `source_revision`/`validated_revision`. These are internal
  evidence, not new client-writable columns. No missing/error validation result
  qualifies. A roster change invalidates stale receipts; implementation may
  revalidate unaffected current rows within the same transaction.
- Stable slot uniqueness + transaction/upsert handles retries and concurrent
  saves. The pure module detects conflicting live duplicates; it does not claim
  to deduplicate arbitrary independently inserted rows or perform transactions.
- `override`: authorization and actor resolved server-side, release/restore and
  nonsecret audit committed in one transaction. `audit_committed` is a server
  acknowledgement, not guest input. Persist actor/action/reason/UTC timestamp;
  audit failure must roll back the override. An expired/cancelled session/stay
  or failed read cannot be rescued by manual release.
- `room_resolution`: `none` only for a booking with no assigned room; `unique`
  only after reconciling every scoped assignment. Other states fail closed.
- `entry_checkin_required`: absent/false preserves the explicit legacy
  `legacy_has_checkin` result. True enforces roster/time; malformed values close
  access. Its setting names are the proposed internal contract, not columns
  already deployed. Keep opt-in hidden until integration is complete.

## Time semantics

The optional release time is `HH:MM` in an explicit IANA property timezone,
recomputed for each sensitive request from current arrival/policy values. There
is no browser timezone/default. Repeated fall-back times use the later UTC
instant; missing spring-forward times advance to the first real local minute.
Skipped calendar days or gaps beyond three hours fail closed for host review.
An exact release boundary is inclusive. Manual release bypasses time and roster,
but preserves booking/session/read/tenant checks. Store audit instants in UTC.

## Remaining Phase 1 gate

Promote and apply the staged persistence after the sequencing gate; implement
the transactional snapshot loader, guest submission binding/writes, audited
admin-impersonation integration, every handler projection and final RPC grants. Add real
handler/RPC/concurrency tests; pure policy tests cannot satisfy that gate.
Generate any migration with the Supabase CLI, verify current docs, run advisors,
serialize production application with Round 65 and prove schema-drift before
calling a migration shipped. Then run complete regression on the integrated
source. Phases 2/3 remain pending; no operational or live pass is claimed here.

## Phase 1b staged persistence and actual record validation

`staged-migrations/20261026072310_round66_entry_roster_audit.sql` was created
with `supabase migration new round66_entry_roster_audit` in a scratch staging
project. It is deliberately **outside `supabase/migrations`**, not registered,
not applied, and not counted as deployed by schema-drift. Promote it through the
normal migration/advisors/production drift gates only after Round 65 sequencing;
if the migration order changes, recreate the final file with the CLI. Do not
treat a green current production drift check as evidence that this draft exists
in production.

The candidate schema provides private `entry_access` booking contracts, stable
numbered slots, scoped check-in bindings and immutable audit events. Owner RPCs
confirm the roster and release/restore entry instructions. Direct table writes
are unavailable to anon/authenticated/service roles. Service role gets read-only
private data; public RPC execute is authenticated-only with an explicit current
property owner check. Admin impersonation is intentionally still pending;
`is_admin` or user metadata cannot bypass owner checks in this checkpoint.

Roster confirmation cannot lower a known reservation count or hide an existing,
cancelled/deleted/ambiguous reservation behind a standalone contract. It accepts
standalone bookings explicitly confirmed by their owner. Repeated request IDs
return the original acknowledgement without repeating writes; different
requests reusing an ID fail. Optimistic versions reject stale edits. Reducing a
roster retires slots; later growth creates fresh identities instead of reusing
a removed guest. Date/reservation identity changes clear prior manual release
and retire all old slots. Each mutation and its nonsecret audit acknowledgement
commit or roll back together. Guest binding is constrained by tenant, booking,
test scope, active slot and unique check-in/slot identity. This does not yet add
the guest endpoint which writes those bindings.

The existing `migration_round36_photo_retention.sql` hard-deletes old properties
and reservations. Property deletion cascades the whole private contract,
slots/bindings and its audit after the parent booking is gone; individual audit
edits/deletes stay forbidden. Reservation deletion keeps its immutable UUID as
an invalid reference rather than silently converting the contract to standalone.
These behaviors have actual SQL tests. No existing retention function was edited.

`api/_entry-submission-validation.js` revalidates current saved names, sex,
dates, recognized countries/documents, main-guest document fields, booking stay,
reopen state and applicable photo evidence. Family/group members and minors do
not acquire document/photo requirements their current rules exempt. Photos
are required only when the trusted slot rules say so. A storage proof must be
constructed by the future server loader; `docs_status=complete`, a browser flag,
an unverified storage path or portal success is not proof. The validator emits
versioned evidence/hash and field-name errors without copying personal fields,
photo paths or codes into that evidence. Valid unrelated corrections revalidate
successfully; an invalid current document immediately makes policy composition
return locked. No compliance builder/output was changed.

`scripts/entry-release-storage.test.mjs` executes the actual SQL twice against
disposable PostgreSQL 17.5 via pinned `@electric-sql/pglite@0.3.14`. It exercises
grants/RLS, explicit owner boundaries, idempotency/version collisions, slot
retirement, tenant/test binding, changed/cancelled/deleted reservations,
append-only audit and injected audit failures with full transaction rollback.
The optimistic competing-write test uses a queued single connection; it is
**not** a multi-connection deadlock/advisory-lock test. Those and hosted RPC
validation remain gates before shipping Phase 1.

The dependency is separate from the product package while Round 65 owns package
and lockfile work. To reproduce with a disposable dependency directory:

```sh
npm install --prefix /tmp/entry-db-tests --no-save --package-lock=false @electric-sql/pglite@0.3.14
ENTRY_PGLITE_MODULE=/tmp/entry-db-tests/node_modules/@electric-sql/pglite/dist/index.js npm run test:all
```

The test joins automatic suite discovery and explicitly skips when that optional
test dependency is absent. That skip is not a DB test pass. Current-row validator
tests require no extra dependency and compose real evidence with the policy.
No PGlite dependency or test database is part of the production runtime.
