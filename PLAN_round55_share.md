# Round 55 — Booking sharing and printable property QR

## Outcome and boundaries
Share existing reservations, not unbound codes. One booking/group retains one
stable link. House QR uses only the property URL on the environment's canonical
origin. No link rotation, booking-code changes, automatic guest messaging,
changes to guest access controls or alteration of existing booking/check-in data.
Round 51 remains paused; preserve its ownership and history.

## Phase 0 — Specification
Publish this specification and CHANGELOG table before implementation.

## Phase 1 — Booking-based sharing
Replace standalone code generator, browser-only recent codes and detached
message template with an existing-reservation selector and shared composer.
Default to active/upcoming stays, with an explicit all-bookings filter. Load
owner-scoped, nondeleted active reservations (exclude blocks, covered echoes and
production test rows), page results, and show errors/retry and empty states.
Preserve original booking/property IDs. Use the existing verified code-assignment
path only for reservations without a code. Expose copy link/open app plus a basic
editable message/copy action. Dashboard and calendar open this same panel with
the original reservation selected, including checked-in bookings without an OTA
row where an existing check-in booking code is available. Never invent a stay.
Handle property switches and stale asynchronous responses. Update the bilingual
guide at each UI change; keep guest test preview and permanent property QR.
Gate: actual module/DOM interactions in IT/EN, property/booking isolation,
blocked/test/cancelled/covered exclusions, pagination/error/retry/empty states,
stale responses, missing-code assignment, dashboard/calendar entry wiring,
clipboard failure, legacy standalone removal; environment, calendar and onboarding
regressions. Publish, merge and verify exact served module/HTML/config before phase 2.

## Phase 2 — Status-aware messages and host defaults
Determine registration from submitted, nondeleted check-ins for the selected
property/booking. Known group count + fewer submitted => partial; enough =>
complete; no expected count => registration received, never assume whole group
complete. Reopened check-ins require completion again. No submissions => start.
Prepare IT/EN messages using guest name, property, arrival, canonical link and
status. Language is independently selectable and remembered per property.
Editable per-booking drafts stay in memory, never persist guest content in host
defaults. Preserve edits across refresh/language/booking switches. Explicit reset.
Add optional private property defaults keyed by language/status, with validated
placeholders; save only the generic template, never a rendered guest message.
Use a minimal owner-scoped preference table/RLS; no service credentials in UI.
WhatsApp opens the reviewed message in a compose window (no automatic send and
no guessed phone); copying/opening must never claim delivery. Existing host
arrival digest links to the same selected-booking share flow.
Gate: actual status/model/message/DOM tests, missing group count, cross-property
and deleted/test rows, draft/default separation, IT/EN persistence, placeholder
validation, edits preserved, WhatsApp encoding/no send, migration/RLS probes
(owner, other owner, anon), failure feedback; prior regressions. Publish, merge,
verify served source and hosted schema before phase 3.

## Phase 3 — Printable house QR and integrated release
Dedicated property QR (never the selected guest link) with print, SVG download
and copy link. Print a clean A4 page with property name, large black/white QR,
bilingual invitation, canonical fallback URL; no booking code, test flag,
credentials or lockbox details. Print uses a same-origin document with scoped
print styles, visible print/cancel actions and no unrelated dashboard content.
Handle blocked windows/QR or clipboard failures honestly. QR payload stays
unchanged when selecting another guest. Keep preview separate.
Update bilingual guide, Italian presenter source/PDF and cache versions.
Gate: real QR SVG payload, print layout/SVG/download/copy tests, malicious property
name escaping, production/demo origins and property switch, mobile wrapping;
render print PDF and visually inspect. Run combined Round 55 and relevant
regressions. Publish, merge and compare live files/config to tested sources.

## Release and rollback
Each phase must pass its gate and production verification before the next.
Record PR/main commit and evidence in CHANGELOG; no live guest messages or
production guest-data writes for tests. Roll back a phase by reverting its source
commit. The optional preferences table may remain unused; removing it requires
preserving host defaults. Separate demo code release uses its isolated project
only if needed; do not claim it from local demo regression alone.
