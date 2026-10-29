# Round 66 Phase 1d-c — guest room delivery

The guest property's `checked_in`, entry-release status, fixed code, dedicated
access text and room door code now come from one loaded policy snapshot. The old
independent `resolveGuestRoom` first-assignment lookup is removed.

For opted-in properties, the existing versioned service-only RPC reconciles all
live check-in assignments with the reservation assignment. The property handler
uses that exact resolved room and door code. A later property-scoped lookup adds
only name/beds; it cannot select another room or supply a newer code. Missing,
foreign, deleted, duplicate or failed metadata reads omit the room. A changed
assignment is evaluated on the next request; this does not recall a code already
viewed, or rotate a physical lock.

For OFF properties, the shared loader reconciles all returned check-in room IDs
and the active reservation ID. A single agreed room preserves its label before
check-in and its code after the legacy check-in gate. Conflicting assignments
omit the room, rather than prioritizing an arbitrary check-in. Fixed/property
entry eligibility otherwise keeps the OFF rule. A failed required read withholds
entry fields. A possibly truncated check-in result (1000 or more rows) fails
closed rather than proving uniqueness from a prefix.

`property` responses are private/no-store and vary on Authorization/Origin.
Public property information keeps the existing allowlist. Fixed-code visibility
is read from the evaluated property snapshot, including if it changed after the
first public-property read. Wi-Fi retains its existing entry-gated behavior;
its policy/copy reconciliation remains a broader Round acceptance item.

## Evidence

- `guest-room.test.mjs` invokes the actual signed-token gateway, loader and policy
  over fictional transport. It covers ON/OFF unique/conflicting/missing/deleted/
  foreign rooms, read/parse/transport failures, bounded-result safety, restored
  locking, token/test scope and metadata changing after the snapshot.
- `entry-atomic-submissions.test.mjs` executes the actual existing SQL migrations
  in disposable PostgreSQL, then feeds the actual RPC through the loader and
  property projector. Room checks cover agreed and conflicting assignments,
  reassignment/code change between snapshot and metadata, deleted/foreign rooms.
- Existing fixed-code and cover projection tests use the new shared wrapper;
  full regression still includes the seventeen guest/host browser suites.

No migration, property activation, physical code change or real guest/provider
write belongs to this delivery. This is a server-side room-delivery subphase;
the dedicated-entry focus/resume/scheduled-time/second-tab/cache continuation
is documented in `REFRESH.md`. Host opt-in/admin audit, full conversation
integration, pilot and rollback remain open. Rollback must preserve the shared
server boundary for opted-in properties; do not restore first-room disclosure.
