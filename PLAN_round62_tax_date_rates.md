# Round 62 — Tourist-tax rates by date

Confirmed by Daniele on 21 October 2026 after the recap in chat.

## Host behavior

Rate, From and To sit together in Settings. New bounds use day/month (DD/MM),
without a year, and repeat every year. Both bounds include their nights; checkout
is excluded. December–January periods wrap across New Year. February 29 applies
only when that night exists. Blank main bounds retain the year-round fallback;
a bounded main rate is zero outside its season. Additional periods require both
bounds, cannot overlap, and override an undated fallback. Zero rates are allowed.

The original 21 October delivery used exact-year dates. The 24 October correction
preserves those saved historical limits until an explicit owner conversion via
Make saved dates repeat every year / Ripeti ogni anno le date salvate. Conversion
is a draft, needs Save Settings, and warns that calculations for other years change.
Cancel restores the exact dates; resulting duplicate/overlapping seasons must be
resolved before saving. Existing arrival-based reduction rules remain separate.

## Storage and calculation

Use the existing properties.tax_rules JSONB for explicitly typed rate_period
entries, with one base entry marking main-row bounds and further entries carrying
their own amount. New seasons store MM-DD; existing YYYY-MM-DD bounds remain
exact. Mixed recurring/exact periods must not overlap on any actual night.
tax_rate_eur remains the main amount. No schema migration.
The normalizer separates rate periods from reductions. Compute each stay night
in UTC; exclude checkout; apply its rate before existing reductions/exemptions.
Quarter clipping passes exact bounds. Preserve night/euro caps across period
boundaries; never reset them for each rate segment. Legacy configurations keep
identical output in UTC; quarter boundaries are corrected for other timezones. Invalid saved period data blocks calculation/export.
No Alloggiati, regional-export or payment-export format changes.

## Phase 1 — settings and engine

Implement accessible IT/EN inputs, add/remove, save validation, loading, copy,
cancel, unsaved guard, preview and summary explanation. Synthetic committed
byte-for-byte tax goldens plus unit/real Chromium coverage. Run test:all; fix any
failure and record real skips. Commit and pass CI before main merge.

## Phase 2 — release verification

Verify complete IT/EN 390/1280 settings lifecycle, dates and zero rates,
overlap/invalid-date rejection, draft restoration and denied/failed save.
Publish changelog/source to public main under standing authorization. Confirm
Vercel project welcomebnb production commit and app.welcomebnb.it alias. Run
read-only test:live and compare deployed tax source against tested source.
No external messages or real guest writes.

## Delivery — 21 October 2026

- Phase 1: PR #194; main merge `3e07473cd6e6a15d3fe8759abcf4bd11b6bfcbe4`.
- Phase 1 and Phase 2 local full regression: PASS 55 / FAIL 0 / SKIP 3.
- Required PR CI run 39580593080 / job 119156924444: full regression 55/0/3;
  live 1/0/3, including successful production schema-drift.
- Production dpl_7LcT681hZD8SBPJzkFfbgjMWJ6Xt READY at app.welcomebnb.it,
  correct main merge and project verified.
- Explicit post-deploy live suite: PASS 2 / FAIL 0 / SKIP 2. Public assets exactly
  match tested source; hosted tax and existing SPOT engines reproduce their
  committed fictional goldens. Local live skips are demo origin and service-role
  key; offline skips are demo origin/private catalog/pglast.
- Final documentation publication does not alter the verified application assets.
  Both phases complete. No migration or owner-only task.


## 24 October correction — yearly seasons

Requested directly by Daniele as a correction to the shipped feature. GPT-6 owns
this Round 62 Phase 2 follow-up; Round 63 remains separate and unchanged. Tests
cover future years, winter wrapping, leap days/century gaps, mixed/annual overlaps,
legacy history, conversion/cancel/copy/save failures and real IT/EN mobile/desktop.
Separate annual declaration goldens join the unchanged exact-date/legacy goldens.
Mandatory full local/CI regression and deployed source/golden smoke before ship.
