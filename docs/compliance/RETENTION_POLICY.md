# Retention policy

**In force:** 18 November 2026 (Round 76). The binding text is Annex B («Tempi di conservazione dei dati») of the host Data Processing Agreement: `legal/ALLEGATO_A_DPA_v1.md` section 9, byte-identical to `docs/compliance/DPA_TEMPLATE.md`. Hosts accept it with the Terms of Service at sign-in. This page maps each row to the job that enforces it. Research, not legal advice: the lawyer brief is `docs/legal/RETENTION_LAWYER_BRIEF_IT.md`.

Principle (Daniele, 18 Nov 2026): keep each kind of data exactly as long as a law requires or allows, and no longer.

| Data | Kept | Enforced by |
|---|---|---|
| Alloggiati receipt and filing log | 5 years from filing | `retention_purge` (receipts queued as bucket `receipts`, reason `receipt_5y`) |
| Identity data sent to the police (document type, number and issuing place; place and full date of birth) | until the filing is recorded (24 h margin); for properties with regional statistics, end of the month after departure | `minimise_filed_checkins`, hourly job `welcomebnb_police_minimise` |
| Document photos and selfie | until the filing is recorded; at the latest 7 days after arrival | `minimise_filed_checkins`; `purge_old_id_photos` (daily) |
| Statistics fields (sex, birth year, citizenship, residence) | end of the 12th month after the stay | `retention_purge` |
| Tourist-tax record (lead guest name, dates, guests, nights, exemptions and declarations) | 5 years after the end of the tax year | `retention_purge` (the check-in row is deleted) |
| Guest invoice details (only if an invoice was asked for) | 10 years | `retention_purge` |
| Reservations (dates, platform, guest name) | 10 years from check-out | `retention_purge` |
| Reservation e-mail and phone | 12 months from check-out | `retention_purge` (also the iCal description) |
| Guest marketing consents | 24 months from the stay; withdrawals 24 months as proof | `retention_purge` |
| Guest chat | 12 months from the stay; anonymised Q&A pairs without limit | `retention_purge` |
| Door-access audit; host notifications | 12 months | `retention_purge` (the whole entry booking) |
| Host account, terms acceptances, subscription and payments | 10 years from account closure | `retention_purge` (10 years after the last record of an account that no longer exists) |
| Admin action log | 2 years | `admin_audit_purge`, daily job `welcomebnb_admin_audit_purge` |
| Usage analytics | 180 days, then monthly aggregates | `purge_old_data` |
| Trash (soft-deleted rows) and test rows | 30 days | `purge_old_data` |

## How it runs

- `retention_purge` runs inside the daily purge `purge_old_data_cron` (pg_cron `welcomebnb_daily_purge`, 02:00 UTC). It follows the same preview/live switch (`purge_settings.live_after`), and its counts are stored in `data_purge_log.legal`.
- The admin Ops «Run preview» shows the same counts without deleting anything.
- **Guards.** Filed check-ins, the terms-acceptance evidence and the entry-access audit stay locked against every API role. The purge passes only through a transaction-local flag (`welcomebnb.retention_purge`) that it sets for itself.
- **Files.** They are queued in `storage_purge_queue` and deleted by the reminder job's storage pass. A receipt is accepted only with reason `receipt_5y`.
- Migrations: `20261118100000_round76_police_data_minimisation.sql`, `20261118110000_round76_retention_purges.sql`.

## Changing a period

1. Change Annex B (a new terms version: hosts accept it again at sign-in).
2. Change the migration, this page and the ROPA in the same PR.
3. Update the guest privacy notice (`index.html`, section 4, IT/EN). `scripts/round76-retention-docs.test.mjs` checks these documents agree.
