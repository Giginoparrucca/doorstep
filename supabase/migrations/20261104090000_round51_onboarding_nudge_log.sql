-- Round 51 Phase 5 — onboarding nudge emails log to notification_log as
-- 'onboarding_nudge_24h' / 'onboarding_nudge_72h'. The CHECK allowed only
-- escalation/guest_message/test and autofile_<kind>; widen it to these two
-- exact values. Existing values stay valid. No new table or column: the
-- sent markers and opt-out already exist on host_onboarding (Round 51
-- Phase 2), written by the service role only.
-- Re-runnable.
-- Rollback: restore the Round 70 CHECK (without the onboarding values).
BEGIN;
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_trigger_check;
ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_trigger_check
  CHECK (trigger = ANY (ARRAY['escalation'::text, 'guest_message'::text, 'test'::text,
                              'onboarding_nudge_24h'::text, 'onboarding_nudge_72h'::text])
         OR trigger ~ '^autofile_[a-z_]{1,40}$');
COMMIT;
