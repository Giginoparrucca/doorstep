# Round 74 — Security fixes from the 16 November 2026 audit

**Specification file.** Written 16 November 2026 at Daniele's request («Prepare a round to fix the red and yellow flags»). **Confirmed by Daniele on 16 November 2026** («Go ahead with your recommendations for D1–D3»): D1 = keep recovery with surname + arrival date + last 4 characters of the document number; D2 = door codes until checkout + 2 hours; D3 = enforce the resource policy only after the synthetic flow run passes, inline scripts still allowed. Round number 73 stays reserved for Stripe + e-invoicing (blocked on the SRLS).

Source: weekly audit «WelcomeBnB code quality and security audit — 16 November 2026, installment 1», audited commit `32e176cae34626cc5eba9ed444c4189a4593a7b7`. Findings in scope: **RED** WBNB-R001, R002, R003; **YELLOW** WBNB-Y001, Y002, Y003, Y004.

## Why

The audit found three access-control defects that were reproduced with fictional data (not exploited in production, no evidence of misuse) and four moderate gaps. They all live in the guest side of the product, where the server uses a privileged database key, so a missing check in the server code is not caught by the database rules:

- **R001** — "Ritrova il tuo check-in" (surname + arrival date) accepts wildcard characters and hands back a booking link → someone who knows a property's public link could read another guest's identity data.
- **R002** — a guest link with no booking attached can edit a check-in of another booking in the same property, if the record's internal ID is known.
- **R003** — on properties without the strict entry rule, an old or cancelled booking link can still show the *current* fixed door code.
- **Y001** — anyone can upload files into the private documents folder (not read them).
- **Y002** — guest rate limits reset if the caller changes a field it chooses itself (session ID).
- **Y003** — changing stay dates can report success while the companions keep the old dates.
- **Y004** — the browser security policy that blocks foreign scripts/connections is only in "report" mode.

## What changes for guests and hosts

- **Guests:** the normal check-in link works exactly as today. "Ritrova il tuo check-in" asks for one more detail (decision D1). Door codes are shown only during the stay window (from the current release rule until checkout + grace, decision D2); after checkout or cancellation the guest page no longer shows them. Document photos upload the same way for the guest, through a short-lived permission from our server.
- **Hosts:** nothing visible, except that date changes made by a guest now update the whole party or fail with a clear message.
- **Admin:** nothing visible.

## Does not touch

Alloggiati/SPOT/regional/tax builders and goldens, autofile scheduling, Round 72 billing (except reusing its tests), Round 63 iReservation, host console features, prices or terms. No production data is read beyond metadata/counts; fixes are proven with fictional data.

## Decisions (confirmed 16 Nov 2026: all three recommendations)

- **D1 — Booking recovery.** Production use: 15 lookups ever, 4 in the last 30 days, 3 properties. Recommended: keep it, but require **surname + arrival date + the last 4 characters of the document number** used at check-in, exact match only (no wildcards), and only when exactly one booking matches; otherwise the generic answer «Non troviamo il check-in: chiedi il link al tuo host». Alternative: remove recovery entirely and always say «chiedi il link al tuo host».
- **D2 — Door-code window after checkout.** Recommended: codes visible until **checkout time + 2 hours** on the departure day (property timezone); never after cancellation. Pre-arrival release keeps today's rule.
- **D3 — Browser policy (Y004).** Recommended: promote the report-only resource policy to enforcing **only after** a synthetic run of every guest/host/admin flow passes under enforcement in a browser test; inline scripts stay allowed for now (removing them is a later, gradual refactor, not this Round).

## Constraints

- Every fix ships a **negative test that fails before the fix** (the audit's four reproductions are rebuilt as our own synthetic tests: R001, R002, R003, Y003), plus the full `npm run test:all`.
- Role matrix where relevant: anonymous, unbound guest token, guest A / guest B, host A / host B, admin, service role.
- Fictional data only; no real booking searched, no production upload, no real door code read.
- Migrations: `supabase/migrations/<ts>_round74_*.sql`, re-runnable, PGlite-loadable, applied to production and found by `schema-drift.test.live.mjs` (AGENTS rule 8). Supabase connector approval prompts do not reach Daniele: apply in plain statements, verify read-only.
- Guest check-in must never be blocked by a limiter outage: bounded fallback (Y002).
- Vercel Pro function list unchanged unless a new entry point is unavoidable (then update the exact function-list test).

## Phases

| Phase | Scope | Test gate (plus full `npm run test:all`) |
|---|---|---|
| 0 — Open | Recap confirmed with D1–D3; plan committed; Round table opened | — |
| 1 — R001 booking recovery | `api/guest.js` `checkin_lookup`: literal, normalised comparison in a parameterised SQL function (no `ilike`); reject `*`, `%`, `_`, `\` and control characters; require the D1 proof; return a booking credential only when exactly one booking matches; identical generic response for "not found / ambiguous / wrong proof"; trusted rate limit (Phase 5 identity, interim per-IP + per-property cap); guest app form and texts IT/EN | Fails before fix: wildcard `*`/`%`/`_` surnames, escaped characters, duplicate surnames, two bookings same day, changed session IDs → no credential; valid proof → exactly that booking; `checkin_list` with the recovered token returns only that booking; generic response indistinguishable; browser test of the recovery form IT/EN 390/1440 |
| 2 — R002 + Y003 check-in edits | `checkin_update`: refuse when the verified token has no booking code; one SECURITY DEFINER function applies id + property + booking + test mode + editable state and, for date changes, updates the whole party in **one transaction** (filed/filing/correction rows → refuse with a clear error); response never returns another booking's fields; legacy null-code rows get no access through this path | Fails before fix: property-only token, other booking's token, other property's token, test/real mismatch → no change, no identity in the response; companion failure injected → full rollback and visible error; normal edit updates every eligible member with consistent nights; concurrent filing claim → refuse |
| 3 — R003 entry-code lifetime | `_entry-release-loader.js` / `_entry-release-policy.js`: distinguish reservation-backed bookings from explicit walk-ins; keep cancellation/soft-delete identity (absent active reservation ≠ new standalone stay); eligibility from status, arrival/departure, checkout time, timezone and the D2 grace; session renewal never extends entitlement; same rule for fixed codes, rotating codes, room codes and protected chat | Fails before fix: no active reservation + 2020 check-in → no code; cancellation, soft deletion, checkout + grace boundary (incl. DST), retained check-in, changed fixed code, link renewal, explicit walk-in inside its stay → allowed; all entry projections empty after expiry/revocation; existing entry-release suites unchanged |
| 4 — Y001 document uploads | Server issues a short-lived signed upload URL only after validating the guest token's booking and the submission ID, for a fixed owned path; bucket `documents` size cap and MIME allowlist (images + PDF); file-signature check on the server path; per-booking upload quota; then remove «Allow anonymous uploads» after the new path is verified in production | Disposable storage / mocked storage API: anonymous direct write denied, foreign submission path denied, oversize denied, MIME/signature mismatch denied, expired permission denied, valid booking upload works (photo and PDF), scan/OCR flow unchanged; production policies re-read after rollout (anon INSERT gone) |
| 5 — Y002 limits | Limits keyed on trusted identity (Vercel client IP header) + property + server-issued session, not the client-chosen session ID; atomic counter function (one statement reserves the slot); caps for mint, recovery, check-in writes and gateway analytics; limiter failure → recovery/AI degrade safely, ordinary check-in keeps a bounded fallback; monthly AI usage aggregated in the database | Many session IDs from one identity → still limited; parallel requests at the limit → exactly the limit pass; counter outage → check-in still works within the fallback cap, recovery refused; usage-record failure handled |
| 6 — Y004 browser policy | Synthetic browser run of guest/host/admin flows (IT/EN, mobile/desktop: uploads, signed links, maps, chat, receipts, auth) under the enforcing policy; fix any violation; then switch the resource policy from report-only to enforcing (inline still allowed, D3); keep reporting | All flows pass under enforcement; a controlled disallowed script/connection is blocked; live headers re-checked after deploy |
| 7 — Regression + close | Full regression, `npm run test:live`, re-run the four audit reproductions (must now fail to reproduce), anonymous production probes, CHANGELOG close, audit register note (finding → PR → test) for the next weekly audit | `npm run test:all` green; live smoke; reproductions negative |

## Out of scope (logged for later)

Leaked-password protection, the seven mutable search paths, `pg_net` in `public`, the 20 authenticated SECURITY DEFINER functions (targeted review), branch-protection verification (owner access), removing inline handlers, Postgres minor upgrade. These are in the audit as follow-ups, not RED/YELLOW findings.

## What Daniele needs to do

Answer D1–D3. Optional, for the audit follow-ups: turn on leaked-password protection in Supabase Auth settings, and confirm GitHub branch protection requires the `regression` check. No costs, accounts or legal steps.
