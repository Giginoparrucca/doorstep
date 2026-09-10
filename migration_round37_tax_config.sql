-- Round 37 (redux) — Universal tourist tax configuration
--
-- Supersedes the previous Round-37 comune-shared tax_rulesets table.
-- Rules now live per-property, in JSONB on the property itself. The
-- host is responsabile d'imposta — the values used in their
-- declaration must be their own, not a central editor's guess.
--
-- Progressive disclosure: most comuni fit the three legacy columns
-- (flat rate + night cap + one age exemption). Those hosts must not
-- see the advanced layers.
--
-- Legacy compatibility: the three existing columns
-- (tax_rate_eur, tax_max_nights, tax_exempt_under_age) stay put and
-- keep their semantics. computeGuestTax normalises them into an
-- implicit rule so there is exactly one code path.
--
-- No new tables. No RLS changes. All additive. RLS rides on the
-- existing owner-scoped policies for properties + checkins.
--
-- Also widens api_usage.endpoint CHECK to include 'tax_parse' — the
-- new AI-draft endpoint reads it via _guest-token-style budget guard.
-- Round 34.1 gotcha: recordUsage swallows insert failures with a
-- console.warn, so a constraint miss silently disables the rate limit
-- instead of erroring. Apply this migration BEFORE deploying the
-- endpoint.

BEGIN;

-- Layer 1 additions (basis + optional euro cap).
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_max_nights_basis text NOT NULL DEFAULT 'per_stay';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'properties_tax_max_nights_basis_chk'
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_tax_max_nights_basis_chk
      CHECK (tax_max_nights_basis IN ('per_stay', 'per_person_per_month', 'per_person_per_year'));
  END IF;
END $$;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_max_total_eur numeric;

-- Layer 2 — ordered list of {when, effect, label}.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_rules jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Layer 3 — labelled declared exemptions. Free-text labels the host
-- writes; the system supplies checkboxes and does not know what they
-- mean, and that is deliberate.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_declared_exemptions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Provenance the host is responsible for citing.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_source_note text;
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_verified_at date;

-- checkins.tax_declared_flags — the host's per-guest attestations.
-- Introduced in the earlier Round-37 pass, kept here for idempotency
-- so a fresh apply of just this migration lands cleanly.
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS tax_declared_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Widen the api_usage endpoint CHECK to include the new tax-parse
-- endpoint. Drop-and-recreate rather than "IN (...)" so a follow-up
-- round can widen again without hunting for the old name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_usage_endpoint_chk'
  ) THEN
    ALTER TABLE public.api_usage DROP CONSTRAINT api_usage_endpoint_chk;
  END IF;
END $$;

ALTER TABLE public.api_usage
  ADD CONSTRAINT api_usage_endpoint_chk
  CHECK (endpoint IN ('chat', 'scan', 'chat_write', 'token_mint', 'tax_parse'));

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.api_usage DROP CONSTRAINT IF EXISTS api_usage_endpoint_chk;
-- ALTER TABLE public.api_usage ADD CONSTRAINT api_usage_endpoint_chk
--   CHECK (endpoint IN ('chat', 'scan', 'chat_write', 'token_mint'));
-- ALTER TABLE public.properties
--   DROP CONSTRAINT IF EXISTS properties_tax_max_nights_basis_chk,
--   DROP COLUMN IF EXISTS tax_max_nights_basis,
--   DROP COLUMN IF EXISTS tax_max_total_eur,
--   DROP COLUMN IF EXISTS tax_rules,
--   DROP COLUMN IF EXISTS tax_declared_exemptions,
--   DROP COLUMN IF EXISTS tax_source_note,
--   DROP COLUMN IF EXISTS tax_verified_at;
-- COMMIT;
