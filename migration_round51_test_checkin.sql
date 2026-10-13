-- Round 51 Phase 4: host-owned tests reuse direct reservations + guest check-in.
BEGIN;
CREATE OR REPLACE FUNCTION public.create_onboarding_test_booking(p_property uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE owner uuid; booking public.ota_reservations; day date;
BEGIN
  SELECT owner_id INTO owner FROM public.properties WHERE id=p_property AND deleted_at IS NULL;
  IF auth.uid() IS NULL OR owner IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not_property_owner' USING ERRCODE='42501'; END IF;
  IF p_code !~ '^WB-[0-9A-HJKMNP-TV-Z]{8}$' THEN RAISE EXCEPTION 'invalid_booking_code'; END IF;
  -- One active test per property; serialise concurrent clicks.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_property::text, 51));
  SELECT * INTO booking FROM public.ota_reservations WHERE property_id=p_property AND is_test IS TRUE AND raw->>'onboarding_test'='true' AND created_at > now()-interval '24 hours' AND deleted_at IS NULL LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(booking); END IF;
  day := (now() AT TIME ZONE 'Europe/Rome')::date;
  -- Same table/shape as Round 45, not a parallel booking system.
  INSERT INTO public.ota_reservations(property_id,platform,uid,entry_type,status,checkin_date,checkout_date,booking_code,is_test,created_by,guest_count,raw)
  VALUES(p_property,'direct','direct_'||replace(gen_random_uuid()::text,'-',''),'reservation','active',day,day+1,p_code,true,owner,1,'{"onboarding_test":true}'::jsonb) RETURNING * INTO booking;
  RETURN to_jsonb(booking);
END $$;
REVOKE ALL ON FUNCTION public.create_onboarding_test_booking(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_onboarding_test_booking(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_onboarding_test_booking(p_property uuid,p_code text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property AND owner_id=auth.uid()) THEN RAISE EXCEPTION 'not_property_owner' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ota_reservations WHERE property_id=p_property AND booking_code=p_code AND is_test IS TRUE AND raw->>'onboarding_test'='true') THEN RETURN 0; END IF;
  INSERT INTO public.storage_purge_queue(bucket,path,reason)
  SELECT 'documents',path,'onboarding_test' FROM public.checkins c CROSS JOIN LATERAL unnest(ARRAY[c.id_photo_path,c.selfie_photo_path]) AS path
  WHERE c.property_id=p_property AND c.booking_code=p_code AND c.is_test IS TRUE AND path IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.checkins real WHERE real.is_test IS NOT TRUE AND (real.id_photo_path=path OR real.selfie_photo_path=path))
  ON CONFLICT(bucket,path) DO NOTHING;
  DELETE FROM public.analytics_events WHERE property_id=p_property AND booking_code=p_code AND is_test IS TRUE;
  DELETE FROM public.chat_messages WHERE property_id=p_property AND booking_code=p_code AND is_test IS TRUE;
  DELETE FROM public.checkins WHERE property_id=p_property AND booking_code=p_code AND is_test IS TRUE;
  DELETE FROM public.ota_reservations WHERE property_id=p_property AND booking_code=p_code AND is_test IS TRUE AND raw->>'onboarding_test'='true';
  GET DIAGNOSTICS n=ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.delete_onboarding_test_booking(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_onboarding_test_booking(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.onboarding_test_checkin_saved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE owner uuid;
BEGIN
  IF NEW.is_test IS NOT TRUE OR NOT EXISTS(SELECT 1 FROM public.ota_reservations WHERE property_id=NEW.property_id AND booking_code=NEW.booking_code AND is_test IS TRUE AND raw->>'onboarding_test'='true') THEN RETURN NEW; END IF;
  SELECT owner_id INTO owner FROM public.properties WHERE id=NEW.property_id;
  IF NEW.guest_type IN ('single','head','group') THEN
    INSERT INTO public.host_onboarding(user_id,property_id,test_checkin_done_at) VALUES(owner,NEW.property_id,now())
    ON CONFLICT(user_id,property_id) DO UPDATE SET test_checkin_done_at=coalesce(host_onboarding.test_checkin_done_at,EXCLUDED.test_checkin_done_at);
  END IF;
  -- Eligible immediately; the existing 10-minute tick drains the queue.
  INSERT INTO public.storage_purge_queue(bucket,path,reason)
  SELECT 'documents',path,'onboarding_test' FROM unnest(ARRAY[NEW.id_photo_path,NEW.selfie_photo_path]) AS path WHERE path IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.checkins real WHERE real.is_test IS NOT TRUE AND (real.id_photo_path=path OR real.selfie_photo_path=path))
  ON CONFLICT(bucket,path) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.onboarding_test_checkin_saved() FROM PUBLIC,anon,authenticated;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='onboarding_test_checkin_saved' AND tgrelid='public.checkins'::regclass) THEN
    CREATE TRIGGER onboarding_test_checkin_saved AFTER INSERT OR UPDATE OF id_photo_path,selfie_photo_path ON public.checkins FOR EACH ROW EXECUTE FUNCTION public.onboarding_test_checkin_saved();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.purge_onboarding_tests(p_dry_run boolean DEFAULT true)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE b record; n integer:=0;
BEGIN
  FOR b IN SELECT property_id,booking_code FROM public.ota_reservations WHERE is_test IS TRUE AND raw->>'onboarding_test'='true' AND created_at <= now()-interval '24 hours' LOOP
    n:=n+1;
    IF NOT p_dry_run THEN
      INSERT INTO public.storage_purge_queue(bucket,path,reason)
      SELECT 'documents',path,'onboarding_test' FROM public.checkins c CROSS JOIN LATERAL unnest(ARRAY[c.id_photo_path,c.selfie_photo_path]) AS path
      WHERE c.property_id=b.property_id AND c.booking_code=b.booking_code AND c.is_test IS TRUE AND path IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.checkins real WHERE real.is_test IS NOT TRUE AND (real.id_photo_path=path OR real.selfie_photo_path=path)) ON CONFLICT(bucket,path) DO NOTHING;
      DELETE FROM public.analytics_events WHERE property_id=b.property_id AND booking_code=b.booking_code AND is_test IS TRUE;
      DELETE FROM public.chat_messages WHERE property_id=b.property_id AND booking_code=b.booking_code AND is_test IS TRUE;
      DELETE FROM public.checkins WHERE property_id=b.property_id AND booking_code=b.booking_code AND is_test IS TRUE;
      DELETE FROM public.ota_reservations WHERE property_id=b.property_id AND booking_code=b.booking_code AND is_test IS TRUE AND raw->>'onboarding_test'='true';
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purge_onboarding_tests(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purge_onboarding_tests(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_autofile_rows(p_property uuid,p_ids uuid[])
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
BEGIN
  UPDATE public.checkins SET alloggiati_status='pending',autofile_claimed_at=NULL,autofile_last_error=coalesce(autofile_last_error,'stale_claim_reset')
  WHERE property_id=p_property AND is_test IS FALSE AND alloggiati_status='filing' AND autofile_claimed_at < now()-interval '20 minutes';
  RETURN QUERY UPDATE public.checkins SET alloggiati_status='filing',autofile_claimed_at=now()
  WHERE id=ANY(p_ids) AND property_id=p_property AND is_test IS FALSE AND coalesce(alloggiati_status,'pending') NOT IN ('filed','filing','correction') AND NOT autofile_excluded AND deleted_at IS NULL RETURNING id;
END $$;
REVOKE ALL ON FUNCTION public.claim_autofile_rows(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_autofile_rows(uuid,uuid[]) TO service_role;

-- Preserve the existing rollup signature/permissions while excluding test and
-- deleted activity. Also repairs its invalid nested window-function expression.
CREATE OR REPLACE FUNCTION public.aggregate_analytics_monthly(p_only_before timestamptz DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog AS $$
DECLARE v_rows integer;
BEGIN
  WITH source AS (
    SELECT to_char(created_at,'YYYY-MM') year_month,property_id,count(*) events,count(DISTINCT session_id) sessions,
    count(*) FILTER(WHERE event_type='guest_checkin_started') checkins_started,
    count(*) FILTER(WHERE event_type='guest_checkin_completed') checkins_completed,
    count(*) FILTER(WHERE event_type='guest_reco_clicked') reco_clicks,
    count(*) FILTER(WHERE event_type='guest_chat_message') chat_messages,
    count(*) FILTER(WHERE event_type='guest_chat_escalated') chat_escalations,
    count(*) FILTER(WHERE event_type='guest_doc_scanned') doc_scans,
    count(DISTINCT booking_code) FILTER(WHERE booking_code IS NOT NULL) unique_guests
    FROM public.analytics_events WHERE property_id IS NOT NULL AND is_test IS FALSE AND deleted_at IS NULL AND (p_only_before IS NULL OR created_at<p_only_before) GROUP BY 1,2
  ), category_counts AS (
    SELECT to_char(created_at,'YYYY-MM') year_month,property_id,coalesce(event_data->>'category','Other') cat,count(*) n
    FROM public.analytics_events WHERE event_type='guest_reco_clicked' AND property_id IS NOT NULL AND is_test IS FALSE AND deleted_at IS NULL AND (p_only_before IS NULL OR created_at<p_only_before) GROUP BY 1,2,3
  ), ranked AS (
    SELECT *,row_number() OVER(PARTITION BY year_month,property_id ORDER BY n DESC,cat) rn FROM category_counts
  ), cats AS (
    SELECT year_month,property_id,jsonb_agg(jsonb_build_object('cat',cat,'n',n) ORDER BY n DESC,cat) FILTER(WHERE rn<=5) top_categories FROM ranked GROUP BY 1,2
  )
  INSERT INTO public.analytics_monthly(year_month,property_id,sessions,events,checkins_started,checkins_completed,reco_clicks,chat_messages,chat_escalations,doc_scans,unique_guests,top_categories,computed_at)
  SELECT s.year_month,s.property_id,s.sessions,s.events,s.checkins_started,s.checkins_completed,s.reco_clicks,s.chat_messages,s.chat_escalations,s.doc_scans,s.unique_guests,coalesce(c.top_categories,'[]'::jsonb),now() FROM source s LEFT JOIN cats c USING(year_month,property_id)
  ON CONFLICT(year_month,property_id) DO UPDATE SET sessions=EXCLUDED.sessions,events=EXCLUDED.events,checkins_started=EXCLUDED.checkins_started,checkins_completed=EXCLUDED.checkins_completed,reco_clicks=EXCLUDED.reco_clicks,chat_messages=EXCLUDED.chat_messages,chat_escalations=EXCLUDED.chat_escalations,doc_scans=EXCLUDED.doc_scans,unique_guests=EXCLUDED.unique_guests,top_categories=EXCLUDED.top_categories,computed_at=now();
  GET DIAGNOSTICS v_rows=ROW_COUNT; RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.aggregate_analytics_monthly(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_analytics_monthly(timestamptz) TO service_role;
create or replace function public.log_alloggiati_filing(
  p_property_id  uuid,
  p_trigger      text,
  p_checkin_ids  uuid[],
  p_outcome      text,
  p_error_code   text default null,
  p_error_detail text default null,
  p_receipt_path text default null,
  p_actor        uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  new_id uuid;
begin
  if p_property_id is null then raise exception 'property_id required'; end if;
  if p_trigger not in ('host','autofile','autofile_dry_run') then
    raise exception 'invalid trigger: %', p_trigger;
  end if;
  if p_checkin_ids is null or cardinality(p_checkin_ids) = 0 then
    raise exception 'checkin_ids required';
  end if;
  if p_outcome is null or length(p_outcome) = 0 then
    raise exception 'outcome required';
  end if;

  if exists(select 1 from public.checkins where id=any(p_checkin_ids) and is_test is true) then raise exception 'test_checkin_excluded'; end if;
  insert into public.alloggiati_filing_log
    (property_id, trigger, checkin_ids, outcome, error_code, error_detail, receipt_path, actor)
  values
    (p_property_id, p_trigger, p_checkin_ids, p_outcome, p_error_code, p_error_detail, p_receipt_path, p_actor)
  returning id into new_id;

  return new_id;
end
$$;

revoke execute on function public.log_alloggiati_filing(uuid, text, uuid[], text, text, text, text, uuid) from public, anon, authenticated;
grant   execute on function public.log_alloggiati_filing(uuid, text, uuid[], text, text, text, text, uuid) to service_role;


COMMIT;
-- Rollback: disable new UI; restore claim/rollup definitions from Round 49/12.
-- DROP TRIGGER onboarding_test_checkin_saved ON public.checkins;
-- DROP FUNCTION public.onboarding_test_checkin_saved(), public.purge_onboarding_tests(boolean), public.create_onboarding_test_booking(uuid,text), public.delete_onboarding_test_booking(uuid,text);
-- Never restore a filing path that accepts test rows while tests remain.
