# Round 63 — real-property comparison pilot

As of 24 October 2026: Phase 3 preparation, **no native calendar cutover**.
The test-property read passed; production has no configured real-property
connection at this checkpoint. Choose one real property before the pilot.

Read [the plan](../../PLAN_round63_ireservation_native_api.md),
[operations](OPERATIONS.md), [provider questions](PROVIDER_QUESTIONS.md) and
[continuation](CONTINUATION.md). This checklist is preparation, not evidence that
any listed test or switch has occurred.

## Smallest owner action

1. Sign in as the property's owner in the normal host console. Admin view cannot
   configure another owner's native credentials.
2. In Bed-and-Breakfast.it's [channel-manager area](https://www.bed-and-breakfast.it/ar/channel_manager.cfm),
   open Configure for an existing channel. Find the property's calendarId and
   set its distinct propertyUsername/propertyPassword. They are not the login to
   the reserved area. Do not put passwords or private feed URLs in chat, issues,
   source files, email drafts or screenshots shared for this pilot.
3. In WelcomeBnB, select that property, open Settings → iReservation → Connect,
   enter its credentials, Save connection, then Check connection. Test calendar
   330 must not be attached to a real property's calendar.
4. Choose Match rooms and explicitly confirm each supported physical-unit match.
   Identical names are not identity proof. Leave ambiguous categories/multi-unit
   inventory unmapped. Save room mapping.
5. Choose Compare bookings for a bounded date window containing known stays.
   The report is private and comparison-only: iCal still manages bookings.
   Neither a successful connection nor matching counts authorizes cutover.

## Agent/operator comparison review

- Confirm current owner, credential version and mapping version; stale requests
  must fail after rotation, transfer, room deletion, mapping edit or disconnect.
- Read fresh room/distributor catalogs and verify inventory scope. Record only
  supported physical mappings; unresolved multi-unit records quarantine.
- Review API-only, local-only, review/ambiguous, unknown-status/distributor and
  conflicting-version results. Do not adopt an ID from names or stay dates.
- Compare repeated/overlapping windows, stays spanning their boundaries, past/
  future stays and observed cancellations. Provider answers must establish what
  each window actually covers. A partial/empty response never cancels a row.
- Verify unchanged local UUIDs, booking codes, guest-link/check-in references,
  host notes, echo links, reservation/block statuses and unrelated OTA rows.
  Keep fingerprints and any private record references in tenant-restricted
  evidence, never in public docs. No real booking should be created/cancelled
  solely to produce a pilot test case.
- Record the run/source revision, property scope, window, versions, safe counts,
  unresolved discrepancies and private evidence reference. A normal manual
  comparison is not a successful complete import or availability read.

## Cutover requirements — all still gated

Prepare a private manifest identifying exactly which existing feeds/distributors
and rows are replaced, proven native identities and room mappings, preserved
baseline references, unresolved items and rollback writer/provenance. Do not
store raw feed URLs/tokens in the public manifest template.

Before activation, implement and test a single transactional ownership/identity
boundary shared by cron, manual iCal and native adapters. Old workers must reject
stale generations. Suppress both writes and cancellation sweeps for replaced
feed scopes; preserve unrelated feeds. Adoption must retain existing row UUIDs,
booking codes, check-ins, guest links and confirmed echo references. A missing
native row is never a cancellation. Proven D affects its exact identity only;
stale I/U must not resurrect a cancellation.

Acceptance requires synthetic race/duplicate/rollback/cancellation tests, the
full regression and CI, any production migration drift lookup, an actual reviewed
pilot and recorded property-scoped cutover/rollback drill. Provider identity,
coverage, timestamp and inventory gaps are unresolved until authoritative
answers/evidence are recorded. No activation control exists in the released UI;
all current reports retain can_cutover=false.

## Evidence template (private completed copy)

| Item | Value |
|---|---|
| Source revision / environment | Pending |
| Selected real property / owner setup | Pending; owner selects the property |
| Credential / mapping versions (no secret values) | Pending |
| Provider contract answer references | Pending |
| Request windows and proven coverage | Pending |
| Comparison run IDs and safe discrepancy counts | Pending |
| Identity/adoption proofs and scoped feeds | Pending |
| Baseline / after fingerprints and private reference | Pending |
| Single-writer / rollback tests and drill | Pending |
| Decision | Comparison only; activation blocked |

Availability-zero blocks remain Phase 5, dependent on a published provider
contract. Outbound direct I/U/D and two-way sync remain Phase 6 with their own
write gate. This pilot does not enable either feature.
