# Round 63 — iReservation Native API Integration

Plan and developer handover prepared 24 October 2026 at Daniele's explicit
request. **Documentation delivered; integration not implemented or enabled.**
Implementation confirmed by Daniele on 24 October 2026 after the host-impact recap.
Phase 1 is in progress; later phases are gated. No runtime phase is yet shipped.
Preserve the current Round and all earlier phase ownership in CHANGELOG.

## Purpose and boundaries

Use the native API to obtain stable reservation identities, room assignments and
available guest details from iReservation/Bed-and-Breakfast.it. First compare it
with existing iCal imports without changing the host calendar. After verified
reconciliation, allow a property-by-property switch to API reservation reads.
Existing guest links, check-ins, reminders, compliance outputs and unrelated OTA
feeds must continue working. Hosts initially see nothing new; later they get a
connection, explicit room mapping, connection health and a controlled switch.

This delivery changes documentation only. It does not configure secrets, create
infrastructure/migrations, send provider messages, authenticate to the API, alter
production reservations, enable a scheduler or activate writes. Runtime work needs
the normal new-Round recap/confirmation in AGENTS.md. Publishing this requested
plan to main is already authorized.

Availability reads are **not currently available**: Salvatore expected an endpoint
in weeks, without a delivery commitment. Reservation reads cannot reconstruct
owner closures or every unavailable night. Zero-availability import and two-way
sync are separately gated future capabilities, not prerequisites silently assumed
complete by this plan.

## Authoritative handover

- [API contract and source register](docs/ireservation/API_REFERENCE.md): verified
  endpoint paths, every published field, status semantics, contradictions and gaps.
- [Credential and operations guide](docs/ireservation/OPERATIONS.md): tenant
  isolation, proposed variable names, retrieval, rotation, budgets and rollback.
- [Continuation guide](docs/ireservation/CONTINUATION.md): repository entry points,
  next actions, tests, host-guide requirements and outstanding provider questions.
- [Sanitized schema snapshot](docs/ireservation/schema.snapshot.json): all five
  endpoint schema definitions and common errors; examples/defaults removed to avoid
  copying credentials from provider examples. Not a generated SDK or valid bundled
  OpenAPI document; external refs and source security syntax need normalization.

Facts come from the uploaded 11-page API v1.3.0 PDF, 3-page English integration
guide and Salvatore's correspondence, checked against official endpoint schemas
on 24 October. Source hashes and URLs are in the reference. Proposed tables,
settings and policy below are WelcomeBnB design decisions, not provider features.

## Phases and mandatory test gates

Phase 0 is the requested documentation work. Phases 1–6 remain pending. Before
starting a runtime phase, claim it in CHANGELOG and commit using the repository's
phase-prefix convention. Every implementation phase runs **npm run test:all** plus
its specific tests; record pass/fail/skip totals and reasons. Red tests block
publication. After deployments run **npm run test:live**; skips are not passes.
New migrations also require production schema-drift lookup evidence. See AGENTS
and RELEASE; do not label a phase shipped based on deployment status alone.

| Phase | Deliverable | Phase tests and exit criteria |
|---|---|---|
| 0 — Plan and handover | This plan, complete nonsecret schema, operations/continuation, roadmap links | Source/page review, local links, secret/URL scan of all new commits, full regression, verify remote main and published file hashes. No live API claim. |
| 1 — Secure connection and API client | Server-only partner auth/token store; encrypted property connections; global limiter and quota; test-only read probes | Synthetic auth/refresh/expiry/rotation, single-flight refresh across workers, 401/nonzero body/429/500/malformed JSON/timeouts; 2-tenant + anon denial for every operation; ciphertext swap/AAD rejection; masked errors/logs; no secrets in browser/network responses or fixtures. Authorized property 330 read probe only after secure provisioning; record separately from synthetic passes. |
| 2 — Room/distributor mapping and comparison | Persist explicit mappings; shadow reservation reader; discrepancy report | Unknown/missing/duplicate mappings, room vs property type, category vs physical units, multiple rooms/repeated IDs, unknown distributor; I/U/D, nullable fields, ordering/timestamp ambiguity, overlapping windows, partial result, property switch and IT/EN desktop/mobile. Calendar/check-in/booking-code before/after fingerprints must be identical in compare mode. |
| 3 — Controlled API-read cutover | Exactly one reservation writer per property/source scope; adopt existing rows transactionally | Duplicate identities across tenants/distributors, repeated reads, iCal/API races, failed handoff rollback, cancellation safety, no false cancellation on absence; existing booking codes/guest links/check-ins and host-confirmed echo links preserved; room filter and all-date sync-count regressions. Pilot discrepancy review and explicit property cutover record required. |
| 4 — Operational hardening and release | Fair polling, run journal, health UI, repair/replay/disconnect controls, canary rollout and runbook | Global multi-worker rate/quota tests, overlapping cron/manual calls, lost leases/crashes, out-of-order pages, connection rotation during run, stale/partial outage, tenant-safe audit access, rollback drill, full suite + live read-only smoke + deployment source verification. Document actual capacity before expanding cohort. |
| 5 — Availability-read blocks (provider dependent) | Only after published endpoint + confirmed inventory semantics: import authoritative availability=0 as blocks | Provider contract tests, exact room/unit mapping, checkout/timezone bounds, zero→positive reopening, reservation-covered zero inventory, genuine closures, partial pages/outage preserving blocks, no guest links/reminders/tax for blocks, no iCal echo duplication. Blocked until endpoint and semantics exist. |
| 6 — Future outbound direct reservations / two-way sync | Separately enabled direct I/U/D outbox, conflicts and reconciliation | Test property only; active channel-manager validation, direct-only distributor=0 guard, I omits ID, U complete replacement, D existing mapped ID, 30-night limit, repeated room capacity, atomic no-availability rejection, timeout after accepted insert, manual conflict resolution, kill switch and remote-side reconciliation. No blind retry or OTA booking mutation. |

Phases 1–4 constitute the first usable inbound reservation release. Phases 5 and
6 may not be represented as shipped by that release. Add phase subrows if scope
splits; preserve attribution and evidence. Provider-dependent tests blocked by
missing access/contract are named blockers, never simulated as live passes.

## Data architecture and identity (proposed)

Use a dedicated server-side integration boundary. Reuse existing authenticated
property ownership checks and cron verification, but do not put property passwords
in `properties.ical_feeds`, `ota_reservations.raw`, browser config or localStorage.
Avoid blindly extending the iCal cancellation sweep to API rows.

Proposed records (final migration names/types must be reviewed in Phase 1):

- Connection: local property/tenant, provider calendarId, encrypted property auth,
  key version, credential version, mode (`disabled`, `compare`, `api_read`, later
  `two_way`), health state and connection generation/fencing token. Sensitive
  fields server-only; browser gets a masked status projection.
- Room mapping: connection + provider room ID/type → active local property room
  or explicit allocation strategy; tenant/property-consistent foreign keys.
  Provider rooms can be inventory types. Never assume a category is one physical
  room, nor assume iCal `idroomcategory` equals native `/rooms.id`.
- Reservation identity: connection/calendar + idDistributor + idReservation →
  stable local reservation/group; IDs remain strings where specified. Use DB
  unique constraints, not date/name matching, to enforce uniqueness. A new
  connection for the same property/calendar must reconcile existing identities,
  not create a second independent import namespace.
- Per-room allocation child rows: retain one external booking identity across
  multiple room allocations. Existing `ota_reservations.room_id` is singular;
  decide parent/child projection before importing multi-room bookings. Do not
  clone booking codes, guest counts, price or compliance totals per room. Unknown
  unit allocation blocks activation for that booking, not an arbitrary room guess.
- Run journal: scope/window, source mode/generation, start/end, outcome and safe
  counters; short-lived staging for comparison, allowlisted minimal guest fields
  only when required, subject to existing retention and property access controls.
- Outbox (Phase 6): local operation UUID, property/remote identity, action,
  canonical payload hash, expected revision, state, attempt ledger and result ID.
  Immutable intent + transactional enqueue; no secret-bearing payload snapshots.

Use local stay dates with checkout excluded; validate calendar dates without
browser-timezone drift. Preserve provider last-update string; its timezone is
undocumented. Do not reinterpret it as UTC or trust it as a monotonic change
cursor. For same identity + same version/hash, no-op; older or equal-timestamp
conflicting values need reconciliation/quarantine. Keep cancellation tombstones
so delayed I/U cannot resurrect a newer deletion. Provider timezone and version
semantics must be resolved before ordering-dependent activation.

## Comparison, cutover and duplicate prevention

1. Compare reads produce a tenant-private report only: matched, API-only,
   iCal-only, ambiguous, room/date/status differences and unsupported inventory.
   Hash/sanitize the comparison key; no raw feed URLs, credentials or contact
   details in run logs. Count fetched records across all dates separately from
   the currently visible calendar month.
2. Match native identities first. Legacy iCal adoption needs a documented exact
   external identity/provenance match and a unique candidate. Name/date overlap
   may propose a review candidate but never merges automatically. Room labels
   are not identity; a shared source can cover multiple distributors, so scope
   the transition explicitly rather than disabling every feed of that platform.
3. Stage a cutover manifest: affected feeds/rows, proven mappings, unresolved
   items, coverage windows, baseline fingerprints and rollback mode. Preserve
   original row UUID, booking_code, check-in references and host-owned fields.
   Resolve ambiguity before activation. Preserve other OTA source writers.
4. Lock/fence cron, manual sync and both adapters for this connection/scope.
   Change routing + provenance/identity links in one transaction. Any previously
   running iCal/API job must reject a stale generation before committing.
   Suppress the replaced iCal writer **and its cancellation sweep**; compare
   reads may continue. All paths consult the same authoritative mode.
5. Native upserts use durable external identity + uniqueness + transaction, not
   newly generated UIDs each poll. Existing iCal uniqueness
   `(property_id, platform, uid)` alone cannot prevent native duplicates.
   Replayed operations are no-ops except genuine provider-owned changes.
6. API D becomes a soft local cancellation for that exact identity/allocation
   scope. Missing rows never imply cancellation: date windows, outages and
   undocumented pagination can omit active records. Never cancel unrelated
   bookings or delete check-ins/compliance evidence. Unknown statuses quarantine.
7. Keep the Round 45/60 echo model and `covered_by_reservation_id` behavior.
   Native reads of locally written direct bookings correlate via stored provider
   IDs/outbox receipts, not dates. Exclude linked echoes from outbound iCal and
   duplicate reminders; maintain explicit local-vs-provider field ownership.

Provider owns imported status, room allocation, stay dates and available source
fields. Local guest link, compliance/check-in progress and private local notes
remain local. API guest fields do not substitute for verified legal check-in
records. Provider pricing is not a replacement tourist-tax calculation rule.

## Safe writes and availability

Phase 6 is off by default with an independent server-side kill switch. Only
explicitly linked direct reservations (`idDistributor=0`) and active channel
managers qualify. U replaces all provider fields; fetch/reconcile first and send
an intentional complete document. No PATCH assumptions. Detect local/provider
concurrent edits and require a resolved conflict before sending. Do not use a
blank update to manufacture an availability block, fabricate guest bookings or
modify OTA reservations.

The API publishes no idempotency-key guarantee, client reference field, version
precondition or transactional bridge to our database. A local unique outbox ID
only prevents duplicate local jobs. On timeout/unknown remote outcome after I,
mark `outcome_unknown`, stop retries and reconcile on the provider before any
new insert. Similar ambiguous U/D outcomes need a read-back before retry; even
repeated U is not harmless after another actor's edit. Match remote IDs from
confirmed receipts; date/guest equality is insufficient proof of a write. Use
per-booking serialization and a durable lease, not memory locks.

When availability reads eventually exist, `availability=0` means unavailable
inventory in the confirmed scope. It becomes `entry_type='block'`, with no guest
name, booking code, reminder or compliance export. Coalesce adjacent zero dates
only for the same proven inventory scope; checkout remains exclusive. A positive
complete authoritative observation may reopen only blocks owned by this adapter.
Do not double-represent zero availability already explained by imported bookings.
Room-type capacity and provider closure-vs-sold-out semantics need confirmation;
no numeric availability field or endpoint exists in the current schema. Local
blocks and unaffected OTA blocks survive outages, partial reads and rollback.

## Readiness and release evidence

First unblock Phase 1 with securely provisioned partner credentials and test
property access, without pasting any values into an issue or chat. In Phase 2,
resolve query range/completeness, timestamp and multi-room semantics with provider
confirmation or recorded safe contract probes. Native-read activation requires
no unresolved identity/mapping duplicates in the selected pilot scope and an
exercised rollback. Availability and outbound writes retain their own hard gates.

Update CHANGELOG with source revision, tests, skips, CI/deployment evidence,
current owner, unresolved questions and the exact next action at every handoff.
No production capability is implied by a green documentation commit.
