# Round 62 — Tourist-tax rates by date

Confirmed by Daniele on 21 October 2026 after the recap in chat.

## Host behavior

Rate, From date and To date sit together in Settings. Dates are inclusive nights,
not checkout dates. Blank main dates retain the year-round fallback. A dated main
rate applies only within its bounds (blank endpoint means unbounded). Add period
creates further dated rates, including zero rates. Additional periods need both
dates. Dated periods cannot overlap (shared endpoints count as overlap). A dated
rate overrides the undated fallback; uncovered nights without fallback cost zero.
Dates include the year so historical rates remain available. Existing MM-DD
arrival-based reduction rules retain their semantics and remain separate.

## Storage and calculation

Use the existing properties.tax_rules JSONB for explicitly typed rate_period
entries, with one base entry marking main-row bounds and further entries carrying
their own amount. tax_rate_eur remains the main amount. No schema migration.
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
