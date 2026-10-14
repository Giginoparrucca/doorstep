-- Fictional property fixture only; every write is rolled back.
BEGIN;
INSERT INTO public.properties(id,owner_id,name,property_type) VALUES
('00000000-0000-4000-8000-000000000057','00000000-0000-4000-8000-000000005701','Round 57 fixture','agriturismo');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000005701',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
 UPDATE public.properties SET hero_image_layout='{"zoom":2,"x":25,"y":75}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'owner update denied'; END IF;
 IF (SELECT hero_image_layout->>'zoom' FROM public.properties WHERE id='00000000-0000-4000-8000-000000000057')<>'2' THEN RAISE EXCEPTION 'frame not persisted'; END IF;
 BEGIN UPDATE public.properties SET hero_image_layout='{"zoom":4,"x":0,"y":0}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057'; RAISE EXCEPTION 'zoom bounds accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.properties SET hero_image_layout='{"zoom":1,"x":-1,"y":0}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057'; RAISE EXCEPTION 'position bounds accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.properties SET hero_image_layout='{}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057'; RAISE EXCEPTION 'missing keys accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.properties SET hero_image_layout=null WHERE id='00000000-0000-4000-8000-000000000057';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000005702',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n int; BEGIN
 UPDATE public.properties SET hero_image_layout='{"zoom":2,"x":25,"y":75}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'cross owner write accepted'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE n int; BEGIN
 UPDATE public.properties SET hero_image_layout='{"zoom":2,"x":25,"y":75}'::jsonb WHERE id='00000000-0000-4000-8000-000000000057';
 GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'anon write accepted'; END IF;
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT 'PASS: owner framing and Agriturismo; bounds/missing keys rejected; nullable fallback; cross-owner/anon writes denied; fixture rolled back' AS result;
ROLLBACK;
