# Launch runbook — SRLS day (Round 72)

What this is: the order of steps that turns on the economic terms and the trial clock **together**, on the day WelcomeBnB starts being sold by Daniele's SRLS. Until then nothing is visible to hosts: `billing_settings.launch_at` is empty, every host is "prelaunch", and no banner, window, reminder or block exists.

Specification: `PLAN_round72_trial_billing.md` (Phase 6). Terms publication: `docs/legal/README.md`.

**Status until the SRLS exists: blocked — owner action.** The code is in production; only the steps below wait.

## Rule in one line

Existing hosts: free until the date Daniele sets for each of them on the launch screen (default launch + 30 days, never earlier than launch + 7 days). New hosts after launch: 30 days from accepting the invite. The terms never promise "30 days from signing" (Art. 4.1).

## Steps

| # | Who | What | Done when |
|---|---|---|---|
| 1 | Daniele | SRLS incorporated. Gives the company fields (ragione sociale, sede, P. IVA/C.F., REA, PEC, foro competente, data di entrata in vigore), the lawyer's final text of the Condizioni Generali, and the company IBAN + account holder. | All fields received in writing. |
| 2 | Agent | Commits the final text as `legal/CONDIZIONI_GENERALI_v1.md` (BOZZA banner removed) — **only while v1 has 0 acceptances**, otherwise as `_v2` with `requires_reacceptance = true`. Regenerates the seed (text SHA-256 + Art. 16 list) in `supabase/migrations/20261101090000_round69_host_terms.sql`, runs `npm run test:all`, re-applies the seed to production (0 acceptances verified first), merges, checks the deploy serves the same bytes. | `round69-host-terms-db` and `round72-terms` green; production `legal_documents.text_sha256` = file hash. |
| 3 | Agent (or Daniele if the Vercel connector cannot write env vars) | Sets `HOST_TERMS_ENFORCE=true` in Vercel (Production) and redeploys. | `/api/host-terms` status returns `enforce: true` for a test host. |
| 4 | Daniele | Admin → Analytics overview → «Abbonamenti · impostazioni»: saves price (60 €), IBAN and holder. Then **Prepara lancio**: checks each existing host's free-until date (default launch + 30; change one by one or «Applica a tutti»; dates before launch + 7 are refused), ticks «Gratis a vita» with a reason for his own test accounts and any partner, presses **Anteprima** (nothing written), then **Lancia**. | Admin shows «Lancio: <data>»; each host card has a chip (Prova · N gg / Gratis a vita). |
| 5 | Agent | Sends the one-off launch email with each host's own date: «Nuove condizioni WelcomeBnB: accedi per firmarle. Puoi continuare a usare WelcomeBnB gratis fino al <data>; poi costa 60 € l'anno, IVA inclusa.» (free-for-life hosts: «Per te WelcomeBnB resta gratuito.»). Admin button «Invia email di lancio»: preview first (lists recipients), then send. Each host at most once (`reminders_sent.launch`). | Every host row shows the launch email in its last events. |
| 6 | Agent | Verifies with a test host: login → terms window → code by email → console → no trial banner until 7 days left; Settings → Abbonamento shows the date and bank details. Records the result in the CHANGELOG. | Test host walked through end to end. |

## When the company is incorporated (Daniele, 18 Nov 2026)

1. **Make the GitHub repository private.** Subscribe to GitHub Pro (~$4/month), then Settings → General → Danger Zone → Change visibility → Private. The agent then checks branch protection, trims CI minutes and switches its check polling to authenticated calls.
2. **Move the contract to the company.** Update the provider identity in `legal_provider` (company name, registered office, VAT/REA, PEC) and e-mail every host about the transfer under art. 1.4 of the terms (art. 1407 c.c.). No new signature is needed; hosts may withdraw at no cost within 30 days.

## What happens after launch, automatically

- Reminder emails 7, 3 and 1 days before each host's date, on the day after it ends, and when the 7-day grace period ends (09:00 Rome, from the hourly reminders job; once per date).
- After the date: a window at every login («La prova è terminata») with bank-transfer details, «Continua» for 7 more days; then read-only (exports, data download, Alloggiati filing for guests already invited and chat keep working).
- Admin can at any time: extend a trial, switch anybody to paid (≥ 7 days' notice, or earlier if the host asked), make a host free for life, mark a bank transfer as paid.

## Safety

- Pressing **Lancia** twice creates nothing new and moves no date; hosts who already have a row are untouched.
- Admin accounts never get a row and never see a paywall.
- The launch writes everything in one database transaction: either every host gets the chosen date, or nothing changes.
- Rollback before any host has paid: in the SQL editor set `billing_settings.launch_at = null` — every host is "prelaunch" again (rows and events stay as history).

## Rehearsal

`scripts/round72-launch.test.mjs` rehearses steps 4–5 on PGlite with the real migrations: dry run writes nothing, each host gets exactly its date, a date before launch + 7 refuses the whole launch, a second Lancia changes nothing, free-for-life hosts and admins are handled, each launch email carries that host's own date and is sent once.
