-- Round 43 · "Come funziona" guide feedback capture
--
-- One row per 👍/👎 press. Hosts vote inline at the bottom of each guide;
-- admins can see the aggregate in a future admin panel to prioritise
-- which guides need better wording. Very small volume expected — one
-- vote per host per panel per session, and each host has ~12 guides,
-- so the table stays tiny.
--
-- Rule (Round 20.2 lesson): tables created via SQL don't inherit
-- default grants. RLS alone isn't enough. Every table needs explicit
-- GRANTs plus REVOKE ALL FROM anon. Symptom when a grant is missing:
-- 0-row write with error:null on the client.

BEGIN;

-- ── Table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guide_feedback (
  id          bigserial PRIMARY KEY,
  host_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  panel       text        NOT NULL CHECK (char_length(panel) BETWEEN 1 AND 40),
  helpful     boolean     NOT NULL,
  lang        text        CHECK (lang IS NULL OR lang IN ('it','en')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guide_feedback_panel_helpful_idx
  ON public.guide_feedback (panel, helpful);
CREATE INDEX IF NOT EXISTS guide_feedback_created_at_idx
  ON public.guide_feedback (created_at DESC);

-- ── Grants (Round 20.2) ─────────────────────────────────────────────
REVOKE ALL ON public.guide_feedback FROM anon;
GRANT INSERT ON public.guide_feedback TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.guide_feedback_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guide_feedback TO service_role;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.guide_feedback_id_seq TO service_role;

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.guide_feedback ENABLE ROW LEVEL SECURITY;

-- Host: INSERT only, and only rows tagged as their own auth.uid().
DROP POLICY IF EXISTS gf_self_insert ON public.guide_feedback;
CREATE POLICY gf_self_insert ON public.guide_feedback
  FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid());

-- Hosts CANNOT read the feedback table — no SELECT policy.

-- Admin: SELECT via the shared is_admin() helper (same pattern as
-- pilot_hosts, api_usage, admin_invites).
DROP POLICY IF EXISTS gf_admin_select ON public.guide_feedback;
CREATE POLICY gf_admin_select ON public.guide_feedback
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- service_role: full CRUD (for future analytics jobs / cleanup).
DROP POLICY IF EXISTS gf_service_all ON public.guide_feedback;
CREATE POLICY gf_service_all ON public.guide_feedback
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMIT;

/*
-- ROLLBACK — run this block manually if the migration needs undoing.
BEGIN;
DROP TABLE IF EXISTS public.guide_feedback;
COMMIT;
*/

-- ── Verification ────────────────────────────────────────────────────
-- After applying, this query should show:
--   - anon has NO privileges,
--   - authenticated has INSERT only,
--   - service_role has SELECT+INSERT+UPDATE+DELETE,
--   - three RLS policies present (gf_self_insert, gf_admin_select, gf_service_all).
SELECT
  (SELECT string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='guide_feedback'
      AND grantee IN ('anon','authenticated','service_role')) AS grants,
  (SELECT string_agg(policyname || '(' || cmd || ')', ', ' ORDER BY policyname)
     FROM pg_policies
    WHERE schemaname='public' AND tablename='guide_feedback') AS policies;
