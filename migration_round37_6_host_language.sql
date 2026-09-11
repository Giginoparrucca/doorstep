-- Round 37.6 — Per-property host language for reminder emails.
--
-- The host toggles EN/IT in the top bar. Until now that pref lived in
-- memory only (the global `hostLang`), so the daily cron that sends
-- arrival + filing reminders had no way to know which language the
-- host actually reads. Everyone got English. This round persists the
-- pref per property so the cron can pick the right template.
--
-- Per-property, not per-user: hosts with multiple properties may
-- (rarely) split by language, and everything else in this schema is
-- already property-scoped.
--
-- Default 'it' matches the app's UI default (Italian pilot).

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS host_language text NOT NULL DEFAULT 'it';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'properties_host_language_chk'
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_host_language_chk
      CHECK (host_language IN ('en', 'it'));
  END IF;
END $$;

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.properties
--   DROP CONSTRAINT IF EXISTS properties_host_language_chk,
--   DROP COLUMN IF EXISTS host_language;
-- COMMIT;
