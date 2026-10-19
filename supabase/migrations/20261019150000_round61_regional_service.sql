-- Round 61 Phase 1 — remember which SPOT service a Puglia property uses.
--
-- Context: Puglia hosts of locazioni turistiche file via SPOT Easy (PS TXT);
-- strutture ricettive alberghiere/extralberghiere file via SPOT Online
-- (movimentogiornaliero XML, Round 61 Phase 2). The host chose the legal
-- category at business registration; nothing in the property's physical
-- building deterministically tells us which service they need.
--
-- B+D detection cascade (lib/cin.js + Puglia regional tile):
--   1. Parse national CIN TIPOLOGIA letter (needs authoritative mapping;
--      silently skips until confirmed).
--   2. property_type heuristic (bnb/hotel/agriturismo/affittacamere/
--      guesthouse → spot_online; apartment/house/villa/trullo → ambiguous).
--   3. Ask the host once on genuine ambiguity.
-- Property Details dropdown is the always-editable override.
--
-- Extensible by design: the CHECK list stays short (two values today) but
-- later rounds can add Trentino STU/DTU, Lazio RADAR, etc. by extending the
-- allowed set — adding to a CHECK is a lightweight ALTER, not a schema
-- rework.
--
-- RLS: no new policy. The existing owner policies on `properties` already
-- scope UPDATE to the owner (service_role bypasses). GRANT UPDATE on the
-- column follows from the table-level GRANT UPDATE on properties to
-- `authenticated`; a Phase 1 behavioural probe (owner → 1 row updated,
-- other host → 0 rows + no error, anon → 42501) confirms the "RLS + GRANT
-- failure mode = 0-row update, no error" invariant.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS regional_service text;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_regional_service_check;

ALTER TABLE public.properties
  ADD CONSTRAINT properties_regional_service_check
  CHECK (regional_service IS NULL OR regional_service IN ('spot_easy','spot_online'));

COMMENT ON COLUMN public.properties.regional_service IS
  'Round 61: which regional-portal service this property uses. Today spot_easy or spot_online for Puglia; extensible to other regions in later rounds. Null means not-yet-chosen (B+D detection cascade decides on first use of the regional tile).';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Verification (run after apply):
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='properties' AND column_name='regional_service';
--     expect regional_service / text / YES
--
--   SELECT conname FROM pg_constraint WHERE conname='properties_regional_service_check';
--     expect one row
--
--   -- Behavioural probe (owner can write own, other host sees 0 rows, anon denied):
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SELECT set_config('request.jwt.claims', jsonb_build_object('sub', '<owner-uuid>', 'role','authenticated')::text, true);
--     UPDATE properties SET regional_service='spot_online' WHERE id='<their-property>';
--     -- own: expect 1 row updated
--     UPDATE properties SET regional_service='spot_online' WHERE id='<other-host-property>';
--     -- cross-owner: expect 0 rows updated, no error (RLS silently filters)
--   ROLLBACK;
--
--   BEGIN;
--     SET LOCAL ROLE anon;
--     UPDATE properties SET regional_service='spot_online' WHERE id='<any>';
--     -- expect 42501 permission_denied
--   ROLLBACK;
--
-- Rollback (if the column must be removed):
--   BEGIN;
--     ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_regional_service_check;
--     ALTER TABLE public.properties DROP COLUMN IF EXISTS regional_service;
--     NOTIFY pgrst, 'reload schema';
--   COMMIT;
