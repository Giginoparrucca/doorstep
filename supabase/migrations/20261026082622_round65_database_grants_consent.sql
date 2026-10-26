-- Round 65 Phase 3: preserve retention bodies; close public execution.
REVOKE ALL ON FUNCTION public.purge_old_id_photos(boolean,integer,integer,integer),
  public.enqueue_orphan_documents(boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_id_photos(boolean,integer,integer,integer),
  public.enqueue_orphan_documents(boolean,integer) TO service_role;
REVOKE ALL ON FUNCTION public.list_hosts_for_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_hosts_for_admin() TO authenticated,service_role;

-- EXISTS(properties) in an anon INSERT policy cannot see rows through the
-- current property RLS. Close that path and use a service-only transaction.
DROP POLICY IF EXISTS marketing_consents_anon_insert ON public.marketing_consents;
REVOKE INSERT ON TABLE public.marketing_consents FROM anon;

CREATE OR REPLACE FUNCTION public.save_guest_marketing_consent(
  p_property_id uuid,p_booking_code text,p_email text,p_phone text,p_consent boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE
  email_value text:=nullif(lower(btrim(p_email)),'');
  phone_value text:=nullif(btrim(p_phone),'');
  main_guest text;
  existing_id uuid;
  reservation_count integer;
  active_count integer;
BEGIN
  IF p_consent IS DISTINCT FROM true OR p_booking_code IS NULL OR length(p_booking_code) NOT BETWEEN 1 AND 120
    OR (email_value IS NULL AND phone_value IS NULL)
    OR (email_value IS NOT NULL AND (length(email_value)>254 OR email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
    OR (phone_value IS NOT NULL AND (length(phone_value)>40 OR phone_value !~ '^\+?[0-9() .-]{6,40}$'))
    THEN RAISE EXCEPTION 'Invalid consent request' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND deleted_at IS NULL AND is_test=false)
    THEN RAISE EXCEPTION 'Invalid consent booking' USING ERRCODE='42501'; END IF;
  -- Locks serialize retries, deduplication and the five-events/hour cap for
  -- one authoritative property/booking, even across different guest sessions.
  PERFORM pg_advisory_xact_lock(hashtextextended('consent:'||p_property_id::text||':'||p_booking_code,65));
  SELECT count(*),count(*) FILTER(WHERE status='active' AND entry_type='reservation' AND deleted_at IS NULL)
    INTO reservation_count,active_count FROM public.ota_reservations
    WHERE property_id=p_property_id AND booking_code=p_booking_code;
  IF reservation_count>0 AND (reservation_count<>1 OR active_count<>1) THEN
    RAISE EXCEPTION 'Invalid consent booking' USING ERRCODE='42501';
  END IF;
  SELECT nullif(btrim(concat_ws(' ',surname,name)),'') INTO main_guest FROM public.checkins
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=false
      AND deleted_at IS NULL AND submitted_at IS NOT NULL AND guest_type IN ('single','head','group')
    ORDER BY submitted_at,id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Check-in required' USING ERRCODE='42501'; END IF;
  SELECT id INTO existing_id FROM public.marketing_consents
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND withdrawn_at IS NULL
      AND email IS NOT DISTINCT FROM email_value AND phone IS NOT DISTINCT FROM phone_value
    ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  IF (SELECT count(*) FROM public.marketing_consents WHERE property_id=p_property_id AND booking_code=p_booking_code
      AND created_at>=clock_timestamp()-interval '1 hour')>=5 THEN
    RAISE EXCEPTION 'Consent rate limit' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.marketing_consents(property_id,booking_code,guest_name,email,phone,consent_text_version)
    VALUES(p_property_id,p_booking_code,main_guest,email_value,phone_value,'v1');
  RETURN jsonb_build_object('ok',true,'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION public.save_guest_marketing_consent(uuid,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_guest_marketing_consent(uuid,text,text,text,boolean) TO service_role;
