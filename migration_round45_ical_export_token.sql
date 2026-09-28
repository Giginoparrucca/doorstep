-- Round 45 Step 4.5 · outbound iCal feed per property
--
-- Adds properties.ical_export_token — a per-property UUID that guards
-- the /api/property-ical endpoint. The host pastes the resulting URL
-- into Airbnb / Booking / Vrbo's "Import calendar" screen and those
-- OTAs then poll it every couple of hours, treating each direct
-- booking (and each host-set block) as an unavailable date range.
--
-- Security model:
--   - The token IS the secret. Anyone with the URL can read the
--     property's blocked date ranges — no PII is emitted (no guest
--     names, no phone/email, no booking codes; only date ranges +
--     the generic label "Blocked").
--   - The token is rotatable from the property panel; rotating
--     invalidates the previous URL immediately (existing OTA
--     imports stop working until the host repastes the new URL).
--   - The endpoint uses SERVICE_ROLE_KEY server-side to look up the
--     property by token, bypassing RLS. Never expose this token to
--     the guest app.
--
-- Verified via Supabase MCP on 2026-09-28:
--   - 11 existing properties → backfilled with gen_random_uuid()
--   - no existing ical_export_token / similar column → clean add
--   - properties table already has 65 columns; adding one nullable
--     UUID with a default has effectively zero write cost.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS ical_export_token uuid DEFAULT gen_random_uuid();

COMMENT ON COLUMN public.properties.ical_export_token IS
  'Round 45 · secret token that guards the /api/property-ical outbound iCal feed. Rotating this column invalidates the OTAs'' existing subscriptions until the host pastes the new URL. Never surface to the guest app.';

-- Backfill any pre-existing rows that came in before the default landed.
UPDATE public.properties
   SET ical_export_token = gen_random_uuid()
 WHERE ical_export_token IS NULL;

-- Fast lookup by token (endpoint hits this on every OTA poll).
CREATE UNIQUE INDEX IF NOT EXISTS properties_ical_export_token_idx
  ON public.properties (ical_export_token)
  WHERE ical_export_token IS NOT NULL;

COMMIT;

/*
-- ROLLBACK — run manually if this migration needs undoing.
BEGIN;
DROP INDEX IF EXISTS public.properties_ical_export_token_idx;
ALTER TABLE public.properties DROP COLUMN IF EXISTS ical_export_token;
COMMIT;
*/

-- Verification — expected: 11 rows, all non-null, 11 distinct.
SELECT COUNT(*) AS total,
       COUNT(ical_export_token) AS with_token,
       COUNT(DISTINCT ical_export_token) AS distinct_tokens
  FROM public.properties;
