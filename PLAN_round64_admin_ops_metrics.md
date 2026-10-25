# Round 64 — Admin Ops metrics

Confirmed by Daniele on 25 October 2026 after the recap in chat.

## Scope and definitions

Add per-property columns to Ops → Hosts & Properties. Keep existing host support actions.
The selected time range applies to the new metrics, with an explicit captured end time.

- Check-ins completed: individual guest records with submitted_at within the period (companions are individual guests, not duplicate bookings).
- Alloggiati sent: current filed rows whose filed_at is in the period. This is recorded filing state, including host manual confirmations/receipt uploads; it does not independently certify a police receipt.
- Alloggiati failed: currently unfiled guest rows with a recorded autofile failure/last attempt in the period. Exclude dry-run rejections, builder warnings and group-already-filed guards; manual Send failures are not persisted by the existing backend, so zero means no recorded automatic failures, not no possible manual failures. Resolved retries are not counted.
- Guest app usage: distinct eligible bookings arriving in the period through today with at least one guest_ event in the period / all eligible bookings arriving in that period. Include reservations without check-ins and standalone check-in booking codes; exclude cancelled reservations, blocks and covered echoes. Match by property + booking code; repeated sessions/companions never inflate the numerator. No eligible bookings means —. Reservations without a booking code count as unused; untracked activity cannot be inferred.

Fetch minimal columns through existing admin-authenticated Supabase reads; fully page each dataset in stable id order. Respect test/hidden toggles. Data-source failures show unavailable, not fabricated zero. Analytics retention limits historical observations; say recorded usage and explain the period/cohort.

## Phase 1

Implement helper/query loader and table, executable synthetic regressions (deduplication, tenant isolation, cohort/period boundaries, cancellation/blocks, filed/error semantics, pagination and read failure), browser desktop/mobile table and support actions. Run test:all, publish PR, require green CI, merge, verify served assets and test:live. No schema, filing behavior, host or guest UI changes. No owner configuration required. Record real blockers and skips. Roll back via previous deployment/source.
