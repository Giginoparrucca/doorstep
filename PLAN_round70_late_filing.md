# Round 70 — Late Alloggiati filing: warn before the window closes, guide the host after

**Specification.** Written 3 November 2026 at Daniele's request; Daniele confirmed the plain-language recap on 3 November 2026 ("yes, go ahead with Round 70"). Follow `AGENTS.md`: every phase passes its own test gate plus the full `npm run test:all` before the next starts. Round 63 stays in-flight with GPT; its phases are untouched.

## Why

On 3 Nov 2026 four Caralis Holiday guests (arrivals 31 Oct, bookings CAR-77HJEN and CAR-JVD4A9) were never filed: autofile kept failing until the online window closed. The rows are `past_portal_window`; the host must file late, by hand.

Rules (`docs/MANUALEALBERGHI.pdf`, 3 Nov hotfix entry):
- The portal accepts only **today or yesterday** as the arrival date. After arrival + 1 at 23:59 Rome, guests can no longer be sent through the portal or the web service.
- From then on the host contacts the competent **Questura** (or the local Commissariato) and agrees how to send the data, usually by PEC; some offices accept it only after authorising it.
- Late or missing filing is a criminal offence (art. 17 + 109 TULPS: arrest up to 3 months or a fine up to €206). Filing late is still far better than never filing.
- Portal outage exception (D.M. 7 gennaio 2013): if the portal is down, the host sends the data by PEC to the Questura **within the deadline** and keeps the delivery receipt.

Today: a chip ("⚠ Non inviabile: finestra portale scaduta"); a generic 09:00 "N rows overdue" alert; nothing says what to do next; nothing warns on the last evening; the manual `.txt` export includes rows the portal will reject.

## Goal

1. **Before the window closes:** an urgent alert on the evening of arrival + 1 while rows can still be filed; if the latest failure looks like a portal outage, point to the PEC emergency route.
2. **After the window closes:** a guided "late filing" path in the console: contact your Questura, a ready package (`.txt` + pre-written Italian PEC text), and recording the late filing with the PEC delivery receipt as evidence.
3. **The manual `.txt` export stops including rows the portal will refuse**, explains why, and points to the late path.

Not legal advice. Neutral wording: contact the Questura and ask how to send the data. Never imply that a late filing makes the host compliant.

## Inspection findings (3 Nov 2026, reported in the recap)

- **Tick scope.** `runAutofileTick` loads only properties with `alloggiati_autofile_mode in (dry_run, live)` **and** a verified credential row. Autofile-off properties (and properties without verified credentials) get no alerts and no `past_portal_window` stamp. `collectReceipts` runs separately. → Phase 1 adds a second, alerts-only pass over the other properties inside the same tick (no new cron, no new function; never Test/Send).
- **`past_portal_window`** is stamped in `processPropertyAutofile` only for candidates with arrival today/yesterday Rome. → Late status is computed **from the dates** by a shared helper in `lib/alloggiati-records.js` (`isPastPortalWindow`), used by server and console.
- **09:00 overdue** counts every unfiled row with arrival ≤ today; no split.
- **Outage-type error codes** written by the tick: `generate_token_failed`, `test_transport_error`, `send_transport_error`, `send_not_started`, `send_result_uncertain` (plus the generic `test_error` / `send_error` / `timeout` transport codes).
- **Host "Segna inviato"** (`markGroupFiledWithoutReceipt`) updates `checkins` directly (`alloggiati_status='filed'`, `filed_at`) with no `alloggiati_filing_log` entry (that table is written only by the service-role `log_alloggiati_filing`). No column records the filing method. Round 52 `collectReceipts` acts only on rows with a portal `filed` log entry (`trigger in (host, autofile)`), so host declarations are already skipped. → Phase 3 adds a `filing_method` column (CHECK) so a late PEC filing is never shown as a portal filing; the log stays service-role-only and untouched.
- **Alert dedup.** `checkins.autofile_last_alert_at` is the 24 h cooldown of the "3 failures" alert. Reusing it for the one-shot window-closed alert would let either alert silence the other. → New column `checkins.late_alert_at` (one-shot, never cleared).

## Phases

### Phase 1 — Last-evening and window-closed alerts (server)

- **Shared helper** `lib/alloggiati-records.js`: `portalWindowCloseAt(arrivalYmd)` (arrival + 1 at 23:59:59.999 Rome, DST-correct) and `isPastPortalWindow(row, now)` (not filed/filing/correction, not excluded, not deleted, not test, and `now` after the close).
- **Closing alert** (`closing`): first tick at/after 18:00 Rome, rows whose window closes tonight (arrival = yesterday Rome, unfiled, not excluded, not test) → one urgent alert per property per day. IT: "⏰ N ospiti di {struttura} vanno inviati ad Alloggiati entro le 23:59 di stasera. Dopo, il portale non li accetta più e dovrai contattare la Questura." If any of those rows' latest error is outage-type, add: "Se il portale non funziona, invia i dati via PEC alla Questura entro stasera e conserva la ricevuta di consegna."
- **Autofile-off properties** get the closing, window-closed and 09:00 alerts too, through the alerts-only pass.
- **Window-closed alert**: once per booking group as it becomes late. IT: "Il termine per inviare N ospiti (prenotazione {booking_code}) è scaduto. Il portale non li accetta più: apri la console → Check-in → «Invio tardivo» per i passaggi." Dedup per row via the new `late_alert_at` (see findings).
- **Stamping**: `past_portal_window` from the shared helper for every late row (autofile-off, older than yesterday). Candidate filter and Test/Send order unchanged.
- **09:00 overdue** splits counts: "still fileable today" and "late, needs the Questura".
- **Privacy**: counts and booking codes only, never names.
- **Migration** (Phase 1): `checkins.late_alert_at timestamptz` (service-role writes; existing grants).
- **Tests**: helper unit tests (DST change, 23:59 vs 00:00); actual `maybeFireDailyAlerts` / tick with a time stub: closing once after 18:00 and not before; not when nothing closes; outage line only with outage errors; window-closed once per group then silent; autofile-off covered; no names in any text.

### Phase 2 — "Invio tardivo" in the console

- Late chip → button "⚠ Invio tardivo", opening a panel for the **whole booking group**.
- Panel (IT/EN, single-line `h()` keys): why (portal accepts today/yesterday only); what to do (contact the Questura competente or Commissariato, ask how they want the data; usually PEC; some authorise first); the property's Questura PEC if saved, with copy; **Scarica il file per la Questura** (same builder, byte-identical records, late filename); **Testo PEC** (subject "Comunicazione tardiva alloggiati – {struttura} – arrivo {data}"; body: struttura, CIN, arrival date, number of guests, booking code, data in the attachment, regret for the delay, host contacts; no guest names) with copy; note to keep the PEC delivery receipt.
- **`properties.questura_pec`**: optional, format check, next to the Alloggiati block, link to the Polizia di Stato Questure page; no hard-coded PEC list; explicit grants.
- **Manual `.txt` export** leaves out late rows with "N ospiti esclusi: il portale non accetta più la loro data di arrivo → usa «Invio tardivo»"; no file if every selected row is late.
- **Tests** (Chromium IT/EN × 390/1440): chip for a late group only; panel counts; downloaded `.txt` byte-identical to the builder output; PEC text without names, with CIN and booking code; export exclusion + message; PEC field saves (no 0-row update) and rejects malformed values.

### Phase 3 — Recording the late filing

- **"Segna come inviato in ritardo"**: requires the PEC sent date; strongly encourages (does not force) the PEC delivery receipt upload (PDF or `.eml`, private receipts bucket, existing path convention); without upload, the same confirmation as `markGroupFiledWithoutReceipt`.
- **Data**: group rows → `filed`, `filing_method='late_questura_pec'` (new column, CHECK), `filed_at` = moment of recording, `late_pec_sent_on` = declared PEC date; filed lock applies; never written as portal; the filing log is not written by hosts (service-role only) and past entries are never edited.
- **Display**: guest view and group header "Inviato in ritardo via PEC · {data}" + receipt link; admin support helper shows the same and stops the late-route hint once recorded; `collectReceipts` ignores these rows (explicit filter on `filing_method`).
- **Migration**: timestamped, re-runnable, explicit grants (no anon; service_role CRUD as Round 48e; authenticated UPDATE on the new columns via existing table grant), PGlite fixture, applied to production before merging code that writes the fields, verified (column, constraint, grants, `schema_migrations`, schema-drift green).
- **ROPA**: Alloggiati activity lists the PEC date and receipt.
- **Tests**: PGlite migration twice, per-role grants, CHECK rejects unknown methods; browser: late group with and without upload, whole group changes, lock applies, labels; receipt fetch skips late rows; admin hint changes.

### Phase 4 — Guide and close-out

- Host guide entry in `host-guides.js` (IT/EN): the 24 h / 6 h deadline, what happens after, PEC route during an outage, how to use «Invio tardivo».
- Update `docs/` where the Alloggiati flow is documented.
- Full regression, merge, post-deploy `npm run test:live` with `SPOT_SMOKE_REQUIRE_MATCH=1`, CHANGELOG with tests, PRs, run IDs.
- **Owner follow-up**: the four Caralis guests (CAR-77HJEN, CAR-JVD4A9) are the first real use; the host can generate their package from «Invio tardivo”; nobody sends anything to any Questura on the host's behalf.

## Hard constraints

- RLS + explicit GRANTs; `.update().select()` with row-count checks.
- Vanilla JS; shared libs follow the `lib/*.js` dual-load pattern.
- i18n strings single-line, data escaped; data into the DOM via `textContent`; the PEC body is built in JS.
- Late `.txt` byte-identical to the normal builder; goldens unchanged; foreign-born guests keep two blank spaces in *provincia*.
- Never Test/Send/retry late rows.
- No guest names in alerts, emails or the PEC body; the `.txt` is a local download only.
- Commits prefixed `Round 70 Phase N · `; CHANGELOG kept current.
