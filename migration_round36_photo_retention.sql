-- Round 36 — Garante-driven photo lifecycle
--
-- The 29 April 2026 Garante note to hospitality associations clarified that
-- TULPS art. 109 obliges hosts to identify guests and transmit their data to
-- Alloggiati Web, but does NOT authorise retaining photocopies, scans or
-- photographs of identity documents. Once transmission is complete, any
-- image copies must be deleted immediately. The only artefact worth keeping
-- is the portal's automatic filing receipt, for five years.
--
-- Round 15.2 deleted document photos 30 days after `departure_date` — a
-- window that, on a typical stay, is about six weeks past the 24-hour
-- Alloggiati filing deadline. This round retightens the window and adds the
-- two things that make the tight window workable for hosts:
--
--   PART 1 · Retighten purge_old_id_photos to arrival_date + 48h
--            (fallback: created_at + 7 days when arrival_date is null).
--            Signature-compatible with existing callers.
--
--   PART 2 · Column + partial index to support the day-after Alloggiati
--            filing reminder that lands in api/send-arrival-reminders.js
--            as a second mode (Vercel Hobby's 2-cron limit rules out a
--            separate scheduled endpoint).
--
--   PART 3 · Receipts storage bucket + checkins.receipt_path / filed_at
--            columns for the portal's filing confirmation. Owner-scoped
--            RLS, explicit GRANTs (Round 28 lesson: SQL-editor tables and
--            storage policies do not inherit privileges — symptom is a
--            silent 0-row result with error:null).
--
-- ⚠️ Nothing here touches the 5-year check-in data retention. That is a
-- legal requirement under TULPS art. 109 and stays exactly as it is. Only
-- the *image* lifecycle changes.
--
-- One-time deletion volume on first live run after this migration lands
-- (queried in the R36 investigation step):
--   - Total checkins with a photo:       134
--   - Old rule (departure_date + 30d):   106 rows eligible
--   - New rule (arrival_date + 48h):     130 rows eligible
--   - New rule (null-arrival + 7d):        0 rows eligible
--   - Delta on first live run:           +24 photos
-- Cron is already past its soft-launch cutoff (live_after = 2026-05-12), so
-- the next scheduled `purge_old_data_cron()` run WILL delete those 24 extra
-- photos. Guest data on the same rows is untouched.

BEGIN;

-- Round 15.2 shipped purge_old_id_photos(boolean, integer). Round 36 adds
-- two new parameters, and CREATE OR REPLACE would not replace it (Postgres
-- keys functions by full signature). Drop the old shape explicitly so the
-- new function below is the only one that resolves for existing callers.
DROP FUNCTION IF EXISTS public.purge_old_id_photos(boolean, integer);

-- ══════════════════════════════════════════════════════════════════════
-- PART 1 · Retighten purge_old_id_photos
--
-- Signature compat strategy: keep the existing p_days parameter so any
-- caller (admin console, ad-hoc SELECTs) that passes a days-since-
-- departure value continues to work with legacy semantics. Add two new
-- parameters p_hours and p_null_arrival_days that drive the new
-- Round 36 anchor when p_days IS NULL. Default arguments mean callers
-- that pass nothing (or only p_dry_run) get the new behaviour.
--
-- purge_old_data internally calls `purge_old_id_photos(p_dry_run, v_id_photo_d)`
-- with v_id_photo_d = 30 — that call path is retired in this migration by
-- switching the call to a named-argument form that lets defaults apply.
-- purge_old_data_cron() is NOT edited; it simply invokes purge_old_data.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.purge_old_id_photos(
  p_dry_run           boolean DEFAULT true,
  p_days              integer DEFAULT NULL,   -- legacy: days-since-departure
  p_hours             integer DEFAULT 48,     -- Round 36: hours-since-arrival
  p_null_arrival_days integer DEFAULT 7       -- Round 36: fallback for null arrival
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
  -- ⚠️ Receipts (bucket_id='receipts') are the Alloggiati filing
  -- confirmation. They follow the 5-year check-in retention tier, NOT the
  -- 48-hour image window. This function must NEVER touch that bucket. All
  -- storage.objects DELETE statements below are scoped to
  -- bucket_id = 'documents' so this is enforced at the query level, but
  -- the next person to add another purge branch here must preserve the
  -- scope explicitly.

  IF v_legacy_mode THEN
    -- ── Legacy path (pre-Round-36): days after departure_date ──────────
    -- Retained so any admin ad-hoc call like
    --   SELECT purge_old_id_photos(true, 30);
    -- keeps its historical meaning. Not used by the cron any more.
    v_cutoff_date := (v_now - (p_days || ' days')::INTERVAL)::DATE;

    SELECT COUNT(*) INTO v_count
      FROM public.checkins
     WHERE id_photo_path IS NOT NULL
       AND departure_date IS NOT NULL
       AND departure_date <= v_cutoff_date
       AND deleted_at IS NULL;

    IF p_dry_run OR v_count = 0 THEN
      RETURN v_count;
    END IF;

    DELETE FROM storage.objects
     WHERE bucket_id = 'documents'
       AND name IN (
         SELECT id_photo_path FROM public.checkins
          WHERE id_photo_path IS NOT NULL
            AND departure_date IS NOT NULL
            AND departure_date <= v_cutoff_date
            AND deleted_at IS NULL
       );

    UPDATE public.checkins SET id_photo_path = NULL
     WHERE id_photo_path IS NOT NULL
       AND departure_date IS NOT NULL
       AND departure_date <= v_cutoff_date
       AND deleted_at IS NULL;

    RETURN v_count;
  END IF;

  -- ── Round 36 path: arrival_date + p_hours, or created_at + p_null_arrival_days ──
  --
  -- A row is eligible if it has a photo, isn't soft-deleted, and either
  --   (a) has an arrival_date and (arrival_date + p_hours) is in the past,
  --   (b) has a NULL arrival_date and (created_at + p_null_arrival_days) is past.
  --
  -- The (a) branch anchors on arrival_date rather than created_at because
  -- guests scan documents during pre-arrival online check-in, sometimes
  -- days ahead of arrival. Anchoring on row creation would delete images
  -- before the host can file at all — the failure mode this round exists
  -- to avoid.

  SELECT COUNT(*) INTO v_count
    FROM public.checkins
   WHERE id_photo_path IS NOT NULL
     AND deleted_at IS NULL
     AND (
       (arrival_date IS NOT NULL
          AND arrival_date + make_interval(hours => p_hours) <= v_now)
       OR (arrival_date IS NULL
          AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
     );

  IF p_dry_run OR v_count = 0 THEN
    RETURN v_count;
  END IF;

  DELETE FROM storage.objects
   WHERE bucket_id = 'documents'
     AND name IN (
       SELECT id_photo_path FROM public.checkins
        WHERE id_photo_path IS NOT NULL
          AND deleted_at IS NULL
          AND (
            (arrival_date IS NOT NULL
               AND arrival_date + make_interval(hours => p_hours) <= v_now)
            OR (arrival_date IS NULL
               AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
          )
     );

  UPDATE public.checkins SET id_photo_path = NULL
   WHERE id_photo_path IS NOT NULL
     AND deleted_at IS NULL
     AND (
       (arrival_date IS NOT NULL
          AND arrival_date + make_interval(hours => p_hours) <= v_now)
       OR (arrival_date IS NULL
          AND created_at + make_interval(days => p_null_arrival_days) <= v_now)
     );

  RETURN v_count;
END;
$function$;

-- Update purge_old_data so its 6f branch uses the Round 36 defaults instead
-- of passing v_id_photo_d = 30 as a legacy days argument. Everything else
-- in purge_old_data (chat, analytics, test, soft-deleted branches) stays
-- exactly as it was.
CREATE OR REPLACE FUNCTION public.purge_old_data(p_dry_run boolean DEFAULT true, p_triggered_by text DEFAULT 'cron'::text)
RETURNS data_purge_log
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now              TIMESTAMPTZ := NOW();
  v_chat_resolved_d  INTEGER := 90;
  v_chat_archived_d  INTEGER := 30;
  v_analytics_d      INTEGER := 180;
  v_test_d           INTEGER := 30;
  v_soft_deleted_d   INTEGER := 30;
  -- Round 36: photos now driven by purge_old_id_photos defaults
  -- (arrival_date + 48h, null-arrival + 7d). No local days constant here.

  v_chat_resolved_n     INTEGER := 0;
  v_chat_archived_n     INTEGER := 0;
  v_analytics_n         INTEGER := 0;
  v_analytics_agg_n     INTEGER := 0;
  v_test_n              INTEGER := 0;
  v_soft_n              INTEGER := 0;
  v_photos_n            INTEGER := 0;

  v_log public.data_purge_log;
BEGIN
  -- ── 6a. Resolved chats older than 90d ─────────────────────────────
  WITH resolved_convos AS (
    SELECT property_id, booking_code, MAX(created_at) AS last_resolve
    FROM public.chat_messages
    WHERE sender = 'system'
      AND (message ILIKE '%resolved%' OR message ILIKE '%returned to AI%')
    GROUP BY property_id, booking_code
  ),
  still_resolved AS (
    SELECT r.property_id, r.booking_code, r.last_resolve
    FROM resolved_convos r
    WHERE r.last_resolve < v_now - (v_chat_resolved_d || ' days')::INTERVAL
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_messages m
        WHERE m.property_id = r.property_id
          AND m.booking_code IS NOT DISTINCT FROM r.booking_code
          AND m.sender IN ('guest', 'host')
          AND m.created_at > r.last_resolve
      )
  )
  SELECT COUNT(*)
    INTO v_chat_resolved_n
    FROM public.chat_messages m
    JOIN still_resolved sr
      ON  m.property_id = sr.property_id
      AND m.booking_code IS NOT DISTINCT FROM sr.booking_code;

  IF NOT p_dry_run AND v_chat_resolved_n > 0 THEN
    DELETE FROM public.chat_messages m
    USING (
      WITH resolved_convos AS (
        SELECT property_id, booking_code, MAX(created_at) AS last_resolve
        FROM public.chat_messages
        WHERE sender = 'system'
          AND (message ILIKE '%resolved%' OR message ILIKE '%returned to AI%')
        GROUP BY property_id, booking_code
      )
      SELECT property_id, booking_code FROM resolved_convos r
      WHERE r.last_resolve < v_now - (v_chat_resolved_d || ' days')::INTERVAL
        AND NOT EXISTS (
          SELECT 1 FROM public.chat_messages m2
          WHERE m2.property_id = r.property_id
            AND m2.booking_code IS NOT DISTINCT FROM r.booking_code
            AND m2.sender IN ('guest', 'host')
            AND m2.created_at > r.last_resolve
        )
    ) sr
    WHERE m.property_id = sr.property_id
      AND m.booking_code IS NOT DISTINCT FROM sr.booking_code;
  END IF;

  -- ── 6b. Archived chats older than 30d ─────────────────────────────
  SELECT COUNT(*) INTO v_chat_archived_n
    FROM public.chat_messages
    WHERE deleted_at IS NOT NULL
      AND deleted_at < v_now - (v_chat_archived_d || ' days')::INTERVAL;

  IF NOT p_dry_run AND v_chat_archived_n > 0 THEN
    DELETE FROM public.chat_messages
    WHERE deleted_at IS NOT NULL
      AND deleted_at < v_now - (v_chat_archived_d || ' days')::INTERVAL;
  END IF;

  -- ── 6c. Analytics events older than 180d (with rollup first) ──────
  SELECT COUNT(*) INTO v_analytics_n
    FROM public.analytics_events
    WHERE created_at < v_now - (v_analytics_d || ' days')::INTERVAL;

  IF v_analytics_n > 0 THEN
    v_analytics_agg_n := public.aggregate_analytics_monthly(
      v_now - (v_analytics_d || ' days')::INTERVAL
    );
    IF NOT p_dry_run THEN
      DELETE FROM public.analytics_events
      WHERE created_at < v_now - (v_analytics_d || ' days')::INTERVAL;
    END IF;
  END IF;

  -- ── 6d. Test rows across tables, older than 30d ───────────────────
  SELECT
    (SELECT COUNT(*) FROM public.analytics_events
       WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.checkins
       WHERE is_test = TRUE AND COALESCE(submitted_at, created_at) < v_now - (v_test_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.chat_messages
       WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.recommendations
       WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.properties
       WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL)
    INTO v_test_n;

  IF NOT p_dry_run AND v_test_n > 0 THEN
    DELETE FROM public.analytics_events
      WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL;
    DELETE FROM public.checkins
      WHERE is_test = TRUE AND COALESCE(submitted_at, created_at) < v_now - (v_test_d || ' days')::INTERVAL;
    DELETE FROM public.chat_messages
      WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL;
    DELETE FROM public.recommendations
      WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL;
    DELETE FROM public.properties
      WHERE is_test = TRUE AND created_at < v_now - (v_test_d || ' days')::INTERVAL;
  END IF;

  -- ── 6e. Soft-deleted rows older than 30d (excl chat — handled in 6b) ─
  SELECT
      (SELECT COUNT(*) FROM public.analytics_events
         WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.checkins
         WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.recommendations
         WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL)
    + (SELECT COUNT(*) FROM public.properties
         WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL)
    INTO v_soft_n;

  IF NOT p_dry_run AND v_soft_n > 0 THEN
    DELETE FROM public.analytics_events
      WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL;
    DELETE FROM public.checkins
      WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL;
    DELETE FROM public.recommendations
      WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL;
    DELETE FROM public.properties
      WHERE deleted_at IS NOT NULL AND deleted_at < v_now - (v_soft_deleted_d || ' days')::INTERVAL;
  END IF;

  -- ── 6f. ROUND 36: Document photos, arrival_date + 48h (null → +7d) ─
  -- Named-argument call so the new defaults apply. Do NOT pass positional
  -- second argument — it would land as p_days and trigger the legacy path.
  v_photos_n := public.purge_old_id_photos(p_dry_run => p_dry_run);

  -- ── Log the run ───────────────────────────────────────────────────
  INSERT INTO public.data_purge_log (
    dry_run, triggered_by,
    chat_resolved_purged, chat_archived_purged,
    analytics_purged, analytics_aggregated,
    test_rows_purged, soft_deleted_purged,
    photos_purged,
    notes
  )
  VALUES (
    p_dry_run, p_triggered_by,
    v_chat_resolved_n, v_chat_archived_n,
    v_analytics_n, v_analytics_agg_n,
    v_test_n, v_soft_n,
    v_photos_n,
    CASE WHEN p_dry_run THEN 'Preview only — no rows were deleted' ELSE NULL END
  )
  RETURNING * INTO v_log;

  RETURN v_log;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════
-- PART 2 · Alloggiati filing reminder support
--
-- The reminder itself lives in api/send-arrival-reminders.js as a second
-- mode alongside the day-before reminder. This column + partial index
-- give it a per-row dedup stamp (mirrors Round 32's arrival_reminder_sent_at
-- pattern on ota_reservations).
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS filing_reminder_sent_at timestamptz;

-- Partial index — only rows that still need a reminder are indexed.
-- Same shape as ota_reservations.arrival_reminder_sent_at from Round 32.
CREATE INDEX IF NOT EXISTS checkins_filing_reminder_pending_idx
  ON public.checkins (property_id, arrival_date)
  WHERE filing_reminder_sent_at IS NULL
    AND deleted_at IS NULL
    AND is_test = false;

-- ══════════════════════════════════════════════════════════════════════
-- PART 3 · Receipts bucket + checkins.receipt_path / filed_at
--
-- The Garante's note says the Alloggiati Web portal produces a filing
-- receipt that must be kept for five years as proof of compliance.
-- Nothing in the product stored it before this round — hosts kept
-- it in email or nowhere.
--
-- Bucket policies are owner-scoped (property owner_id = auth.uid()) so
-- one host cannot read another host's receipts even if they happened to
-- guess the object path. Explicit GRANTs on the checkins column changes
-- are unnecessary (existing checkins grants cover them), but the note
-- from Round 28 stands for any future receipts-related tables.
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS receipt_path text,
  ADD COLUMN IF NOT EXISTS filed_at     timestamptz;

-- Storage bucket. Private (no public CDN). Uploads and reads gated by RLS
-- policies below. `public: false` matches the `documents` bucket
-- convention — the client always uses signed URLs to fetch, and uploads
-- go through the authenticated Supabase JS client.
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Owner-scoped policies. Path convention (enforced by the host console
-- code, not the DB): '<property_id>/<checkin_id>-<yyyymmdd>.<ext>'. We
-- extract the first path segment and check that segment names a property
-- the caller owns.

DROP POLICY IF EXISTS "receipts_owner_read"   ON storage.objects;
DROP POLICY IF EXISTS "receipts_owner_write"  ON storage.objects;
DROP POLICY IF EXISTS "receipts_owner_delete" ON storage.objects;
DROP POLICY IF EXISTS "receipts_service_all"  ON storage.objects;

CREATE POLICY "receipts_owner_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "receipts_owner_write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.owner_id = auth.uid()
    )
  );

CREATE POLICY "receipts_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipts' AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.owner_id = auth.uid()
    )
  );

-- Service role bypasses RLS but we spell the policy out anyway so cron /
-- server-side maintenance can be attributed via SQL log rather than
-- "service role bypass".
CREATE POLICY "receipts_service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'receipts') WITH CHECK (bucket_id = 'receipts');

COMMIT;

-- ══════════════════════════════════════════════════════════════════════
-- Rollback (paste into SQL editor if the retighten needs to be undone).
-- Restores the Round 15.2 signature and behaviour, drops the R36 column,
-- and drops the receipts bucket + policies. It does NOT delete uploaded
-- receipt files — those must be exported manually before rollback.
-- ══════════════════════════════════════════════════════════════════════
--
-- BEGIN;
--
-- -- Restore Round 15.2 shape
-- CREATE OR REPLACE FUNCTION public.purge_old_id_photos(
--   p_dry_run boolean DEFAULT true,
--   p_days    integer DEFAULT 30
-- ) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
-- DECLARE v_count INTEGER := 0; v_cutoff DATE;
-- BEGIN
--   v_cutoff := (NOW() - (p_days || ' days')::INTERVAL)::DATE;
--   SELECT COUNT(*) INTO v_count FROM public.checkins
--     WHERE id_photo_path IS NOT NULL AND departure_date IS NOT NULL
--       AND departure_date <= v_cutoff AND deleted_at IS NULL;
--   IF p_dry_run OR v_count = 0 THEN RETURN v_count; END IF;
--   DELETE FROM storage.objects WHERE bucket_id='documents' AND name IN (
--     SELECT id_photo_path FROM public.checkins WHERE id_photo_path IS NOT NULL
--       AND departure_date IS NOT NULL AND departure_date <= v_cutoff AND deleted_at IS NULL);
--   UPDATE public.checkins SET id_photo_path = NULL WHERE id_photo_path IS NOT NULL
--     AND departure_date IS NOT NULL AND departure_date <= v_cutoff AND deleted_at IS NULL;
--   RETURN v_count;
-- END; $$;
--
-- ALTER TABLE public.checkins
--   DROP COLUMN IF EXISTS filing_reminder_sent_at,
--   DROP COLUMN IF EXISTS receipt_path,
--   DROP COLUMN IF EXISTS filed_at;
-- DROP INDEX IF EXISTS public.checkins_filing_reminder_pending_idx;
--
-- DROP POLICY IF EXISTS "receipts_owner_read"   ON storage.objects;
-- DROP POLICY IF EXISTS "receipts_owner_write"  ON storage.objects;
-- DROP POLICY IF EXISTS "receipts_owner_delete" ON storage.objects;
-- DROP POLICY IF EXISTS "receipts_service_all"  ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'receipts';
--
-- COMMIT;
