-- migration_round51_host_onboarding.sql — Round 51 Phase 2.
--
-- Creates `public.host_onboarding`: one row per (host user, property)
-- that tracks per-property onboarding state. Readiness itself is NOT
-- stored here — it is always derived by `lib/onboarding-readiness.js`
-- from real property state so it cannot drift. This table only stores
-- the fields the derivation can't infer: when the host first saw the
-- checklist, when the property reached `ready`, which steps the host
-- explicitly skipped, whether a test check-in has ever been
-- completed, when the host dismissed the ready-badge, and the nudge-
-- email bookkeeping for Phase 5.
--
-- Idempotent. Safe to run twice. A commented rollback block lives at
-- the bottom of the file.
--
-- Related data:
--   * `public.checkins.is_test`         (boolean NOT NULL DEFAULT false) — pre-existing (Rounds 29+).
--   * `public.ota_reservations.is_test` (boolean NOT NULL DEFAULT false) — pre-existing (Round 50 Phase 3 uses it).
-- Round 51 reuses those columns for the Phase 4 test check-in; no new
-- columns are needed on either table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.host_onboarding (
  user_id                 uuid        NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  property_id             uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz NULL,
  test_checkin_done_at    timestamptz NULL,
  skips                   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  checklist_dismissed_at  timestamptz NULL,
  nudge_24h_sent_at       timestamptz NULL,
  nudge_72h_sent_at       timestamptz NULL,
  nudges_opted_out        boolean     NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_onboarding_pkey PRIMARY KEY (user_id, property_id),
  CONSTRAINT host_onboarding_skips_is_object CHECK (jsonb_typeof(skips) = 'object')
);

COMMENT ON TABLE  public.host_onboarding IS
  'Round 51 Phase 2 — per-(host,property) onboarding state. Readiness is derived.';
COMMENT ON COLUMN public.host_onboarding.skips IS
  'Opt-in skip flags, e.g. {"tax_not_applicable":true,"direct_only":true,"test_checkin":true}.';
COMMENT ON COLUMN public.host_onboarding.test_checkin_done_at IS
  'Persists Phase 4 completion so the test-row purge does not un-complete the step.';

-- ── touch trigger for updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.host_onboarding_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS host_onboarding_set_updated_at ON public.host_onboarding;
CREATE TRIGGER host_onboarding_set_updated_at
  BEFORE UPDATE ON public.host_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.host_onboarding_touch_updated_at();

-- ── RLS + policies ──────────────────────────────────────────────────
ALTER TABLE public.host_onboarding ENABLE ROW LEVEL SECURITY;

-- Owner can read rows whose property they own AND whose user_id is
-- their own auth.uid(). The user_id predicate is belt-and-braces:
-- the service role is the only writer that would ever cross user_ids,
-- and it bypasses RLS entirely.
DROP POLICY IF EXISTS host_onboarding_owner_select ON public.host_onboarding;
CREATE POLICY host_onboarding_owner_select
  ON public.host_onboarding
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = host_onboarding.property_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS host_onboarding_owner_insert ON public.host_onboarding;
CREATE POLICY host_onboarding_owner_insert
  ON public.host_onboarding
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = host_onboarding.property_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS host_onboarding_owner_update ON public.host_onboarding;
CREATE POLICY host_onboarding_owner_update
  ON public.host_onboarding
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = host_onboarding.property_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = host_onboarding.property_id AND p.owner_id = auth.uid()
    )
  );

-- Admin read-only policy, matching the Round 48/35 `properties`
-- admin pattern (`is_admin()` is `STABLE SECURITY DEFINER`).
DROP POLICY IF EXISTS host_onboarding_admin_select ON public.host_onboarding;
CREATE POLICY host_onboarding_admin_select
  ON public.host_onboarding
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- No DELETE policy. The row is destroyed by the FK cascade when its
-- property or user is removed; nothing else should delete it.

-- ── explicit grants ─────────────────────────────────────────────────
-- Without these, RLS still rejects the write even if a policy matches
-- (RLS evaluates after the base GRANT). Round 48 Phase 5 nailed down
-- the "missing GRANT = silent 0-row write" rule.
REVOKE ALL ON public.host_onboarding FROM PUBLIC;
REVOKE ALL ON public.host_onboarding FROM anon;
GRANT  SELECT, INSERT, UPDATE ON public.host_onboarding TO authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.host_onboarding TO service_role;

COMMIT;

-- ── Rollback (commented) ────────────────────────────────────────────
-- BEGIN;
--   DROP POLICY IF EXISTS host_onboarding_admin_select  ON public.host_onboarding;
--   DROP POLICY IF EXISTS host_onboarding_owner_update  ON public.host_onboarding;
--   DROP POLICY IF EXISTS host_onboarding_owner_insert  ON public.host_onboarding;
--   DROP POLICY IF EXISTS host_onboarding_owner_select  ON public.host_onboarding;
--   DROP TRIGGER IF EXISTS host_onboarding_set_updated_at ON public.host_onboarding;
--   DROP FUNCTION IF EXISTS public.host_onboarding_touch_updated_at();
--   DROP TABLE IF EXISTS public.host_onboarding;
-- COMMIT;
