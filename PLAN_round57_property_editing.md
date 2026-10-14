# Round 57 — Safer property editing and cover framing

## Phase 1 — integrated editing flow
- Track actual Property Details changes, including bilingual text, programmatic
  edits, photo replacement and framing. Merely entering Edit is not dirty.
- Before another console tab/section or property opens, offer Save and continue,
  Discard changes, or Keep editing. Save failure stays on the original property
  with edits intact. Prevent repeated navigation and saving races. Warn on browser
  reload/close via the native unsaved-changes prompt. Do not save automatically.
- Add Agriturismo to the existing property type selector; preserve current values.
- Keep original photo URL plus bounded zoom/horizontal/vertical framing metadata.
  Show live preview, keyboard-accessible sliders and Center/reset. Replacement
  uploads and framing remain drafts until Save Property Details; Cancel restores
  saved photo/frame. Reject invalid files and surface storage/database errors.
- Apply persisted framing to both normal guest and host preview hero renders.
  Default existing photos to centered/no zoom. No guest or credential changes.

## Verification and release
Use actual source functions and real Chromium at mobile/desktop in IT/EN:
unchanged form, edited/reverted fields, translated text, each prompt action,
failed/repeated saves, property switches, reload warning, file rejection, upload
failure, cancel/restore, framing bounds and guest/API rendering. Use fictional
fixtures, no live host or guest records. Verify additive schema and unchanged
RLS with rolled-back SQL probes. Run relevant onboarding/admin/Share/link and
guest regressions, syntax checks. Merge main under standing authorization, verify
served source/config and deployment status. Update CHANGELOG and affected guide.
Rollback source; additive nullable metadata may remain safely unused.

## Execution — 2026-10-14
Phase 1 shipped to production in PR #157, main commit
`38a04098372f49bedf122cb18480a7eaa671cb41`. Chromium IT/EN at 390/1280px,
actual guest gateway/rendering, app regressions and rolled-back fictional-owner
SQL gates pass. Production schema ready; live console/editor/shared framing/guide/
guest source matches tested files exactly. Vercel reports success and canonical
origin remains app.welcomebnb.it. Full CHANGELOG upload failed; PR #157 retains
that limitation while the source, tests, migration, guide and this plan are public.
No separate demo rollout. Round 51 remains paused.
