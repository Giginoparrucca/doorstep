-- Round 50 Phase 4 — presenter-only `demo_reset_v1` function.
--
-- The function deletes session-mutable rows that are NOT in the
-- Phase 3 fixture allowlist, then upserts the fixtures back to the
-- canonical state. All within one transaction, under a per-process
-- advisory lock, so two presenters pressing the button at the same
-- time see one succeed and one report `locked`.
--
-- Authorization is internal — the function is SECURITY DEFINER and
-- rejects every caller whose `auth.uid()` is not one of the
-- provisioned presenters. The function is callable by the
-- `authenticated` role so the host console (Phase 5 UI) can invoke
-- it with the presenter's JWT. The `anon` role has no execute grant.
--
-- The DEMO_PROJECT_REF constant hard-codes the demo project; a copy
-- of this function must never be installed in production. Phase 2's
-- rebuild-verify records the schema fingerprint; apply this migration
-- and re-record it in the same commit.

CREATE OR REPLACE FUNCTION public.demo_reset_v1(reset_day date DEFAULT (CURRENT_DATE AT TIME ZONE 'Europe/Rome')::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  demo_props uuid[] := ARRAY[
    '50505050-0000-4000-8000-000000000003',
    '50505050-0000-4000-8000-000000000002'
  ]::uuid[];
  presenter_ids uuid[] := ARRAY[
    'edcf2a10-a59b-4565-8721-7dafd7567417',
    'fec66ee7-518c-4440-b663-003eee505839'
  ]::uuid[];
  fixture_ota      uuid[] := ARRAY[
    '50505050-0000-4000-8000-000000000301','50505050-0000-4000-8000-000000000302',
    '50505050-0000-4000-8000-000000000303','50505050-0000-4000-8000-000000000304',
    '50505050-0000-4000-8000-000000000305','50505050-0000-4000-8000-000000000306',
    '50505050-0000-4000-8000-000000000307','50505050-0000-4000-8000-000000000308',
    '50505050-0000-4000-8000-000000000309','50505050-0000-4000-8000-000000000310'
  ]::uuid[];
  fixture_checkins uuid[] := ARRAY[
    '50505050-0000-4000-8000-000000001303','50505050-0000-4000-8000-000000001304',
    '50505050-0000-4000-8000-000000001305','50505050-0000-4000-8000-000000002351',
    '50505050-0000-4000-8000-000000002352','50505050-0000-4000-8000-000000001306',
    '50505050-0000-4000-8000-000000001307','50505050-0000-4000-8000-000000001308',
    '50505050-0000-4000-8000-000000001309'
  ]::uuid[];
  fixture_chats    uuid[] := ARRAY[
    '50505050-0000-4000-8000-000000004001','50505050-0000-4000-8000-000000004002',
    '50505050-0000-4000-8000-000000004003','50505050-0000-4000-8000-000000004004',
    '50505050-0000-4000-8000-000000004005','50505050-0000-4000-8000-000000004006'
  ]::uuid[];
  fixture_events   uuid[] := ARRAY[
    '50505050-0000-4000-8000-000000005001','50505050-0000-4000-8000-000000005002',
    '50505050-0000-4000-8000-000000005003','50505050-0000-4000-8000-000000005004',
    '50505050-0000-4000-8000-000000005005','50505050-0000-4000-8000-000000005006',
    '50505050-0000-4000-8000-000000005007'
  ]::uuid[];
  caller         uuid := auth.uid();
  lock_acquired  boolean;
  deleted_counts jsonb;
BEGIN
  IF caller IS NULL OR NOT caller = ANY(presenter_ids) THEN
    RAISE EXCEPTION 'Not authorized to reset the demo' USING ERRCODE = '42501';
  END IF;

  SELECT pg_try_advisory_xact_lock(505050004) INTO lock_acquired;
  IF NOT lock_acquired THEN
    RETURN jsonb_build_object('ok', false, 'code', 'locked',
      'message', 'Another reset is in progress');
  END IF;

  -- Session-mutable rows outside the fixture allowlist belonging to a
  -- demo property are discarded. Order matters: delete children first
  -- so FK constraints on checkins → ota_reservations stay happy.
  WITH d1 AS (DELETE FROM public.analytics_events WHERE property_id = ANY(demo_props) AND NOT id = ANY(fixture_events) RETURNING 1),
       d2 AS (DELETE FROM public.chat_messages    WHERE property_id = ANY(demo_props) AND NOT id = ANY(fixture_chats) RETURNING 1),
       d3 AS (DELETE FROM public.checkins         WHERE property_id = ANY(demo_props) AND NOT id = ANY(fixture_checkins) RETURNING 1),
       d4 AS (DELETE FROM public.ota_reservations WHERE property_id = ANY(demo_props) AND NOT id = ANY(fixture_ota) RETURNING 1),
       d5 AS (DELETE FROM public.host_dismissed_bookings WHERE property_id = ANY(demo_props) RETURNING 1)
  SELECT jsonb_build_object(
    'analytics_events', (SELECT COUNT(*) FROM d1),
    'chat_messages',    (SELECT COUNT(*) FROM d2),
    'checkins',         (SELECT COUNT(*) FROM d3),
    'ota_reservations', (SELECT COUNT(*) FROM d4),
    'host_dismissed_bookings', (SELECT COUNT(*) FROM d5)
  ) INTO deleted_counts;

  -- Normalize fixture state. Rebase the ten scenarios' dates relative
  -- to the chosen reset day in Europe/Rome.
  UPDATE public.ota_reservations SET
    checkin_date  = reset_day + offset_pair.arr,
    checkout_date = reset_day + offset_pair.dep,
    guest_name    = offset_pair.name,
    guest_count   = offset_pair.gc,
    status        = 'active', entry_type = 'reservation', platform = 'manual',
    uid           = 'demo:' || offset_pair.code,
    summary       = '[DEMO] ' || offset_pair.code || ' — ' || offset_pair.demo,
    is_test       = true,
    updated_at    = now()
  FROM (VALUES
    ('50505050-0000-4000-8000-000000000301'::uuid, 'DEMO-ARRIVO',     1,  3, 2, 'Rossi — ESEMPIO',             'Reservation and shareable guest link'),
    ('50505050-0000-4000-8000-000000000302'::uuid, 'DEMO-NUOVO',      0,  2, 1, 'Bianchi — ESEMPIO',           'Complete interactive guest journey'),
    ('50505050-0000-4000-8000-000000000303'::uuid, 'DEMO-SOGGIORNO', -1,  3, 2, 'Verdi — ESEMPIO',             'Active stay and guest details'),
    ('50505050-0000-4000-8000-000000000304'::uuid, 'DEMO-AIUTO',     -1,  2, 2, 'Russo — ESEMPIO',             'Host help request and reply'),
    ('50505050-0000-4000-8000-000000000305'::uuid, 'DEMO-GRUPPO',     0,  2, 3, 'Famiglia Esposito — ESEMPIO', 'Group lead and members'),
    ('50505050-0000-4000-8000-000000000306'::uuid, 'DEMO-CONFORMITA',-1,  1, 1, 'Marino — ESEMPIO',            'Simulated filing and sample receipt'),
    ('50505050-0000-4000-8000-000000000307'::uuid, 'DEMO-PARTENZA', -2,  0, 2, 'Greco — ESEMPIO',              'Departure actions'),
    ('50505050-0000-4000-8000-000000000308'::uuid, 'DEMO-RECENTE',  -5, -3, 2, 'Lombardi — ESEMPIO',           'Recent activity'),
    ('50505050-0000-4000-8000-000000000309'::uuid, 'DEMO-SCADUTO', -10, -8, 1, 'Fontana — ESEMPIO',            'Excluded from action board'),
    ('50505050-0000-4000-8000-000000000310'::uuid, 'DEMO-NOSHOW',  -10, -8, 1, 'Rizzo — ESEMPIO',              'No stale check-in prompt')
  ) AS offset_pair(id, code, arr, dep, gc, name, demo)
  WHERE public.ota_reservations.id = offset_pair.id;

  -- Check-in arrival/departure follow the scenario dates.
  UPDATE public.checkins c SET
    arrival_date   = o.checkin_date,
    departure_date = o.checkout_date,
    nights         = (o.checkout_date - o.checkin_date),
    is_test        = true,
    docs_status    = 'completed'
  FROM public.ota_reservations o
  WHERE c.id = ANY(fixture_checkins) AND c.booking_code = o.booking_code AND o.property_id = ANY(demo_props);

  -- Chat and analytics seeds keep their relative offsets from arrival.
  UPDATE public.chat_messages m SET
    created_at = (o.checkin_date::timestamp AT TIME ZONE 'Europe/Rome') + offs.offset_min * interval '1 minute',
    is_test    = true
  FROM public.ota_reservations o,
       (VALUES
         ('50505050-0000-4000-8000-000000004001'::uuid, 'DEMO-SOGGIORNO', -1440),
         ('50505050-0000-4000-8000-000000004002'::uuid, 'DEMO-SOGGIORNO', -1380),
         ('50505050-0000-4000-8000-000000004003'::uuid, 'DEMO-SOGGIORNO', -1320),
         ('50505050-0000-4000-8000-000000004004'::uuid, 'DEMO-AIUTO',       -180),
         ('50505050-0000-4000-8000-000000004005'::uuid, 'DEMO-AIUTO',       -120),
         ('50505050-0000-4000-8000-000000004006'::uuid, 'DEMO-NUOVO',        -60)
       ) AS offs(id, code, offset_min)
  WHERE m.id = offs.id AND o.booking_code = offs.code AND o.property_id = ANY(demo_props);

  UPDATE public.analytics_events e SET
    created_at = (o.checkin_date::timestamp AT TIME ZONE 'Europe/Rome') + offs.offset_min * interval '1 minute',
    is_test    = true
  FROM public.ota_reservations o,
       (VALUES
         ('50505050-0000-4000-8000-000000005001'::uuid, 'DEMO-SOGGIORNO', -1500),
         ('50505050-0000-4000-8000-000000005002'::uuid, 'DEMO-SOGGIORNO', -1320),
         ('50505050-0000-4000-8000-000000005003'::uuid, 'DEMO-SOGGIORNO', -1320),
         ('50505050-0000-4000-8000-000000005004'::uuid, 'DEMO-AIUTO',       -300),
         ('50505050-0000-4000-8000-000000005005'::uuid, 'DEMO-AIUTO',       -180),
         ('50505050-0000-4000-8000-000000005006'::uuid, 'DEMO-NUOVO',        -60),
         ('50505050-0000-4000-8000-000000005007'::uuid, 'DEMO-NUOVO',        -60)
       ) AS offs(id, code, offset_min)
  WHERE e.id = offs.id AND o.booking_code = offs.code AND o.property_id = ANY(demo_props);

  -- Properties stay as the fixtures left them; the reset only clears
  -- the autofile-alerts bag so each presentation starts clean.
  UPDATE public.properties
     SET alloggiati_autofile_alerts = '{}'::jsonb
   WHERE id = ANY(demo_props);

  RETURN jsonb_build_object(
    'ok', true,
    'reset_day', reset_day,
    'reset_at', now(),
    'caller', caller,
    'deleted', deleted_counts
  );
END;
$function$;

-- Only the authenticated role (via a presenter JWT) can execute the
-- function. anon has no business running it. service_role implicitly
-- has execute via its superuser-like grant; we don't need to add it.
REVOKE ALL ON FUNCTION public.demo_reset_v1(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_reset_v1(date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.demo_reset_v1(date) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.demo_reset_v1(date) TO service_role;
