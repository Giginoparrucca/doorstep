-- Round 68: optional invoice details on check-ins (codice fiscale, street
-- address, postcode, province). Country and comune/city reuse the Round 47.2
-- residence_country / residence_place columns. Format checks only; NULL allowed.
-- The Round 48d filed lock does not cover residence or these columns, so hosts
-- can still edit them after Alloggiati filing. The atomic submission function
-- below is the Round 66 source with only the inserted column list extended.
BEGIN;
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS fiscal_code text,
  ADD COLUMN IF NOT EXISTS residence_address text,
  ADD COLUMN IF NOT EXISTS residence_postcode text,
  ADD COLUMN IF NOT EXISTS residence_province text;
ALTER TABLE public.checkins
  DROP CONSTRAINT IF EXISTS checkins_fiscal_code_format,
  DROP CONSTRAINT IF EXISTS checkins_residence_province_format,
  DROP CONSTRAINT IF EXISTS checkins_residence_address_length,
  DROP CONSTRAINT IF EXISTS checkins_residence_postcode_length,
  ADD CONSTRAINT checkins_fiscal_code_format CHECK (fiscal_code IS NULL OR fiscal_code ~ '^[A-Z0-9]{16}$'),
  ADD CONSTRAINT checkins_residence_province_format CHECK (residence_province IS NULL OR residence_province ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT checkins_residence_address_length CHECK (residence_address IS NULL OR char_length(residence_address) <= 120),
  ADD CONSTRAINT checkins_residence_postcode_length CHECK (residence_postcode IS NULL OR char_length(residence_postcode) <= 12);

CREATE OR REPLACE FUNCTION public.entry_access_submit_checkin(
  p_property_id uuid, p_booking_code text, p_is_test boolean,
  p_submission_id uuid, p_ordinal integer, p_record jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  prop public.properties%ROWTYPE;
  r public.ota_reservations%ROWTYPE;
  b entry_access.bookings%ROWTYPE;
  s entry_access.slots%ROWTYPE;
  c public.checkins%ROWTYPE;
  prior entry_access.submissions%ROWTYPE;
  matches integer;
  request_hash text;
  changed_identity boolean := false;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO prop FROM public.properties WHERE id=p_property_id AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown property' USING ERRCODE='22023'; END IF;
  IF prop.entry_checkin_required IS NOT TRUE THEN RETURN jsonb_build_object('enabled',false); END IF;
  IF p_is_test IS NULL OR p_submission_id IS NULL OR p_ordinal IS NULL OR p_ordinal NOT BETWEEN 1 AND 50
    OR p_booking_code IS NULL OR length(btrim(p_booking_code)) NOT BETWEEN 1 AND 120
    OR p_booking_code<>btrim(p_booking_code) OR jsonb_typeof(p_record) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Submission identity required' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_property_id::text||':'||p_booking_code||':'||p_is_test::text,66));
  SELECT count(*) INTO matches FROM public.ota_reservations
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test;
  IF matches>1 THEN RAISE EXCEPTION 'Ambiguous reservation' USING ERRCODE='22023'; END IF;
  IF matches=1 THEN
    SELECT * INTO r FROM public.ota_reservations WHERE property_id=p_property_id
      AND booking_code=p_booking_code AND is_test=p_is_test FOR SHARE;
    IF r.status IS DISTINCT FROM 'active' OR r.deleted_at IS NOT NULL OR r.entry_type IS DISTINCT FROM 'reservation'
      THEN RAISE EXCEPTION 'Invalid reservation' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO b FROM entry_access.bookings WHERE property_id=p_property_id
    AND booking_code=p_booking_code AND is_test=p_is_test FOR UPDATE;
  IF NOT FOUND THEN
    IF matches<>1 OR r.guest_count IS NULL OR r.guest_count NOT BETWEEN 1 AND 50
      OR r.checkin_date IS NULL OR r.checkout_date<=r.checkin_date THEN
      RAISE EXCEPTION 'Host-confirmed roster required' USING ERRCODE='22023';
    END IF;
    INSERT INTO entry_access.bookings(property_id,booking_code,is_test,reservation_id,
      arrival_date,departure_date,expected_count,roster_source)
      VALUES(p_property_id,p_booking_code,p_is_test,r.id,r.checkin_date,r.checkout_date,r.guest_count,'reservation')
      RETURNING * INTO b;
  ELSE
    IF b.status<>'active' OR NOT b.roster_confirmed OR (b.reservation_id IS NOT NULL AND matches=0)
      OR (b.reservation_id IS NULL AND matches>0) THEN
      RAISE EXCEPTION 'Invalid booking contract' USING ERRCODE='22023';
    END IF;
    IF matches=1 THEN
      changed_identity:=b.reservation_id IS DISTINCT FROM r.id OR b.arrival_date IS DISTINCT FROM r.checkin_date
        OR b.departure_date IS DISTINCT FROM r.checkout_date;
      -- Preserve explicit host totals; reservation count is a floor.
      IF changed_identity OR coalesce(r.guest_count,0)>b.expected_count THEN
        IF r.guest_count IS NULL OR r.guest_count NOT BETWEEN 1 AND 50 THEN
          RAISE EXCEPTION 'Unknown reservation count' USING ERRCODE='22023';
        END IF;
        UPDATE entry_access.bookings SET reservation_id=r.id,arrival_date=r.checkin_date,departure_date=r.checkout_date,
          expected_count=CASE WHEN changed_identity THEN r.guest_count ELSE greatest(expected_count,r.guest_count) END,
          identity_version=CASE WHEN changed_identity THEN gen_random_uuid() ELSE identity_version END,
          roster_version=gen_random_uuid(),state_version=gen_random_uuid(),updated_at=clock_timestamp(),
          released_manually=false,manual_audit_id=NULL WHERE id=b.id RETURNING * INTO b;
        IF changed_identity THEN
          UPDATE entry_access.slots SET retired_at=clock_timestamp() WHERE booking_id=b.id AND retired_at IS NULL;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p_ordinal>b.expected_count THEN RAISE EXCEPTION 'Guest exceeds roster' USING ERRCODE='22023'; END IF;
  c:=jsonb_populate_record(NULL::public.checkins,p_record);
  IF c.id_photo_path IS NOT NULL AND (
    c.id_photo_path NOT LIKE 'id-photos/'||p_property_id::text||'/'||p_submission_id::text||'/%'
    OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=c.id_photo_path)) THEN
    RAISE EXCEPTION 'Unverified document upload' USING ERRCODE='22023';
  END IF;
  IF c.arrival_date IS DISTINCT FROM b.arrival_date OR c.departure_date IS DISTINCT FROM b.departure_date
    OR c.nights IS DISTINCT FROM (b.departure_date-b.arrival_date)
    OR (p_ordinal=1 AND c.guest_type NOT IN ('single','head','group'))
    OR (p_ordinal>1 AND c.guest_type NOT IN ('member','group_member')) OR c.guest_type IS NULL THEN
    RAISE EXCEPTION 'Guest does not match roster' USING ERRCODE='22023';
  END IF;
  INSERT INTO entry_access.slots(booking_id,property_id,ordinal)
    SELECT b.id,b.property_id,n FROM generate_series(1,b.expected_count) n
    ON CONFLICT (booking_id,ordinal) WHERE retired_at IS NULL DO NOTHING;
  SELECT * INTO s FROM entry_access.slots WHERE booking_id=b.id AND ordinal=p_ordinal AND retired_at IS NULL FOR UPDATE;
  request_hash:=encode(sha256(convert_to(p_record::text,'UTF8')),'hex');
  SELECT * INTO prior FROM entry_access.submissions WHERE checkin_id=p_submission_id;
  IF FOUND THEN
    IF prior.slot_id<>s.id OR prior.property_id<>p_property_id OR prior.request_hash IS DISTINCT FROM request_hash
      OR NOT EXISTS (SELECT 1 FROM public.checkins WHERE id=p_submission_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'Submission identity reused' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('enabled',true,'id',p_submission_id,'booking_code',p_booking_code,'expected_count',b.expected_count);
  END IF;
  IF EXISTS(SELECT 1 FROM entry_access.submissions WHERE slot_id=s.id) THEN
    RAISE EXCEPTION 'Guest slot already saved' USING ERRCODE='40001';
  END IF;
  IF p_ordinal=1 AND b.expected_count>1 AND c.guest_type='single' THEN c.guest_type:='head'; END IF;
  INSERT INTO public.checkins(id,property_id,booking_code,is_test,guest_type,surname,name,sex,date_of_birth,
    place_of_birth,birth_province,birth_country,citizenship,document_type,document_number,doc_issue_place,
    arrival_date,departure_date,nights,id_photo_path,docs_status,residence_country,residence_place,
    fiscal_code,residence_address,residence_postcode,residence_province,submitted_at,room_id)
    VALUES(p_submission_id,p_property_id,p_booking_code,p_is_test,c.guest_type,c.surname,c.name,c.sex,c.date_of_birth,
      c.place_of_birth,c.birth_province,c.birth_country,c.citizenship,coalesce(c.document_type,''),coalesce(c.document_number,''),
      c.doc_issue_place,b.arrival_date,b.departure_date,c.nights,c.id_photo_path,c.docs_status,
      c.residence_country,c.residence_place,
      c.fiscal_code,c.residence_address,c.residence_postcode,c.residence_province,clock_timestamp(),r.room_id);
  UPDATE entry_access.slots SET guest_type=c.guest_type WHERE id=s.id;
  INSERT INTO entry_access.submissions(slot_id,booking_id,property_id,checkin_id,request_hash)
    VALUES(s.id,b.id,p_property_id,p_submission_id,request_hash);
  -- Existing reopened-group flow adds missing guests. Clear its operational
  -- flag atomically; required slots and current-field validation still gate entry.
  UPDATE public.checkins SET checkin_reopened_at=NULL WHERE property_id=p_property_id
    AND booking_code=p_booking_code AND is_test=p_is_test AND deleted_at IS NULL;
  UPDATE public.ota_reservations SET checkin_reopened_at=NULL WHERE id=b.reservation_id;
  RETURN jsonb_build_object('enabled',true,'id',p_submission_id,'booking_code',p_booking_code,'expected_count',b.expected_count);
END $$;
REVOKE ALL ON FUNCTION public.entry_access_submit_checkin(uuid,text,boolean,uuid,integer,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.entry_access_submit_checkin(uuid,text,boolean,uuid,integer,jsonb) TO service_role;
COMMIT;
