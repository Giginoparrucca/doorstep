-- Round 66 Phase 1c: service-only atomic inserts and coherent validation reads.
-- Existing OFF clients and host release RPCs keep their contracts. No opt-ins.
BEGIN;
ALTER TABLE entry_access.slots ADD COLUMN IF NOT EXISTS guest_type text;
ALTER TABLE entry_access.slots ADD COLUMN IF NOT EXISTS photo_required boolean NOT NULL DEFAULT false;
ALTER TABLE entry_access.submissions ADD COLUMN IF NOT EXISTS request_hash text;

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
    arrival_date,departure_date,nights,id_photo_path,docs_status,residence_country,residence_place,submitted_at,room_id)
    VALUES(p_submission_id,p_property_id,p_booking_code,p_is_test,c.guest_type,c.surname,c.name,c.sex,c.date_of_birth,
      c.place_of_birth,c.birth_province,c.birth_country,c.citizenship,coalesce(c.document_type,''),coalesce(c.document_number,''),
      c.doc_issue_place,b.arrival_date,b.departure_date,c.nights,c.id_photo_path,c.docs_status,
      c.residence_country,c.residence_place,clock_timestamp(),r.room_id);
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

-- Entire ON snapshot is read in one STABLE RPC. Full current records and
-- storage evidence never reach the browser or the model.
CREATE OR REPLACE FUNCTION public.get_entry_access_booking_snapshot(
  p_property_id uuid,p_booking_code text,p_is_test boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  state jsonb;
  b entry_access.bookings%ROWTYPE;
  r public.ota_reservations%ROWTYPE;
  prop public.properties%ROWTYPE;
  matches integer;
  rows_json jsonb;
  bindings_json jsonb;
  slots_json jsonb;
  rooms uuid[];
  room_json jsonb;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  SELECT * INTO prop FROM public.properties WHERE id=p_property_id AND deleted_at IS NULL;
  IF NOT FOUND OR prop.entry_checkin_required IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO b FROM entry_access.bookings WHERE property_id=p_property_id
    AND booking_code=p_booking_code AND is_test=p_is_test;
  IF NOT FOUND OR b.status<>'active' THEN RETURN NULL; END IF;
  SELECT count(*) INTO matches FROM public.ota_reservations WHERE property_id=p_property_id
    AND booking_code=p_booking_code AND is_test=p_is_test;
  IF matches>1 OR (b.reservation_id IS NULL AND matches>0) THEN RETURN NULL; END IF;
  IF b.reservation_id IS NOT NULL THEN
    SELECT * INTO r FROM public.ota_reservations WHERE id=b.reservation_id;
    IF NOT FOUND OR matches<>1 OR r.property_id<>p_property_id OR r.booking_code IS DISTINCT FROM p_booking_code
      OR r.is_test<>p_is_test OR r.status IS DISTINCT FROM 'active' OR r.deleted_at IS NOT NULL
      OR r.entry_type IS DISTINCT FROM 'reservation' OR r.checkin_date IS DISTINCT FROM b.arrival_date
      OR r.checkout_date IS DISTINCT FROM b.departure_date OR coalesce(r.guest_count,0)>b.expected_count THEN RETURN NULL; END IF;
  END IF;
  state:=public.get_entry_access_booking_state(p_property_id,p_booking_code,p_is_test);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'ordinal',s.ordinal,
    'guest_type',s.guest_type,'photo_required',s.photo_required) ORDER BY s.ordinal),'[]'::jsonb)
    INTO slots_json FROM entry_access.slots s WHERE s.booking_id=b.id AND s.retired_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object('slot_id',sub.slot_id,'checkin_id',sub.checkin_id,
    'booking_id',sub.booking_id,'property_id',sub.property_id)),'[]'::jsonb) INTO bindings_json
    FROM entry_access.submissions sub JOIN entry_access.slots s ON s.id=sub.slot_id
    WHERE sub.booking_id=b.id AND s.retired_at IS NULL;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'property_id',c.property_id,'booking_code',c.booking_code,'is_test',c.is_test,'deleted_at',c.deleted_at,
    'guest_type',c.guest_type,'surname',c.surname,'name',c.name,'sex',c.sex,'date_of_birth',c.date_of_birth,
    'place_of_birth',c.place_of_birth,'birth_province',c.birth_province,'birth_country',c.birth_country,
    'citizenship',c.citizenship,'document_type',c.document_type,'document_number',c.document_number,
    'doc_issue_place',c.doc_issue_place,'arrival_date',c.arrival_date,'departure_date',c.departure_date,'nights',c.nights,
    'id_photo_path',c.id_photo_path,'submitted_at',c.submitted_at,'checkin_reopened_at',c.checkin_reopened_at,
    'keybox_code',c.keybox_code,
    'entry_photo_verified',c.id_photo_path LIKE 'id-photos/'||p_property_id::text||'/'||c.id::text||'/%'
      AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='documents' AND o.name=c.id_photo_path)
  )),'[]'::jsonb) INTO rows_json FROM entry_access.submissions sub JOIN public.checkins c ON c.id=sub.checkin_id
    JOIN entry_access.slots s ON s.id=sub.slot_id AND s.retired_at IS NULL
    WHERE sub.booking_id=b.id AND c.property_id=p_property_id AND c.booking_code=p_booking_code AND c.is_test=p_is_test;
  SELECT array_agg(DISTINCT rid) INTO rooms FROM (
    SELECT c.room_id rid FROM public.checkins c WHERE c.property_id=p_property_id AND c.booking_code=p_booking_code
      AND c.is_test=p_is_test AND c.deleted_at IS NULL AND c.room_id IS NOT NULL
    UNION SELECT r.room_id WHERE r.room_id IS NOT NULL
  ) q;
  IF cardinality(rooms)=1 THEN
    SELECT jsonb_build_object('id',pr.id,'property_id',pr.property_id,'deleted_at',pr.deleted_at,'door_code',pr.door_code)
      INTO room_json FROM public.property_rooms pr WHERE pr.id=rooms[1] AND pr.property_id=p_property_id AND pr.deleted_at IS NULL;
  END IF;
  RETURN state||jsonb_build_object('snapshot_version',2,'status',b.status,'slots',slots_json,'submissions',bindings_json,
    'current_rows',rows_json,'property_snapshot',jsonb_build_object('id',prop.id,'deleted_at',prop.deleted_at,
      'entry_checkin_required',prop.entry_checkin_required,'entry_release_time',prop.entry_release_time,
      'entry_release_timezone',prop.entry_release_timezone,'access_method',prop.access_method,'keybox_code',prop.keybox_code,
      'show_fixed_lockbox_to_guest',prop.show_fixed_lockbox_to_guest,'show_rotating_lockbox_to_guest',prop.show_rotating_lockbox_to_guest,
      'rotating_lockbox_enabled',prop.rotating_lockbox_enabled,'use_per_guest_lockbox',prop.use_per_guest_lockbox),
    'reservation_snapshot',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id',r.id,'property_id',r.property_id,
      'booking_code',r.booking_code,'is_test',r.is_test,'status',r.status,'deleted_at',r.deleted_at,
      'entry_type',r.entry_type,'room_id',r.room_id,'keybox_code',r.keybox_code,
      'checkin_date',r.checkin_date,'checkout_date',r.checkout_date,'guest_count',r.guest_count) ELSE NULL END,
    'room_resolution',CASE WHEN coalesce(cardinality(rooms),0)=0 THEN 'none'
      WHEN cardinality(rooms)=1 AND room_json IS NOT NULL THEN 'unique' ELSE 'ambiguous' END,
    'room_snapshot',room_json,'resolved_room_id',CASE WHEN cardinality(rooms)=1 THEN rooms[1] ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.get_entry_access_booking_snapshot(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_entry_access_booking_snapshot(uuid,text,boolean) TO service_role;
COMMIT;
