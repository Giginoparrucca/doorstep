# iReservation credentials, operations and rollback

**Phase 1 secure provisioning and test-property reads verified; Phase 2 manual comparison shipped in PR #197.** Start with the
[Round 63 plan](../../PLAN_round63_ireservation_native_api.md) and
[API contract](API_REFERENCE.md). No secret values are stored in this handover.

## Secret inventory and retrieval

Partner credentials were supplied privately by Salvatore. An authorized operator
retrieves them from the restricted original correspondence or the team's approved
password manager/secret store. Do not claim a password-manager entry already
exists: one has not been provisioned or verified by this documentation task. If
access is unavailable, Daniele can grant access to that restricted record or have
the provider reissue credentials. Provider contact: info@ireservation.it; preparing
questions is allowed, but sending messages needs explicit authorization.

The partner username, partner password, API key, access token, refresh token and
test property password are all secrets. Never publish even the partner username.
Neither the test password nor credentials printed in the PDF examples belong in
public fixtures. Private inbound iCal URLs and outbound export tokens are bearer
secrets too. No copies in CHANGELOG, issues, chat, screenshots, command history,
traces or scripts. Do not put partner auth in a public `curl` example.

For each real property, the authorized host opens the provider's
[channel-manager settings](https://www.bed-and-breakfast.it/ar/channel_manager.cfm),
selects **Configura**, obtains calendarId and configures propertyUsername and
propertyPassword distinct from their reserved-area login. Submit through a
server-authorized secure connection form when implemented; do not save in generic
property JSON. The app should accept a new password without returning the old
one. Blank masked input means keep existing secret, not clear it. Disconnect or
clear is a separate deliberate action. Test identifiers are calendar 330 / user
testtesttest; retrieve the test password privately. Test writes may affect shared
provider test inventory: use a bounded isolated test window and track cleanup.

## Proposed environment variables

These names are consumed by the Phase 1 backend unless marked future/test.
Production provisioning was explicitly approved and completed on 24 October;
verify current metadata without decrypting values before any future changes.
Server runtime only, with separate Production/Preview/Test values. Never use
`VITE_`, `NEXT_PUBLIC_`, browser config or build-time string substitution for
secrets. Avoid per-host env vars: tenant credentials belong in encrypted rows.

| Name | Value category and purpose |
|---|---|
| `IRESERVATION_BASE_URL` | Nonsecret fixed allowlisted origin `https://api.ireservation.it`; do not accept host overrides from tenant input |
| `IRESERVATION_PARTNER_USERNAME` | Secret partner account username |
| `IRESERVATION_PARTNER_PASSWORD` | Secret partner initial-auth password |
| `IRESERVATION_API_KEY` | Secret partner header key |
| `IRESERVATION_ENC_KEY` | Secret dedicated base64 32-byte AES-256 key for v1; never reuse Alloggiati's key |
| `IRESERVATION_BUILD_PROBE` | Nonsecret, temporary opt-in for the protected production build; leave `false` after verifying the test property |
| `IRESERVATION_LIVE_PROBE` | Explicit standalone test-runner opt-in; never globally enables runtime sync |
| `IRESERVATION_ENC_KEY_ID` | Nonsecret active key version, initially `v1` |
| `IRESERVATION_ENC_KEY_V2` | Future secret rotation key; keep v1 until every dependent row/token backup is migrated |
| `IRESERVATION_ENABLED` | Nonsecret global gate, initially `false`; server-enforced |
| `IRESERVATION_WRITES_ENABLED` | Future independent write gate, initially `false`; no write method is implemented in Phase 1 |
| `IRESERVATION_DAILY_BUDGET` | Nonsecret local ceiling, initially 4500, always below/equal provider 5000; reserve 500 for recovery/manual operations |
| `IRESERVATION_RATE_PER_SECOND` | Nonsecret ceiling, at most 5 globally |
| `IRESERVATION_BURST` | Nonsecret ceiling, at most 10 globally |
| `IRESERVATION_POLL_INTERVAL_MINUTES` | Future nonsecret scheduling input; compute from cohort/window cost before activation, not a delivery guarantee |
| `IRESERVATION_TEST_CALENDAR_ID` | Test-runner-only nonsecret 330 |
| `IRESERVATION_TEST_PROPERTY_USERNAME` | Test-runner-only nonsecret testtesttest |
| `IRESERVATION_TEST_PROPERTY_PASSWORD` | Secret in test secret store only; never a public fixture or normal production global default |

Access/refresh tokens belong in a durable, encrypted server-only token record,
not plaintext env dumps. Reuse existing server database/cron configuration under
its current names after auditing access; do not duplicate service-role keys. The
implementation must add an audited config validator that fails closed for missing
keys and invalid origin/budget/gates before any API call.

## Multi-tenant storage and authorization

Use versioned AES-256-GCM with a fresh random 96-bit nonce per encryption and
additional authenticated data binding environment + tenant/property + provider +
calendar + credential kind/version. Swapping ciphertext between tenants must
fail. Store ciphertext, nonce, key ID and credential version together, with no
plaintext fallback. Validate key length, restrict decrypt access, and keep a
recoverable secure key backup. Runtime services alone can decrypt. A database
read must not grant possession of the decryption key.

Keep propertyUsername and propertyPassword in the encrypted property record,
partner tokens separately keyed by partner/environment, and connection metadata
in a safe status projection. Prefer a private schema unavailable to browser Data
API clients. If tables are exposed, revoke anon/authenticated access to secret
rows, enable RLS and restrict service-only access explicitly. Metadata policies
must enforce actual property ownership and both USING/WITH CHECK for writes;
UPDATE also needs the appropriate SELECT access. Service role bypasses RLS, so
all service-backed routes need their own verified tenant ownership checks.
Never trust a caller-supplied property ID or user-editable JWT metadata alone.
Definer functions need fixed search_path and explicit EXECUTE grants/revokes.

Follow [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
and existing `api/alloggiati.js` / `api/_alloggiati-crypto.js` for local patterns,
but review rather than copying their crypto unchanged (Round 63 requires AAD).
New schema needs migrations, explicit grants/RLS tests and production drift
verification. Phase 1 now creates private state through its tracked migration; see the continuation checkpoint.
The original Phase 0 handover itself created no tables.

Safe form/API response: connected flag, calendarId, masked username if needed,
mode, credential version, last verified/success time and actionable safe error.
Never return ciphertext as a substitute for access control, tokens or passwords.
Credential save requires authenticated ownership/admin edit authority; mere admin
view mode does not authorize editing. Disable body/header logging on secret
routes, redact tracing and scrub upstream exception messages. No secret URL
query parameters, request-body snapshots, raw provider response logs or key hashes
as public identifiers. Guest PII is private application data, not debug telemetry.

## Rotation, revocation and recovery

1. Pause affected scheduling/writes and fence in-flight jobs. Record only safe
   credential version/time/operator metadata. Keep other tenants' jobs isolated.
2. Partner credentials/API key: authorized operator requests rotation/revocation
   from provider and injects replacement via secret manager/deployment settings,
   without terminal echo. Confirm provider's overlap/revocation policy first.
   Invalidate cached tokens as appropriate, securely reauthenticate and verify
   test read access before resuming cohorts. Do not assume password rotation
   automatically revokes every refresh token.
3. Property credential: host changes it in provider channel configuration, then
   submits new values to our secure connection form. Atomically encrypt/save and
   increment credential version; stale workers cannot overwrite current health
   or data. Verify rooms/read access with the new version. Never silently restore
   a revoked value after failure; keep connection paused with safe guidance.
4. Encryption key: introduce v2, read by stored key ID, write new ciphertext using
   v2 + new nonce/AAD, reencrypt existing credentials and token rows in bounded
   verified batches, exercise restore, then retire v1 after required backup
   retention. Losing the key requires re-onboarding credentials; do not erase
   v1 before recovery is proven. Key compromise also requires provider credential
   rotation, not only re-encryption.
5. Refresh single-flight across all workers, not an in-memory promise alone.
   Refresh before returned expiry with bounded clock skew; allow one coordinated
   refresh/retry for read 401. Persist tokens atomically with a versioned CAS.
   Invalid refresh token pauses auth and uses a controlled reauth flow. Never
   loop auth failures across every property's poll.
6. Disconnect: invalidate generation, revoke provider access where supported,
   stop jobs, dispose encrypted credentials/tokens according to retention, and
   retain minimal nonsecret identity/audit history needed to avoid duplicate
   reimports. Do not delete guest check-ins or silently switch writers.

## Polling, budgets and observability

All partner-key traffic shares one durable rate limiter/token bucket (5/sec,
capacity at most 10), request accounting and fair queue across tenants/workers.
Use per-connection leases plus fencing; one manual click and cron cannot race.
Count attempts/auth/refresh/retries conservatively against the daily ceiling.
Until reset timezone is confirmed, enforce a conservative rolling 24-hour cap
rather than resetting at local midnight and accidentally exceeding provider day
limits. Reserve recovery budget and stop/defer before hard exhaustion; never
busy-loop a provider 429. Honor Retry-After if supplied; otherwise bounded
exponential backoff with jitter and a circuit breaker. Repeated 429 of unknown
cause pauses the partner queue pending budget/reset verification. Writes with
ambiguous outcome are reconciled, not automatically retried by the HTTP client.

Capacity example, not a configured schedule: 20 properties × 24 hourly polls ×
4 reservation windows = 1920 requests/day, plus catalog refresh, auth, retries and
manual probes. 100 properties on that same schedule would need 9600 and cannot
fit. Cache distributor metadata and rooms until refresh is required; spread jobs
with jitter. Choose explicit bounded look-back/look-ahead windows and occasional
reconciliation windows after provider range semantics are known. Date filtering
is not an updated-since guarantee. Persist a successful-window checkpoint only
when the response is fully validated; partial failures never advance success or
cancel missing records. No webhook or delta cursor is currently documented.

Persist safe run records: opaque run/connection/property IDs, mode/generation,
window, timings, request counts, status class, fetched/matched/created/updated/
cancelled/quarantined/ambiguous counters, retries, budget estimate and last
complete success. Keep last attempt and last success distinct. Health states:
disabled, unconfigured, verifying, healthy, stale, auth_error, quota_paused,
mapping_required, partial, conflict, outcome_unknown. Compare completion does
not mean the calendar was updated. UI must distinguish all-date result counts
from the selected calendar month and expose stale/partial coverage.

Alert on sustained failures/staleness, quota pressure, unknown write outcomes,
new unmapped rooms, duplicates and conflicts. Keep thresholds tied to expected
poll interval and actual cohort size; configure escalation recipients privately.
No messages/notification destination is configured by this plan. Host-visible
status and audit access remain property-scoped. Apply retention/cleanup to
staging and run journals; persist minimal counters, not raw PII indefinitely.

## Rollback drill and kill switches

- First disable writes, then pause/fence API jobs for the affected property or
  globally. Retain confirmed receipts and `outcome_unknown` operations for review.
  No destructive database downgrade or blanket deletion of imports.
- Restore the cutover manifest's iCal writer/provenance under the same scope lock,
  after comparing a fresh complete feed with preserved identities. Resume exactly
  one writer; suppress cancellation for the transition until scope coverage is
  verified. Rollback must not recreate duplicate rows or replace booking codes.
- Preserve existing reservation UUIDs, check-ins, compliance evidence and local
  blocks. Do not automatically delete remote direct bookings: remote writes are
  external effects and need explicit reconciled compensating operations.
- Reconcile provider state with the outbox before resuming two-way mode. Any
  uncertain insert remains paused; guessing by dates/guest name is insufficient.
- Verify calendar room filters, existing guest links, reminders, echo suppression
  and unchanged unrelated OTA feeds. Record rollback run IDs/counters and test
  evidence. API availability blocks may be retained as stale until an authoritative
  source resolves them; never silently reopen nights based on a failed read.
- Deployment rollback follows [RELEASE.md](../../RELEASE.md), but source rollback
  alone does not reverse database state, routing modes, secrets or remote writes.


### Phase 1 operating notes

The read client retries a data request only once after a coordinated token refresh
for 401. Other failures return safe classifications; there are no automatic 500
or transport retries yet. Invalid partner authentication latches auth_blocked for
that credential version. An operator investigates before resuming; credential
rotation changes the private auth scope while the stable partner quota scope
continues accounting, so key rotation cannot reset the daily budget. Invalid
property credentials can also produce a data-read 401; one token refresh is
attempted, then the property remains unverified. No raw upstream messages surface.

The independent request budget uses a rolling 24-hour ledger and a token bucket,
serialized in the database across workers. Unknown provider 429 reset causes a
conservative 24-hour shared pause. Global auth failures pause auth attempts; a
60-second lease with a unique holder and CAS prevents stale worker commits.
Server-only state access is through `public.ireservation_state`; browser roles
cannot execute it or access its private tables. The Phase 1 checkpoint had no
form; Phase 2 now supplies owner-only manual comparison controls. No live source
switch has shipped.


Provisioning evidence (24 October): partner username/password/API key, dedicated
key and test password stored as Production-only sensitive variables following
explicit user approval. No preview/development values were created. A recovery
copy of the generated key is in this machine's ignored `.env.local`, mode 0600;
partner/test passwords are not stored locally. Preserve recovery before key
rotation or a machine move. During Phase 1 the runtime and write gates stayed false. Phase 2 enables only
manual comparison; writes remain false.


## Phase 2 manual comparison operations

Owner path: Settings → iReservation → Connect → Save connection → Check connection
→ Match rooms → Save room mapping → Compare bookings. Admin view cannot configure
credentials. Use the real property's channel-manager calendar/username/password;
test calendar 330 is for isolated provider probes, never a real property's setup.
Passwords are write-only; edit requires the username again. Blank password keeps
the saved password only for the same calendar. Saving rotates the connection
version, clears verification and invalidates mappings/reports until reviewed.
Disconnect deletes the stored connection ciphertext and fences stale work.

`IRESERVATION_ENABLED=true` enables owner-triggered **manual comparison only** in
this release. There is no native import scheduler or reservation writer in the
client. `IRESERVATION_WRITES_ENABLED=false` remains explicit; future code must
honor a separate write gate. Set ENABLED=false and redeploy to disable all native
controls; existing iCal and local bookings continue. Preview/demo stay rejected.

Reports strip provider guest names, email, phone, nationality, prices and raw
payloads. Only IDs, distributor, status, dates, mapped room IDs, minimal reasons,
counts and generation time are retained. Private reports retain the latest 20
per property. They always say coverage=unverified and can_cutover=false. Dates
are a bounded request (maximum 31-day span), not proof of provider completeness.
The local comparison uses stay overlap and at most 1000 records; truncation is
explicit. Names/dates are hints, never sufficient identity proof. Editable OTA
raw JSON is not accepted as a verified native binding. No missing-row deletion.

Gateway: existing POST /api/ical-sync?integration=ireservation, actions catalog,
save_mapping and compare, with property_id, connection version, and mapping_version
for writes/comparisons. Compare adds fromDate/toDate. Request max16KB, provider
response max2MB, max5000 fetched reservations; larger/invalid results fail closed.
Every remote request uses the shared limiter/quota. Manual comparisons fetch
rooms, reservations and distributors; avoid repeated clicks during quota pauses.
Only narrow service-only RPCs access private mapping/report tables. CAS and final
ownership/room-validity checks reject edits, deletion, transfer or disconnect races.

The protected build probe now also reads a seven-day window from test calendar
330, prints counts only and saves no connection/reservation/report. Explicitly set
BUILD_PROBE=true only for an authorized verification build, then false immediately.
A passing count does not resolve missing pagination/date/ordering documentation.
