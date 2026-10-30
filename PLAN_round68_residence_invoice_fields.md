# Round 68 — Residence required for regional statistics + optional invoice details

**Specification file.** Living document. Written 30 October 2026; **confirmed by Daniele on 30 October 2026** after the plain-language recap (AGENTS.md "Confirm before every new Round").

## Why, in short

Business B&Bs and affittacamere issue an electronic invoice to the guest. For that they need the payer's **codice fiscale** (if they have one) and **full residence address**, which WelcomeBnB doesn't collect today. This simple version adds these as **optional** fields on the main guest's check-in, so hosts can find them on the guest record instead of chasing guests by WhatsApp or email.

WelcomeBnB only captures the data. It doesn't create, number or send invoices; that stays in the host's own invoicing tool. **No new retention rule:** the fields live on the check-in row and follow its existing lifecycle.

Background rule (for wording only, nothing enforced): Italian invoices need the codice fiscale + full Italian address when the guest has a codice fiscale. Foreign guests without one need only country + address, and must **not** get a codice fiscale on the invoice. So the codice fiscale field is labelled "if you have one".

### Part A — residence becomes required for every guest

Checked 30 October 2026 against every region and autonomous province mapped in `lib/regional-exports.js`. All of them collect guest flows for the same national ISTAT survey, "Movimento dei clienti negli esercizi ricettivi" (IST-00139). That survey has a mandatory response under art. 7 D.Lgs. 322/1989, and it classifies Italians by region of residence and foreigners by country of residence.

| Region / system | Residence evidence |
|---|---|
| Abruzzo, Basilicata, Calabria, Emilia-Romagna, Lazio, Liguria, Lombardia, Marche, Molise, Piemonte, Sardegna, Veneto, Toscana (FI/PO/PT): ROSS1000 | Tracciato XML v3 (18/03/2026): `statoresidenza` mandatory; `luogoresidenza` mandatory for Italian residents, optional for foreigners |
| Puglia: SPOT Online | XSD 0.6: `paeseresidenza` or `comuneresidenza` mandatory for every guest (members may reuse the capogruppo's value) |
| Puglia: SPOT Easy | Manual: residence added after the PS import |
| Umbria: Turismatica | C/59 record: Italian provenance = province of residence, foreign = country (`docs/REGIONAL_EXPORT_FORMATS.md`) |
| Trentino: STU / DTU Alloggi | Province of Trento: each guest recorded by own Italian province/region or foreign country of residence, never the group leader's; private alloggi also obliged under the PSN |
| Alto Adige: ASTAT / LTS | ASTAT guidelines 2025: country of origin **with postcode for everyone**, region/province for Italians |
| Campania: Sinfonia Turismo SMART | Provenance (Italian region or foreign country) required |
| Friuli-Venezia Giulia: WebTur | Arrivals/departures by provenance (ISO country codes) |
| Sicilia: Turist@t | Same ISTAT C/59 movement data |
| Valle d'Aosta: VIT / locazioni turistiche | Statistical presence reporting required for tourist rentals too (L.R. 11/2023) |
| Toscana other provinces: MOTouristOffice / local systems | ISTAT provenance, Italy vs abroad; L.R. 86/2016 art. 84 bis extends it to locazioni turistiche |

Conclusion: residence is required everywhere, so it becomes **mandatory on every property** with no opt-out. `docs/REGIONAL_EXPORT_FORMATS.md` already forbids guessing residence from citizenship or birthplace.

## Scope

**In (Part A).** Residence (country, plus comune for Italian residents) required for every guest on every property; postcode also required in Alto Adige; members pre-filled from the main guest.

**In (Part B).** Four nullable columns, an optional collapsible section for the main guest (`single` / `head` / `group`) in the guest form, server allowlists, a light codice fiscale check, view/edit in the host's guest detail modal, IT/EN strings, a ROPA line and a privacy-notice line.

**Out (later rounds if needed).**
- A per-property on/off switch for the invoice fields, or making them mandatory.
- Matching the codice fiscale against the guest's name/date of birth.
- A "Dati fattura" card, copy buttons, CSV export.
- Invoicing a company (P.IVA / SDI / PEC).
- Any change to Alloggiati / SPOT / ROSS1000 / tourist-tax outputs.
- Any change to retention jobs.
- Any change to the Round 66 entry-release gate: these fields never block door codes.

## Phase 1 — single phase

Follow AGENTS.md: CHANGELOG `in-progress — <model>` at start, whole suite `npm run test:all` as the gate, `shipped — PR #N — <model>` after merge, `npm run test:live` after deploy. The migration is not shippable until `scripts/schema-drift.test.live.mjs` finds it in production.

**1. Migration** `supabase/migrations/<timestamp>_round68_invoice_fields.sql`

- `public.checkins` new nullable columns: `fiscal_code text`, `residence_address text` (street + number), `residence_postcode text`, `residence_province text`. Reuse the existing `residence_country` / `residence_place` (Round 47.2) for country and comune/city.
- CHECK constraints, format only, NULL allowed: `fiscal_code ~ '^[A-Z0-9]{16}$'`, `residence_province ~ '^[A-Z]{2}$'`, `char_length(residence_address) <= 120`, `char_length(residence_postcode) <= 12`.
- Add the four columns to the Round 66 atomic submission function (`20261028082453_round66_atomic_submissions.sql` lists every inserted column) via `CREATE OR REPLACE`. Keep grants, `search_path` and SECURITY settings identical apart from the column list.
- **RLS + GRANT gotcha:** confirm the guest path and the host edit path actually write the new columns. A 0-row UPDATE with no error means a missing grant.
- Round 48d filed lock: hosts must still be able to edit these fields after Alloggiati filing (invoices are often issued at checkout). If the lock blocks it, exempt only these four columns plus `residence_country/place`.

**2a. Guest app: residence required for every guest (Part A)**

- For **every** guest (main guest and members), on every property: country of residence is required. If Italy: comune is required, validated against the existing comuni list (ambiguous names need the province, as the regional exports already demand). If foreign: city stays optional. Remove "(optional)" from these two labels.
- **Alto Adige only:** ASTAT also asks for the postcode of every guest. When the property region is Alto Adige, show the postcode field (the Part B column `residence_postcode`) for every guest and make it required. Nowhere else is postcode required.
- Members: pre-fill country/comune from the main guest. The pre-fill must be visible and editable, never a silent copy: the Trentino guidance says each member is recorded with their own residence, not the leader's.
- Server (`api/guest.js`): enforce the same rule on insert/update, reading the property region server-side, never from the client. Return the existing field-error shape so the form shows inline errors. Do **not** add residence to `api/_entry-submission-validation.js`: door codes never depend on it.
- Already-submitted check-ins aren't retro-validated. A guest or host editing an old check-in with no residence is asked to fill it before saving. The host export review keeps handling gaps for old rows.
- Host console guest detail modal: same required rule when the host edits, plus a "missing residence" badge on older rows without it.

**2b. Guest app: invoice details (Part B)**, main-guest step only:

- A collapsed section below the existing residence fields: "Ti serve la fattura? Aggiungi i tuoi dati (facoltativo)" / "Need an invoice? Add your details (optional)".
- Inside it: codice fiscale ("se ne hai uno" / "if you have one"), auto-uppercased; address (street and number); postcode; provincia (2 letters, shown only when the country of residence is Italy).
- Country and comune/city stay the existing `residenceCountry` / `residencePlace` fields; no duplicates.
- Everything stays optional; submitting with the section empty must work exactly as today.
- Codice fiscale check only when filled: 16 characters with the correct check character (official odd/even tables, omocodia letters allowed). If invalid, show an inline error and don't submit until it's fixed or cleared. Put the check in a small `lib/codice-fiscale.js` (no bundler, browser + Node, like `lib/alloggiati-records.js`) so server and host console reuse it.
- Pre-fill from the welcome-back / edit flow like the other fields.
- i18n: all new strings in the existing `applyLang` dictionaries, at least IT and EN, plus any other languages the guest app already ships. Single-line strings only (`innerHTML` constraint).

**3. Server (`api/guest.js`)**

- Add the four columns to `CHECKIN_WRITE_FIELDS` and `CHECKIN_READ_FIELDS`.
- Normalise: trim; uppercase codice fiscale and provincia; `''` → NULL. Reject a codice fiscale that fails the shared check.
- Do **not** touch `api/_entry-submission-validation.js` or its `revisionFields`.

**4. Host console (`host-console.html`)**

- Guest detail modal: the four fields shown and editable next to the existing residence fields, labelled "(opz.)", with the same codice fiscale check. Editable after filing (see migration).
- Nothing else in the host UI changes.

**5. Paper trail (same PR, as AGENTS.md requires)**

- `docs/compliance/ROPA.md`: add codice fiscale + residence address (optional) to the check-in activity's `personal_data`, purpose "lets the host issue the guest's invoice", retention "same as the check-in row". Keep `scripts/round67-ropa.test.mjs` green.
- Guest privacy notice template, one IT/EN line: "If you need an invoice, you can also give your codice fiscale and residence address so your host can issue it."

**6. Tests (join the full suite)**

- `scripts/codice-fiscale.test.mjs`: valid/invalid check characters, omocodia, lowercase/space normalisation. Synthetic codes only, never real ones.
- Browser (390 px and 1440 px, IT/EN): empty section → submission unchanged; Italian resident with a valid codice fiscale + full address saved; foreigner with address only, no provincia field shown; invalid codice fiscale blocked inline, then fixed; values pre-filled on edit; host edits the fields after filing.
- Residence (Part A), browser + API: required for main guest and members on every property, including one with no region set; members pre-filled from the main guest, visible and editable; Italian comune required, foreign city optional; Alto Adige property → postcode also required for every guest; server rejects a missing residence even if the client check is bypassed; editing an older check-in that has no residence asks for it before saving.
- Existing Alloggiati / SPOT / regional / tax goldens must stay byte-identical.

## Risks and limits

- Optional fields mean some hosts will still need to chase guests. If pilot hosts ask, a follow-up round can add a per-property "required" switch and the copy/CSV handover.
- Never use real codici fiscali in fixtures, goldens or demo data.
