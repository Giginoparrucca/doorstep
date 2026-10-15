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
