-- Round 36.2.3 — Host-driven "reopen check-in" so more guests can be added.
--
-- Real-world case that surfaced: a guest completed check-in for 3 people
-- and later needed to add 3 more (the booking was for 6). The Round 15
-- welcome-back state locks that guest out. This migration adds a small
-- host-controlled flag on both tables; when either row for a booking
-- has it set, the guest app skips the welcome-back state and lets the
-- guest add additional group members. Flag is cleared on the next
-- successful insert from that guest so the booking naturally re-locks.
--
-- Two tables, one column each:
--   - ota_reservations.checkin_reopened_at (iCal-driven bookings)
--   - checkins.checkin_reopened_at (walk-in / no-booking-code check-ins)
--
-- The host UI stamps whichever tables are relevant (usually both when a
-- booking_code is present) and the guest app OR-detects the flag across
-- them.

BEGIN;

ALTER TABLE public.ota_reservations
  ADD COLUMN IF NOT EXISTS checkin_reopened_at timestamptz;

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS checkin_reopened_at timestamptz;

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.ota_reservations DROP COLUMN IF EXISTS checkin_reopened_at;
-- ALTER TABLE public.checkins         DROP COLUMN IF EXISTS checkin_reopened_at;
-- COMMIT;
