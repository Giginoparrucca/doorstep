-- Round 66 Phase 2 — opt-in column + optional time-of-release settings.
--
-- Adds three nullable/defaulted columns to public.properties that the
-- entry-release policy already expects to see on the snapshot:
--
--   entry_checkin_required  boolean  default false, not null
--       The master opt-in. False preserves today's legacy behaviour
--       (bookingHasCheckin() is the gate). True enables the policy's
--       roster/time logic for this property.
--
--   entry_release_time      text     null
--       Optional "HH:MM" wall-clock time of day on the arrival calendar
--       date, in the property's own timezone. Null disables time gating
--       (policy only checks roster completion).
--
--   entry_release_timezone  text     null
--       IANA timezone string (e.g. "Europe/Rome") used to anchor the
--       release_time to a real UTC instant. Required if release_time is
--       set — the policy explicitly rejects browser/default timezones.
--
-- A CHECK constraint keeps time + timezone paired: either both are set
-- or both are null. The format of release_time is also validated at the
-- DB layer so a malformed value cannot silently disable the gate.
--
-- No existing row changes: the new boolean defaults to false, so every
-- property today keeps its legacy OFF behaviour and the policy's
-- "entry_checkin_required == null || === false" branch continues to
-- return legacy_available/locked identically to the prior
-- bookingHasCheckin() path. The Phase 1b loader currently overrides
-- these fields to null in the snapshot; a follow-up commit removes the
-- override so the real column values flow through to the policy.
--
-- Rollback: ALTER TABLE public.properties DROP COLUMN entry_checkin_required,
--   DROP COLUMN entry_release_time, DROP COLUMN entry_release_timezone;
-- then DELETE FROM supabase_migrations.schema_migrations WHERE name='round66_entry_release_columns'.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS entry_checkin_required boolean NOT NULL DEFAULT false;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS entry_release_time text NULL;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS entry_release_timezone text NULL;

-- Time format must be HH:MM in 24-hour notation. Checked at DB level
-- so a malformed value cannot be saved via a PATCH that bypasses the
-- host-console validation.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'properties_entry_release_time_hhmm'
      AND conrelid = 'public.properties'::regclass
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_entry_release_time_hhmm
      CHECK (entry_release_time IS NULL
         OR entry_release_time ~ '^(?:[01]\d|2[0-3]):[0-5]\d$');
  END IF;
END $$;

-- Time + timezone must be set together. The policy module explicitly
-- rejects a browser/default timezone (see arrivalReleaseInstant in
-- api/_entry-release-policy.js); forbidding the half-set case here
-- removes the ambiguity before it reaches the loader.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_constraint WHERE conname = 'properties_entry_release_pair'
      AND conrelid = 'public.properties'::regclass
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_entry_release_pair
      CHECK ((entry_release_time IS NULL) = (entry_release_timezone IS NULL));
  END IF;
END $$;

COMMIT;
