-- Round 60c hotfix — extend ID photo retention from 48h to 7 days (168h)
-- after arrival. Policy chosen by Daniele on 2026-10-19 after Round 60
-- live testing showed hosts expect to see photos of recent guests
-- (e.g. to verify a claim), and 48 hours is too tight. 7 days remains
-- defensible under GDPR Art. 5(1)(e) (storage limitation) since the
-- Alloggiati filing is still the stated purpose completion event and
-- 7 days is a reasonable operational buffer around it.
--
-- The receipts bucket (5-year retention) is NOT touched by this
-- function; see migration_round46 for the full receipts-vs-documents
-- separation. The 'documents' CHECK on storage_purge_queue still blocks
-- any receipt file from being queued.
--
-- All we change is the DEFAULT on p_hours. Behavioural change:
--   purge_old_data_cron() → purge_old_data(p_dry_run) → purge_old_id_photos(p_dry_run => p_dry_run)
-- picks up the new default because the cron only passes p_dry_run.
BEGIN;

CREATE OR REPLACE FUNCTION public.purge_old_id_photos(
  p_dry_run              boolean DEFAULT true,
  p_days                 integer DEFAULT NULL,
  p_hours                integer DEFAULT 168,
  p_null_arrival_days    integer DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count       INTEGER := 0;
  v_now         TIMESTAMPTZ := NOW();
  v_legacy_mode BOOLEAN := (p_days IS NOT NULL);
  v_cutoff_date DATE;
BEGIN
  -- Receipts (bucket_id='receipts') follow the 5-year check-in retention
  -- tier, NOT this image window. This function never touches that bucket:
  -- storage_purge_queue has a CHECK (bucket = 'documents') constraint.

  IF v_legacy_mode THEN
    v_cutoff_date := (v_now - (p_days || ' days')::INTERVAL)::DATE;

    SELECT COUNT(*) INTO v_count FROM public.checkins
      WHERE (id_photo_path IS NOT NULL OR selfie_photo_path IS NOT NULL)
        AND departure_date IS NOT NULL
        AND departure_date <= v_cutoff_date
        AND deleted_at IS NULL;
    IF p_dry_run OR v_count = 0 THEN RETURN v_count; END IF;

    INSERT INTO public.storage_purge_queue (bucket, path, reason)
    SELECT 'documents', id_photo_path, 'id_photo_7d'
      FROM public.checkins
      WHERE id_photo_path IS NOT NULL
        AND departure_date IS NOT NULL
        AND departure_date <= v_cutoff_date
        AND deleted_at IS NULL
    ON CONFLICT (bucket, path) DO NOTHING;

    INSERT INTO public.storage_purge_queue (bucket, path, reason)
    SELECT 'documents', selfie_photo_path, 'selfie_7d'
      FROM public.checkins
      WHERE selfie_photo_path IS NOT NULL
        AND departure_date IS NOT NULL
        AND departure_date <= v_cutoff_date
        AND deleted_at IS NULL
    ON CONFLICT (bucket, path) DO NOTHING;

    UPDATE public.checkins
       SET id_photo_path = NULL, selfie_photo_path = NULL
     WHERE (id_photo_path IS NOT NULL OR selfie_photo_path IS NOT NULL)
       AND departure_date IS NOT NULL
       AND departure_date <= v_cutoff_date
       AND deleted_at IS NULL;

    RETURN v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.checkins
    WHERE (id_photo_path IS NOT NULL OR selfie_photo_path IS NOT NULL)
      AND deleted_at IS NULL
      AND (
        (arrival_date IS NOT NULL AND arrival_date + make_interval(hours => p_hours) <= v_now)
        OR (arrival_date IS NULL AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
      );
  IF p_dry_run OR v_count = 0 THEN RETURN v_count; END IF;

  INSERT INTO public.storage_purge_queue (bucket, path, reason)
  SELECT 'documents', id_photo_path, 'id_photo_7d'
    FROM public.checkins
    WHERE id_photo_path IS NOT NULL
      AND deleted_at IS NULL
      AND (
        (arrival_date IS NOT NULL AND arrival_date + make_interval(hours => p_hours) <= v_now)
        OR (arrival_date IS NULL AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
      )
  ON CONFLICT (bucket, path) DO NOTHING;

  INSERT INTO public.storage_purge_queue (bucket, path, reason)
  SELECT 'documents', selfie_photo_path, 'selfie_7d'
    FROM public.checkins
    WHERE selfie_photo_path IS NOT NULL
      AND deleted_at IS NULL
      AND (
        (arrival_date IS NOT NULL AND arrival_date + make_interval(hours => p_hours) <= v_now)
        OR (arrival_date IS NULL AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
      )
  ON CONFLICT (bucket, path) DO NOTHING;

  UPDATE public.checkins
     SET id_photo_path = NULL, selfie_photo_path = NULL
   WHERE (id_photo_path IS NOT NULL OR selfie_photo_path IS NOT NULL)
     AND deleted_at IS NULL
     AND (
       (arrival_date IS NOT NULL AND arrival_date + make_interval(hours => p_hours) <= v_now)
       OR (arrival_date IS NULL AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
     );

  RETURN v_count;
END;
$function$;

COMMIT;
