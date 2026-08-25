-- Round 26: iCal calendar sync for OTA reservations (Airbnb, Booking.com, Vrbo).
--
-- properties.ical_feeds is an array of {platform, url, label} entries
-- edited by the host in the Property panel. The server endpoint
-- /api/ical-sync fetches them, hand-parses ICS, and upserts into
-- ota_reservations. Guest name and guest count come from the checkins
-- table once the guest actually checks in — never fabricated from iCal.
--
-- Applied to the remote Supabase project via MCP as migration
-- `round26_ical_sync` on 2026-08-25. This file is the tracked mirror;
-- re-runs are safe (IF NOT EXISTS / DROP POLICY IF EXISTS everywhere).

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS ical_feeds jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ical_last_synced_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ota_reservations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  uid             text NOT NULL,
  entry_type      text NOT NULL DEFAULT 'reservation',
  status          text NOT NULL DEFAULT 'active',
  summary         text,
  guest_name      text,
  checkin_date    date,
  checkout_date   date,
  reservation_url text,
  phone_last4     text,
  booking_code    text,
  raw             jsonb,
  is_test         boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, platform, uid)
);

CREATE INDEX IF NOT EXISTS ota_reservations_property_checkin_idx
  ON public.ota_reservations (property_id, checkin_date);

CREATE OR REPLACE FUNCTION public._ota_reservations_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ota_reservations_touch_updated_at ON public.ota_reservations;
CREATE TRIGGER ota_reservations_touch_updated_at
  BEFORE UPDATE ON public.ota_reservations
  FOR EACH ROW EXECUTE FUNCTION public._ota_reservations_touch_updated_at();

-- RLS + grants. Round 28 lesson: silent 0-row UPDATEs with no error are
-- this project's number-one gotcha. New tables here don't inherit default
-- privileges, so the GRANT lines are mandatory, not decorative.

ALTER TABLE public.ota_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ota_reservations_host_select ON public.ota_reservations;
CREATE POLICY ota_reservations_host_select
  ON public.ota_reservations FOR SELECT TO authenticated
  USING (property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS ota_reservations_host_insert ON public.ota_reservations;
CREATE POLICY ota_reservations_host_insert
  ON public.ota_reservations FOR INSERT TO authenticated
  WITH CHECK (property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS ota_reservations_host_update ON public.ota_reservations;
CREATE POLICY ota_reservations_host_update
  ON public.ota_reservations FOR UPDATE TO authenticated
  USING (property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid()))
  WITH CHECK (property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS ota_reservations_host_delete ON public.ota_reservations;
CREATE POLICY ota_reservations_host_delete
  ON public.ota_reservations FOR DELETE TO authenticated
  USING (property_id IN (SELECT id FROM public.properties WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS ota_reservations_admin_all ON public.ota_reservations;
CREATE POLICY ota_reservations_admin_all
  ON public.ota_reservations FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS ota_reservations_service_all ON public.ota_reservations;
CREATE POLICY ota_reservations_service_all
  ON public.ota_reservations FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_reservations TO authenticated;
GRANT ALL                           ON public.ota_reservations TO service_role;
