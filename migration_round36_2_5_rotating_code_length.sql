-- Round 36.2.5 — Host picks how many digits the rotating lockbox code has.
--
-- Rationale: 4 digits fit the most common mechanical lockboxes, but some
-- hosts use 5- to 8-digit smart locks or digital gate keypads. Rather than
-- hard-coding 4, we let the host choose per property.
--
-- One column on properties:
--   properties.rotating_lockbox_length  int  DEFAULT 4  CHECK 4..8
--
-- The client generates a code of exactly that many digits and enforces the
-- same length as a maxlength on the edit inputs (upper-bounded to 8 for
-- safety even if the column is somehow out of range).

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS rotating_lockbox_length integer NOT NULL DEFAULT 4;

-- Guard against nonsense values. 4..8 covers real hardware; anything longer
-- is a QR-code territory, anything shorter is trivial to guess.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'properties_rotating_lockbox_length_chk'
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_rotating_lockbox_length_chk
      CHECK (rotating_lockbox_length BETWEEN 4 AND 8);
  END IF;
END $$;

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.properties
--   DROP CONSTRAINT IF EXISTS properties_rotating_lockbox_length_chk;
-- ALTER TABLE public.properties
--   DROP COLUMN IF EXISTS rotating_lockbox_length;
-- COMMIT;
