BEGIN;
-- Current admin membership is checked against the authenticated database user,
-- never browser metadata or a supplied actor/email.
CREATE OR REPLACE FUNCTION entry_access.current_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM auth.users u JOIN public.admin_users a ON lower(a.email)=lower(u.email)
 WHERE u.id=auth.uid() AND u.email_confirmed_at IS NOT NULL)
$$;
REVOKE ALL ON FUNCTION entry_access.current_admin() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION entry_access.audit_admin_change(p_property uuid,p_action text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid(); email_value text;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.properties WHERE id=p_property AND owner_id=actor AND deleted_at IS NULL) THEN RETURN; END IF;
 IF NOT entry_access.current_admin() OR p_action NOT IN ('entry_view','entry_roster_confirmed','entry_released','automatic_restored')
 THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 SELECT email INTO email_value FROM auth.users WHERE id=actor;
 INSERT INTO public.admin_impersonation_log(admin_id,admin_email,property_id,action)
 VALUES(actor,email_value,p_property,p_action);
END $$;
REVOKE ALL ON FUNCTION entry_access.audit_admin_change(uuid,text) FROM PUBLIC,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.entry_access_confirm_roster(
  p_property_id uuid, p_booking_code text, p_count integer,
  p_arrival date, p_departure date, p_request_id uuid,
  p_reservation_id uuid DEFAULT NULL, p_expected_version uuid DEFAULT NULL,
  p_is_test boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor uuid := auth.uid();
  b entry_access.bookings%ROWTYPE;
  r public.ota_reservations%ROWTYPE;
  old_event entry_access.audit%ROWTYPE;
  request_data jsonb;
  answer jsonb;
  identity_changed boolean := false;
  count_changed boolean := false;
  matching integer;
BEGIN
  -- Explicit current owner or verified admin predicate, independent of browser metadata.
  -- Admin mutations append both audit records atomically below.
  PERFORM 1 FROM public.properties WHERE id=p_property_id AND (owner_id=actor OR entry_access.current_admin()) AND deleted_at IS NULL FOR SHARE;
  IF actor IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NULL OR p_is_test IS NULL OR p_count IS NULL OR p_count NOT BETWEEN 1 AND 50
    OR p_booking_code IS NULL OR length(btrim(p_booking_code)) NOT BETWEEN 1 AND 120
    OR p_booking_code<>btrim(p_booking_code) OR p_arrival IS NULL OR p_departure IS NULL
    OR p_departure<=p_arrival THEN RAISE EXCEPTION 'Invalid roster request' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_property_id::text||':'||p_booking_code||':'||p_is_test::text,66));
  request_data:=jsonb_build_object('booking_hash',encode(sha256(convert_to(p_booking_code,'UTF8')),'hex'),
    'count',p_count,'arrival',p_arrival,'departure',p_departure,'reservation_id',p_reservation_id,
    'expected_version',p_expected_version,'is_test',p_is_test);
  SELECT * INTO old_event FROM entry_access.audit WHERE property_id=p_property_id AND request_id=p_request_id;
  IF FOUND THEN
    IF old_event.actor_id<>actor OR old_event.action<>'roster_confirmed' OR old_event.request_data<>request_data
      THEN RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE='22023'; END IF;
    RETURN old_event.result;
  END IF;
  -- A standalone contract cannot hide an existing reservation, including a
  -- cancelled/deleted reservation sharing the link identity.
  SELECT count(*) INTO matching FROM public.ota_reservations
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test;
  IF p_reservation_id IS NULL AND matching>0 THEN
    RAISE EXCEPTION 'Reservation binding required' USING ERRCODE='22023';
  END IF;
  IF p_reservation_id IS NOT NULL THEN
    SELECT * INTO r FROM public.ota_reservations WHERE id=p_reservation_id FOR SHARE;
    IF NOT FOUND OR matching<>1 OR r.property_id<>p_property_id OR r.booking_code IS DISTINCT FROM p_booking_code
      OR r.is_test<>p_is_test OR r.status<>'active' OR r.deleted_at IS NOT NULL OR r.entry_type<>'reservation'
      OR r.checkin_date IS DISTINCT FROM p_arrival OR r.checkout_date IS DISTINCT FROM p_departure
      OR (r.guest_count IS NOT NULL AND p_count<r.guest_count)
      THEN RAISE EXCEPTION 'Reservation does not match roster' USING ERRCODE='22023'; END IF;
  END IF;
  SELECT * INTO b FROM entry_access.bookings
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test FOR UPDATE;
  IF FOUND THEN
    IF p_expected_version IS DISTINCT FROM b.state_version OR b.status<>'active'
      THEN RAISE EXCEPTION 'Stale booking version' USING ERRCODE='40001'; END IF;
    identity_changed:=b.arrival_date<>p_arrival OR b.departure_date<>p_departure
      OR b.reservation_id IS DISTINCT FROM p_reservation_id;
    count_changed:=b.expected_count<>p_count;
    UPDATE entry_access.bookings SET expected_count=p_count, arrival_date=p_arrival, departure_date=p_departure,
      reservation_id=p_reservation_id, roster_confirmed=true,
      identity_version=CASE WHEN identity_changed THEN gen_random_uuid() ELSE identity_version END,
      roster_version=CASE WHEN identity_changed OR count_changed THEN gen_random_uuid() ELSE roster_version END,
      state_version=gen_random_uuid(), updated_at=clock_timestamp(),
      released_manually=CASE WHEN identity_changed THEN false ELSE released_manually END,
      manual_audit_id=CASE WHEN identity_changed THEN NULL ELSE manual_audit_id END
      WHERE id=b.id RETURNING * INTO b;
  ELSE
    IF p_expected_version IS NOT NULL THEN RAISE EXCEPTION 'Stale booking version' USING ERRCODE='40001'; END IF;
    INSERT INTO entry_access.bookings(property_id,booking_code,is_test,reservation_id,arrival_date,departure_date,expected_count)
      VALUES(p_property_id,p_booking_code,p_is_test,p_reservation_id,p_arrival,p_departure,p_count) RETURNING * INTO b;
  END IF;
  -- Retire slots rather than reusing their identities for another required
  -- guest after roster shrink/growth. Identity changes retire the whole roster.
  UPDATE entry_access.slots SET retired_at=clock_timestamp()
    WHERE booking_id=b.id AND retired_at IS NULL AND (ordinal>p_count OR identity_changed);
  INSERT INTO entry_access.slots(booking_id,property_id,ordinal)
    SELECT b.id,b.property_id,n FROM generate_series(1,p_count) n
    ON CONFLICT (booking_id,ordinal) WHERE retired_at IS NULL DO NOTHING;
  answer:=entry_access.summary(b);
  PERFORM entry_access.audit_admin_change(p_property_id,'entry_roster_confirmed');
  INSERT INTO entry_access.audit(id,booking_id,property_id,actor_id,request_id,action,request_data,result)
    VALUES(gen_random_uuid(),b.id,b.property_id,actor,p_request_id,'roster_confirmed',request_data,answer);
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.entry_access_set_release(
  p_booking_id uuid,p_release boolean,p_expected_version uuid,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  actor uuid:=auth.uid();
  b entry_access.bookings%ROWTYPE;
  r public.ota_reservations%ROWTYPE;
  old_event entry_access.audit%ROWTYPE;
  request_data jsonb;
  answer jsonb;
  event_id uuid:=gen_random_uuid();
  event_action text;
BEGIN
  SELECT * INTO b FROM entry_access.bookings WHERE id=p_booking_id;
  IF NOT FOUND OR actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  -- Same lock order as confirm_roster: property, advisory booking, booking row.
  PERFORM 1 FROM public.properties WHERE id=b.property_id AND (owner_id=actor OR entry_access.current_admin()) AND deleted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(b.property_id::text||':'||b.booking_code||':'||b.is_test::text,66));
  SELECT * INTO b FROM entry_access.bookings WHERE id=p_booking_id FOR UPDATE;
  IF p_request_id IS NULL OR p_release IS NULL THEN RAISE EXCEPTION 'Invalid release request' USING ERRCODE='22023'; END IF;
  event_action:=CASE WHEN p_release THEN 'entry_released' ELSE 'automatic_restored' END;
  request_data:=jsonb_build_object('booking_id',b.id,'release',p_release,'expected_version',p_expected_version);
  SELECT * INTO old_event FROM entry_access.audit WHERE property_id=b.property_id AND request_id=p_request_id;
  IF FOUND THEN
    IF old_event.actor_id<>actor OR old_event.action<>event_action OR old_event.request_data<>request_data
      THEN RAISE EXCEPTION 'Idempotency key reused' USING ERRCODE='22023'; END IF;
    RETURN old_event.result;
  END IF;
  IF p_expected_version IS DISTINCT FROM b.state_version OR b.status<>'active'
    THEN RAISE EXCEPTION 'Stale booking version' USING ERRCODE='40001'; END IF;
  IF b.reservation_id IS NOT NULL THEN
    SELECT * INTO r FROM public.ota_reservations WHERE id=b.reservation_id FOR SHARE;
    IF NOT FOUND OR r.property_id<>b.property_id OR r.booking_code IS DISTINCT FROM b.booking_code
      OR r.is_test<>b.is_test OR r.status<>'active' OR r.deleted_at IS NOT NULL OR r.entry_type<>'reservation'
      OR r.checkin_date IS DISTINCT FROM b.arrival_date OR r.checkout_date IS DISTINCT FROM b.departure_date
      THEN RAISE EXCEPTION 'Booking is no longer valid' USING ERRCODE='22023'; END IF;
  END IF;
  -- Insert audit FIRST; any later failure rolls it back together with release.
  -- FK is deferred by ordering only: audit references an existing booking.
  answer:=entry_access.summary(b)||jsonb_build_object('state_version',gen_random_uuid(),
    'released_manually',p_release,'audit_id',CASE WHEN p_release THEN event_id ELSE NULL END);
  PERFORM entry_access.audit_admin_change(b.property_id,event_action);
  INSERT INTO entry_access.audit(id,booking_id,property_id,actor_id,request_id,action,request_data,result)
    VALUES(event_id,b.id,b.property_id,actor,p_request_id,event_action,request_data,answer);
  UPDATE entry_access.bookings SET released_manually=p_release,
    manual_audit_id=CASE WHEN p_release THEN event_id ELSE NULL END,
    state_version=(answer->>'state_version')::uuid,updated_at=clock_timestamp()
    WHERE id=b.id;
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION entry_access.booking_state(
  p_property_id uuid, p_booking_code text, p_is_test boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  caller_role text := current_setting('role', true);
  b entry_access.bookings%ROWTYPE;
  audit_row entry_access.audit%ROWTYPE;
  slot_rows jsonb;
  submission_rows jsonb;
BEGIN
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
REVOKE ALL ON FUNCTION entry_access.booking_state(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION entry_access.booking_snapshot(
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
  state:=entry_access.booking_state(p_property_id,p_booking_code,p_is_test);
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

REVOKE ALL ON FUNCTION entry_access.booking_snapshot(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.get_entry_access_booking_snapshot(p_property_id uuid,p_booking_code text,p_is_test boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 RETURN entry_access.booking_snapshot(p_property_id,p_booking_code,p_is_test);
END $$;
CREATE OR REPLACE FUNCTION public.entry_access_host_state(p_property_id uuid,p_booking_code text,p_is_test boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prop public.properties%ROWTYPE; b entry_access.bookings%ROWTYPE; r public.ota_reservations%ROWTYPE; matches integer; actor uuid:=auth.uid();
BEGIN
 SELECT * INTO prop FROM public.properties WHERE id=p_property_id AND deleted_at IS NULL
 AND (owner_id=actor OR entry_access.current_admin());
 IF NOT FOUND OR actor IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_booking_code IS NULL OR btrim(p_booking_code)='' OR p_is_test IS NULL THEN RAISE EXCEPTION 'Invalid booking scope' USING ERRCODE='22023'; END IF;
 PERFORM entry_access.audit_admin_change(p_property_id,'entry_view');
 SELECT * INTO b FROM entry_access.bookings WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test;
 SELECT count(*) INTO matches FROM public.ota_reservations WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test;
 IF matches=1 THEN SELECT * INTO r FROM public.ota_reservations WHERE property_id=p_property_id AND booking_code=p_booking_code AND is_test=p_is_test; END IF;
 RETURN jsonb_build_object('enabled',prop.entry_checkin_required,'summary',CASE WHEN b.id IS NOT NULL THEN entry_access.summary(b)||jsonb_build_object('reservation_id',b.reservation_id,'arrival_date',b.arrival_date,'departure_date',b.departure_date) ELSE NULL END,
 'reservation',CASE WHEN r.id IS NOT NULL THEN jsonb_build_object('id',r.id,'guest_count',r.guest_count,'checkin_date',r.checkin_date,'checkout_date',r.checkout_date) ELSE NULL END,
 'snapshot',entry_access.booking_snapshot(p_property_id,p_booking_code,p_is_test));
END $$;
REVOKE ALL ON FUNCTION public.entry_access_confirm_roster(uuid,text,integer,date,date,uuid,uuid,uuid,boolean),
 public.entry_access_set_release(uuid,boolean,uuid,uuid),public.entry_access_host_state(uuid,text,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.entry_access_confirm_roster(uuid,text,integer,date,date,uuid,uuid,uuid,boolean),
 public.entry_access_set_release(uuid,boolean,uuid,uuid),public.entry_access_host_state(uuid,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.get_entry_access_booking_snapshot(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_entry_access_booking_snapshot(uuid,text,boolean) TO service_role;
COMMIT;
