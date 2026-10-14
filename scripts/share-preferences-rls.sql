-- Run with a privileged SQL connection. Uses a real property solely as scope;
-- all preference probes are rolled back. No guest or property data is changed.
BEGIN;
CREATE TEMP TABLE share_ctx AS SELECT id,owner_id FROM public.properties WHERE owner_id IS NOT NULL AND deleted_at IS NULL LIMIT 1;
GRANT SELECT ON share_ctx TO authenticated;
SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM share_ctx),true);
SET LOCAL ROLE authenticated;
INSERT INTO public.host_share_preferences SELECT id,'en_start','Fixture {guest_link}' FROM share_ctx ON CONFLICT(property_id,preference_key) DO UPDATE SET value=EXCLUDED.value;
DO $$ DECLARE n int; BEGIN
 IF (SELECT count(*) FROM public.host_share_preferences WHERE property_id=(SELECT id FROM share_ctx) AND preference_key='en_start')<>1 THEN RAISE EXCEPTION 'owner select'; END IF;
 UPDATE public.host_share_preferences SET value='Updated {guest_link}' WHERE property_id=(SELECT id FROM share_ctx) AND preference_key='en_start';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owner update'; END IF;
 DELETE FROM public.host_share_preferences WHERE property_id=(SELECT id FROM share_ctx) AND preference_key='en_start';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owner delete'; END IF;
 INSERT INTO public.host_share_preferences SELECT id,'en_start','Fixture {guest_link}' FROM share_ctx;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000055',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
 IF EXISTS(SELECT FROM public.host_share_preferences) THEN RAISE EXCEPTION 'cross read'; END IF;
 UPDATE public.host_share_preferences SET value='Forbidden'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross update'; END IF;
 DELETE FROM public.host_share_preferences; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross delete'; END IF;
 BEGIN INSERT INTO public.host_share_preferences SELECT id,'it_start','Forbidden' FROM share_ctx; RAISE EXCEPTION 'cross insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM public.host_share_preferences; RAISE EXCEPTION 'anon select'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.host_share_preferences VALUES('00000000-0000-4000-8000-000000000055','en_start','Forbidden'); RAISE EXCEPTION 'anon insert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.host_share_preferences SET value='Forbidden'; RAISE EXCEPTION 'anon update'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.host_share_preferences; RAISE EXCEPTION 'anon delete'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS owner CRUD, cross-owner CRUD denied, anon CRUD denied; probes rolled back' AS result;
ROLLBACK;
