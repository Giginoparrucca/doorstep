-- Round 36.2 — Dual lockbox codes (fixed + rotating) with per-code visibility
--
-- Rationale: real properties often have TWO codes:
--   * a "fixed" one that doesn't change (front gate, building entrance),
--   * a "rotating" one the host resets between guests (apartment lockbox).
-- The single properties.keybox_code + properties.use_per_guest_lockbox pair
-- didn't cover that. This round splits them:
--
--   properties.keybox_code                    → the FIXED code (kept as-is)
--   properties.show_fixed_lockbox_to_guest    → default true
--   properties.rotating_lockbox_enabled       → default false; when on,
--                                                every new check-in gets a
--                                                client-side auto-generated
--                                                4-digit rotating code
--                                                (checkins.keybox_code)
--   properties.show_rotating_lockbox_to_guest → default true
--
-- Legacy properties.use_per_guest_lockbox → mapped to
-- rotating_lockbox_enabled on this migration; kept as a dead column for
-- rollback safety. Legacy checkins.keybox_code values are treated as
-- rotating codes going forward.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS show_fixed_lockbox_to_guest    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rotating_lockbox_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_rotating_lockbox_to_guest boolean NOT NULL DEFAULT true;

-- Preserve behaviour for any property that previously opted into per-guest
-- codes: turn on rotating_lockbox_enabled. Rows with use_per_guest_lockbox
-- IS NULL / false are left with the new defaults.
UPDATE public.properties
   SET rotating_lockbox_enabled = TRUE
 WHERE COALESCE(use_per_guest_lockbox, FALSE) = TRUE
   AND rotating_lockbox_enabled = FALSE;

COMMIT;

-- Rollback (paste into SQL editor to undo):
-- BEGIN;
-- ALTER TABLE public.properties
--   DROP COLUMN IF EXISTS show_fixed_lockbox_to_guest,
--   DROP COLUMN IF EXISTS rotating_lockbox_enabled,
--   DROP COLUMN IF EXISTS show_rotating_lockbox_to_guest;
-- COMMIT;
