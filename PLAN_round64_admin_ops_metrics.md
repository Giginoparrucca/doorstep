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

## Release evidence — complete

PR #199 merged as `45f2863fee36412a085fe15ef598fce828fef7f7`. Local and PR CI full regression 64/0/3; all ten browser suites passed. Protected CI live 1/0/4 (production schema-drift passed). Production `dpl_EK1oZUVf1fxPxkGkChrgBEXa19SZ` READY, correct main source and app.welcomebnb.it alias. Admin/helper public assets match tested source exactly and deployed helper passed the fictional 1/1/0 + 1/2 usage case. Local post-release live 2/0/3 with SPOT/tax source and goldens passing. Named skips and limitations are in CHANGELOG. No schema or production data mutations. Phase shipped; final release record is documentation only.

## Phase 2 — Sort and filter Hosts & Properties

Requested directly by Daniele after Phase 1 release. Add ascending/descending sorting on every data column (Actions excluded), with numeric/date sorting and missing values last. Preserve default newest-activity-first order. Add search by property/host/city/id, city filter and operational filters for filing failures, no/low guest usage, incomplete setup, missing metrics and accounts without properties. Compose filters, show visible/total row counts and a clear empty state, provide Reset. Preserve table state across tab switches, refresh and period/test/hidden changes within the page session; do not refetch data while sorting/filtering. Keep support actions and mobile horizontal scrolling. Keyboard-accessible buttons and aria-sort expose sort direction. Reuse existing data only; no database or filing changes.

Gate: synthetic sort/filter regressions plus desktop/mobile actual-renderer interactions, including null vs zero, numeric ordering, combined filters, no-property rows, safe search, reset, refresh persistence and Console action. Full test:all, green PR CI, exact production source verification and read-only test:live before marking shipped.

### Phase 2 release evidence — complete

PR #200, head `1800a424673ada4c1f1e929bb741f5f6d084d706`, merge `92ba95a37e85b573f5630c08781464d6f78845f0`; tested and remote tree `6566fc3122378ec772cbd42a2b71419581e0f362`. Local/CI full regression 65/0/3, all ten browser suites passed; protected CI live 1/0/4 with schema-drift passing. Production `dpl_rH8Qxsck2yYejcLFBZUqXR4NiVBS` READY with correct main source and production alias. Three admin assets byte-identical to tested source, deployed controller synthetic sort/filter checks passed. Post-release live 2/0/3. Named skips and evidence are recorded in CHANGELOG. No schema or production data mutation; phase shipped. Final release record is documentation only.

## Phase 3 — Alloggiati support diagnostics

Daniele explicitly requested an actionable support path after finding the failed count unusable and the owner-only connection hidden in admin view. Extend this Round's Ops support surface with a property-scoped diagnostic dialog and clickable failure count. Show connection configuration/last verification/key expiry, autofile mode, current affected booking/guest records, last attempts and recent immutable filing history. Provide admin-authorized connection testing and server-built per-booking SOAP Test, never Send. Display portal per-row error description and ErroreDettaglio with check-in IDs, local builder warnings, current state, expired app automatic window and instructions to correct guest records via the existing audited Console/Edit path. Credential replacement remains owner-only; secrets never return. Existing owner/send authorization remains unchanged. No blanket resend or automatic data correction.

Auth: live validated bearer plus caller-JWT is_admin RPC; server-side property scope including test/deleted exclusion, no metadata-based authorization. Read minimal diagnostic fields; strict per-booking validation uses bounded authoritative rows and the unchanged shared builder. Mask sensitive strings and never return lines, document values, ciphertext or tokens. Audit support access using existing admin_impersonation_log; no schema. Keep errors/retry and stale-dialog handling honest. Preserve portal per-row detail in parsing and future rejected-autofile logs without changing filing acceptance decisions or golden bytes.

Observed incident (read-only): Antica Torre has five pending guest records last marked test_rejected, portal message SCHEDINA_CAMPO_NON_CORRETTO; historical audit details omit the actual field. A separate successful filing follows. This establishes a recorded validation failure, not the precise bad field or present connection health. No guest records or filing status changed.

Gates: synthetic nonadmin/anonymous/cross-property denial, no-secret/no-Send assertions, malformed/missing portal result handling, check-in exclusion/window warnings, browser dialog/actions at mobile/desktop, existing Alloggiati goldens, full test:all, green CI, production source/auth/read-only smoke. No real Send or real guest mutation in tests. Complete release records.

Phase 3 implementation refinement: new manual Send-path authentication/Test/Send failures are now appended to the existing immutable host-trigger audit with redacted portal detail, without changing success/failure decisions or guest state. The failed counter remains automatic-only; current UI copy points manual failures to support history and preserves the historical coverage caveat.
