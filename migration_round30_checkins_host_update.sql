-- Round 30: allow property owners to UPDATE their own check-in rows.
--
-- Gap discovered while wiring the host console "Edit check-in" flow:
-- checkins had host SELECT and host DELETE owner-scoped, plus admin ALL
-- and admin UPDATE, but no host UPDATE. Any UPDATE from the host client
-- returned data:[] with error:null — the Round 28 silent-0-rows trap.
-- This policy is the exact mirror of checkins_host_delete.
--
-- Applied to the remote Supabase project via MCP as migration
-- `checkins_host_update_policy` on 2026-08-25. Verified end-to-end:
-- owner UPDATE returned rows, non-owner returned zero.

DROP POLICY IF EXISTS checkins_host_update ON public.checkins;
CREATE POLICY checkins_host_update
  ON public.checkins FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = checkins.property_id AND p.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = checkins.property_id AND p.owner_id = auth.uid()
  ));

-- Grant already exists (authenticated has table-level UPDATE); RLS was
-- the missing piece. Re-grant defensively so a re-run is safe.
GRANT UPDATE ON public.checkins TO authenticated;
