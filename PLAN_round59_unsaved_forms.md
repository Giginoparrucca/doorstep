# Round 59 — Centered prompts and consistent unsaved-form protection

## Phase 1 — implementation, verification and release

Center the save-before-leaving dialog in the viewport, including scrolled mobile
and desktop layouts. Keep accessible dialog focus/Escape behavior and responsive
height/width. Use a shared guard across editable host-console tabs: Property,
Settings (tax rules, feeds and reminders), Rules, Recommendations and property
Share defaults, plus persistent-data entry dialogs reached from other tabs.
Detect actual field/model changes (including focused text, dynamic rows, ordering
and languages), not mere edit mode or filters. Save and continue uses the form's
existing explicit save operation; never send chat/guest messages automatically.
Discard restores the draft, Keep editing/Escape retains it. Invalid/failed/zero-row
saves cannot navigate. Protect tab/section/property/new-property/sign-out and
browser unload; serialize save/navigation and retain permission boundaries.
Credentials remain memory-only and use their existing explicit consent/validation.
Read-only/generated links and export review/filter controls are not saveable drafts.

Gate: actual Chromium IT/EN at 390/1280px, measured dialog centering on scroll,
all three actions/Escape, unchanged/reverted fields, Settings arrays/reminders,
Rules/Recommendations focused text/add/remove/order, Share defaults, validation,
failed/repeated saves, property switch, unload and read-only access. Run existing
property-editor/regional/Share/admin/links/onboarding and affected regressions.
Publish source, tests, guides, plan and changelog; merge main and verify Vercel
success and exact production source. No schema changes or live guest test writes.
Round 51 remains paused.

## Delivery — 15 October 2026

Application scope shipped through PR #159, merged to main as
`8a6240a92a0b87c732992631d048772a749bf3e5`. Vercel production succeeded.
All eight published files match tested local source; served host console, shared
draft registry, property editor, Share module and guide match byte for byte.
The canonical origin remains https://app.welcomebnb.it.

The new shared-form browser suite and existing property, Share/QR and regional
download browser suites pass at 390/1280px in IT/EN, alongside affected regression
gates. Booking/block and guest-edit dialogs use existing validation, permission
and confirmed-row paths. No live guest records or schema were changed to test.
The guide is updated. Existing Rules/Recommendations replacement writes remain
non-atomic; errors retain the draft for retry.

The initial full Round 59 CHANGELOG upload was rejected by automatic approval
review. Daniele subsequently explicitly confirmed standing authorization for all
requested project work, including CHANGELOG publication to public
Giginoparrucca/doorstep main, without repeated permission requests. This
follow-up publishes the prepared full release record and records that standing
instruction in AGENTS.md. Application code and verification are unchanged.
Round 51 remains paused.
