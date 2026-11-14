-- Hotfix 14 Nov 2026 — a check-in that was filed to Alloggiati can no longer
-- be deleted.
--
-- Before: hosts could hard-delete a filed check-in (console row menu
-- «Elimina», the unexposed bulk deletes, the purge_booking RPC, or straight
-- through the API under the owner DELETE policies), soft-delete it (and the
-- daily purge then removed it after 30 days), clear filed_at, or flip it to
-- is_test so the test purges would take it. The Round 48/49 lock only
-- covered field edits.
--
-- Rule, for real rows (is_test = false) that have been filed
-- (filed_at IS NOT NULL or alloggiati_status = 'filed'):
--   * DELETE is refused (also via ON DELETE CASCADE from properties and via
--     SECURITY DEFINER functions such as purge_booking);
--   * deleted_at cannot be set, filed_at cannot be cleared, is_test cannot
--     be switched on.
-- The «Unlock to correct» flow (filed → correction, then re-file) still
-- works: status changes and corrections are untouched, the row just stays.
-- TULPS art. 109 retention. The only bypass is a direct database session
-- as postgres/supabase_admin with no API JWT claims (SQL editor, migrations,
-- pg_cron), never an API request, for an end-of-retention or legal-order deletion done on purpose.
-- Also: TRUNCATE revoked from anon/authenticated on checkins (not reachable
-- through PostgREST, but no client role needs it; TRUNCATE skips RLS and
-- row triggers).
-- Re-runnable.
-- Rollback: DROP TRIGGER checkins_filed_retained_guard ON public.checkins;
--           DROP FUNCTION public.checkins_protect_filed();
BEGIN;
CREATE OR REPLACE FUNCTION public.checkins_protect_filed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Direct maintenance session only: API requests always carry JWT claims
  -- (anon, authenticated and service_role alike), definer functions too.
  IF session_user IN ('postgres', 'supabase_admin')
     AND COALESCE(current_setting('request.jwt.claims', true), '') = '' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF COALESCE(OLD.is_test, false) IS TRUE
     OR (OLD.filed_at IS NULL AND COALESCE(OLD.alloggiati_status, '') <> 'filed') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'checkin_filed_retained: a check-in filed to Alloggiati cannot be deleted'
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RAISE EXCEPTION 'checkin_filed_retained: a check-in filed to Alloggiati cannot be moved to the trash'
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.filed_at IS NOT NULL AND NEW.filed_at IS NULL THEN
    RAISE EXCEPTION 'checkin_filed_retained: the filing date of a filed check-in cannot be cleared'
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(NEW.is_test, false) IS TRUE THEN
    RAISE EXCEPTION 'checkin_filed_retained: a filed check-in cannot become a test record'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.checkins_protect_filed() FROM PUBLIC;
DROP TRIGGER IF EXISTS checkins_filed_retained_guard ON public.checkins;
CREATE TRIGGER checkins_filed_retained_guard
  BEFORE UPDATE OR DELETE ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION public.checkins_protect_filed();
REVOKE TRUNCATE ON public.checkins FROM anon, authenticated;
COMMENT ON FUNCTION public.checkins_protect_filed() IS
  'Hotfix 14 Nov 2026: filed (non-test) check-ins are retained — no DELETE, no soft delete, filed_at not cleared, not turned into test rows. Bypass only for direct postgres/supabase_admin sessions.';
COMMIT;
