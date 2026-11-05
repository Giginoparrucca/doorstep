# Round 71 — Admin host health: who do I call today?

Confirmed by Daniele on 5 November 2026 («Yes. Go ahead») after the plain-language recap. Admin-only; hosts and guests see nothing new.

## Goal

Replace the per-host Deep Dive raw counts with metrics that each carry a **definition, a target, a status colour and a one-line "what to do"**, and add an **Action needed** list to the admin overview. Scope: (1) check-in coverage, (2) compliance / filing, (3) action-needed list and host health score. **Parked for a later round:** guest engagement, chat response time, cost per host.

## Constraints

- Vanilla HTML/JS, no framework/bundler/modules in the browser. DB values into the DOM via `textContent`/escaping; any `applyLang` string single-line.
- Server-side only: new Vercel function `api/admin-host-health.js` (Vercel Pro since 5 Nov 2026, so the 12-function cap no longer applies). Admin gate = the existing server-side check: caller JWT → `/auth/v1/user` → `rpc/is_admin` with the caller's JWT (same as `api/_alloggiati-support.js`). `admin_users` has 1 row today (the spec assumed 0); `is_admin()` is the source of truth. Reuse `api/_cors.js` and the origin allowlist. Service-role reads; no SQL function, so no new migration (no GRANT surface).
- Global filters: `is_test = false` and `deleted_at IS NULL` on properties, checkins, ota_reservations, recommendations; test properties excluded.
- Privacy: guests appear as surname initial + arrival date only. No documents, birth data, fiscal codes, photos. Metric payloads are not logged.
- One JSON payload for all properties (≈21): overview array + per-property detail.

## Phase 1 findings (production, 5 Nov 2026)

| Question | Finding | Decision |
|---|---|---|
| Real guest stays in `ota_reservations` | `entry_type='reservation'` + `status='active'` (148 rows). `entry_type='block'` never has a booking code (183 rows, 173 cancelled). Platforms: airbnb, booking, direct, other. Echo rows (`covered_by_reservation_id`) only on 1 cancelled block. | Denominator = spec filters, as written. |
| Empty `booking_code` among real stays | 10 active reservations overall; **2 of 57** in the last 30 days. | Counted as **unlinkable**, shown, not in coverage. |
| Link paths reservation → check-in | `checkins.booking_code` + `property_id` (spec). `room_id` exists on both but is a room, not a booking. 2 booking codes with check-ins in 30 days have no reservation (direct check-ins). | Match on property + booking code only; several check-ins of one booking = one covered reservation. |
| `link_sent_at` | **Never written by any code** (added in Round 45, only read): 0 of 57 in 30 days, 0 in the table. | Not used (it would show 0% for everyone). «Link reached guest» = a `guest_*` analytics event for that property + booking code (guest app opened; host devices excluded since the 31 Oct 2026 guest-analytics hotfix): **36 of 55** with a code. Host «copy link» events carry no booking code. |
| `alloggiati_filing_log.outcome` | Success: `filed` (portal send), `test_all_ok` (dry run). Failure: `test_rejected`, `cred_error`. `evidence_*` rows are audit records of the same attempt, not attempts. `phase2-probe` is an old probe. | Attempt = row whose outcome is not `evidence_*`/`phase2-probe`; «last 3 failed» = last 3 attempts all in the failure set. |
| Timezones | All 21 live properties `Europe/Rome`. | Code uses `properties.timezone` (default Europe/Rome); non-Rome covered by a test. |
| Host activity source | `analytics_events` with `user_id = owner_id`: 3,141 in 30 days (panel_view, save_*, session_end…), the reliable source. `ota_reservations.created_by = owner`: 31 rows (direct bookings). `auth.users.last_sign_in_at` via service role. | Last activity = latest of the three. |
| Filing on time (30 d) | 86 eligible check-ins; 67 filed by arrival+1; 19 unfiled; 0 filed late. | See decision below. |
| Overdue (spec: arrival ≤ today, unfiled) | 28, of which **2 arrive today** (not due yet) and 9 older than 60 days. | **Overdue = arrival before today (property tz), unfiled, not excluded**; arrival today = «due today», shown, not red. Otherwise every arrival day turns the host red before the 24 h deadline. |

**Filed on time** = filed by the end of arrival + 1 day (property tz) ÷ check-ins in the window whose deadline has passed or that are already filed (a guest arriving today or yesterday cannot be late yet). Excludes `autofile_excluded`.

## Metrics, targets and hints

As specified by Daniele (§3 of the round brief), with the decisions above:

- **Coverage (30 d):** covered ÷ linkable real stays with check-in date today−30…today. Green ≥ 85%, amber 50–84%, red < 50%, grey when 0. 4-week mini bars. Hint (red/amber): «Host may still be collecting documents outside WelcomeBnB. Check they send the guest link at booking (share templates).»; when the link rarely reaches guests: «Guest link not reaching guests: check the host sends it.»
- **Filed on time (30 d):** green 100%, amber ≥ 90%, red < 90%.
- **Overdue now:** > 0 is red; list surname initial, arrival date, last autofile error. Hint: «Overdue filing: the host must file today or send a PEC to the Questura.»
- **Late filings (30 d):** `filing_method = 'late_questura_pec'`.
- **Autofile health:** last 5 attempts (trigger, outcome, error code, time); red when the last 3 failed. Hint: «3 failed filings in a row usually means expired or changed Alloggiati credentials. Contact the host before a fine.»
- **Credentials:** red if missing while mode is `live`, unverified, or `last_error`; amber if the key expires within 14 days; shows mode.
- **Activity:** amber > 7 days, red > 14 days, only with reservations in the last or next 30 days.
- **Setup gaps:** CIN; ROSS1000 code where the region's export is ROSS1000 (same rule as onboarding readiness / regional exports); tourist tax unless `tax_not_applicable`; iCal unless `direct_only`; fewer than 10 recommendations; no welcome message (IT/EN/legacy); Alloggiati credentials missing/unverified.
- **Upcoming without check-in (next 48 h):** date, platform, link reached guest yes/no. Hint: «Nudge guest / tell host.»
- **Health:** red = overdue > 0 or last 3 attempts failed or credentials red or coverage < 50%; amber = coverage 50–84% or key expiring or inactive > 14 d with reservations or any setup gap or upcoming without check-in; green otherwise; grey = no reservations in the last 30 or next 30 days. Reasons returned with the colour.

## UI (admin.html)

- **Overview** (top of the default Pilot tab and of Deep Dive «All users»): «Action needed» list (red first, then date), each line opening that host's deep dive; hosts sorted by health with colour + top reason.
- **Deep dive** (a host selected): per property, a 3-tile strip (Coverage, Filed on time, Overdue now) with value, target, colour and hint when not green; then Upcoming without check-in → Autofile/credentials → Setup gaps → Activity. Replaces the host raw-count blocks (listed in the CHANGELOG). Tiles stack on narrow screens.

## Phases

| Phase | Scope | Test gate |
|---|---|---|
| 1 — Data check | Distinct values, link paths, unlinkable count, decisions above. Documentation only. | Findings recorded (this file + CHANGELOG). |
| 2 — Server | `lib/host-health.js` (pure, dual-load metric rules) + `api/admin-host-health.js` (admin gate, CORS, service-role reads, one payload, no logging of payloads). | Unit tests incl. edge cases (no reservations, empty booking code, multi-guest booking, excluded rows, non-Rome timezone); anon and non-admin rejected, admin never gets a silent empty result; hand SQL vs computed numbers for Marco Polo San Zeno and Trullo Verde Ulivo on production data. |
| 3 — Admin UI | Action needed, health-sorted hosts, new deep dive; removal list. | Browser test with the actual admin code at 390/1440 (order, links, tiles/hints, privacy, stacking, unavailable state). |
| 4 — Regression + close | Full `npm run test:all`, post-deploy `test:live`, report (description of overview and one deep dive, two-property check, data-quality surprises). | Whole suite green; CHANGELOG close with parked items. |
