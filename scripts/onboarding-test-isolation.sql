-- Non-production gate only. Fictional rows; ROLLBACK leaves fixtures unchanged.
BEGIN;
INSERT INTO public.properties(id,name,owner_id,is_test,region,city)
VALUES('51515151-0000-4000-8000-000000000051','Round 51 fictional isolation gate','fec66ee7-518c-4440-b663-003eee505839',true,'Puglia','Ostuni');
SELECT set_config('request.jwt.claim.sub','fec66ee7-518c-4440-b663-003eee505839',true);
SET LOCAL ROLE authenticated;
SELECT public.create_onboarding_test_booking('51515151-0000-4000-8000-000000000051','WB-51TEST00')->>'booking_code' AS test_booking;
-- A repeated click must reuse the existing direct booking.
SELECT public.create_onboarding_test_booking('51515151-0000-4000-8000-000000000051','WB-51TEST01')->>'booking_code' AS reused_booking;
RESET ROLE;
INSERT INTO public.ota_reservations(property_id,platform,uid,entry_type,status,checkin_date,checkout_date,booking_code,is_test)
VALUES('51515151-0000-4000-8000-000000000051','direct','direct_round51_normal','reservation','active',current_date+1,current_date+2,'NORMAL51',false);
UPDATE public.ota_reservations SET checkin_date=current_date+1,checkout_date=current_date+2 WHERE property_id='51515151-0000-4000-8000-000000000051' AND is_test;
INSERT INTO public.checkins(id,property_id,booking_code,is_test,surname,name,date_of_birth,place_of_birth,citizenship,document_number,guest_type,arrival_date,departure_date,id_photo_path)
VALUES
('51515151-0000-4000-8000-000000000052','51515151-0000-4000-8000-000000000051','WB-51TEST00',true,'FACSIMILE','TEST','1980-01-01','Paris','France','FACSIMILE-ONLY','single',current_date,current_date+1,'id-photos/round51-facsimile.png'),
('51515151-0000-4000-8000-000000000053','51515151-0000-4000-8000-000000000051','NORMAL51',false,'FACSIMILE','NORMAL','1980-01-01','Paris','France','FACSIMILE-ONLY','single',current_date,current_date+1,NULL);
DO $$ DECLARE claimed uuid[]; normal_log uuid; BEGIN
  SELECT array_agg(x) INTO claimed FROM public.claim_autofile_rows('51515151-0000-4000-8000-000000000051',ARRAY['51515151-0000-4000-8000-000000000052'::uuid,'51515151-0000-4000-8000-000000000053'::uuid]) x;
  IF claimed IS DISTINCT FROM ARRAY['51515151-0000-4000-8000-000000000053'::uuid] THEN RAISE EXCEPTION 'claim leaked test row'; END IF;
  normal_log:=public.log_alloggiati_filing('51515151-0000-4000-8000-000000000051','host',ARRAY['51515151-0000-4000-8000-000000000053'::uuid],'fixture_only_no_external_filing');
  BEGIN
    PERFORM public.log_alloggiati_filing('51515151-0000-4000-8000-000000000051','host',ARRAY['51515151-0000-4000-8000-000000000052'::uuid],'must_reject');
    RAISE EXCEPTION 'log accepted test row';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM != 'test_checkin_excluded' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM public.alloggiati_filing_log WHERE property_id='51515151-0000-4000-8000-000000000051') != 1 THEN RAISE EXCEPTION 'filing log count'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.storage_purge_queue WHERE path='id-photos/round51-facsimile.png' AND queued_at<=now()) THEN RAISE EXCEPTION 'photo not eligible immediately'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.host_onboarding WHERE property_id='51515151-0000-4000-8000-000000000051' AND test_checkin_done_at IS NOT NULL) THEN RAISE EXCEPTION 'completion not saved'; END IF;
  IF (SELECT array_agg(booking_code) FROM public.ota_reservations WHERE property_id='51515151-0000-4000-8000-000000000051' AND entry_type='reservation' AND status='active' AND is_test=false AND deleted_at IS NULL AND covered_by_reservation_id IS NULL AND arrival_reminder_sent_at IS NULL AND checkin_date=current_date+1) IS DISTINCT FROM ARRAY['NORMAL51'] THEN RAISE EXCEPTION 'reminder selection leaked test'; END IF;
END $$;
INSERT INTO public.analytics_events(property_id,session_id,event_type,is_test,event_data)
VALUES('51515151-0000-4000-8000-000000000051','round51-normal','guest_reco_clicked',false,'{"category":"food"}'),('51515151-0000-4000-8000-000000000051','round51-test','guest_reco_clicked',true,'{"category":"test_leak"}');
SELECT public.aggregate_analytics_monthly();
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.analytics_monthly WHERE property_id='51515151-0000-4000-8000-000000000051' AND events=1 AND reco_clicks=1 AND top_categories='[{"cat":"food","n":1}]'::jsonb) THEN RAISE EXCEPTION 'rollup leaked test'; END IF;
END $$;
UPDATE public.ota_reservations SET created_at=now()-interval '24 hours' WHERE property_id='51515151-0000-4000-8000-000000000051' AND is_test;
SELECT public.purge_onboarding_tests(false);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.ota_reservations WHERE property_id='51515151-0000-4000-8000-000000000051' AND is_test) OR EXISTS(SELECT 1 FROM public.checkins WHERE id='51515151-0000-4000-8000-000000000052') THEN RAISE EXCEPTION 'test rows survived TTL'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.checkins WHERE id='51515151-0000-4000-8000-000000000053') OR NOT EXISTS(SELECT 1 FROM public.ota_reservations WHERE property_id='51515151-0000-4000-8000-000000000051' AND NOT is_test) THEN RAISE EXCEPTION 'normal rows purged'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.host_onboarding WHERE property_id='51515151-0000-4000-8000-000000000051' AND test_checkin_done_at IS NOT NULL) THEN RAISE EXCEPTION 'completion lost on purge'; END IF;
END $$;
SELECT 'PASS: owner mint/reuse, real-only claim, immutable filing log, photo queued immediately, reminder selection, real-only monthly rollup, 24h purge and durable completion' AS evidence;
ROLLBACK;
