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
- **Multi-language strategy beyond EN/IT** _(flagged Round 19)_
  Currently the guest app supports only EN/IT toggle. Real Italian B&Bs receive guests from France, Germany, Spain, the Netherlands, Eastern Europe, etc. — most read English fine, but not all. Three approaches worth considering when this surfaces as a real need:
  - **Pre-translate at save time**: host writes once, app calls Claude to fill in 4-5 other languages, stored as JSONB column. Host can review/edit. ~$0.005 per property edit. Zero runtime cost. Best UX for guests; some host friction.
  - **On-demand translation in guest app**: a small "translate" button on each text section calls Claude. Cheap (~$0.001 per click), but every guest re-pays the cost. Adds latency.
  - **Browser-native translate hint** (current approach): zero cost, zero risk, but discoverability is poor and trust is uneven for safety-critical instructions.
  Right call probably hinges on whether non-EN/IT guests become >10% of volume. Worth measuring before building. **Trigger**: when a host explicitly asks, or when we see French/German/Spanish browser-language sessions hitting >15% in admin analytics.
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

### Round 19.5 — "Preview as guest" + bulk-purge of untagged test events _(2026-05-29)_
**Two-part fix for the "I just tested my app and now I have garbage analytics" problem.**

#### Part 1 — Preview as guest mode (going forward)
- Guest app reads `?test=1` from URL at module load → sets `IS_TEST_SESSION` flag
- Both `trackGuest()` and `trackGuestBeacon()` set `is_test: true` on every event when the flag is on
- A fixed top-of-screen banner appears: "🧪 Preview mode · your activity is not being tracked" with an Exit button that reloads without the param
- Host console has two entry points to launch test mode:
  - **Property settings**: "🧪 Preview as guest" button next to Save
  - **QR & Links panel**: dedicated dashed-border card under the apartment QR
- Both call `openPreviewAsGuest()` which opens `https://welcomebnb.vercel.app/?p={propertyId}&test=1` in a new tab
- **Threat model considered**: a guest could append `?test=1` themselves to disable tracking. Stakes: low (worst case = one guest's events go uncounted, no data leak / no fraud). Decided lax over signed-token approach to keep UX simple.
- Bilingual EN/IT for all new strings and the banner text.
- **Fixup (same day)**: Exit button on the test banner originally reloaded without `?test=1`, which spawned a normal tracked guest session — exactly what test mode was meant to avoid. Now `exitTestMode()` calls `window.close()` (works because the tab was opened by `window.open()` from the host console). For the edge case where the user reached the URL another way (bookmark, manual edit) and `window.close()` is silently blocked, it falls back to replacing the document with a static "Test mode ended" page that doesn't run any tracking code.

#### Part 2 — Bulk-purge of pre-existing untagged test events
- `migration_round19_5_purge_untagged_tests.sql` — three-step SQL: **preview**, **tag**, **delete** (each commented separately so you can stop after preview if counts look off)
- Heuristic for "looks like test data": session_id that never produced a `guest_checkin_completed` event AND has no `booking_code` AND is >24h old. Also catches events from any booking_code already in `host_dismissed_bookings`
- 24-hour gate intentional: prevents catching a real anonymous guest currently using the app
- Tagging (Step 2) sets `is_test = true`. Reversible. Hard-delete (Step 3) is optional and only after verifying the tag looked right.

- **Files**: `index.html`, `host-console.html`, `migration_round19_5_purge_untagged_tests.sql`

### Round 19.4 — Host-dismissed bookings (hide test/junk from dashboard) _(2026-05-29)_
- **Need**: hosts test their own apps and accumulate fake bookings (TRU-NJYVD7, etc.) that clutter the action board long after testing. They asked for self-service hiding without needing admin.
- **Design choice (kept separate from `is_test`)**: a host saying "this booking isn't real to me" is conceptually different from a developer saying "exclude this row from analytics". Mixed concepts muddle both. So this is a new table `host_dismissed_bookings` (host_id + property_id + booking_code + dismissed_at + optional note), strictly separate from `is_test`. RLS scopes everything to the calling host.
- **Schema**: `migration_round19_4_dismissed_bookings.sql` — table + composite UNIQUE + RLS for SELECT/INSERT/DELETE (no UPDATE; restore = delete then re-add) + explicit GRANTs (avoiding the recurring RLS+GRANT gotcha).
- **Action board UX**: small 🗑 button in the top-right of each card → confirm dialog showing name + code → insert into table → card disappears. Filter applied in both the dashboard render and the Guest Analytics per-guest breakdown.
- **Settings UX**: new "Dismissed bookings" card in property settings showing each dismissed code + date + Restore button. Restore confirms, deletes the row, refreshes both views.
- **State management**: module-level `dismissedBookingCodes` Set populated by `loadDismissedBookings()` on property load and after every dismiss/restore. Renderers consult the Set inline (cheap O(1) lookup).
- **Bilingual EN/IT** for confirm dialogs, toasts, button labels, empty-state messages.
- **Files**: `host-console.html`, `migration_round19_4_dismissed_bookings.sql`

### Round 19.3 — Admin RLS UPDATE policies (mark-test / soft-delete buttons) _(2026-05-29)_
- **Bug**: clicking 🧪 (mark as test) or 🗑 (soft delete) on any row in the admin event log returned the toast *"No row updated — RLS may be blocking. Check admin policies."*
- **Root cause** (textbook recurrence of the RLS+GRANT gap from CHANGELOG gotchas): `analytics_events` had SELECT/INSERT policies but no UPDATE policy for `authenticated`. The Supabase update returned `data: []` with `error: null` — Supabase's signature for "RLS filtered the row out of the writable set."
- **Fix** (`migration_round19_3_admin_rls.sql`): adds `*_admin_update` RLS policies + scoped `GRANT UPDATE (is_test, deleted_at)` on five tables — `analytics_events`, `chat_messages`, `checkins`, `recommendations`, `properties`. Admin can flag/soft-delete but cannot tamper with payload columns.
- **Security note**: policies are permissive (any authenticated user can flag/soft-delete any row). Acceptable at current scale (single admin, gated admin page). When multiple non-admin users exist, swap to role-based policies or move admin writes to `SECURITY DEFINER` functions checking a role flag.
- **Bonus**: migration includes a commented-out one-time hard-delete block for clearing all `is_test = true` rows, with a preview query to run first. Useful for cleaning house after testing.
- **Files**: `migration_round19_3_admin_rls.sql`

### Round 19.2 — Home page density pass _(2026-05-29)_
**Feedback on Round 19.1**: too much vertical scrolling; host message buried; could pack info side-by-side. All correct.

- **Host welcome message moved above the sections** — sits directly under the hero. First thing the guest reads is "hello from your host", before any practical info.
- **Address row packed horizontally**: address text on the left, "Directions" button on the right of the same row. Was previously stacked (button below). Button label shortened from "📍 Get Directions" → "Directions" for the inline context. New `maps_btn_short` i18n key (EN + IT).
- **Check-in row packed horizontally**: time + access method on the left, lockbox code chip on the right of the same row. The chip is compact (label + monospace code stacked vertically inside a tinted box). Was previously a full-width row below the time. Lockbox label shortened "Lockbox code" → "Code" since the context (chip with monospace code) makes the meaning obvious.
- **WiFi + Emergency in a two-column grid** inside Staying. Both cards are small content (label + value) so stacking wasted space. New `.home-card-grid` (2-col) + `.home-card-compact` modifier. Wifi password gets `word-break: break-all` so a long password wraps inside its column rather than overflowing.
- New `.home-card-row-split` modifier handles wrap-on-narrow: at standard mobile widths (≥360px) everything fits horizontally; on very narrow viewports the trailing element (CTA or chip) wraps below cleanly via `flex-wrap`.
- **No collapsibles** — density was the right lever. Collapsibles trade scrolling for taps, and mobile guests are more likely to miss collapsed content than to mind a small amount of scroll.
- All existing IDs retained — JS unchanged. Pure markup + CSS restructure.
- **Files**: `index.html`

### Round 19.1 — Home page restructure: three sections _(2026-05-29)_
**Feedback from Round 19**: the new instruction cards just added another piece of info to the page rather than being thoughtfully integrated. "How to find us" was separate from the address card and the check-in time card despite being conceptually the same thing. Same for departure info.

- **New structure**: three semantic sections — **🛬 Arriving**, **🏡 Staying**, **👋 Leaving** — each with a small uppercase header above its cards. Cards related to the same activity now sit together visually and conceptually.
  - **Arriving** = Address (with map link) + Check-in (time, access method, lockbox code, instructions all in one card) + Host welcome message
  - **Staying** = WiFi + Emergency
  - **Leaving** = Check-out (time + instructions in one card)
- **Removed redundancy**: instructions are no longer their own cards. They're appended inside the relevant check-in or check-out card, separated by a thin divider. The lockbox code is a tinted chip inside the check-in card.
- **New unified CSS system**: `.home-section` + `.home-section-header` + `.home-card` with consistent row layout (icon + label + value + sub + optional CTA). Replaces the old mix of `.quick-grid` / `.quick-card` / `.host-message` / `.instruction-card` / `.emergency-card`. Visual rhythm is more consistent.
- **Hero preserved** as you asked.
- All existing IDs retained (`#wifiName`, `#checkinTime`, `#lockboxCodeRow`, etc.) so the property loader and `refreshLockboxDisplay()` work unchanged. The two old wrapper IDs (`#checkinInstructionsCard`, `#checkoutInstructionsCard`) no longer exist; the loader and refresh helper were updated accordingly.
- Bilingual EN/IT for the three section titles and the new card labels.
- **Files**: `index.html`

### Round 19 — Check-in/out instructions + per-guest lockbox codes _(2026-05-29)_
**Two host-requested capabilities. The lockbox toggle is opt-in to keep existing behavior unchanged.**

- **Check-in / check-out instructions**: two free-text fields on the property (`checkin_instructions`, `checkout_instructions`, 800 chars each). Shown on the guest's Home tab in two new cards ("How to find us" / "When you leave"). Cards hidden if empty. Plain text only — host writes in their preferred language; the form hint reminds them guests can use browser-native translate (long-press iOS / three-dot menu Android) if needed. Whitespace preserved via `white-space: pre-wrap` so the host's line breaks survive intact.
- **Per-guest lockbox codes (opt-in)**: new boolean column `properties.use_per_guest_lockbox` (default `false`, preserves existing behavior). When the host toggles it on, the guest detail modal exposes an editable lockbox-code field with two buttons: **🎲 Generate** (random 4-digit code) and **Save** (writes to `checkins.keybox_code`).
- **Resolution logic on the guest side**: new `_resolveLockboxCode(propData)` picks per-guest code from the head-of-family's `checkins` row when the toggle is on; falls back to `properties.keybox_code` if the per-guest field is blank. Lockbox row in the Home card is hidden if no code is configured anywhere.
- **Refresh hooks**: lockbox display refreshes after every `existingCheckins` assignment (welcome-back lookup, surname lookup, in-app lookup) since the per-guest code depends on knowing who the guest is.
- **Schema**: `migration_round19_instructions_lockbox.sql` adds three columns to `properties` (`checkin_instructions`, `checkout_instructions`, `use_per_guest_lockbox`) and one to `checkins` (`keybox_code`).
- **Bilingual EN/IT** for all new host-facing labels, hints, modal text, and guest-app card titles.
- **Files**: `host-console.html`, `index.html`, `migration_round19_instructions_lockbox.sql`

### Round 18.4 — Per-property PayTourist portal URL _(2026-05-07)_
- **Problem**: the PayTourist export card hardcoded `https://bari.paytourist.com/admin/ps/import`. PayTourist runs one subdomain per comune (bari, lecce, matera, …), so the link was wrong for any property outside Bari. (Note: the 403 the host saw was a PayTourist-side WAF block, not a WelcomeBnB bug — but it surfaced the real hardcoding issue.)
- **Fix**: new optional `paytourist_url` column on `properties`. New "PayTourist portal" field in property settings — the host enters their municipality's subdomain.
- `normalizePayTouristUrl()` accepts any of: bare subdomain (`bari`), hostname (`bari.paytourist.com`), or full URL — normalizes all to `https://{sub}.paytourist.com/admin/ps/import`. Rejects garbage input.
- Export card link is now built dynamically and refreshes live as the host types. When no portal is configured, the link is hidden and a hint tells the host to set it in property settings — better than a link to the wrong municipality.
- The PayTourist CSV export itself is unchanged — it always worked regardless of the portal URL; this only drives the convenience link.
- Bilingual EN/IT for the new field, hint, and "not set" message.
- **Migration**: `migration_round18_4_paytourist_url.sql`
- **Files**: `host-console.html`

### Round 18.3 — Fix Alloggiati country-code resolution for missing countries _(2026-05-07)_
- **Bug** (spotted on a real Mauritius-passport group of 3): Alloggiati export warned "couldn't resolve birth country 'Mauritius' to a 9-digit code" for every guest from Mauritius.
- **Root cause**: country resolution is a two-step lookup — `COUNTRY_ALIASES` (English name → official Italian name), then `ALLOG_STATI` (Italian name → 9-digit code). Mauritius IS in `ALLOG_STATI`, but under its Italian name "MAURIZIO" (code 100000438). `COUNTRY_ALIASES` had no `'MAURITIUS'` entry, so the English name never got translated and the second lookup missed.
- **Fix**: added ~70 country entries to `COUNTRY_ALIASES`, covering Africa, South/Southeast Asia, Middle East, Latin America, the Balkans, and the Caucasus — the map previously stopped at major Western countries, so any guest from a smaller country hit the same wall.
- **Also caught 3 pre-existing silent failures** via a validation script that checks every alias target exists as a real `ALLOG_STATI` key:
  - `'SOUTH AFRICA'` mapped to `'SUD AFRICA'` (two words) but `ALLOG_STATI` has `'SUDAFRICA'` (one word) → South African guests were failing
  - `'RUSSIA'` mapped to `'RUSSIA'` but `ALLOG_STATI` key is `'FEDERAZIONE RUSSA'` → Russian guests were failing
  - `'SLOVAKIA'` mapped to `'SLOVACCHIA'` but `ALLOG_STATI` key is `'REPUBBLICA SLOVACCA'` → Slovak guests were failing
- All 195 alias entries now validated to resolve to a real 9-digit code. End-to-end tested: Mauritius → 100000438, South Africa → 100000454, Russia → 100000245, Slovakia → 100000255.
- **Files**: `host-console.html`

### Round 18.2 — Fix comune validation firing for foreign guests _(2026-05-07)_
- **Bug** (spotted on a real French-passport check-in): place-of-birth "PARIS" showed a red "pick a city from the list" error, and place-of-issue got auto-matched to "San Francesco al Campo (TO)" — a random Italian comune fuzzy-matched against foreign text. Italian comune validation was firing for a guest born in France.
- **Root cause**: `showStatus()` (hint), `refreshComuneValidation()`, and `renderResults()` (the dropdown panel) all resolved every value against the Italian comune list unconditionally, with no check on whether the guest was born in Italy.
- **Fix**: new helper `_comuneValidationApplies()` reads the birth-country field; comune validation is suppressed entirely when the guest is foreign-born. Guarded all three functions: hint text, fuzzy resolution, and the dropdown panel. Foreign guests see place-of-birth and place-of-issue as plain free-text fields.
- **18.2.1 follow-up**: the dropdown *panel* was still rendering ("No match" + stale comune rows) even after the hint text was fixed — `renderResults()` wasn't guarded, and a panel rendered mid-scan (before birth country was set) lingered. Fixed by guarding `renderResults()` and having `refreshComuneValidation()` force-close all `.comune-autocomplete-panel` elements when validation doesn't apply.
- `onBirthCountryChange()` no longer copies a foreign `birthplace` into `docissue`; auto-fill from birthplace only happens when born in Italy. It also re-runs comune validation on both fields when born-in-Italy status changes, so stale hints/panels clear.
- The submit gate (`checkinNext`) was already correct — only enforced comune validation for Italian-born guests — so foreign guests were never blocked from submitting; the bug was cosmetic only.
- **Files**: `index.html`

### Round 18.1 — PDF support for check-in document scan _(2026-05-07)_
- Guests can now upload a **PDF** of their passport/ID for check-in scanning, not just images. Common because agencies email documents as PDF and some government portals only export PDF.
- Gallery/file picker `accept` widened to `image/*,application/pdf` (camera input stays image-only — a camera can't produce a PDF)
- `fileToBase64()` is now PDF-aware: images still get canvas-resized to 1200px wide; PDFs are read raw as base64 (can't go through an `<img>` element, and Anthropic reads PDFs natively)
- `scanDocument()` detects PDF by mime type / `.pdf` extension and sends `is_pdf: true` + `media_type: 'application/pdf'`
- `/api/scan-document` builds a `document` content block for PDFs (vs `image` block for images) — Claude renders + OCRs PDF pages natively, no client-side conversion needed. Extraction prompt unchanged + one line added for multi-page docs
- Model on the scan endpoint bumped `claude-sonnet-4-20250514` → `claude-sonnet-4-5` (was still on the old string)
- **Files**: `api/scan-document.js`, `index.html`

### Round 18 — Guest cache validation against DB _(2026-05-07)_
- **Real scenario**: a guest checked in as solo traveller but was actually a group of 9. Host deleted her checkin row in the console, but on refresh she still saw herself as the main guest. Cause: her browser had cached identity in `wbnb_lookup` localStorage, and the deletion (hard or soft) wasn't being detected client-side.
- **Fix**: on every app open, run a tiny indexed query against the DB before trusting any cache:
  - If guest has `?b=CODE` in URL → query `checkins` count where `booking_code = CODE AND property_id = X AND is_test = FALSE AND deleted_at IS NULL`
  - Else if guest has cached `wbnb_lookup` (surname + arrival_date) → query the same predicate via surname + date
  - If the count is explicitly 0 → host has reset this guest; clear `wbnb_lookup` and `wbnb_booking` from localStorage and flag `_wbnb_show_reset_toast = true`
- **UX**: at end of init, if the reset flag is set, show a top-of-screen toast ("Your booking has been updated. Please check in again." / IT equivalent) plus drop a system message into the chat feed. 6-second auto-dismiss.
- **Cost**: one extra Supabase query per app open, ~30-80ms. Free at our scale; eliminates a real bug class for hosts (no more "send guest a new link" workaround).
- Validation is best-effort: network errors during validation don't block the app, just log a warning.
- Works for both hard delete (`.delete()`) and soft delete (`.deleted_at`) since we filter on both `is_test = false` AND `deleted_at IS NULL`.
- **Files**: `index.html`

### Round 17.1 — Chat input bar polish (mobile) _(2026-05-07)_
- Mobile chat had 5 stacked UI rows in 200px (input controls + Powered by + Privacy floating + bottom nav). Sofia's send button was visually colliding with the Privacy badge, photo/mic buttons were too big, input field was getting squeezed.
- **Pill input layout**: 📎 and 🎤 buttons now sit *inside* the rounded input field on the left (smaller, 32px, no border, hover state). Field grows to fill horizontal space. Send button stays outside as the visual anchor on the right.
- **"Powered by WelcomeBnB" watermark hidden on chat tab** — kept on Home/Check-in/Rules/Explore where there's vertical room. Body class `tab-chat` toggles via `goTo()`. Smooth fade transition.
- **Privacy floating button hidden on chat tab** — was overlapping the send button. Still accessible from every other tab.
- Input bar padding tightened (10/16 → 8/12); send button shrunk slightly (42 → 38) to feel proportional with the smaller inline icons.
- No JS logic changes — purely structural/CSS. Voice and photo features work identically.
- **Files**: `index.html`

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

### Validation that should be conditional often isn't
Twice now (Round 13.0.1 anonymizer, Round 18.2 comune validation) a validation/transformation ran unconditionally when it should have checked context first. The comune autocomplete fuzzy-matched foreign cities against the Italian municipality list and "found" wrong matches. Pattern to watch: any fuzzy matcher or validator that runs on every input should first ask "does this validation even apply to this case?" — gate it on the relevant context flag (born-in-Italy, language, guest type) before doing the work.

### Two-step lookup tables silently fail when the link breaks
Round 18.3: country resolution chains two maps (English→Italian name, then Italian name→code). If an entry is missing from the first map, or the first map's output doesn't EXACTLY match a key in the second, the lookup silently returns nothing — no error, just a warning at export time. Three countries (South Africa, Russia, Slovakia) had been broken this way for an unknown period because the alias value didn't match the official `ALLOG_STATI` key spelling ("SUD AFRICA" vs "SUDAFRICA", "RUSSIA" vs "FEDERAZIONE RUSSA"). Lesson: whenever two lookup tables are chained, write a validation script that confirms every value produced by the first table is a real key in the second. Run it after any edit to either table. The script lives inline in the Round 18.3 dev notes — it parses both objects out of the HTML and cross-checks all 195 entries.

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
