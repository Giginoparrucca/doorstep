-- Round 32: day-before arrival reminders (email via Resend).
--
-- Adds:
--   * properties.reminder_email      — where the daily "arriving tomorrow"
--                                      digest is sent. Empty = no reminder.
--   * properties.timezone            — IANA zone. The cron converts "tomorrow"
--                                      into the property's local calendar day
--                                      and only fires when it's ~07:00 local.
--                                      Default: 'Europe/Rome'.
--   * ota_reservations.arrival_reminder_sent_at — set once the reminder has
--                                      gone out, so a re-run within the same
--                                      hour never double-sends.
--
-- No new tables, no new policies — everything sits on tables whose RLS was
-- already validated in Round 26 (ota_reservations) and Round 28 (properties).
-- Apply via Supabase SQL Editor. Re-runs are safe (IF NOT EXISTS).

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS reminder_email text,
  ADD COLUMN IF NOT EXISTS timezone       text NOT NULL DEFAULT 'Europe/Rome';

ALTER TABLE public.ota_reservations
  ADD COLUMN IF NOT EXISTS arrival_reminder_sent_at timestamptz;

-- Small index for the cron's hot query: pending reminders for near-future
-- reservations. Kept narrow so it stays useful only for that access pattern.
CREATE INDEX IF NOT EXISTS ota_reservations_pending_reminder_idx
  ON public.ota_reservations (property_id, checkin_date)
  WHERE arrival_reminder_sent_at IS NULL
    AND status = 'active'
    AND entry_type = 'reservation'
    AND deleted_at IS NULL;
