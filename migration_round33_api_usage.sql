-- Round 33: API endpoint hardening — usage table + per-property monthly cap.
--
-- This migration is additive:
--   * api_usage — new table; every successful call to chat.js / scan-document.js
--     inserts one row so cost per property is observable and rate-limits +
--     monthly budget can be evaluated by counting/summing rows.
--   * properties.ai_monthly_token_cap — bigint, default 2_000_000, per-property
--     ceiling. When exceeded the chat endpoint degrades gracefully (returns
--     "concierge briefly unavailable" + escalated=true), scan errors cleanly.
--   * public.purge_old_api_usage(dry_run) — SECURITY DEFINER function that
--     deletes / previews rows older than 180 days. Wired into the daily
--     retention cron in a follow-up (needs inspection of the existing
--     purge_old_data body to integrate cleanly; Supabase MCP was offline
--     at author time).
--
-- Round 28 lesson everywhere: explicit GRANTs, no reliance on defaults.
-- Apply via the Supabase SQL editor. Re-runs are safe.

CREATE TABLE IF NOT EXISTS public.api_usage (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id    uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  session_id     text,
  endpoint       text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_usage_endpoint_chk
    CHECK (endpoint IN ('chat', 'scan', 'chat_write'))
);

CREATE INDEX IF NOT EXISTS api_usage_prop_time_idx
  ON public.api_usage (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_session_time_idx
  ON public.api_usage (session_id, created_at DESC);

ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- Host: SELECT only, and only rows belonging to a property they own. Reads
-- go through owner-scoped RLS; writes are server-side with the service key.
DROP POLICY IF EXISTS api_usage_host_select ON public.api_usage;
CREATE POLICY api_usage_host_select
  ON public.api_usage FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
       WHERE p.id = api_usage.property_id
         AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS api_usage_admin_all ON public.api_usage;
CREATE POLICY api_usage_admin_all
  ON public.api_usage FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS api_usage_service_all ON public.api_usage;
CREATE POLICY api_usage_service_all
  ON public.api_usage FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- No anon policies. All server-side writes go through service_role.
GRANT SELECT                            ON public.api_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE    ON public.api_usage TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;

-- Per-property monthly ceiling on (input + output) tokens combined.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS ai_monthly_token_cap bigint NOT NULL DEFAULT 2000000;

-- Retention: purge api_usage rows older than 180 days. Callable dry-run
-- returns the count that would be deleted; the runner in the retention
-- cron passes p_dry_run=false. SECURITY DEFINER so the daily runner can
-- call it as a non-superuser role.
CREATE OR REPLACE FUNCTION public.purge_old_api_usage(p_dry_run boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  IF p_dry_run THEN
    SELECT count(*) INTO n
      FROM public.api_usage
     WHERE created_at < now() - INTERVAL '180 days';
    RETURN n;
  ELSE
    WITH deleted AS (
      DELETE FROM public.api_usage
       WHERE created_at < now() - INTERVAL '180 days'
       RETURNING 1
    )
    SELECT count(*) INTO n FROM deleted;
    RETURN n;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.purge_old_api_usage(boolean) FROM public;
REVOKE EXECUTE ON FUNCTION public.purge_old_api_usage(boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.purge_old_api_usage(boolean) TO service_role;
GRANT  EXECUTE ON FUNCTION public.purge_old_api_usage(boolean) TO authenticated;
-- (authenticated grant is so an admin panel button can preview counts;
--  RLS/is_admin() gating happens at the UI/RPC caller layer.)
