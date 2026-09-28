-- Round 45 · Direct bookings + blocked dates
--
-- Design principle: one reservations table for every source. Direct
-- bookings (WhatsApp, Instagram, host's own website, word of mouth)
-- live in ota_reservations with `platform = 'direct'`. No new table.
--
-- The columns added here are all optional (NULL-able) so existing
-- OTA rows aren't affected. Every CHECK is written to accept NULL,
-- so `INSERT`ing an OTA row without new fields still succeeds.
--
-- Verified via Supabase MCP on 2026-09-28:
--   - zero rows with checkout_date <= checkin_date → the tight
--     CHECK can be added IMMEDIATELY VALID, not NOT VALID.
--   - zero rows with platform='direct' → no legacy conflict.
--   - existing grants on ota_reservations cover authenticated +
--     service_role (SELECT/INSERT/UPDATE/DELETE). Column adds
--     inherit table grants, so no re-grant needed; verified below.
--   - existing RLS policies (host_select/insert/update/delete,
--     admin_all, service_all) already scope by property owner and
--     admin, so direct rows will be visible/writable to the host
--     that owns the property without any policy change.

BEGIN;

-- ── 1. New columns (all nullable, all IF NOT EXISTS) ───────────────
ALTER TABLE public.ota_reservations
  ADD COLUMN IF NOT EXISTS channel                    text,
  ADD COLUMN IF NOT EXISTS guest_count                smallint,
  ADD COLUMN IF NOT EXISTS contact_phone              text,
  ADD COLUMN IF NOT EXISTS contact_email              text,
  ADD COLUMN IF NOT EXISTS notes                      text,
  ADD COLUMN IF NOT EXISTS created_by                 uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS link_sent_at               timestamptz,
  ADD COLUMN IF NOT EXISTS covered_by_reservation_id  uuid REFERENCES public.ota_reservations(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ota_reservations.channel IS
  'For platform=direct only. How the host got the booking. NULL for OTA rows.';
COMMENT ON COLUMN public.ota_reservations.guest_count IS
  'Optional headcount, 1..50. NULL when unknown.';
COMMENT ON COLUMN public.ota_reservations.contact_phone IS
  'Host-only. Never surfaced in guest app, exports or reminder emails.';
COMMENT ON COLUMN public.ota_reservations.contact_email IS
  'Host-only. Never surfaced in guest app, exports or reminder emails.';
COMMENT ON COLUMN public.ota_reservations.notes IS
  'Host-only free-text. Never surfaced to the guest or in exports.';
COMMENT ON COLUMN public.ota_reservations.link_sent_at IS
  'Stamped best-effort when the host taps WhatsApp/Copy/Email in the form.';
COMMENT ON COLUMN public.ota_reservations.covered_by_reservation_id IS
  'Set on an OTA-imported row (Airbnb block, Booking CLOSED, or Booking echo of our own iCal feed) when that row is only the host''s own closure for a direct booking. When set, the row is hidden from calendar bars, dashboard, reminders and ensureReservationBookingCodes — the direct row represents it.';

-- ── 2. CHECK constraints (all NULL-tolerant) ────────────────────────
-- channel: bounded enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_reservations_channel_chk') THEN
    ALTER TABLE public.ota_reservations
      ADD CONSTRAINT ota_reservations_channel_chk
      CHECK (channel IS NULL OR channel IN (
        'website', 'instagram', 'whatsapp_phone', 'word_of_mouth',
        'returning_guest', 'other_platform', 'other'
      ));
  END IF;
END $$;

-- guest_count: 1..50 sanity
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_reservations_guest_count_chk') THEN
    ALTER TABLE public.ota_reservations
      ADD CONSTRAINT ota_reservations_guest_count_chk
      CHECK (guest_count IS NULL OR (guest_count >= 1 AND guest_count <= 50));
  END IF;
END $$;

-- checkout must be strictly after checkin when both are set.
-- Verified 0 existing violations → add fully valid, not NOT VALID.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ota_reservations_dates_chk') THEN
    ALTER TABLE public.ota_reservations
      ADD CONSTRAINT ota_reservations_dates_chk
      CHECK (checkin_date IS NULL OR checkout_date IS NULL OR checkout_date > checkin_date);
  END IF;
END $$;

-- ── 3. Indexes ─────────────────────────────────────────────────────
-- Overlap check on the form: same property, active, not deleted.
CREATE INDEX IF NOT EXISTS ota_reservations_overlap_idx
  ON public.ota_reservations (property_id, checkin_date, checkout_date)
  WHERE deleted_at IS NULL AND status = 'active';

-- covered_by_reservation_id lookups (echo matching, unlink).
CREATE INDEX IF NOT EXISTS ota_reservations_covered_by_idx
  ON public.ota_reservations (covered_by_reservation_id)
  WHERE covered_by_reservation_id IS NOT NULL;

COMMIT;

/*
-- ROLLBACK — run this block manually if the migration needs undoing.
BEGIN;
DROP INDEX IF EXISTS public.ota_reservations_overlap_idx;
DROP INDEX IF EXISTS public.ota_reservations_covered_by_idx;
ALTER TABLE public.ota_reservations
  DROP CONSTRAINT IF EXISTS ota_reservations_channel_chk,
  DROP CONSTRAINT IF EXISTS ota_reservations_guest_count_chk,
  DROP CONSTRAINT IF EXISTS ota_reservations_dates_chk,
  DROP COLUMN IF EXISTS channel,
  DROP COLUMN IF EXISTS guest_count,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS created_by,
  DROP COLUMN IF EXISTS link_sent_at,
  DROP COLUMN IF EXISTS covered_by_reservation_id;
COMMIT;
*/

-- ── Verification ────────────────────────────────────────────────────
-- Run after applying. Expected shape:
--   - 8 new columns present
--   - 3 new CHECK constraints present
--   - 2 new indexes present
--   - grants unchanged (authenticated + service_role keep full CRUD)
--   - policies unchanged (existing 6 policies still cover the new columns)
SELECT
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ota_reservations'
      AND column_name IN ('channel','guest_count','contact_phone','contact_email',
                          'notes','created_by','link_sent_at','covered_by_reservation_id')) AS new_columns,
  (SELECT string_agg(conname, ', ' ORDER BY conname)
     FROM pg_constraint
    WHERE conrelid='public.ota_reservations'::regclass
      AND conname LIKE 'ota_reservations_%_chk') AS new_checks,
  (SELECT string_agg(indexname, ', ' ORDER BY indexname)
     FROM pg_indexes
    WHERE schemaname='public' AND tablename='ota_reservations'
      AND indexname IN ('ota_reservations_overlap_idx','ota_reservations_covered_by_idx')) AS new_indexes,
  (SELECT string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='ota_reservations'
      AND grantee IN ('authenticated','service_role')
      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AS crud_grants;
