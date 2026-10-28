-- Round 66 Phase 2e — read-side RPC exposing entry_access state.
--
-- The Phase 1a entry_access.* schema is REVOKEd from PostgREST so the
-- loader cannot query it directly. This migration adds a SECURITY
-- DEFINER function in the public schema that returns the state a
-- Phase 2 ON-path snapshot needs: the booking row, its slots (active),
-- and the actor + audit id for a current manual override.
--
-- Authorization: the function is callable by `authenticated` AND
-- `service_role`. For an authenticated caller (host console) it
-- requires the caller to own the property, mirroring every other
-- Phase 1 RPC. For `service_role` (the api/guest.js loader) it skips
-- the ownership check — the server-side scope has already been
-- derived from the signed guest token.
--
-- The function returns NULL when no entry_access.bookings row exists
-- for this (property, booking_code, is_test). Callers must treat that
-- as "no persisted roster yet; fall back to the policy's legacy
-- branch" rather than as an error.
--
-- Rollback: DROP FUNCTION public.get_entry_access_booking_state(uuid, text, boolean);
-- then DELETE FROM supabase_migrations.schema_migrations WHERE name='round66_entry_access_state_rpc'.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_entry_access_booking_state(
  p_property_id uuid, p_booking_code text, p_is_test boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  caller_role text := current_setting('role', true);
  b entry_access.bookings%ROWTYPE;
  audit_row entry_access.audit%ROWTYPE;
  slot_rows jsonb;
  submission_rows jsonb;
BEGIN
  -- When an authenticated caller invokes this (not service_role), it
  -- must own the property. service_role is already server-scoped.
  IF caller_role IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.properties
        WHERE id = p_property_id AND owner_id = auth.uid() AND deleted_at IS NULL
      )
    THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO b FROM entry_access.bookings
    WHERE property_id = p_property_id
      AND booking_code = p_booking_code
      AND is_test = p_is_test;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id,
    'ordinal', s.ordinal,
    'created_at', s.created_at
  ) ORDER BY s.ordinal) INTO slot_rows
  FROM entry_access.slots s
  WHERE s.booking_id = b.id AND s.retired_at IS NULL;

  -- Submissions tie an entry_access.slot → public.checkins row so the
  -- loader can project each check-in to its roster slot. This is what
  -- the policy's automatic-release path needs when override.active is
  -- false (host restored automatic release after a manual override, or
  -- the roster was persisted automatically). Only live check-ins count
  -- toward the policy: deleted ones are filtered by the loader.
  SELECT jsonb_agg(jsonb_build_object(
    'slot_id', sub.slot_id,
    'checkin_id', sub.checkin_id,
    'bound_at', sub.bound_at
  )) INTO submission_rows
  FROM entry_access.submissions sub
  WHERE sub.booking_id = b.id;

  IF b.manual_audit_id IS NOT NULL THEN
    SELECT * INTO audit_row FROM entry_access.audit WHERE id = b.manual_audit_id;
  END IF;

  RETURN jsonb_build_object(
    'booking_id', b.id,
    'property_id', b.property_id,
    'booking_code', b.booking_code,
    'is_test', b.is_test,
    'state_version', b.state_version,
    'identity_version', b.identity_version,
    'roster_version', b.roster_version,
    'roster_source', b.roster_source,
    'roster_confirmed', b.roster_confirmed,
    'expected_count', b.expected_count,
    'arrival_date', b.arrival_date,
    'departure_date', b.departure_date,
    'reservation_id', b.reservation_id,
    'released_manually', b.released_manually,
    'manual_audit_id', b.manual_audit_id,
    'created_at', b.created_at,
    'updated_at', b.updated_at,
    'slots', COALESCE(slot_rows, '[]'::jsonb),
    'submissions', COALESCE(submission_rows, '[]'::jsonb),
    'override_audit', CASE WHEN b.manual_audit_id IS NOT NULL AND audit_row.id IS NOT NULL
      THEN jsonb_build_object(
        'id', audit_row.id,
        'actor_id', audit_row.actor_id,
        'action', audit_row.action,
        'created_at', audit_row.created_at
      )
      ELSE NULL
    END
  );
END $$;

REVOKE ALL ON FUNCTION public.get_entry_access_booking_state(uuid, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_entry_access_booking_state(uuid, text, boolean) TO authenticated, service_role;

COMMIT;
