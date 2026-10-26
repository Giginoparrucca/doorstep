-- Round 66 Phase 1b: STAGED ONLY, not applied or registered as a migration.
-- CLI-created migration held outside supabase/migrations until Round 65's
-- keybox contract/serialized application gate. No activation/property changes.
BEGIN;

CREATE SCHEMA IF NOT EXISTS entry_access;
REVOKE ALL ON SCHEMA entry_access FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA entry_access TO service_role;

CREATE TABLE IF NOT EXISTS entry_access.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_code text NOT NULL CHECK (length(btrim(booking_code)) BETWEEN 1 AND 120),
  is_test boolean NOT NULL,
  -- Keep a deleted reservation's identity as an invalid tombstone. SET NULL
  -- would silently turn it into a standalone booking; a restrictive FK would
  -- break the existing physical retention purge.
  reservation_id uuid,
  arrival_date date NOT NULL,
  departure_date date NOT NULL CHECK (departure_date > arrival_date),
  expected_count integer NOT NULL CHECK (expected_count BETWEEN 1 AND 50),
  roster_confirmed boolean NOT NULL DEFAULT true,
  roster_source text NOT NULL DEFAULT 'host' CHECK (roster_source IN ('host','reservation','server_contract')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  identity_version uuid NOT NULL DEFAULT gen_random_uuid(),
  roster_version uuid NOT NULL DEFAULT gen_random_uuid(),
  state_version uuid NOT NULL DEFAULT gen_random_uuid(),
  released_manually boolean NOT NULL DEFAULT false,
  manual_audit_id uuid,
  CHECK (released_manually = (manual_audit_id IS NOT NULL)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (property_id, booking_code, is_test),
  UNIQUE (id, property_id)
);
CREATE TABLE IF NOT EXISTS entry_access.slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL,
  property_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 50),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (booking_id, property_id) REFERENCES entry_access.bookings(id, property_id) ON DELETE CASCADE,
  UNIQUE (id, booking_id, property_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS entry_access_active_slot_ordinal
  ON entry_access.slots(booking_id, ordinal) WHERE retired_at IS NULL;
CREATE TABLE IF NOT EXISTS entry_access.submissions (
  slot_id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  property_id uuid NOT NULL,
  checkin_id uuid NOT NULL UNIQUE REFERENCES public.checkins(id) ON DELETE CASCADE,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (slot_id, booking_id, property_id)
    REFERENCES entry_access.slots(id, booking_id, property_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS entry_access.audit (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL,
  property_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  request_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('roster_confirmed','entry_released','automatic_restored')),
  request_data jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (booking_id, property_id) REFERENCES entry_access.bookings(id, property_id) ON DELETE CASCADE,
  UNIQUE (property_id, request_id),
  UNIQUE (id, booking_id, property_id)
);
-- Bind a manual release to its own booking's immutable evidence.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='entry_access_manual_audit_fk'
    AND conrelid='entry_access.bookings'::regclass) THEN
    ALTER TABLE entry_access.bookings ADD CONSTRAINT entry_access_manual_audit_fk
      FOREIGN KEY (manual_audit_id, id, property_id)
      REFERENCES entry_access.audit(id, booking_id, property_id);
  END IF;
END $$;

ALTER TABLE entry_access.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_access.slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_access.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_access.audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA entry_access FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON entry_access.bookings, entry_access.slots, entry_access.submissions, entry_access.audit TO service_role;

CREATE OR REPLACE FUNCTION entry_access.immutable_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  -- The application's existing property-retention cascade must still work.
  -- No application role can delete private bookings directly. Permit only a
  -- nested FK cascade AFTER its booking is gone; ordinary event deletion and
  -- every update stay forbidden. This is retention, not an editable audit API.
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 AND NOT EXISTS
    (SELECT 1 FROM entry_access.bookings WHERE id=OLD.booking_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Entry audit is append-only' USING ERRCODE='42501';
END $$;
DROP TRIGGER IF EXISTS entry_access_audit_append_only ON entry_access.audit;
CREATE TRIGGER entry_access_audit_append_only BEFORE UPDATE OR DELETE ON entry_access.audit
  FOR EACH ROW EXECUTE FUNCTION entry_access.immutable_audit();

CREATE OR REPLACE FUNCTION entry_access.validate_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM entry_access.slots s
    JOIN entry_access.bookings b ON b.id=s.booking_id AND b.property_id=s.property_id
    JOIN public.checkins c ON c.id=NEW.checkin_id
    WHERE s.id=NEW.slot_id AND s.booking_id=NEW.booking_id AND s.property_id=NEW.property_id
      AND s.retired_at IS NULL AND b.status='active'
      AND c.property_id=b.property_id AND c.booking_code=b.booking_code
      AND c.is_test=b.is_test AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Invalid entry submission binding' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS entry_access_validate_submission ON entry_access.submissions;
CREATE TRIGGER entry_access_validate_submission BEFORE INSERT OR UPDATE ON entry_access.submissions
  FOR EACH ROW EXECUTE FUNCTION entry_access.validate_binding();

CREATE OR REPLACE FUNCTION entry_access.summary(b entry_access.bookings) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('booking_id',b.id,'state_version',b.state_version,
    'identity_version',b.identity_version,'roster_version',b.roster_version,
    'expected_count',b.expected_count,'released_manually',b.released_manually,
    'audit_id',b.manual_audit_id);
$$;

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
  -- Explicit owner predicate, independent of editable metadata or broad RLS.
  -- Audited admin impersonation is a separate pending integration, not a bypass.
  PERFORM 1 FROM public.properties WHERE id=p_property_id AND owner_id=actor AND deleted_at IS NULL FOR SHARE;
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
  PERFORM 1 FROM public.properties WHERE id=b.property_id AND owner_id=actor AND deleted_at IS NULL FOR SHARE;
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
  INSERT INTO entry_access.audit(id,booking_id,property_id,actor_id,request_id,action,request_data,result)
    VALUES(event_id,b.id,b.property_id,actor,p_request_id,event_action,request_data,answer);
  UPDATE entry_access.bookings SET released_manually=p_release,
    manual_audit_id=CASE WHEN p_release THEN event_id ELSE NULL END,
    state_version=(answer->>'state_version')::uuid,updated_at=clock_timestamp()
    WHERE id=b.id;
  RETURN answer;
END $$;

-- Revoke the default PUBLIC execute grant in the same transaction as creation.
REVOKE ALL ON FUNCTION entry_access.immutable_audit(),entry_access.validate_binding(),entry_access.summary(entry_access.bookings)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.entry_access_confirm_roster(uuid,text,integer,date,date,uuid,uuid,uuid,boolean),
  public.entry_access_set_release(uuid,boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.entry_access_confirm_roster(uuid,text,integer,date,date,uuid,uuid,uuid,boolean),
  public.entry_access_set_release(uuid,boolean,uuid,uuid) TO authenticated;
COMMIT;
