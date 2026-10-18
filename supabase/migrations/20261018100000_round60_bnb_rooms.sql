-- migration_round60_bnb_rooms.sql — Round 60 Phase 1.
--
-- Adds a `public.property_rooms` table and two nullable `room_id` FK
-- columns on `ota_reservations` and `checkins`. One property can
-- host 2-6 rooms (private Italian B&B, non imprenditoriale); each
-- room is a bed in a shared struttura, so compliance stays per
-- struttura (one CIN, one Alloggiati account, one regional statistics
-- code, one tourist-tax setup) and the room is only an internal
-- bucket for calendar / iCal / door-code purposes.
--
-- Zero-impact rule: a property with no `property_rooms` row behaves
-- exactly as before. All new columns are nullable; all existing
-- queries that don't SELECT `room_id` continue to return byte-
-- identical results. `regional-exports.test.mjs` is the canary.
--
-- Related plan: PLAN_round60_bnb_rooms.md
--
-- iCal feeds: the existing `public.properties.ical_feeds` JSONB
-- column gains an optional `room_id` key per feed entry. No DDL for
-- that: the shape is `[{"url":"...","platform":"airbnb","room_id":"<uuid|null>"}, ...]`
-- and absent `room_id` means "unassigned". The host console
-- (Phase 3) and the sync handler (Phase 2) treat null as "any room"
-- for display and "no room stamping" for insert.
--
-- Idempotent. A commented rollback block lives at the bottom.

BEGIN;

-- ── property_rooms ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.property_rooms (
  id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid        NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  beds        integer     NOT NULL DEFAULT 1 CHECK (beds BETWEEN 1 AND 20),
  door_code   text        NULL CHECK (door_code IS NULL OR length(door_code) BETWEEN 1 AND 60),
  sort_order  integer     NOT NULL DEFAULT 0,
  deleted_at  timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.property_rooms IS
  'Round 60 Phase 1 — B&B rooms inside one struttura. Zero-impact if empty for a given property.';
COMMENT ON COLUMN public.property_rooms.name IS
  'Host-visible label (e.g. "Camera Blu"). Uniqueness is case-insensitive within an active property.';
COMMENT ON COLUMN public.property_rooms.beds IS
  'Bed count per room, used to derive beds_available for ROSS1000 / regional review.';
COMMENT ON COLUMN public.property_rooms.door_code IS
  'Optional per-room access code; shown to the guest if their booking is linked to this room, subject to existing lockbox visibility toggles.';

-- Case-insensitive unique name within an active (not soft-deleted)
-- property. Soft-deleted rows are excluded so a host can re-use a
-- name after deleting a room.
CREATE UNIQUE INDEX IF NOT EXISTS property_rooms_name_unique_active
  ON public.property_rooms (property_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS property_rooms_property_sort_idx
  ON public.property_rooms (property_id, sort_order, name)
  WHERE deleted_at IS NULL;

-- ── touch trigger for updated_at ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.property_rooms_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS property_rooms_set_updated_at ON public.property_rooms;
CREATE TRIGGER property_rooms_set_updated_at
  BEFORE UPDATE ON public.property_rooms
  FOR EACH ROW EXECUTE FUNCTION public.property_rooms_touch_updated_at();

-- ── RLS + policies ──────────────────────────────────────────────────
ALTER TABLE public.property_rooms ENABLE ROW LEVEL SECURITY;

-- Owner: full CRUD on rooms of the properties they own.
DROP POLICY IF EXISTS property_rooms_owner_select ON public.property_rooms;
CREATE POLICY property_rooms_owner_select
  ON public.property_rooms
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_rooms.property_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS property_rooms_owner_insert ON public.property_rooms;
CREATE POLICY property_rooms_owner_insert
  ON public.property_rooms
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_rooms.property_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS property_rooms_owner_update ON public.property_rooms;
CREATE POLICY property_rooms_owner_update
  ON public.property_rooms
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_rooms.property_id AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_rooms.property_id AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS property_rooms_owner_delete ON public.property_rooms;
CREATE POLICY property_rooms_owner_delete
  ON public.property_rooms
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = property_rooms.property_id AND p.owner_id = auth.uid()
    )
  );

-- Admin read-only, matching the pattern on properties / host_onboarding.
DROP POLICY IF EXISTS property_rooms_admin_select ON public.property_rooms;
CREATE POLICY property_rooms_admin_select
  ON public.property_rooms
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- ── explicit grants (RLS without GRANT = silent 0-row writes) ──────
REVOKE ALL ON public.property_rooms FROM PUBLIC;
REVOKE ALL ON public.property_rooms FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.property_rooms TO authenticated;
GRANT  SELECT, INSERT, UPDATE, DELETE ON public.property_rooms TO service_role;

-- ── room_id column on existing stay tables ─────────────────────────
-- NULL means "unassigned" (property has no rooms, or the host hasn't
-- picked one yet). ON DELETE SET NULL so deleting a room never
-- cascades into losing a reservation.
ALTER TABLE public.ota_reservations
  ADD COLUMN IF NOT EXISTS room_id uuid NULL
    REFERENCES public.property_rooms(id) ON DELETE SET NULL;

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS room_id uuid NULL
    REFERENCES public.property_rooms(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ota_reservations.room_id IS
  'Round 60 — optional link to property_rooms. NULL when the property has no rooms or the booking is unassigned.';
COMMENT ON COLUMN public.checkins.room_id IS
  'Round 60 — optional link to property_rooms. Used only for check-in groups that are not linked to a reservation; otherwise the room follows the reservation via booking_code.';

-- Partial index to make per-room overlap queries fast. Scoped to the
-- common active-and-not-deleted case so the index stays small.
CREATE INDEX IF NOT EXISTS ota_reservations_property_room_dates_idx
  ON public.ota_reservations (property_id, room_id, checkin_date, checkout_date)
  WHERE deleted_at IS NULL AND status = 'active';

COMMIT;

-- ── Rollback (commented) ────────────────────────────────────────────
-- Safe to run: additive migration, no data loss on rollback.
-- BEGIN;
--   DROP INDEX IF EXISTS public.ota_reservations_property_room_dates_idx;
--   ALTER TABLE public.checkins          DROP COLUMN IF EXISTS room_id;
--   ALTER TABLE public.ota_reservations  DROP COLUMN IF EXISTS room_id;
--   DROP POLICY IF EXISTS property_rooms_admin_select  ON public.property_rooms;
--   DROP POLICY IF EXISTS property_rooms_owner_delete  ON public.property_rooms;
--   DROP POLICY IF EXISTS property_rooms_owner_update  ON public.property_rooms;
--   DROP POLICY IF EXISTS property_rooms_owner_insert  ON public.property_rooms;
--   DROP POLICY IF EXISTS property_rooms_owner_select  ON public.property_rooms;
--   DROP TRIGGER IF EXISTS property_rooms_set_updated_at ON public.property_rooms;
--   DROP FUNCTION IF EXISTS public.property_rooms_touch_updated_at();
--   DROP INDEX IF EXISTS public.property_rooms_property_sort_idx;
--   DROP INDEX IF EXISTS public.property_rooms_name_unique_active;
--   DROP TABLE IF EXISTS public.property_rooms;
-- COMMIT;

-- ── Post-apply verification ─────────────────────────────────────────
-- Run these after the migration lands on each environment:
--   SELECT 'table'  AS kind, EXISTS (SELECT 1 FROM pg_tables  WHERE tablename='property_rooms' AND schemaname='public') AS ok;
--   SELECT 'rls'    AS kind, relrowsecurity FROM pg_class WHERE oid='public.property_rooms'::regclass;
--   SELECT 'policies' AS kind, count(*) FROM pg_policies WHERE schemaname='public' AND tablename='property_rooms';
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--     WHERE table_schema='public' AND table_name='property_rooms'
--     ORDER BY grantee, privilege_type;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name IN ('ota_reservations','checkins') AND column_name='room_id';
--   SELECT indexname FROM pg_indexes
--     WHERE schemaname='public' AND indexname IN
--       ('property_rooms_name_unique_active','property_rooms_property_sort_idx','ota_reservations_property_room_dates_idx');
