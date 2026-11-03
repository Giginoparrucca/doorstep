# Alloggiati — deadlines, alerts and late filing (Round 70)

Operational note for developers and support. Specification: `PLAN_round70_late_filing.md`. Not legal advice: the product tells hosts to contact their Questura and ask how to send the data, and never implies that a late filing makes them compliant.

## The window

- Guests must be communicated within 24 hours of arrival (6 hours for one-night stays). `autofileDueAt` schedules automatic filing inside that window.
- The Alloggiati portal and web service accept only arrivals of **today or yesterday**. The window closes at **arrival + 1, 23:59 Europe/Rome**.
- One rule decides "late" everywhere: `AllogRecords.portalWindowCloseAt(arrival)` / `AllogRecords.isPastPortalWindow(row, now)` in `lib/alloggiati-records.js` (unfiled, not excluded/deleted/test, now after the close). The server (alerts, stamping) and the console (late button, export) both use it.

## Alerts (`api/alloggiati.js`, every 10-minute tick)

| When | Kind | Text (counts and booking codes only, never names) |
|---|---|---|
| First tick ≥ 09:00 Rome, once a day | `overdue` | N still to send today, M late (contact the Questura — «Invio tardivo») |
| First tick ≥ 18:00 Rome, once a day, arrivals of yesterday still unfiled | `closing` | must be sent by 23:59 tonight; adds the PEC outage route if a row's last error is outage-type |
| Once per booking group as it becomes late (window closed in the last 48 h) | `window_closed` | the deadline has passed → console → Check-in → «Invio tardivo» |
| 3 consecutive transport failures / portal rejection (24 h cooldown per row) | `failures` / `rejection` | as before |

- Autofile properties (dry-run/live with verified credentials) are processed as before; **every other property with unfiled guests in the last 30 days gets an alerts-only pass** (no Test/Send).
- Dedup: daily kinds in `properties.alloggiati_autofile_alerts` (kind → Rome date); window-closed in `checkins.late_alert_at` (one-shot, separate from `autofile_last_alert_at`, the row-alert cooldown). Late rows older than 48 h are marked silently.
- Late rows are stamped `autofile_last_error = 'past_portal_window'` from the shared rule.
- Outage-type errors: `generate_token_failed`, `test_transport_error`, `send_transport_error`, `send_not_started`, `send_result_uncertain`, `test_error`, `send_error`, `timeout`.
- Before Round 70 `pgrestGET` was missing from `api/alloggiati.js`, so no alert was ever sent; `notification_log.trigger` now also accepts `autofile_<kind>`.

## «Invio tardivo» (host console)

- Late rows show **⚠ Invio tardivo** (row and group header), whatever the autofile mode. The panel covers the whole booking group: why, what to do, the saved Questura PEC (`properties.questura_pec`, Settings), the file for the Questura (same `buildBatch` output, this group only, downloaded on the host's device, never emailed), an Italian PEC text without guest names (CIN, arrival date, number of guests, booking code, host contacts), and the note to keep the PEC delivery receipt.
- The normal portal export leaves late guests out and says so; no file when all are late.
- **Segna come inviato in ritardo**: PEC sent date required; PEC delivery receipt (PDF/.eml) strongly encouraged, stored in the private `receipts` bucket (`<property_id>/<booking>-tardivo-<YYYYMMDD>.<ext>`). The whole group becomes `filed` with `filing_method = 'late_questura_pec'` and `late_pec_sent_on`; `filed_at` is the moment of recording. The filed lock applies afterwards. Nothing is written to `alloggiati_filing_log` (service-role only) and the Round 52 receipt fetch skips these rows.
- Admin support shows "Filed late via PEC · date" for these rows instead of the late-route hint.

## Portal outage

D.M. 7 gennaio 2013: if the portal is down, the host sends the data by PEC to the Questura **within the deadline** and keeps the delivery receipt. The 18:00 closing alert mentions this when the last failure looks like an outage.
