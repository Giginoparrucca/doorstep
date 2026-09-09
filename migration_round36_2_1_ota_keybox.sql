-- Round 36.2.1 — Rotating lockbox code lives on the reservation, not the check-in.
--
-- R36.2 stored the rotating code on checkins.keybox_code, generated at
-- check-in insert time. That's too late — the host wants to see the code
-- on the dashboard the moment a booking link exists, so they can
-- physically program the lockbox before the guest arrives.
--
-- This round moves the code up a level: it lives on the reservation
-- (ota_reservations.keybox_code) and is generated whenever a booking
-- link is minted. The guest-app fallback picks it up on read.

ALTER TABLE public.ota_reservations
  ADD COLUMN IF NOT EXISTS keybox_code text;

-- Guests use the anon key and can't SELECT ota_reservations directly (host-
-- scoped RLS). This SECURITY DEFINER function exposes exactly one field —
-- the keybox_code — for the (property_id, booking_code) tuple the guest
-- already knows from their URL. Nothing else about the reservation leaks.
CREATE OR REPLACE FUNCTION public.get_reservation_keybox(p_property_id uuid, p_booking_code text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT keybox_code
  FROM public.ota_reservations
  WHERE property_id = p_property_id
    AND booking_code = p_booking_code
    AND deleted_at IS NULL
  ORDER BY created_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_reservation_keybox(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_reservation_keybox(uuid, text) TO anon, authenticated, service_role;

-- Rollback:
-- DROP FUNCTION IF EXISTS public.get_reservation_keybox(uuid, text);
-- ALTER TABLE public.ota_reservations DROP COLUMN IF EXISTS keybox_code;
