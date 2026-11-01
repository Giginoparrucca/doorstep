# Host Terms of Service — how they work and how to publish a new version

Round 69 (`PLAN_round69_host_terms.md`). Hosts accept the Terms of Service (Condizioni Generali) and Annex A (the DPA) in the host console, with a separate approval of the art. 16 clauses (arts. 1341-1342 c.c.), confirmed by a one-time code sent to their account email.

## Where things are

| What | Where |
|---|---|
| Served texts (the exact bytes hosts read and accept) | `legal/CONDIZIONI_GENERALI_vN.md`, `legal/ALLEGATO_A_DPA_vN.md` (the `legal/` folder is deployed; `docs/` is not) |
| Annex A source | `docs/compliance/DPA_TEMPLATE.md` — `legal/ALLEGATO_A_DPA_v1.md` must stay a byte-identical copy (test `round69-host-terms-db`) |
| Versions | table `legal_documents` (one row per version: file paths, SHA-256 of both texts, art. 16 clause list, `requires_reacceptance`, `published_at`) |
| Evidence | table `host_terms_acceptances` — append-only; nothing can change or delete a row, except recording the receipt email id once |
| One-time codes | table `host_terms_codes` (keyed hash only; purged daily after 1 day) |
| Server | `api/_host-terms.js`, reached at `/api/host-terms` (rewrite onto `/api/guest`) |
| Console window | `host-console.html`, Round 69 block (`ensureHostTerms`) called from `init()` |
| Admin | Admin → Hosts & Properties → column "Terms" (version · date, or "Non accettate") and "Scarica prova" (JSON for a dispute file) |

## Environment variables (Vercel, Production + Preview)

- `HOST_TERMS_PEPPER` — random secret (`openssl rand -hex 32`), marked Sensitive. Keys the code hashes. Without it no code can be issued. Do not change it while codes are pending (changing it only invalidates codes not yet used; recorded acceptances are unaffected).
- `HOST_TERMS_ENFORCE` — `true` turns the requirement on. Unset or anything else = off: the server reports every host as accepted and no window appears. Background work (Alloggiati autofile, reminders, calendar sync, guest check-ins) never depends on it.

## Turning the requirement on (first time)

1. The SRLS exists. Fill the bracketed fields in `legal/CONDIZIONI_GENERALI_v1.md` (ragione sociale, sede, P. IVA/C.F., REA, PEC, foro, data di entrata in vigore, Annex A version) and remove the "BOZZA" banner, with the lawyer's approved wording.
2. Update the v1 row: the migration `supabase/migrations/20261101090000_round69_host_terms.sql` seeds v1 with the file hashes and the art. 16 list. Regenerate those values from the final file (the test `round69-host-terms-db` fails until the seed matches the file), commit, and re-apply the migration to production. Re-running it updates v1 only while no host has accepted it; once someone accepts a version it is frozen by a trigger.
3. Merge; check the protected run's `schema-drift.test.live.mjs` passes.
4. Set `HOST_TERMS_ENFORCE=true` in Vercel (Production) and redeploy. Every host is asked at their next console load.
5. Consider a one-off email asking hosts to log in: hosts who never log in never accept (their filings keep running).

## Publishing a new version (v2, v3, …)

1. Add new files `legal/CONDIZIONI_GENERALI_v2.md` (and, if Annex A changed, `legal/ALLEGATO_A_DPA_v2.md`). Never edit a version that has been accepted.
2. Decide `requires_reacceptance`:
   - `true` when the change touches an art. 16 clause (terms art. 14.2), prices or paid plans (art. 4), or anything material: every host is asked again at the next load.
   - `false` for corrections that do not need a new acceptance: hosts who accepted an earlier version are not asked again.
3. Add a new migration inserting the `legal_documents` row (kind `host_terms`, version, file paths, SHA-256 of the exact committed bytes, art. 16 clause list as `[{"ref":"…","label":"…"}]`, `requires_reacceptance`, `published_at`). A future `published_at` schedules it: the server ignores it until then. Extend the DB test so the seed matches the new files.
4. Apply to production, merge, check schema-drift. Terms art. 14.1: announce changes by email and in the service at least 30 days before they apply.

## Evidence for a dispute

Admin → Hosts & Properties → "Scarica prova" downloads every acceptance row of that host (version, text and annex SHA-256, times of general acceptance, specific approval and code verification, host kind, method `password_login+email_otp`, account email, IP, user agent, receipt email id) plus the version rows they refer to. Together with the committed text at that version (git history) and the receipt email, this shows what was accepted, when and how. Retention: life of the account plus 10 years (ROPA activity 12).
