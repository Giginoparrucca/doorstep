# Round 76 — Data retention by law (privacy)

Requested by Daniele, 18 Nov 2026: «abide by the law and keep data as long as possible and as much as possible» → keep each kind of data exactly as long as a law requires or allows, and no longer; then «make sure the data retention policy is in the signed agreement with a host».

## Why

- **DM Interno 7 Jan 2013, as amended by DM 16 Sep 2021, art. 4-bis c.2.** The structure deletes the digital data it transmitted to Alloggiati and destroys any paper copy *as soon as the receipt is generated*, and keeps the **receipt for 5 years**. The Ministry keeps the data for 5 years on its own systems.
- **Garante, note and press release of 29 Apr 2026.** No copies of identity documents (scans or phone photos) are kept after transmission.
- **Today WelcomeBnB keeps transmitted check-ins in full, with no time limit.** That is 279 rows, the oldest from Apr 2026. Thirteen still have document photos, which are deleted only 7 days after arrival. The 14 Nov hotfix that blocks deleting filed check-ins assumed a retention duty the decree does not impose: the duty is to keep the **receipt**, not the data.
- **No host has accepted the terms yet** (0 acceptances, version 1). The retention rules can go into Annex A (the DPA) now, without anyone having to sign again.

## Retention schedule (the policy)

| Data | Kept | Then | Legal basis |
|---|---|---|---|
| Alloggiati receipt (PDF) and filing log | 5 years from transmission | deleted | DM 2013/2021 art. 4-bis |
| Identity data sent to the police: document type, number and issuing place; place of birth; full date of birth | until the receipt exists, or until the host marks the guest as sent | erased automatically | DM 2013/2021 art. 4-bis; Garante 29 Apr 2026 |
| Document photos and selfie | until the receipt exists, or until the host marks the guest as sent | deleted | Garante 29 Apr 2026 |
| Fields the regional statistics need (sex, birth year, citizenship, residence) | until the end of the 12th month after the stay (regional/ISTAT corrections) | erased; aggregate counts kept | Regional statistics obligations; GDPR art. 5(1)(e) |
| Stay record for the tourist tax: lead guest's name, dates, number of guests and nights, exemption category and the exemption declaration | 5 years after the end of the tax year | deleted | Municipal tourist-tax regulations (e.g. Bologna, Napoli, Torino) |
| Invoice details (only for guests who ask for an invoice) | 10 years | deleted | Civil code art. 2220 |
| Reservations: dates, platform, guest name | 10 years after checkout, as the host's business record | deleted | Art. 2220; ordinary limitation period, art. 2946 |
| Reservation contact e-mail and phone | 12 months after checkout | erased | GDPR art. 5(1)(e) |
| Marketing consents | 24 months after the stay; withdrawn ones kept 24 months as proof of withdrawal | deleted | Garante 2005/2020/2023 (24-month benchmark) |
| Guest chat | 12 months after the stay; anonymised Q&A pairs have no limit | deleted | GDPR art. 5(1)(e) |
| Door-code / entry-access audit | 12 months | deleted | GDPR art. 5(1)(e) |
| Host notification log | 12 months | deleted | GDPR art. 5(1)(e) |
| Host account, terms acceptances, subscription and payments | 10 years after the account closes | deleted | Art. 2220; art. 2946 |
| Admin audit log | 2 years (Round 67) | purged | GDPR art. 5(2) accountability |
| Analytics | pseudonymous; rolled up after 180 days (as today) | aggregates only | GDPR art. 5(1)(e) |

Research, not legal advice: the lawyer checks the table (Phase 0).

## Phases

0. **Plan and lawyer brief.** This file, plus `docs/legal/RETENTION_LAWYER_BRIEF_IT.md`: the table in Italian, its sources and three questions for the lawyer:
   - may a third-party software keep the statistics and tourist-tax fields after the receipt?
   - are 24 months right for marketing?
   - are 10 years right for reservations?

   Documentation only.
1. **Policy into the signed agreement.**
   - New `docs/compliance/RETENTION_POLICY.md`.
   - DPA section 5.8 and a new Annex B «Tempi di conservazione», in both `docs/compliance/DPA_TEMPLATE.md` and `legal/ALLEGATO_A_DPA_v1.md` (kept byte-identical). The general terms point to Annex B.
   - The v1 hashes and clauses in `legal_documents` are refreshed; the version has no acceptances, so it is still editable.
   - ROPA retention lines and the guest privacy notice updated (IT/EN).
   - Tests: the Round 69 terms tests, DPA ↔ ROPA consistency, the annex lists every row of the table.
2. **Police data minimised.**
   - A migration and a daily job (`pg_cron`). As soon as a check-in is filed (a receipt exists, or the host marked it as sent), the job erases the identity fields and queues the photos for deletion.
   - The filed-edit lock and the retention guard (14 Nov hotfix) are changed so that only this minimisation step can clear those fields. Hosts and the API still cannot delete or edit filed records.
   - Backfill of existing rows, previewed first and with counts recorded.
   - The console shows «dati di identità cancellati per legge dopo l'invio» on older rows.
   - Alloggiati, ISTAT, regional and tourist-tax exports still work for the fields that remain. Golden files stay byte-identical for current stays; old stays export without the erased fields.
   - Tests: PGlite migration, cron job, guards, exports, console.
3. **The other retention rules as scheduled purges:** statistics fields, tourist-tax records, receipts and filing log, reservation contacts, reservations, marketing, chat, entry audit, notification log, closed host accounts. Each has a dry-run preview (the Ops «Anteprima» already exists) and tests that use rows just inside and just outside each limit.
4. **Close.** Full regression, live smoke, schema drift, ROPA and CHANGELOG. Production counts are recorded before and after.

## Not touched

The guest check-in flow and the Alloggiati sending itself; billing; the admin console outside the Ops purge preview and the privacy pages.

## Owner actions

- Send the lawyer brief (Phase 0). Not blocking: the agent applies the schedule; if the lawyer changes a period, that change is a follow-up.
- No host action is needed: nobody has signed v1 yet.
