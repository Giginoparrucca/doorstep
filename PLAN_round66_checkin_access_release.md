# Round 66 — Release entry instructions after completed check-in

Requested by Daniele on 26 October 2026 after two hosts asked to withhold entry codes until online check-in is complete.

Status: confirmed and in progress. Daniele approved concurrent development alongside Round 65 on 26 October 2026. Phase 1 is claimed by GPT on `codex/round66-checkin-access`; the first isolated policy/test foundation is tracked in PR #207. No feature activation, operational roster/override or completed phase is claimed. Preserve Round 63 ownership/provider gates and Round 65 security ownership. See CHANGELOG and `docs/entry-release/INTEGRATION.md` for precise delivery evidence and remaining integration.

## Outcome and host setup

Add a per-property setting in the existing access/check-in settings:
**Show entry instructions only after check-in is complete**.
Italian: **Mostra le istruzioni di accesso solo dopo il completamento del check-in**.

Default OFF for existing and newly created properties; hosts opt in deliberately. OFF preserves existing visibility rules, not unrestricted public access.
Use existing page-wide View/Edit/Save and unsaved-change protection.

When ON:
- Withhold the protected entry instructions, fixed lockbox code, rotating/per-booking code and assigned room door code until the booking qualifies.
- Keep address, directions, recommendations, contact/support and the check-in form usable. Wi-Fi keeps its existing policy unless it is embedded in protected access text.
- Offer an optional **Release from [time] on arrival day** setting. It defaults disabled. Use an explicit property IANA timezone, not the browser/device timezone. If none is available, require a valid property timezone before enabling time restriction.
- Show concise guidance that entry secrets belong in the protected access fields. General welcome text, recommendations, attachments or house rules must not contain duplicate codes. Automated scanning cannot guarantee discovery of arbitrary secret-bearing prose.
- Before activation, show which existing access fields will be protected and require the host to review other published content. Do not silently move/delete existing text or pretend old messages/cached codes can be recalled.

No smart-lock integration, automatic hardware code changes, payment prerequisite, identity-verification service or mandatory host approval is added. No change to Alloggiati, regional reporting, tourist-tax calculations, OTA imports or filing acceptance.

## Booking completion and authorization

Use a single server-side decision shared by every access delivery path.

1. Resolve a valid guest session to its authoritative property and booking identity. Browser-supplied property IDs, status, timestamps, guest totals, room IDs or completion flags cannot grant access.
2. Require every required guest in that booking, including companions/minors under current check-in rules, to have a successfully persisted, valid submission. Do not require documents that existing rules exempt. A photo is required only where current check-in configuration requires it.
3. Use the authoritative expected guest roster/count, not the count of already inserted rows. Guest-entered party size cannot reduce a known reservation/host total. Deduplicate retries by stable guest identity/slot, not name matching.
4. Where current data cannot establish an authoritative expected roster, add a persisted server-validated booking roster/completion contract; do not default unknown total to one. Hosts can correct the roster or release access manually. Standalone/share-link bookings must be supported without requiring an OTA reservation.
5. Partial multi-guest saves, draft/reopened incomplete records, invalid submissions and unknown/ambiguous booking/room resolution do not qualify. Failed/partial reads fail closed with retry/support guidance.
6. Completion is independent of Alloggiati submission, police receipts, regional exports and tourist-tax payment. A provider outage cannot prevent access after valid online check-in.
7. If the optional time restriction is active, the property-local arrival date/time must also have been reached. Re-evaluate server-side after arrival/date/timezone/policy changes; store absolute audit instants in UTC. Test DST transition behavior.
8. Cancelled/deleted/invalid bookings, expired/revoked guest sessions and other tenants never qualify, including with an old manual override. Honor the existing stay/session validity window; do not broaden it.

Re-evaluate on each sensitive fetch. Successful completion refreshes access immediately; guest page focus/resume and a modest visible-page refresh around the release time detect changes without requiring a new link or cron. Do not persist an irreversible automatic unlock flag.

## Host exception

On the booking/check-in detail show:
- **Locked — check-in incomplete**, with submitted/expected count when known;
- **Scheduled — available from [local date/time]**;
- **Available — check-in complete**, or **Released manually**;
- An explicit unavailable/needs-review state for unknown roster, room or read errors.

Provide **Release entry instructions** for the authorized property host. Explain in the action that it bypasses check-in and release-time requirements for this booking. Require an explicit host action, not a guest-triggered mutation.
Persist an idempotent booking-scoped override with actor, timestamp and nonsecret audit reason; audit failure blocks the override. Reuse host authorization and existing audited admin impersonation rather than adding a guest/admin bypass.
Allow **Restore automatic release** with clear wording that previously viewed codes cannot be forgotten. Audit changes without recording actual codes. Overrides must not transfer to a different booking when codes, dates or reservation links change.

Editing/removing a required guest or increasing the expected roster returns automatic access to locked until complete; unrelated valid corrections do not. Restoring automatic policy does not rotate physical codes.

## Guest experience (IT and EN)

| Server state | Guest presentation |
|---|---|
| Incomplete | “Complete online check-in to view your entry instructions.” / “Completa il check-in online per visualizzare le istruzioni di accesso.” + Complete check-in / Completa il check-in |
| Complete, too early | “Your entry instructions will be available on [date] at [time].” / “Le istruzioni di accesso saranno disponibili il [date] alle [time].” Show property-local time clearly. |
| Eligible/manual release | Show only this booking's permitted access instructions and correctly assigned room code. |
| Read error/unknown roster | Clear retry/contact-host path; no code, no fabricated completed state. |
| Cancelled/expired | Existing invalid-link/stay-expiry behavior; no entry information. |

Locked content is never sent to the device. No blurred code, hidden DOM element, masked full value in attributes, premature copy button or secret-bearing accessibility label.
Retain public help/contact while locked. Mobile/desktop, language changes, multiple tabs, refresh and booking/property switching must show the same authoritative state.

## Server enforcement and existing-code integration

Implementation entry points to verify against current main:
- api/guest.js: property projection, checkin read/insert/update responses, room resolution and rotating-code side effects. Current bookingHasCheckin/hasCheckin semantics are insufficient for ON.
- PROPERTY_PUBLIC_FIELDS / PROPERTY_POST_CHECKIN_FIELDS and CHECKIN_READ_FIELDS: keybox_code and door_code must be filtered in every response, including insert/update responses.
- index.html: guest access cards, localized instructions, booking cache, welcome-back flow, companion submission and focus/resume handling.
- api/chat.js and its context/tool loaders: use the same server-authorized access projection. Never accept client propertyContext/stayContext as authority for entry secrets.
- host-console.html and its services: existing fixed/rotating/per-guest settings, room codes, booking actions and page-wide save.
- Database RPCs/grants and migrations: get_reservation_keybox and any legacy direct access paths must not bypass the gate. Coordinate with Round 65 security changes; rebase and inspect their final implementation.
- Share links/QR, reminders, generated messages, exports, chat history, host escalation replies, guides and test/demo paths: inventory every guest-accessible delivery route.

Separate safe public arrival content from protected entry content in storage/projections where needed; reuse dedicated fields rather than duplicating secrets. The final migration and exact field names are implementation decisions, not existing capabilities.

Exclude protected content from model prompts/tools while locked. Filter secret-bearing historical conversation content before browser/model delivery; it must not become an alternate retrieval route. Guest-supplied instructions/forged contexts cannot unlock access. A regex response filter alone is insufficient.

Do not place secrets in logs, analytics, notification previews, URLs, public assets or reusable Q&A datasets. Use private/no-store responses and clear relevant legacy browser caches on upgrade, booking switch and state change; no service-worker/localStorage persistence of protected codes. Already delivered messages or codes cannot be retrospectively secured.

Preserve existing fixed/rotating visibility switches and code precedence: release eligibility does not reveal a code the host otherwise disabled. Generate/stamp rotating codes idempotently per booking under existing rules, but never return them early. Never rotate a live physical code merely because the visibility policy changed. Ambiguous room assignments return no room-specific code; no “first room” fallback.

## Phases and test gates

| Phase | Deliverable | Required evidence |
|---|---|---|
| 1 — Authoritative policy and protected delivery | Inventory all delivery paths; booking roster/completion contract; property settings persistence, time policy, audited override and shared server projection. Keep ON unavailable until every exposure route is protected. | Real handler/RPC tests with two properties/bookings, anonymous/forged/expired sessions, read/audit failure, partial submissions, retries/concurrency, expected-roster manipulation, companions/minors, reopened/deleted records, cancelled bookings, room isolation and every code response path. Clock-controlled timezone/DST/boundary tests and override permissions/idempotency. Existing OFF behavior preserved. |
| 2 — Host and guest interface | Opt-in settings, booking status/override, locked/scheduled/released cards, immediate completion refresh, resume/time refresh, localized help and cache migration. | Actual browser journeys IT/EN at desktop/mobile: OFF baseline; 1-of-3 locked; final guest unlock; time restriction; host release/restore; roster/date changes; reload/back/second tab/property switch; offline/error/support. Network/DOM/storage assertions prove codes absent before release. Save/cancel/unsaved-changes behavior and fixed/rotating/room precedence verified. |
| 3 — Integrated release and guides | AI/messages/history protection verified end-to-end, host guide and setup help updated, rollout and rollback rehearsed. Publish complete release evidence. | Adversarial AI requests and forged contexts, old chat/code retrieval, direct RPC/API and preview/demo routes, generated messages/QR links, stale-cache and concurrent policy edits. Byte/source verification of deployed assets; read-only production smoke and schema-drift evidence. No real guest/codes/portal calls in fixtures or published records. |

Every implementation phase runs npm run test:all plus its specific checks; new tests join the full suite. Record pass/fail/skip totals and reasons in CHANGELOG. Red suites block merge. New migrations require production schema-drift RPC evidence before shipped status. After deployment run npm run test:live and distinguish synthetic, authenticated hosted and read-only smoke evidence; no simulated result is a live pass.

Phase 1 backend delivery must stay compatible with existing clients and keep activation unavailable until the complete gate and UI ship. Claim each phase in CHANGELOG before implementation; preserve other round ownership. The new-round recap/confirmation gate was satisfied on 26 October 2026; do not request confirmation again to resume this Round. No owner action, new provider account or additional service cost is expected beyond hosts choosing to enable the setting.

## Rollout, rollback and acceptance

Existing settings/data remain intact and OFF preserves current behavior. Validate in isolated fictional fixtures before production; do not auto-enable pilot hosts.

Done means a host can opt in, see why a booking is locked, release manually when necessary, and the guest receives the right entry information only after the shared server policy permits it. All required guests and optional arrival time are enforced across browser/API/AI/message routes.

Rollback must preserve the restriction for opted-in properties: roll back UI/activation while retaining the secure server boundary, or hold access closed with host support. Reverting to an old backend that leaks codes is not an acceptable rollback. Preserve submission data, audit history, existing live codes and unrelated compliance/calendar functionality.

## Documentation-only publication record

26 October 2026 — GPT: plan prepared and queued after Round 65; no implementation, schema migration, host activation or runtime test claimed. Checks for this delivery: Markdown structure, roadmap link, unique round numbering and publication read-back. Next step: implement only after the new-round gate, coordinating with Round 65 security work.
