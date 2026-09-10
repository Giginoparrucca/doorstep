-- Round 37 — Tourist tax rulesets per comune
--
-- Rationale: the three-column model on properties (tax_rate_eur,
-- tax_max_nights, tax_exempt_under_age) encodes exactly one shape:
-- flat rate, night cap, one age exemption. Real comuni don't all fit
-- it. Verona has percentage reductions for youth (15–25) and over-70s
-- plus a group-size band; Chieti reduces (not exempts) under-14s; each
-- has its own declaration categories (residents, disabled, twinned
-- towns…). This round encodes rulesets as data.
--
-- Two decisions drive the schema:
--
--   1. Rules belong to the COMUNE, not the property. Every host in
--      Verona shares one ruleset — re-entering it per host would create
--      drift when a delibera changes. Comune-level means one Verona
--      setup serves all Verona hosts, current and future.
--
--   2. Rules are an ordered list of {when, effect}. See rules_shape
--      below. Deprecated `structure_type` distinguishes locazione
--      turistica / albergo / etc. — rates typically differ by category.
--
-- Legacy compatibility: the three existing columns on properties stay
-- put. Properties without a linked ruleset fall back to them, so
-- Trullo Verde Ulivo / Claudio House / Hidden Hamlet / Bedda Matri
-- keep working unchanged.
--
-- rules JSONB — array of:
--   { id, when, effect, requires_documentation?, label_it, label_en }
--
--   when: any combination of
--     age_min, age_max, group_size_min, group_size_max, declared
--   effect: { type: 'exempt' | 'percent_off' | 'fixed_rate', value?, includes_companion? }
--   declared: 'resident_comune' | 'disability' | ... — never auto-applied
--
-- stacking: 'best_single' is the only mode implemented in Round 37;
-- other modes may be added later. Code reads the column rather than
-- hardcoding.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tax_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comune text NOT NULL,
  provincia text,
  istat_code text,
  structure_type text NOT NULL DEFAULT 'locazione_turistica',
  base_rate_eur numeric NOT NULL,
  max_nights integer,
  max_nights_basis text NOT NULL DEFAULT 'per_stay'
    CHECK (max_nights_basis IN ('per_stay', 'per_person_per_month')),
  rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  stacking text NOT NULL DEFAULT 'best_single'
    CHECK (stacking IN ('best_single')),
  source_citation text,
  source_url text,
  valid_from date NOT NULL,
  valid_to date,
  verified_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One current ruleset per (comune, structure_type) starting on any
-- given date. Versioning by valid_from is not optional — Verona
-- changed its night cap on 2024-05-09 and any historical declaration
-- must use the rate that applied then.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tax_rulesets_unique_comune_structure_valid_from'
  ) THEN
    ALTER TABLE public.tax_rulesets
      ADD CONSTRAINT tax_rulesets_unique_comune_structure_valid_from
      UNIQUE (comune, structure_type, valid_from);
  END IF;
END $$;

-- FK on properties, plus the checkins column for the host-flagged
-- documentation-based rules (residency, disability, ...). Kept
-- optional/nullable so existing rows and unlinked properties stay
-- valid.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS tax_ruleset_id uuid REFERENCES public.tax_rulesets(id) ON DELETE SET NULL;

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS tax_declared_flags jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Round 20.2 gotcha: tables created via the SQL editor don't inherit
-- privileges. The symptom is a silent 0-row query with error: null.
-- Explicit GRANTs first, then RLS.
GRANT SELECT ON public.tax_rulesets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_rulesets TO service_role;

ALTER TABLE public.tax_rulesets ENABLE ROW LEVEL SECURITY;

-- Reference data: authenticated hosts read everything; only admins can
-- mutate (the whole comune's rate must not be editable by a single
-- host). service_role bypasses.
DROP POLICY IF EXISTS tax_rulesets_select_authenticated ON public.tax_rulesets;
CREATE POLICY tax_rulesets_select_authenticated
  ON public.tax_rulesets FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS tax_rulesets_admin_all ON public.tax_rulesets;
CREATE POLICY tax_rulesets_admin_all
  ON public.tax_rulesets FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS tax_rulesets_service_all ON public.tax_rulesets;
CREATE POLICY tax_rulesets_service_all
  ON public.tax_rulesets FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public._tax_rulesets_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tax_rulesets_touch_updated_at ON public.tax_rulesets;
CREATE TRIGGER tax_rulesets_touch_updated_at
  BEFORE UPDATE ON public.tax_rulesets
  FOR EACH ROW EXECUTE FUNCTION public._tax_rulesets_touch_updated_at();

COMMIT;

-- Rollback:
-- BEGIN;
-- DROP TRIGGER IF EXISTS tax_rulesets_touch_updated_at ON public.tax_rulesets;
-- DROP FUNCTION IF EXISTS public._tax_rulesets_touch_updated_at();
-- ALTER TABLE public.checkins DROP COLUMN IF EXISTS tax_declared_flags;
-- ALTER TABLE public.properties DROP COLUMN IF EXISTS tax_ruleset_id;
-- DROP TABLE IF EXISTS public.tax_rulesets;
-- COMMIT;
