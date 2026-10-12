-- Round 51 (hotfix on top of Round 38) — flip pilot_invites.status to
-- 'accepted' the first time an invitee signs in.
--
-- Before this migration, `pilot_invites.status` only moved by one
-- backfill at Round 38 install time; a user accepting their invite
-- stayed 'invited' forever and the admin dashboard was lying.
--
-- The fix is a SECURITY DEFINER function the host-console calls on its
-- SIGNED_IN event. It uses `auth.email()` to find the row for the
-- caller — the caller cannot touch anyone else's row because the
-- UPDATE is predicated on the current session's email. The function
-- also respects the Round 48 principle that the `pilot_invites` RLS
-- stays admin-only; this is the one and only hole we cut.
--
-- Idempotent. Safe to run twice. Rollback block at the bottom.

CREATE OR REPLACE FUNCTION public.accept_my_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  _email text := LOWER(COALESCE(auth.email(), ''));
  _row   public.pilot_invites;
BEGIN
  IF _email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_session');
  END IF;
  SELECT * INTO _row FROM public.pilot_invites WHERE email = _email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_row', 'email', _email);
  END IF;
  IF _row.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'email', _email);
  END IF;
  UPDATE public.pilot_invites
     SET status      = 'accepted',
         accepted_at = now()
   WHERE email = _email;
  RETURN jsonb_build_object('ok', true, 'email', _email, 'accepted_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_my_invite() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_my_invite() FROM anon;
GRANT  EXECUTE ON FUNCTION public.accept_my_invite() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.accept_my_invite() TO service_role;

-- Rollback:
-- BEGIN;
--   REVOKE EXECUTE ON FUNCTION public.accept_my_invite() FROM authenticated;
--   REVOKE EXECUTE ON FUNCTION public.accept_my_invite() FROM service_role;
--   DROP FUNCTION IF EXISTS public.accept_my_invite();
-- COMMIT;
