-- Arrival/filing reminder time chosen by the host (6 Nov 2026). Local hour in
-- the property's timezone, 6..21; default 7 keeps today's behaviour for every
-- existing property. The reminders job now runs hourly and sends at this hour
-- (a few hours of catch-up if a run is missed; the *_sent_at markers prevent
-- duplicates). Owners update it through the existing table grant and owner
-- RLS policy (same as reminder_email / timezone). No anon access.
-- Re-runnable. Rollback: ALTER TABLE public.properties DROP COLUMN reminder_hour;
BEGIN;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS reminder_hour smallint NOT NULL DEFAULT 7;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_reminder_hour_range;
ALTER TABLE public.properties ADD CONSTRAINT properties_reminder_hour_range CHECK (reminder_hour BETWEEN 6 AND 21);
COMMENT ON COLUMN public.properties.reminder_hour IS 'Local hour (property timezone, 6..21) at which the daily arrival and filing reminders are emailed. Default 7.';
COMMIT;
