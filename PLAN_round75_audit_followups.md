# Round 75 — Audit follow-ups: function hardening

**Specification file.** Written and **confirmed by Daniele on 16 November 2026** («go ahead») after the plain-language recap. Source: lower-priority items of the 16 Nov 2026 audit and the Supabase security advisor (`get_advisors security`, 16 Nov).

## Why
Good-practice hardening flagged by the audit and the advisor; none is a known exploitable hole. Nothing visible changes for hosts or guests.

## Does not touch
Check-in, Alloggiati/SPOT/regional/tax outputs, billing, entry codes, anything fixed in Round 74.

## Left out on purpose
- Inline-handler removal (hundreds of `onclick` across the three pages): its own Round later (Round 65 Phase 5c).
- Postgres minor upgrade: owner action in Supabase → Project Settings → Infrastructure (a few minutes of downtime); the agent re-runs live checks afterwards.

## Phases

| Phase | Scope | Test gate (plus full `npm run test:all`) |
|---|---|---|
| 1 — search_path | `SET search_path` on the 7 functions the advisor flags (`anonymize_text`, `compute_season`, `_ota_reservations_touch_updated_at`, `_pilot_hosts_touch_updated_at`, `_tax_rulesets_touch_updated_at`, `tg_touch_updated_at`, `checkins_prevent_filed_edit`); bodies unchanged | PGlite: each function still behaves the same; production: advisor `function_search_path_mutable` gone |
| 2 — SECURITY DEFINER review | For each of the 20 functions `authenticated` can execute: does it check the caller, does any client page call it (code search)? Revoke `authenticated` where no page needs it (server/admin only); keep the ones pages use, each proven to act only on the caller's own data | Per function: grant probe as anon/host A/host B/admin; code search recorded in CHANGELOG; browser suites still green |
| 3 — pg_net | Check whether moving `pg_net` out of `public` is safe for the scheduled jobs; move only if safe, otherwise record why it stays | cron jobs still listed and calling `net.*`; advisor result recorded |
| 4 — Regression + close | Full regression, live smoke, advisor re-run, CHANGELOG close | `npm run test:all` green; live smoke; advisor warnings reduced as recorded |

## What Daniele needs to do
Approve Supabase prompts if they appear. Optional: the Postgres upgrade above.
