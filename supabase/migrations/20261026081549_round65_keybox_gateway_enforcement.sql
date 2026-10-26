-- Round 65 Phase 2: host ownership for every non-service caller. Guest browser
-- reads move to the token-authenticated gateway; preserve its existing trusted
-- service-role caller during rolling deployment. Never trust user_metadata or
-- auth.role() to exempt anon callers from the owner check.
CREATE OR REPLACE FUNCTION public.get_reservation_keybox(p_property_id uuid,p_booking_code text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.properties WHERE id=p_property_id
         AND owner_id=auth.uid() AND deleted_at IS NULL
     )) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT keybox_code FROM public.ota_reservations
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND deleted_at IS NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION public.get_reservation_keybox(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_reservation_keybox(uuid,text) TO authenticated,service_role;
