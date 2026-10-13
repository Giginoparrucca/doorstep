# Round 52 - Automatic Alloggiati receipt retrieval

Owner: GPT-6.1. Requested by Daniele on 13 October 2026.

## Problem and intended behavior

Both manual API Send and live autofile try Ricevuta immediately after Send.
Alloggiati's MANUALEWS (Ricevuta, page 17) allows the last 30 calendar days,
excluding the current day. There is no later retry. Filing succeeds but the
check-in has no receipt. The daily PDF covers the account's filings on that
date; it is not a PDF per guest or per booking.

WelcomeBnB must retrieve the receipt from the next day in Europe/Rome, save
it in the existing private receipts bucket, and link it to corresponding
check-in records. The existing ten-minute Alloggiati tick must also process
receipts for properties whose autofile is off, because host API Send still
needs a receipt. Receipt recovery never invokes Test, Send, claims, alerts,
notifications or guest-data changes.

Official reference: https://alloggiatiweb.poliziadistato.it/PortaleAlloggiati/Download/Manuali/MANUALEWS.pdf

## Phase 0 - Specification and handoff

- Publish this plan and the Round 52 table in CHANGELOG before implementation.
- Preserve Round 51's entire table, pending phases and attribution as paused.
- Gate: scope, exclusions, time window, authenticated operational probe,
  implementation tests, live acceptance and rollback are documented.

## Phase 1 - Implement, verify and release

### Server

- Reuse `/api/alloggiati` and its existing cron; no function or cron added.
- Add a private underscore-prefixed helper for receipt collection. It can
  call only GenerateToken and Ricevuta, never a filing operation.
- Derive eligible records from successful `host` / `autofile` filing logs,
  joined to the same property's non-test, undeleted, currently filed rows
  with a reliable `filed_at` and missing `receipt_path`. Ignore dry runs,
  failures and unproven manual declarations. Never modify the immutable log.
- Use the record's Europe/Rome filing date, not arrival or UTC date. Exclude
  today/future dates and dates older than the documented 30-day window.
- Deduplicate per property/date. Use one deterministic private PDF path and
  conditional receipt-only row updates. Keep existing uploads, statuses,
  timestamps, sensitive data and resubmitted/correction records intact.
- Verify a nonempty PDF before storing; report sanitized failure counts,
  retry subsequent ticks and bound query sizes, requests and elapsed time.
  Failed old jobs must not indefinitely starve other properties/dates.
- A successful new/corrected Send clears the current receipt link so the new
  filing can obtain its matching receipt; the previous stored PDF is retained.
- Stop calling Ricevuta for the current day after Send. Mark filing normally
  and explain that automatic receipt download is pending.
- Provide a `receipt_tick` action behind the same constant-time cron-secret
  authentication, for safe operational backfill/probes without invoking
  autofile. Demo/invalid environments reject it before any outbound call.

### Host and demo

- Existing receipt link uses a short-lived signed URL after attachment.
- Bilingual single-line dictionary strings explain next-day automatic
  download and retry. No new host actions or onboarding steps.
- Preserve manual upload for filings made outside WelcomeBnB and receipts
  outside the portal retrieval window. Do not promise recovery of all
  historical records merely marked filed.
- Keep fictional demo filing/receipt simulation isolated; update the Italian
  guide and PDF for changed presenter behavior. No real receipt in demo.

### Mandatory local gate

Exercise the real collector with a fake transport, covering:

- Rome midnight/DST, today/future exclusion, exact 30-day boundary.
- Host Send and autofile, multiple batches/guests sharing one daily PDF.
- Test/deleted/unfiled/correction/cross-property/unproven records excluded.
- Existing uploads and changed filing timestamps not overwritten.
- Valid PDF download/storage/attachment, repeat run/concurrent safety,
  rejected/empty PDF, portal/storage/update failure and successful retry.
- Query pagination/limits, runtime budget and fair retry ordering.
- Actual dispatcher: unauthorized and demo requests do zero outbound work;
  receipt-only action cannot submit guests; regular tick reuses collector.
- Manual/autofile submission schedules receipt retrieval without same-day
  Ricevuta. Host i18n/inline syntax and existing test isolation regressions.
- Environment, deployment configuration and demo UX regression checks.

### Mandatory operational gate

1. Verify preview and production deployments/source after local tests.
2. Invoke only authenticated `receipt_tick` against production. Retrieve
   recent confirmed submissions, verify private PDF Storage metadata and
   correct record links, and verify filing states/timestamps/logs unchanged.
3. Invoke it again; attached records cause zero additional receipt downloads.
4. Verify the existing cron remains active and no new schedule/function exists.
5. Verify private receipt ownership/anon restrictions remain; preserve demo
   isolation and hosted demo smoke. Record actual evidence and limitations.
6. Mark shipped only after these gates pass; unavailable portal/access is a
   blocker, not a fabricated pass. No repeat Send as a recovery strategy.

## Live-gate amendment - receipt owner policy binding

The live owner-read probe returned zero after successful download. Existing
Round 36 policies resolve unqualified `name` inside the property subquery to
`p.name`, not the storage object's path. Correct owner SELECT/INSERT/DELETE
policies with explicit `objects.name` in production via an additive ALTER
POLICY migration. Demo already has this correction from Round 50; verify it
without changing its baseline or migration fingerprints. Existing service grants and private bucket remain.
Gate: owner sees the two real receipts, non-owner/anon see zero; migration
contains only the three owner-policy corrections; production rebuild applies the new migration; demo rebuild retains its
existing Round 50 receipt-owner-scope correction and fingerprints.
Rollback: restore the previous policy expressions if needed, retaining files.

## Rollback and operations

Revert the implementation commit and redeploy. Existing stored PDFs and links
remain valid; do not delete receipts during rollback. Existing manual upload
continues to work. No schema migration is intended. If a schema change becomes
necessary, amend this plan before implementation and include RLS/GRANT gates.

Credential or portal failures leave a missing receipt for retry within the
documented window. Removed credentials prevent recovery until restored.
Receipt retention and receipt bucket permissions keep their existing rules.
