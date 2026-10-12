# Round 51 — Self-serve host onboarding: setup checklist + contact widget

Date: 12 October 2026. Implementation owner: GPT or Claude as recorded in
CHANGELOG. Technical documentation is in English; UI copy is Italian first.

## Why this round exists

Every new host today has to book a Calendly call before they can use the
product. We lose hosts at that door — some can't book, some won't, some don't
show up. Round 51 removes the gate without removing the help: a short,
derived setup checklist gets a new host from empty account to "ready for my
first guest" without a call, a contact widget on every host-console page
turns the call into an optional rescue path, and nudge emails + an admin
"stuck list" catch anyone who still needs a hand.

## Non-goals

- **No auto-starting product tour.** No welcome video modal that steals focus.
- **No in-app chat with us** and no WhatsApp Business API. Plain `wa.me` links.
- **No AI-drafted recommendations.** Candidate for a later round.
- **No change to Alloggiati filing logic** beyond excluding `is_test` rows.
- **No feature is blocked behind readiness.** The checklist drives the badge,
  the banner, the nudge emails and the admin view, nothing else.

## Guiding principles

- Checklist, not product tour. Short (5 steps), visible progress ("3 di 5"),
  resumable, dismissable only after it is complete.
- Each step is done when the **data is actually there**, not when the host
  clicked "next". Completion is derived from real property state by
  `computeReadiness`; it can't drift.
- Video is optional per-step help, not a step. Reuse the Round 43 "Come
  funziona" guide drawer (`host-guides.js`, `HG.openGuide`) as the primary
  in-step help. The per-step `video_url` slot is hidden when empty; videos
  ship empty and get recorded later.
- Readiness never blocks a feature. A host whose property is incomplete can
  still take a real booking; the checklist is a hint, not a gate.

## The five steps

Each step has a stable `id`, Italian title, "done-when" rule evaluated from
real property state, and a help link into the Round 43 guide drawer. "Skip"
is an explicit choice the host makes, stored in `host_onboarding.skips`, and
rendered as **done-with-note** rather than a to-do.

| # | `id` | IT title | Done when | Help |
|---|---|---|---|---|
| 1 | `property` | **Dati e codici della struttura** | `name`, `city`, canonical `region`, `cir_code` present and CIN-format-valid; the regional code required by `regionComplianceFor(region, city)` present (e.g. `ross1000_codice` in Veneto); tourist tax configured (≥1 tax rule in `tax_rules`) **or** host chose `tax_not_applicable`. Alloggiati: either web-service credentials saved in `host_alloggiati_credentials` (Round 44) or `alloggiati_autofile_mode` explicitly set to `manual` export. | Guide drawer `compliance`; 60s video slot "Dove trovo il CIN e i codici" |
| 2 | `calendar` | **Collega il calendario** | `ical_feeds` has ≥1 feed with a valid HTTPS URL **or** host chose `direct_only` | Video slot "Dove trovo il link iCal su Airbnb / Booking" |
| 3 | `content` | **Prepara l'accoglienza** | welcome message present (IT **or** EN) + `wifi_name` + check-in instructions present. Recommendations are encouraged but **not** required for this step. | Guide drawer `guest-content` |
| 4 | `test` | **Prova come ospite** | a test check-in with `is_test=true` has been completed on this property **or** host chose `test_checkin` skip. `host_onboarding.test_checkin_done_at` persists completion so the test-row purge doesn't un-complete the step. | Short inline explainer "Così vedranno i tuoi ospiti" |
| 5 | `notifications` | **Attiva le notifiche** | at least one channel on in `host_notification_settings` (push, Telegram or email) | Existing notification settings panel |

A property is **Pronta** when steps 1, 2, 3 and 5 are done (step 4 is
strongly suggested but **not** blocking). Readiness never blocks a feature.

## Data model — Phase 1 (pure) and Phase 2 (storage)

### `lib/onboarding-readiness.js` — the one source of truth

Dual IIFE / `module.exports` module so both `host-console.html` (via
`<script src>`) and Node tests can load it, following the pattern of
`lib/alloggiati-records.js`.

```
computeReadiness({
  property,              // row from `properties`
  taxRules,              // array (property.tax_rules or []); treat empty as "no rule yet"
  alloggiatiCreds,       // {configured, verified_at} or null (api/alloggiati status)
  notificationSettings,  // row from host_notification_settings or null
  hasTestCheckin,        // boolean — test_checkin_done_at IS NOT NULL in host_onboarding
  onboardingState,       // host_onboarding row (skips bag)
  regionCompliance,      // regionComplianceFor(property.region, property.city)
}) → {
  steps: [
    { id: 'property',      done, skipped, missing: [fieldKey, …] },
    { id: 'calendar',      done, skipped, missing },
    { id: 'content',       done, skipped, missing },
    { id: 'test',          done, skipped, missing },
    { id: 'notifications', done, skipped, missing },
  ],
  doneCount, total: 5,
  ready,                  // true when 1,2,3,5 all done
  firstIncompleteStep,    // id or null
}
```

- `missing` lists exact field keys (`region`, `cir_code`, `ross1000_codice`,
  `wifi_name`, …) so the UI can say "Manca: CIN, codice ROSS1000" and deep-
  link to the field.
- Region tables are **not** duplicated here. The caller resolves them with
  `regionComplianceFor` (Round 47) and passes the result in.
- Pure. No DB, no network, no `Date.now()`. Deterministic for the same
  inputs so tests are stable.

### `migration_round51_host_onboarding.sql`

Idempotent, with a commented rollback block (same style as prior Rounds).
Applied to **production** (`jcjwaqqabgwqhhzhfbts`) via Supabase MCP in
Phase 2.

#### `public.host_onboarding`

One row per `(user_id, property_id)` so a host with two properties has two
onboarding rows.

| Column | Type | Notes |
|---|---|---|
| `user_id` | `uuid` NOT NULL | FK `auth.users` |
| `property_id` | `uuid` NOT NULL | FK `properties`, `ON DELETE CASCADE` |
| `first_seen_at` | `timestamptz` NOT NULL DEFAULT `now()` | set on first checklist view |
| `completed_at` | `timestamptz` NULL | first time `ready` flips true |
| `test_checkin_done_at` | `timestamptz` NULL | persists step 4 even after the test row is purged |
| `skips` | `jsonb` NOT NULL DEFAULT `'{}'` | e.g. `{"tax_not_applicable":true,"direct_only":true,"test_checkin":true}` |
| `checklist_dismissed_at` | `timestamptz` NULL | allowed only after `completed_at` |
| `nudge_24h_sent_at` | `timestamptz` NULL | dedupe for Phase 5 |
| `nudge_72h_sent_at` | `timestamptz` NULL | dedupe for Phase 5 |
| `nudges_opted_out` | `boolean` NOT NULL DEFAULT false | footer unsubscribe |
| `updated_at` | `timestamptz` NOT NULL DEFAULT `now()` | touched by trigger |

PK `(user_id, property_id)`; `BEFORE UPDATE` trigger sets `updated_at = now()`.

**RLS and grants.** RLS enabled; policies match the `properties` ownership
predicate so a host sees only rows where they own the property. `is_admin()`
read-only policy for admin dashboards. `GRANT SELECT, INSERT, UPDATE ON
public.host_onboarding TO authenticated`; full CRUD to `service_role`;
nothing to `anon`.

Readiness is **never** stored here. It is always derived (Phase 1) so it
cannot drift from real property state.

#### `is_test` flag on booking + check-in tables

The test-booking plumbing for Phase 4 needs:

- `public.checkins.is_test` — **already exists** (boolean, default false,
  Rounds 29+). No change required.
- `public.ota_reservations.is_test` — **already exists** (Round 50 Phase 3
  seeder uses it). No change required.
- Round 45 direct-reservation / walk-in path: inspect in Phase 2 and confirm
  the created rows land in `ota_reservations` (if they do, no new column is
  needed). The plan is to **reuse the existing `is_test` columns** rather
  than adding a new one, which keeps the autofile/export exclusion code
  touching the smallest surface.

The migration therefore adds **only** `host_onboarding`. Phase 2's test gate
re-confirms the existence of `is_test` on `checkins` and `ota_reservations`
and documents the direct-reservation path.

## Checklist UI — Phase 3

### Where it lives

- Card at the top of the **Oggi** section per selected property. Progress
  bar, "3 di 5", the five steps with done / to-do / skipped states. Each
  to-do step shows what's missing and a primary button that calls
  `showSection(...)` and scrolls/focuses the exact field.
- Collapses to a slim "Pronta ✓" badge once `ready`; dismissable via
  **Nascondi** only when `ready` is true (sets `checklist_dismissed_at`).
- Sidebar: small readiness dot on the **Proprietà** item while any property
  is incomplete. The property list/selector shows "Pronta" or
  "Da completare (3/5)".
- Recomputes after every relevant save (property, tax, iCal, notifications,
  Alloggiati credentials) — no reload needed. First view upserts
  `first_seen_at`; the first time `ready` flips true, sets `completed_at`.
- First login with zero properties: step 0 is "Aggiungi la tua struttura"
  and opens the property form.

### Contact widget ("Aiuto")

- Floating button, bottom-right, on **every host-console section**.
  Respects the mobile layout and the Round 50 demo banner; does not cover
  the save buttons. **Not** present in `index.html` (guest app) or
  `admin.html`.
- Opens a small sheet with three options in order:
  1. **Scrivici su WhatsApp** → `https://wa.me/<number>?text=<prefill>`
  2. **Scrivici una email** → `mailto:` with subject prefill
  3. **Prenota una chiamata di 20 minuti** → Calendly URL
- Prefill: "Ciao, sono {nome host}, struttura {nome struttura}. Ho bisogno
  di aiuto con: {step title or current section}." (EN mirrors it when
  `host_language = 'en'`.) **Only** the host's own name, property name and
  step name. Never guest data, booking codes, email addresses, phone numbers
  or anything else.
- Fixed line in the sheet (always visible):
  "Non inviarci documenti o foto degli ospiti: li gestiamo solo dentro
  WelcomeBnB." (EN equivalent.)
- "Serve aiuto?" link under every incomplete checklist step opens the same
  sheet with that step preselected as context.
- Configuration lives in the generated `app-config.js`, built by
  `scripts/build-config.mjs` from env vars:

  ```
  SUPPORT_WHATSAPP_E164=+39...        (optional; hides the channel if unset)
  SUPPORT_EMAIL=info@welcomebnb.it    (defaults to this when unset)
  SUPPORT_CALENDLY_URL=https://...    (optional; hides the channel if unset)
  ```

  `publicConfiguration()` grows a `support: { whatsapp, email, calendly }`
  key. In demo mode, demo-specific values (or empty) are used — never a
  production number in demo.
- Analytics events through the existing host-side `analytics_events` path.
  Event types are new and all `is_test=false` on real hosts:
  `onboarding_checklist_viewed`, `onboarding_step_completed` (data:
  `{step}`), `onboarding_step_skipped` (`{step, reason}`), `support_opened`
  (`{section, step}`), `support_channel_clicked` (`{channel, step}`). No PII
  anywhere in event payloads.

### i18n

Every new string lands in **both** the EN and IT dictionaries in
`host-console.html`, read via `h('key')`. Italian is written first and must
read like a person, not a manual. `applyLang` uses `innerHTML`, so all new
strings are **single-line** (no literal newlines in the dictionary values).

### Test gate for Phase 3

`scripts/onboarding-ui.test.mjs` static sweep covers:

- Every new `h()` key exists in both EN and IT and is single-line.
- The floating "Aiuto" button appears in `host-console.html` but is absent
  from `index.html` and `admin.html`.
- No literal `wa.me/`, `mailto:`, Calendly URL or WhatsApp number appears
  hard-coded in HTML. All three are read from `WELCOME_BNB_CONFIG.support`.
- `buildSupportPrefill(hostName, propertyName, step, lang)` is pure and
  unit-tested: encoding, IT/EN, no field outside the three allowed.

Manual mobile (375 px width) and desktop screenshots recorded in CHANGELOG.

## "Prova come ospite" — Phase 4

Button in step 4 — "Fai un check-in di prova" — creates a test booking on
this property flagged `is_test = true` via the Round 45 direct-reservation /
walk-in mint path. Do **not** build a second booking flow. The guest app
link opens in a new tab, and `index.html` shows a visible
"Check-in di prova — nessun dato reale" banner when the booking's row is
`is_test = true`.

**Non-negotiable exclusions.** A test check-in must never reach the
authorities or any export. Enforce **server-side** (SQL functions + API),
not only in the UI:

- `claim_autofile_rows` already filters by `alloggiati_status`; add
  `is_test = false` to the predicate (Round 49 Phase 2 function).
- `api/alloggiati.js` → `autofile_tick` path and manual `send` action skip
  test rows up-front.
- `.txt` export for Alloggiati manual mode skips test rows.
- ROSS1000 / regional exports (Round 47 `host-exports.js`) skip test rows.
- PayTourist / CityTax exports skip test rows.
- `api/send-arrival-reminders.js` skips test bookings so no SMS/push fires.
- Host statistics (`analytics_monthly`, dashboard cards) treat test rows as
  not counted — Round 48 established the `is_test` precedent in reports.

Test data hygiene:

- Test check-in photos use the existing storage-purge queue with an
  **immediate** TTL (≤1 h). Reuse `storage_purge_queue`; schedule the test
  row's photo with the earliest possible execution time rather than adding a
  new scheduler.
- The test booking and check-in rows are deleted **24 h after creation** by
  the same scheduler. Host can also delete immediately via "Elimina prova".
- `host_onboarding.test_checkin_done_at` is set at completion and never
  cleared by the purge, so step 4 remains **done** after the test row goes
  away.

### Test gate for Phase 4

Run against a non-production target (local Supabase shadow branch, or the
demo project `wmegnnlmcrabndyzywmj`). Create one test check-in and one
normal check-in on the same property and assert:

- `claim_autofile_rows` returns the normal row and **not** the test row.
- Manual Alloggiati `send` call errors or skips when passed the test row's
  ID; the real row is accepted.
- Local `.txt` export, ROSS1000 export, PayTourist export: test row absent.
- `api/send-arrival-reminders` next-24h selection does not include the test
  booking (verified by running the selection SQL against the fixture).
- `alloggiati_filing_log` has **zero** rows for the test check-in; one for
  the normal one.
- The purge removes the test booking and its photo at the configured TTL;
  the normal row survives.

## Nudge emails — Phase 5

Reuse the scheduler and Resend transport already used by
`api/send-arrival-reminders.js`. Add **one** new cron entry (or a new action
on the existing endpoint, whichever stays inside the Vercel Hobby
12-function cap). Hourly tick finds `host_onboarding` rows where the
property is not ready (computed with `lib/onboarding-readiness.js`
server-side, same input shape as the UI) and sends:

- **24h window** — if `first_seen_at + 24h < now()` and
  `nudge_24h_sent_at IS NULL` → send email 1, set `nudge_24h_sent_at`.
- **72h window** — if `first_seen_at + 72h < now()` and
  `nudge_72h_sent_at IS NULL` → send email 2, set `nudge_72h_sent_at`.
- Never more than these two. Stop as soon as the property is `ready`.
- Rows with `nudges_opted_out = true` are excluded.
- Dedupe against `notification_log` so a job that runs twice doesn't double
  send; the job is idempotent.

Email content (IT by default, EN when `host_language = 'en'`): one short
paragraph, the single next missing step by name, one button deep-linking
with `host-console.html#onboarding=<step>` (a new hash handler scrolls to
the checklist and focuses that step), and
"Preferisci che ti aiutiamo noi? Scrivici su WhatsApp" with the support
WhatsApp link. Footer link to stop these reminders
(`?stop=<signed-token>` → sets `nudges_opted_out = true`).

### Test gate for Phase 5

- Unit tests for the selection logic: time-window boundaries, ready
  properties excluded, opted-out excluded, dedupe when the job runs twice,
  stop after 72h even if the property is still not ready.
- One real send to Daniele's own host account in production; Resend id
  recorded in CHANGELOG with the test host user_id (no secret).

## Admin readiness view — Phase 6

Extends the Round 35 per-host status cards in `admin.html`:

- Per property: readiness "3/5", first incomplete step, days since
  `first_seen_at`, support clicks per channel.
- "Bloccati" sortable list: hosts not ready after 48 h, oldest first.
- Aggregate funnel across the organization: how many hosts reached each
  step, plus support clicks per step. The step with the most clicks is the
  next thing to simplify.
- All reads gated by `is_admin()`; a non-admin session gets zero rows (the
  five SECURITY DEFINER advisor warnings carried over from Round 50 Phase 2
  remain documented noise, not new ones).

### Test gate for Phase 6

- Admin probe: a known admin JWT lists readiness for every pilot host and
  the counts match `computeReadiness` run in a script against the same
  rows.
- Non-admin probe: a presenter / host JWT gets zero rows from the admin
  queries, matching the existing Round 35 negative gate.

## End-to-end, demo and docs — Phase 7

Fresh test host account in production via the invite flow (Round 38):

1. Log in. Zero-properties step 0 is visible; add a property.
2. Complete steps 1 → 5 including a test check-in. Confirm "Pronta" badge
   and that `completed_at` is set.
3. Confirm the test check-in is absent from every export / filing / stats
   view listed in Phase 4.
4. Simulate 24h / 72h clock skew in a staging query (`UPDATE host_onboarding
   SET first_seen_at = now() - interval '25 hours'`) and verify the nudge
   job sends one email, then nothing more once the property is ready.

Clean up the test host account and its rows afterwards; record evidence
with the test user_id and Resend ids.

### Demo (Round 50)

- Set the second demo property (`Trullo Fico Vicino`) to a partially
  complete state so presenters can show the checklist. Update
  `lib/demo-fixtures.mjs`, the seeder, the reset function (if needed),
  `docs/DEMO_ONBOARDING_IT.md` and regenerate the PDF
  (`scripts/demo-onboarding-pdf.mjs`).
- `demo-launch.html` grows a "Checklist in corso" link to the host console
  with the second property pre-selected.
- Demo gates must still pass after the fixture changes: `demo-live-smoke`,
  `demo-rebuild-verify`, `demo-ux`, `demo-ux-sim`, `demo-e2e`.

### CHANGELOG close

Fill the Round 51 table with PRs, test evidence and a "What to watch"
section: checklist completion rate without support contact, and support
clicks per step. These are the two numbers that tell us whether the
Calendly gate is actually gone.

## Owner-only actions

Daniele only for:

- The WhatsApp number and Calendly URL to put in `support` config (if not
  already in Vercel env).
- Optional per-step video recordings; the slots ship empty.

## Recurring gotchas (worth repeating)

- **RLS + GRANT**: new tables need both. A missing `GRANT` is a silent
  0-row write under RLS. The Phase 2 probe asserts non-zero writes.
- **Vanilla JS only**: no bundler, no browser-side `import`/`export`.
  Shared logic uses the IIFE + `module.exports` dual.
- **i18n**: `applyLang` uses `innerHTML` and needs single-line strings in
  both EN and IT dictionaries.
- **Region-aware compliance**: resolve via `regionComplianceFor`; don't
  hard-code "ROSS1000 required".
- **CIN** is the user-facing term; the DB column stays `cir_code`.
- **Demo**: any new host-console behavior ripples into `lib/demo-fixtures.mjs`,
  `docs/DEMO_ONBOARDING_IT.md` and the PDF.
- **Migrations**: `migration_round51_<description>.sql`, idempotent, with a
  commented rollback block.
