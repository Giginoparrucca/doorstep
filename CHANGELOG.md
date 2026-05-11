# WelcomeBnB — Changelog & Roadmap

Living document tracking what's been built, what's pending, and what to revisit.
Newest entries at the top of each section.

> **Maintenance contract:** Claude updates this file automatically at the end of every working session — Daniele does not need to ask. New "Done / Shipped" entry per round, items moved between Pending and Done as work progresses, gotchas appended whenever a recurring pattern surfaces. Daniele's only job is to push the updated file to the repo alongside the code.

---

## 🚧 Open / Pending

Things we've discussed but haven't built. Roughly ordered by leverage.

### High value, ready to build
- **Cross-property guest read leak fix** _(deferred from Round 12.1)_
  Currently any anon with the API key can read chat messages across all properties. Today's exposure is low (you have ~2 test hosts), but onboarding a paying customer makes this urgent. Real work — half a day or so. Needs either signed JWTs per guest or an Edge Function gateway.
- **Polish pass on existing analytics** _(Round 14.5, bundled)_
  - Question Gaps: stop-word list misses common Italian conjugations
  - Concierge Upsell: phrase dictionary could grow as real chats surface new intents
  - Funnel Drop-off: doesn't yet account for guests who close the tab between steps
  - Per-Guest Action Board: weight "checking out today" higher in sort

### Medium value, build when triggered
- **Year-over-year analytics view** using `analytics_monthly`
  The aggregate table is being populated; nothing currently *reads* it in the admin UI. Build a comparison view (Apr 2026 vs Apr 2025 etc.) once you have at least two seasons of data.
- **Channel manager / OTA calendar sync (Airbnb, Booking.com)**
  Surfaced during Round 15 dashboard redesign. App currently only knows about future arrivals if the guest has already started pre-checkin — biased view, not useful for "arriving this week" panel. iCal (`.ics`) integration is the right fix: parse external calendars, drop bookings into a new `bookings` table, populate a real upcoming-arrivals panel. ~4-6 hours for the first platform; long tail for handling deletions/changes/conflicts/per-host credentials. **Trigger**: first paying host who asks for it. Don't build speculatively.
- **Tracking consent flag for guests**
  Currently the guest privacy modal discloses analytics but offers no opt-out. If a guest writes asking to opt out, you'd manually skip their booking. Add a `tracking_consent` column on first session if/when this becomes a recurring request.
- **`property_type` filter in admin**
  Useful for "show me silent rates by property type" — small addition once `property_type` has been set on real properties.
- **Booking-level "do not capture" flag**
  Round 14.2 covers booking_code exclusion. If you ever need broader scope (per-property opt-out, per-host opt-out), that's a small extension.

### Watch list — not building yet
- **Supabase Pro plan ($25/mo) for backups + 7-day PITR**
  Defer until first paying host. Current data volume is low, soft-launch + audit log give a partial safety net.
- **Token-based guest auth (Supabase signed JWTs)**
  The proper fix for cross-property leak. Larger project; only worth it once volume justifies the auth flow rebuild.
- **Edge Function for chat read gateway**
  Alternative to JWTs. Same calculus.
- **Privacy page as standalone HTML**
  Currently a modal. Standalone page is more polished but defer until formalizing brand/legal infrastructure.
- **Click-through consent dialog on first guest visit**
  Overkill for legitimate-interest processing. Hurts completion. Defer.
- **Backup before next high-risk migration**
  Run an on-demand Supabase backup before any future migration that does mass DELETE. Soft-launch + dry-run preview cover most of this, but explicitly worth a checkbox.

### Recurring chores
- **Daily during soft-launch week**: check retention log each morning, ensure dry-run rows accumulate as expected
- **Weekly**: sanity-check chat_qa_pairs anonymization with the regex query (still_has_emails / booking_codes / name phrases — all should stay 0)
- **Whenever a guest writes objecting**: admin → GDPR Objections card → record booking code

---

## 📋 Done / Shipped

### Round 17 — Cache, voice, weather _(2026-05-07)_
**Three chat improvements that compound: roughly halves cost, adds two new input/context modes, no breaking changes.**

- **Prompt caching** (cost reduction). System prompt split into two blocks: a stable block (persona, app instructions, response format — ~1.5K tokens) and a variable block (property context, stay context, weather, language). The stable block gets `cache_control: { type: 'ephemeral' }` so Anthropic caches it; subsequent requests within 5 minutes hit the cache at 10% of normal input cost. Expected savings: ~50% on input tokens at current scale.
- **Voice input** (UX). Mic button in chat input bar (between 📎 and ↗). Tap to start listening, tap to stop. Live transcript appears in the input field as the guest speaks; auto-sends when the speech recognizer detects end-of-phrase. Pulsing red indicator while listening. Language follows the EN/IT toggle (`it-IT` or `en-US`). Uses native Web Speech API — free, no third-party transcription costs. Falls back gracefully on unsupported browsers (button greyed out with a tooltip explaining). Privacy note: Chrome/Edge transcribe via Google's servers; Safari transcribes locally. No audio is stored.
- **Today's weather context**. Server fetches current conditions for the property's coordinates (parsed from the Google Maps URL in property context) via open-meteo.com (free, no API key, no rate limits at this scale). Weather is injected into the variable system block as a single line. 30-minute server-side cache per coord avoids hammering the API. Sofia uses it naturally when relevant ("the rain chance is 60% today, you might want to swap the beach for the basilica"). Doesn't recite forecasts at the guest unprompted.
- **Cost projection**: 10-host realistic scenario was $4/month baseline. With caching: ~$2/month. Weather adds <$0.50/month. Voice input is free. Total: roughly half the cost with more capability.
- **Backward compat**: no breaking changes. The frontend's request shape is identical to Round 16; weather flows through automatically when the property context contains parseable coords.
- **Files**: `api/chat.js`, `index.html`

### Round 16 — Best-in-class guest chat _(2026-05-07)_
- **Model upgraded** from `claude-sonnet-4-20250514` to `claude-sonnet-4-5` (significant intelligence jump)
- **System prompt rewritten** with a persona ("Sofia"), warmth + opinion calibration, structured tone instructions, language-switch detection, and proactive escalation triggers (frustration, urgency, out-of-scope). Existing app-usage section preserved (genuinely useful — guests ask "where's the WiFi password?")
- **Stay context awareness** — `/api/chat` accepts a new optional `stayContext` field (guest name, country, group size, arrival/departure dates, total nights, day-of-stay). Frontend builds this from `wbnb_lookup` localStorage. Sofia weaves it in naturally ("Since you're on day 3 already…") instead of reciting like a database
- **Streaming responses** — typewriter effect via Server-Sent Events. Server detects/forwards only the text inside `<reply>` tags; tags themselves never reach the browser. Animated cursor (▍) blinks while streaming
- **Photo input (vision)** — paperclip 📎 button next to the input, file picker prefers camera (`capture="environment"` on mobile), 8MB cap, preview row above the input with remove button. Image sent as base64 content block alongside text. Photo accompanies one message — not retained in conversation history (keeps payload bounded)
- **Contextual followups** — system prompt now requires `<followups>` structured output with 3 suggestions in the guest's language; server parses + returns them; frontend renders as tappable chips. Empty when conversation is winding down
- **max_tokens** bumped 512 → 1024 — earlier limit was truncating good answers
- **HEIC fallback** — iOS HEIC images that fail browser canvas decoding fall back to `image/jpeg` media type for the API call
- **Backward compat**: old `{messages, propertyContext, lang}` shape still works (no `stream`, no `imageData`, no `stayContext`). Non-streaming JSON response also still returns `followups` array
- Telegram escalation notification preserved; works for image messages (shows "[image + text]" placeholder)
- **Files**: `api/chat.js`, `index.html`

### Round 15.2 — Document photo retention (30 days post-departure) _(2026-05-07)_
- Document photos now auto-deleted from the `documents` storage bucket 30 days after the guest's `departure_date`
- New `purge_old_id_photos(p_dry_run, p_days)` function deletes from `storage.objects` where bucket_id='documents' AND name matches paths in eligible checkin rows, then NULLs `id_photo_path` on those rows so the host UI shows "no photo" instead of broken-link refs
- The 5-year check-in **data** retention (TULPS art. 109 / Alloggiati Web) is unchanged — only the **image** is deleted at 30 days
- Added `photos_purged INTEGER` column to `data_purge_log`; preview + log table in admin updated to surface the count
- Daily cron (Round 12) calls `purge_old_id_photos` as part of the standard run; photos deleted only when `purge_old_data` runs in live mode (soft-launch dry-runs preview but don't delete)
- Privacy modals updated in both apps (host + guest, EN + IT) — splits the existing 5-year line into "Check-in data: 5 years" + "Document photos: 30 days post-departure". Notes Italian Garante guidance ("la legge richiede i dati, non l'immagine")
- Admin Data Retention card: new 📷 "Document photos / 30d / after guest departure (Garante guidance)" tile, renamed 🛂 tile to "Check-in data" for clarity
- Legal reasoning: TULPS art. 109 requires retention of guest data, not the document image itself. The Garante has flagged disproportionate retention of document scans in inspections. 30-day post-stay window covers the 24-hour Alloggiati filing requirement, typical 3-7 day stays, and a buffer for late filings or disputes.
- **Migration**: `migration_round15_2_photo_retention.sql`
- **Files**: `host-console.html`, `index.html`, `admin.html`

### Round 15.1 — Guest detail modal _(2026-05-07)_
- "View" button on Check-in Data rows now opens a proper modal instead of a truncated bottom-right toast
- Five sections: Stay (booking code, dates, nights), Personal details (name, sex, DOB, place/country of birth, citizenship), Document (type, number, place of issue, status), Document photo (signed URL from `documents` bucket, 5-minute expiry, click to enlarge in new tab), System (submitted at, internal id)
- Bilingual EN/IT, follows host language toggle
- Document photo loads asynchronously after modal opens — error states surface clearly if the signed URL can't be generated
- Close on click-outside, on × button, or Escape key
- **Files**: `host-console.html`

### Round 15 — Dashboard redesign as action board _(2026-05-07)_
- Replaced the host dashboard's vanity stat tiles + redundant recent-checkins table with a decision-driven action-board layout
- Two panels: 🔴 "Needs your attention" (urgent + attention-tone actions) and 🟢 "Currently staying" (active stays not already in urgent panel)
- Each panel hides if empty; if both empty, shows ✨ "You're all caught up" state
- Each row is one decision: guest name, booking code, status badge, top reco categories, action prompt — same logic as Round 11.1 Per-Guest Action Board
- Removed misleading "Alloggiati inviati" stat — the app has no signal whether the host actually filed with the police portal
- Removed misleading "22" badge from sidebar Check-in Data link (was total-ever count, not actionable)
- Dashboard subtitle changed from "Overview of your property and guests" → "What needs your attention right now"
- Decision: cut "Arriving in 7 days" panel before building it. The app only sees future arrivals via pre-checkin completion, which is structurally biased toward already-engaged guests. Fixing this requires Airbnb/Booking.com iCal integration — added to roadmap as deferred.
- **Files**: `host-console.html`

### Round 14.3 — Brand rename Doorstep → WelcomeBnB _(2026-05-06 → 2026-05-07)_
- **Day 1 (drafting)**: renamed all user-visible surfaces — CSS comments, admin export ZIP/README/filename, CHANGELOG, privacy notices. Drafted `migration_round14_3_rename_cron_jobs.sql` for the live cron rename.
- **Day 2 (deployed)**: ran the cron-rename migration in production. Live cron jobs now `welcomebnb_daily_purge` (02:00 UTC retention) and `welcomebnb_daily_qa_capture` (01:30 UTC Q&A capture). Verified via `cron.job`.
- Round 12 + Round 13 migration files updated for clean-rebuild consistency on a fresh Supabase project.
- Legacy `doorstep_*` localStorage migration code preserved as-is in `index.html` — it's a one-way upgrade for returning users with stale keys; renaming would lose state.
- **Migration**: `migration_round14_3_rename_cron_jobs.sql`
- **Files**: `index.html`, `admin.html`, `CHANGELOG.md`, `privacy_notice_round12.md`, `privacy_notice_round13.md`, `migration_round12_retention.sql` (prose only), `migration_round13_qa_dataset.sql` (prose only)

### Round 14.2 — GDPR objection flag _(2026-05-06)_
- New `excluded_booking_codes` table, admin-only RLS
- `record_qa_exclusion(code, reason, contact)` — records objection, hard-deletes existing chat_qa_pairs for that booking
- `remove_qa_exclusion(code)` — undo
- `capture_chat_qa_pairs()` updated to skip excluded codes
- Admin UI card with form + recorded-objections table + Undo
- **Migration**: `migration_round14_2_gdpr_objection.sql`
- **Files**: `admin.html`

### Round 14 — Silent guest rate + per-property engagement _(2026-05-06)_
- New helper `_r14BuildEngagement` computing per-booking buckets (silent/low/normal/high) based on stay-window events
- Admin section: platform headline tiles, distribution bars, per-property sortable table, silent-guests coaching list
- Definition: "silent" = checked-in booking with zero analytics events on/after arrival_date
- **Files**: `admin.html` (added `arrival_date`, `departure_date`, `nights` to checkins fetch)

### Round 13.1 — Privacy modals _(2026-05-06)_
- Guest app: bottom-right Privacy link above nav, fullscreen modal, EN/IT toggle
- Host console: Privacy button in sidebar footer next to Sign Out
- Both modals cover Round 12 retention + Round 13 anonymization, contact `info@welcomebnb.it`
- Data controller: WelcomeBnB
- **Files**: `index.html`, `host-console.html`

### Round 13.0.1 — Anonymizer regex fix _(2026-05-06)_
- Fixed false-positive name match: `I'm Your concierge` no longer becomes `I'm [NAME] concierge`
- Two-step regex: protect stop-words first, then match remaining capitalized words after "I'm"/"sono"/"mi chiamo"
- Stop-list covers EN/IT pronouns and common function words
- One-shot UPDATE re-anonymizes existing rows
- **Migration**: `migration_round13_0_1_anonymize_fix.sql`

### Round 13 — Chat Q&A dataset (the AI moat) _(2026-05-06)_
- New `chat_qa_pairs` table — anonymized, kept indefinitely (admin-only RLS)
- New `properties.property_type` column with smart backfill (trullo/villa/apartment/etc) and host UI dropdown
- Functions: `anonymize_text()` (regex-based), `compute_season()` (Italian tourism seasons), `capture_chat_qa_pairs()`
- Daily cron at 01:30 UTC (30 min before Round 12 purge so we mine Q&A before retention deletes anything)
- Captures: question/answer text, answered_by, escalated, language, region, property_type, season, stay_length_bucket, group_size_bucket, response times
- Admin: 📦 Download all button — bundles all legally-keepable tables into a ZIP of CSVs with README
- Privacy notice text drafted for host TOS + guest disclosure (EN/IT)
- **Migration**: `migration_round13_qa_dataset.sql`
- **Files**: `admin.html`, `host-console.html`
- **Doc**: `privacy_notice_round13.md`

### Round 12.1 — Tighten anon SELECT policy on chat_messages _(2026-05-06)_
- Replaced `Guests read chat USING (true)` with scoped policy: `property_id IS NOT NULL AND is_test = FALSE AND deleted_at IS NULL`
- Closes archived-chat leak to anon; closes test-row leak; closes NULL-property orphan leak
- Does NOT close cross-property reads — that's the deferred bigger fix
- **Migration**: `migration_round12_1_chat_select_tighten.sql`

### Round 12 — Data retention policy + automatic purge _(2026-05-06)_
- Tiered retention: chat resolved 90d / archived 30d / active never; analytics 180d (with monthly rollup); test rows 30d; soft-deleted 30d; check-ins 5y (NOT touched, fiscal requirement)
- Three new tables: `analytics_monthly` (anonymized rollups, kept forever), `data_purge_log` (audit trail), `purge_settings` (live-after timestamp)
- Functions: `aggregate_analytics_monthly()`, `purge_old_data(dry_run)`, `purge_old_data_admin(dry_run)`, `purge_old_data_cron()`, `set_purge_live_after(when)`
- **Soft-launch safety**: cron runs in dry-run mode for 7 days after deploy, auto-flips to live on day 8. Admin can shorten or extend via UI.
- Admin Data Retention card: launch status banner (soft-launch/live), Run preview button, recent purge log
- Cron schedule: 02:00 UTC daily
- **Migration**: `migration_round12_retention.sql`
- **Files**: `admin.html`, `host-console.html`

### Round 11.4.1 — Host UPDATE policy on chat_messages _(2026-05-06)_
- Bug: archive button returned "Archived 0 messages" because hosts had no UPDATE permission on chat_messages
- Added `chat_messages_host_update` policy scoped to property ownership
- JS improvement: surface clear "permissions issue, see console" message when archive returns 0 rows with no error
- **Migration**: `migration_round11_4_1_chat_update_policy.sql`
- **Files**: `host-console.html`

### Round 11.4 — Active stays filter + Archive + View archived _(2026-05-06)_
- "Active stays only" checkbox in chat panel (default ON) — hides past tenants
- 📁 Archive button — soft-deletes all messages for selected booking, fires `chat_archived` analytics event
- "View archived" read-only mode — separate query, greyed-out composer, banner with retention countdown ("Archived 12 Mar · 18 days until permanent deletion")
- EN/IT i18n keys throughout
- **Files**: `host-console.html`

### Round 11.3 — Concierge upsell value (admin) _(2026-05-06)_
- Detects bookable intents in guest chats via curated bilingual phrase dictionary (16 categories, conservative southern-Italy prices)
- Headline tiles: total demand €, guests with intent, implied 15% commission revenue
- Three breakdowns: by service, top hosts by detected demand, sample of detected intents
- Each service counts once per guest (no double-counting)
- Methodology footnote for credibility
- **Files**: `admin.html`

### Round 11.2 — Question Gaps + Funnel Drop-off (admin) _(2026-05-06)_
- **Question Gaps**: bilingual stop-word filtering, top 15 topics ranked by frequency + cross-property bonus. Cross-host topics tagged red as platform-level fixes.
- **Funnel Drop-off**: platform-wide bars (opens → starts → completed), worst-converting properties (≥5 opens) with done % color-coded
- Required adding `chat_messages` to admin parallel load
- **Files**: `admin.html`

### Round 11.1 — Per-Guest Action Board (host) _(2026-05-06)_
- Replaced old "Sessions/Events/Quota" table with card-per-guest layout
- One actionable next-step per row, sorted by urgency (urgent → attention → opportunity → routine)
- Status badges (Day N of M / Arrives in 2d / Checks out today / etc.)
- Engagement bucket (High/Normal/Low/Silent) with colored left-border accent
- Top reco categories shown as upsell hook
- Action prompts color-coded (urgent red / attention amber / opportunity green / routine blue)
- EN/IT toggle re-renders the analytics panel correctly
- **Files**: `host-console.html`

### Round 10 — Comune autocomplete validation (guest) _(2026-05-04)_
- Italian place-of-birth must match official Alloggiati comune list, validated at form-entry time (not at export)
- Searchable dropdown with green ✓ / amber "Did you mean..." / red "Pick from list" feedback
- Round 9 preposition variants integrated (handles "Castellammare Stabia" → "Castellammare di Stabia")
- Wired on initial form, doc scan auto-fill, and edit-mode review cards
- Strict validation — submission blocked when bornInItaly + not validated
- **Files**: `index.html`

### Round 9 — Alloggiati preposition variants _(2026-05-04)_
- Italian comuni indexed with both full name AND preposition-reduced variant
- Stop-list: DI/DEL/DELLA/DELLE/DELLO/DEI/DEGLI/D/DA/IN/SU/SUL/SULLA/SULLE/SULLO/SUI/SUGLI/AL/ALLA/ALLE/ALLO/AI/AGLI/E/CON
- 7,898 comuni → 8,704 index entries, 0 collisions
- **Files**: `host-console.html`

### Earlier rounds (1-8) — context only

Built before this changelog existed. Summary of major moves:
- **Round 1-2**: Per-guest analytics with booking_code attribution
- **Round 3**: Escalation counting model fix (each AI→host handoff = 1 event)
- **Round 4**: Admin host analytics + business intelligence
- **Round 5**: All Recommendations Registry
- **Round 6**: Admin login (separate `welcomebnbadmin@gmail.com` identity)
- **Round 7**: Soft-delete + test flag system across 5 tables, dropped vestigial `bookings` table
- **Round 7.1**: Admin RLS policies via `is_admin()` SECURITY DEFINER function
- **Round 8**: Drag-and-drop reordering with custom auto-scroll for `body { overflow:hidden }` shells
- **Migrations from these rounds**: `migration_admin_users.sql`, `migration_round2_soft_delete.sql`, `migration_round2_1_admin_rls.sql`

---

## 🔑 Key learnings & gotchas

Recurring patterns worth remembering across future rounds.

### Supabase RLS + GRANT gap _(hit 3+ times)_
Tables created via SQL Editor don't inherit default permissions. **RLS policies AND explicit GRANTs are both required** — silent failures otherwise.

The classic symptom: an UPDATE returns `error: null, data: []` instead of erroring. RLS filtered to zero rows; the client thinks it succeeded.

**Diagnostic to run when UPDATE behaves like a no-op:**
```sql
SELECT policyname, cmd, qual::text
FROM pg_policies WHERE schemaname='public' AND tablename='your_table'
ORDER BY cmd, policyname;
```

Make sure there's a policy for the verb you're trying to use. INSERT + SELECT policies don't grant UPDATE.

### Inline HTML onclick + JSON.stringify quotes
Silent escaping bug. Browser truncates the onclick attribute when quotes collide. Use `data-*` attributes + delegated event listeners instead.

### Native HTML5 drag doesn't auto-scroll
Custom `requestAnimationFrame` loop with document-level dragover listener required. Don't forget to find the actual scrolling ancestor — `body { overflow:hidden }` pattern means scrolling happens on an inner flex child, not window.

### Italian comune names + OCR
Prepositions (DI/DEL/IN) often elided. Index variants. Same applies to other text matching against curated lists.

### Postgres `||` in DDL
String concatenation works in `SELECT 'a' || 'b'` but NOT in `COMMENT ON ... IS '...'`. Inline the full string, no concat.

### Brand rename + live identifiers
When you rename a brand, watch out for identifiers that are *already deployed*:
- **localStorage keys**: keep a one-way migration block (returning users have the old keys)
- **Cron job names**: live in Supabase, not in code. Need a separate migration to rename, OR accept the mismatch (purely internal — nobody but admin sees `cron.job` rows)
- **Database table/column names**: most expensive to rename, would touch RLS policies, indexes, all queries. Don't rename unless absolutely necessary. Add a comment explaining the historical name.

In our case: HTML/docs renamed cleanly; cron jobnames left as `doorstep_*` until explicitly renamed via Round 14.3 migration; localStorage migration block preserved.

### Anonymization regex is never "done"
Each new pattern of false-positives (over-anonymization) gets patched as it surfaces. The security-relevant patterns (emails, phones, codes, IDs) are the priority; over-zealous name matching is a quality issue, not a privacy issue. Run sanity-check queries weekly during early operation.

### Mobile camera UX
Single `capture="environment"` file input forces camera. Splitting into two inputs (camera vs gallery) with a bottom sheet overlay gives users explicit control.

### Field visibility detection
`offsetParent !== null` is more reliable than checking `style.display` strings.

---

## 📁 Files reference

### Production HTML
- `index.html` — guest app
- `host-console.html` — host dashboard
- `admin.html` — analytics admin

### SQL migrations (apply in this order if rebuilding)
1. `migration_admin_users.sql` — admin whitelist + RLS
2. `migration_round2_soft_delete.sql` — `is_test` + `deleted_at` columns + indexes (drops vestigial `bookings`)
3. `migration_round2_1_admin_rls.sql` — `is_admin()` function + admin policies on all tables
4. `migration_round11_4_1_chat_update_policy.sql` — host UPDATE policy on chat_messages
5. `migration_round12_retention.sql` — retention policy + cron + soft-launch
6. `migration_round12_1_chat_select_tighten.sql` — anon SELECT policy fix
7. `migration_round13_qa_dataset.sql` — chat Q&A dataset + property_type
8. `migration_round13_0_1_anonymize_fix.sql` — anonymizer regex fix
9. `migration_round14_2_gdpr_objection.sql` — GDPR objection mechanism

### Documentation
- `privacy_notice_round12.md` — retention policy paragraphs
- `privacy_notice_round13.md` — anonymized dataset paragraphs
- `CHANGELOG.md` — this file

---

## How to update this file

**At the end of each working session**, add a new entry under the relevant Round heading in `## 📋 Done / Shipped`. Format:

```
### Round XX — Short descriptive title _(YYYY-MM-DD)_
- Bullet 1: what changed
- Bullet 2: any non-obvious decision or trade-off
- **Migration**: `filename.sql` (if any)
- **Files**: `file1.html`, `file2.html`
```

For pending work that comes up, add to `## 🚧 Open / Pending` under the right priority bucket. Move items from there to `## 📋 Done / Shipped` once they're shipped.
