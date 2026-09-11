-- Round 37.5 — Host-owned portal links per Export/Compliance tile.
--
-- Each tile in the Export panel and each section in the Compliance
-- Guide comes with a default link WelcomeBnB suggests (Alloggiati,
-- ROSS1000 Veneto, Puglia DMS, PayTourist, Comune di Venezia CityTax,
-- …). Real hosts land on different regional/comune portals — Puglia
-- SPOT Easy, Veneto ROSS1000, Emilia-Romagna Stat.-er, PayTourist
-- Bari, direct comune tax portals. This round lets each host add
-- their own direct link per tile on top of (not replacing) the
-- default.
--
-- One JSONB column on properties. Keyed by a stable tile id
-- (e.g. "export.paytourist", "compliance.tax"). Value shape:
--   { "url": "https://…", "label": "Comune di Bari" }
-- The label is optional; when empty a localised default is used.
-- The URL is validated client-side (http/https, host looks like a
-- domain) before being written.
--
-- No RLS changes needed — rides on the existing owner-scoped policies
-- for `properties`.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS portal_links jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.properties DROP COLUMN IF EXISTS portal_links;
-- COMMIT;
