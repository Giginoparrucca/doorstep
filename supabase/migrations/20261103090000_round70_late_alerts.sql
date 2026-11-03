-- Round 70 Phase 1 — late Alloggiati filing alerts.
--
-- 1. checkins.late_alert_at: one-shot marker for the "window closed" alert
--    (sent once per booking group when its portal window closes). Separate
--    from autofile_last_alert_at, which is the 24 h cooldown of the
--    "3 failures" / "rejected" row alerts: sharing it would let either alert
--    silence the other. Written by the service role only (autofile tick);
--    existing table grants apply, no new policy needed.
-- 2. notification_log.trigger: the autofile alerts log as 'autofile_<kind>'
--    (overdue, closing, window_closed, failures, rejection, heads_up,
--    digest). The CHECK only allowed escalation/guest_message/test, so
--    every Alloggiati alert log row was refused. Widen it to that pattern;
--    existing values stay valid.
--
-- Re-runnable.
-- Rollback: ALTER TABLE public.checkins DROP COLUMN late_alert_at;
--   restore notification_log_trigger_check to the three original values.
BEGIN;
ALTER TABLE public.checkins ADD COLUMN IF NOT EXISTS late_alert_at timestamptz;
COMMENT ON COLUMN public.checkins.late_alert_at IS
  'Round 70: when the one-shot "portal window closed" alert was sent (or the row was marked as already late without alerting).';

ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_trigger_check;
ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_trigger_check
  CHECK (trigger = ANY (ARRAY['escalation'::text, 'guest_message'::text, 'test'::text])
         OR trigger ~ '^autofile_[a-z_]{1,40}$');
COMMIT;
