# Round 66 Phase 1d-b — protected saved chat and Q&A

## Guest delivery

A service-only RPC reads the current entry snapshot and the latest saved
messages together. Property, booking and test mode come from the signed token.
The server evaluates the existing entry policy and returns only a small message
allowlist. Raw check-in data, identity tags and content digests stay server-side.
A failed read returns 503 and never falls back to unfiltered chat.

For an opted-in property, a saved message is displayed only when access is
currently allowed and its server-stamped booking identity and access-content
version match. Locked, scheduled, cancelled, expired, ambiguous and unknown
states do not reveal message text. Manual release/restore uses the same policy.
Changes to dedicated codes, access text, visibility flags or rooms invalidate
older text. Historical messages without trustworthy provenance remain withheld,
even after release; do not guess that an old code is still appropriate.

The placeholder is available in Italian and English and points guests to check-in
or the host for help. This is deliberately conservative: ordinary host replies
may also be withheld while access is locked. Current AI assistance and the host's
contact details remain the support paths. Hosts should keep entry secrets in
dedicated fields. Free-text copies in public welcome/rules/recommendations still
require host review.

New messages at never-opted-in properties keep their existing behavior. Turning
the feature off permits new ordinary chat again but does not unquarantine old
protected messages. Test-mode conversations cannot read production chat.
A database trigger stamps provenance for both gateway and direct host inserts;
clients cannot forge the tags. Updates preserve protection and invalidate changed
text or scope. JSON reads and send acknowledgements are private/no-store. Chat
text is removed from the guest browser's diagnostic logs.

The guest history renderer is tested with fresh withheld/released/restored
responses at IT/EN and mobile/desktop sizes. This does not claim automatic
focus/second-tab refresh or recall of previously displayed text; those broader
cache journeys remain in the Round plan. Already delivered codes cannot be
withdrawn from a person's memory or screenshots.

## Reusable Q&A

Properties that ever opt in are permanently excluded from Q&A capture, including
after the setting is turned off. New reusable answers retain internal source
property provenance so later opt-in can quarantine them atomically. Capture and
opt-in use the same transaction lock. A table trigger also catches old in-flight
capture calls or inserts without verified source provenance.

Legacy derived Q&A has no recoverable property reference once its original
chat is purged. Existing derived records are preserved in
`entry_access.chat_qa_quarantine`, removed from the reusable public table, and
made inaccessible to browser/admin/service API roles. This is preservation in a
restricted archive, not deletion of primary chat or check-in records. No
anonymization regex is treated as proof that entry secrets were removed. New
capture at never-opted-in properties retains the existing anonymization and
objection rules. Manual capture remains admin-only; cron/service execution stays
available. Archive review/retention must use the existing authorized operations
process; it is never an automatic export source.

## Verification and release

The SQL/actual guest-handler test uses disposable PGlite with fictional tenants,
bookings, codes and Q&A. It verifies role denials, direct host stamping, history
and poll, release/restore, code and identity changes, read failure, expiry,
legacy/test isolation, quarantine, late unverified inserts, sticky exclusion and
non-admin capture denial. It is not a multi-connection PostgreSQL lock stress
test. The browser suite exercises the actual guest history renderer, with
fictional projected responses and DOM/storage checks.

Production migration installation, advisors, service-only grants and the exact
protected HTTP schema-drift gate must be recorded separately in CHANGELOG. No
property is automatically enabled. Rollback retains the triggers, exclusion and
secure delivery boundary; do not restore an unfiltered history endpoint or move
quarantined Q&A back into reuse. Room lookup and the full cache/admin/pilot gates
remain outside this subphase.

## Completion continuation

The final Round integration restricts protected saved text to currently eligible,
provenance-matched host replies. Historical browser-originated AI/guest text is
withheld even after release: its creation snapshot is not trustworthy. Access
refreshes cancel/fence active replies and clear protected conversation memory.
See `OPERATIONS.md` for host support, current admin auditing and safe pause/rollback.
