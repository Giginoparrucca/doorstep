-- Round 38 — Invite-only host access + guest privacy notice column comment.
--
-- Part B (invites) side of the migration. Part A (guest privacy notice)
-- reuses existing columns and needs no schema work aside from a
-- clarifying COMMENT on cir_code (which actually holds the CIN — the
-- column name is a legacy holdover from before the CIR→CIN rename).
--
-- IMPORTANT: this migration alone is NOT the gate that stops new
-- signups. The gate is the Supabase project setting
--   Authentication → Sign In / Providers → Email
--     → "Allow new users to sign up" = OFF
-- because sb.auth.signUp() can be called directly against the API with
-- the anon key. See CHANGELOG Round 38 for the deployment checklist.

BEGIN;

-- ── pilot_invites ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pilot_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text NOT NULL,
  status       text NOT NULL DEFAULT 'invited',
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes        text
);

-- Emails are normalised — lowercased and trimmed — on write everywhere
-- else. The unique index enforces the invariant at the DB.
CREATE UNIQUE INDEX IF NOT EXISTS pilot_invites_email_key
  ON public.pilot_invites (email);

-- CHECK on status. `invited` is the initial state; `accepted` is set
-- when the user sets a password and signs in; `revoked` means the
-- invitation was withdrawn.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pilot_invites_status_chk'
  ) THEN
    ALTER TABLE public.pilot_invites
      ADD CONSTRAINT pilot_invites_status_chk
      CHECK (status IN ('invited', 'accepted', 'revoked'));
  END IF;
END $$;

-- Round 20.2 gotcha: SQL-editor tables don't inherit privileges;
-- symptom is a silent 0-row result with error: null. Explicit GRANTs
-- FIRST, RLS after.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_invites TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_invites TO service_role;

ALTER TABLE public.pilot_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_invites_admin_all ON public.pilot_invites;
CREATE POLICY pilot_invites_admin_all
  ON public.pilot_invites FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS pilot_invites_service_all ON public.pilot_invites;
CREATE POLICY pilot_invites_service_all
  ON public.pilot_invites FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Backfill: one `accepted` row per existing auth.users email so the
-- audit view starts from reality rather than empty. accepted_at is
-- best-effort — use last_sign_in_at when available, else created_at.
INSERT INTO public.pilot_invites (email, status, invited_at, accepted_at, notes)
SELECT
  lower(trim(u.email)),
  'accepted',
  COALESCE(u.created_at, now()),
  COALESCE(u.last_sign_in_at, u.created_at, now()),
  'backfilled from auth.users at Round 38 migration'
FROM auth.users u
WHERE u.email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

-- ── Part A · cir_code column comment ───────────────────────────────────
-- properties.cir_code actually holds the CIN (Codice Identificativo
-- Nazionale). The name is legacy from when the field held the regional
-- CIR. Every UI label, hint, i18n key and exportCityTax already reads
-- CIN — only the column name lags. Comment so the next reader stops
-- reaching for a cin_code column that isn't there.
COMMENT ON COLUMN public.properties.cir_code IS
  'Holds the CIN (Codice Identificativo Nazionale). Legacy column name from when this field held the regional CIR code.';

COMMIT;

-- Rollback:
-- BEGIN;
-- COMMENT ON COLUMN public.properties.cir_code IS NULL;
-- DROP POLICY IF EXISTS pilot_invites_service_all ON public.pilot_invites;
-- DROP POLICY IF EXISTS pilot_invites_admin_all ON public.pilot_invites;
-- DROP TABLE IF EXISTS public.pilot_invites;
-- COMMIT;
