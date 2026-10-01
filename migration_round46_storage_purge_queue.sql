-- migration_round46_storage_purge_queue.sql
--
-- Round 46 Part A — fix the nightly purge that has been failing since
-- 2026-05-13 with:
--   ERROR: Direct deletion from storage tables is not allowed. Use the
--          Storage API instead.
-- raised by storage.protect_delete() on `DELETE FROM storage.objects`.
--
-- SQL can still READ storage.objects; it just can't DELETE. So we keep
-- the DB-side eligibility logic in SQL and move the file deletions to
-- a server-side Storage API call. Per-row flow:
--
--   02:00 UTC — purge_old_data_cron() runs the SQL purge, which now
--               INSERTs eligible paths into public.storage_purge_queue
--               and nulls the corresponding checkins columns.
--
--   05:00 UTC — api/send-arrival-reminders.js PASS C reads the queue,
--               hits the Storage API DELETE endpoint, drops the rows
--               it successfully deleted. (3-hour gap is coincidence
--               of the existing crons; the queue naturally tolerates
--               drift.)
--
-- Receipts bucket (5-year retention) is protected two ways:
--   (a) purge_old_id_photos() only scopes to 'documents';
--   (b) storage_purge_queue has CHECK (bucket = 'documents') — so even
--       a future SQL edit cannot accidentally queue a receipt file.

-- ──────────────────────────────────────────────────────────────────
-- 1. The queue table
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.storage_purge_queue (
  id          bigserial PRIMARY KEY,
  bucket      text NOT NULL CHECK (bucket = 'documents'),
  path        text NOT NULL,
  reason      text NOT NULL,
  queued_at   timestamptz NOT NULL DEFAULT now(),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  UNIQUE (bucket, path)
);

-- Service-role only. No RLS policies, which means no row is visible
-- to the anon or authenticated roles even if a GRANT slips in.
ALTER TABLE public.storage_purge_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.storage_purge_queue FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.storage_purge_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.storage_purge_queue_id_seq TO service_role;

-- ──────────────────────────────────────────────────────────────────
-- 2. data_purge_log — new nullable column for the orphan count
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.data_purge_log
  ADD COLUMN IF NOT EXISTS orphans_queued integer;

-- ──────────────────────────────────────────────────────────────────
-- 3. purge_old_id_photos — rewritten to queue, not delete
-- ──────────────────────────────────────────────────────────────────
-- Same signature as before. Same eligibility rules. Same return
-- semantics (count of eligible checkins rows). Two changes:
--   (a) DELETE FROM storage.objects → INSERT INTO storage_purge_queue
--       (ON CONFLICT (bucket,path) DO NOTHING, so a re-run after a
--        partial failure never duplicates work).
--   (b) Covers selfie_photo_path too (reason='selfie_48h') under the
--       exact same eligibility predicate. The count includes any
--       eligible row with EITHER path set.
CREATE OR REPLACE FUNCTION public.purge_old_id_photos(
  p_dry_run              boolean DEFAULT true,
  p_days                 integer DEFAULT NULL,
  p_hours                integer DEFAULT 48,
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
  -- ⚠️ Receipts (bucket_id='receipts') follow the 5-year check-in
  -- retention tier, NOT the 48-hour image window. This function must
  -- NEVER touch that bucket. Round 46 moves file deletion out of SQL
  -- entirely into api/send-arrival-reminders.js PASS C, which pulls
  -- paths from public.storage_purge_queue — and that queue has a
  -- CHECK (bucket = 'documents') constraint, so a future edit that
  -- tried to queue a receipts path would fail at insert time.

  IF v_legacy_mode THEN
    v_cutoff_date := (v_now - (p_days || ' days')::INTERVAL)::DATE;

    SELECT COUNT(*) INTO v_count FROM public.checkins
      WHERE (id_photo_path IS NOT NULL OR selfie_photo_path IS NOT NULL)
        AND departure_date IS NOT NULL
        AND departure_date <= v_cutoff_date
        AND deleted_at IS NULL;
    IF p_dry_run OR v_count = 0 THEN RETURN v_count; END IF;

    INSERT INTO public.storage_purge_queue (bucket, path, reason)
    SELECT 'documents', id_photo_path, 'id_photo_48h'
      FROM public.checkins
      WHERE id_photo_path IS NOT NULL
        AND departure_date IS NOT NULL
        AND departure_date <= v_cutoff_date
        AND deleted_at IS NULL
    ON CONFLICT (bucket, path) DO NOTHING;

    INSERT INTO public.storage_purge_queue (bucket, path, reason)
    SELECT 'documents', selfie_photo_path, 'selfie_48h'
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
  SELECT 'documents', id_photo_path, 'id_photo_48h'
    FROM public.checkins
    WHERE id_photo_path IS NOT NULL
      AND deleted_at IS NULL
      AND (
        (arrival_date IS NOT NULL AND arrival_date + make_interval(hours => p_hours) <= v_now)
        OR (arrival_date IS NULL AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
      )
  ON CONFLICT (bucket, path) DO NOTHING;

  INSERT INTO public.storage_purge_queue (bucket, path, reason)
  SELECT 'documents', selfie_photo_path, 'selfie_48h'
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

-- ──────────────────────────────────────────────────────────────────
-- 4. enqueue_orphan_documents — sweep for abandoned scans
-- ──────────────────────────────────────────────────────────────────
-- Objects in the 'documents' bucket older than p_days whose name is
-- NOT referenced by any checkins.id_photo_path or selfie_photo_path.
-- Two sources:
--   (1) scans the guest started but never submitted — no checkin row
--       was ever created to reference the file;
--   (2) files whose owning checkin was hard-deleted by the soft-delete
--       branch, which drops the row but not the storage object.
--
-- The 7-day floor protects in-flight check-ins: the guest app uploads
-- the photo BEFORE writing the checkins row, so a brand-new object
-- can be "unreferenced" for a few seconds. 7 days is well past any
-- plausible mid-upload gap.
CREATE OR REPLACE FUNCTION public.enqueue_orphan_documents(
  p_dry_run boolean DEFAULT true,
  p_days    integer DEFAULT 7
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INTEGER := 0;
  v_now   TIMESTAMPTZ := NOW();
BEGIN
  WITH referenced AS (
    SELECT id_photo_path    AS p FROM public.checkins WHERE id_photo_path    IS NOT NULL
    UNION
    SELECT selfie_photo_path       FROM public.checkins WHERE selfie_photo_path IS NOT NULL
  )
  SELECT COUNT(*) INTO v_count
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.created_at < v_now - make_interval(days => p_days)
    AND NOT EXISTS (SELECT 1 FROM referenced r WHERE r.p = o.name);

  IF p_dry_run OR v_count = 0 THEN RETURN v_count; END IF;

  INSERT INTO public.storage_purge_queue (bucket, path, reason)
  WITH referenced AS (
    SELECT id_photo_path    AS p FROM public.checkins WHERE id_photo_path    IS NOT NULL
    UNION
    SELECT selfie_photo_path       FROM public.checkins WHERE selfie_photo_path IS NOT NULL
  )
  SELECT 'documents', o.name, 'orphan'
  FROM storage.objects o
  WHERE o.bucket_id = 'documents'
    AND o.created_at < v_now - make_interval(days => p_days)
    AND NOT EXISTS (SELECT 1 FROM referenced r WHERE r.p = o.name)
  ON CONFLICT (bucket, path) DO NOTHING;

  RETURN v_count;
END;
$function$;

-- ──────────────────────────────────────────────────────────────────
-- 5. purge_old_data_cron — call the orphan sweep + record its count
-- ──────────────────────────────────────────────────────────────────
-- Logic unchanged for the main purge. After purge_old_data returns:
--   - call enqueue_orphan_documents(v_dry_run) regardless of mode, so
--     the data_purge_log row carries the orphan count in both preview
--     and live runs;
--   - UPDATE the log row that purge_old_data() just inserted;
--   - mirror the value into v_log so the RETURN includes it.
CREATE OR REPLACE FUNCTION public.purge_old_data_cron()
RETURNS data_purge_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_live_after TIMESTAMPTZ;
  v_dry_run    BOOLEAN;
  v_log        public.data_purge_log;
  v_trigger    TEXT;
  v_orphans    INTEGER;
BEGIN
  SELECT live_after INTO v_live_after FROM public.purge_settings WHERE id = 1;
  -- If somehow the settings row is missing, default to dry-run for safety.
  IF v_live_after IS NULL THEN
    v_dry_run := TRUE;
    v_trigger := 'cron:no-settings';
  ELSIF NOW() < v_live_after THEN
    v_dry_run := TRUE;
    v_trigger := 'cron:soft-launch';
  ELSE
    v_dry_run := FALSE;
    v_trigger := 'cron';
  END IF;

  v_log := public.purge_old_data(v_dry_run, v_trigger);

  -- Round 46 — orphan documents (abandoned guest scans + files whose
  -- checkin row was hard-deleted). Call in both modes so the log row
  -- is honest; the function itself no-ops writes when p_dry_run=true.
  v_orphans := public.enqueue_orphan_documents(v_dry_run);
  UPDATE public.data_purge_log
     SET orphans_queued = v_orphans
   WHERE id = v_log.id;
  v_log.orphans_queued := v_orphans;

  RETURN v_log;
END;
$function$;
