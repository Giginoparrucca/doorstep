-- Round 70 Phase 2 — optional PEC address of the host's Questura, shown in
-- the «Invio tardivo» panel with a copy button. Format check only: we do
-- not ship or verify a list of Questura PEC addresses (the host finds
-- theirs on the Polizia di Stato Questure page).
-- Owners already UPDATE their own properties through the existing
-- table-level grant and RLS policy; a new column is covered by that
-- table-level grant (verified in production after applying). No anon.
-- Re-runnable.
-- Rollback: ALTER TABLE public.properties DROP COLUMN questura_pec;
BEGIN;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS questura_pec text;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_questura_pec_format;
ALTER TABLE public.properties ADD CONSTRAINT properties_questura_pec_format CHECK (questura_pec IS NULL OR
  (char_length(questura_pec) <= 254 AND questura_pec ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
COMMENT ON COLUMN public.properties.questura_pec IS
  'Round 70: optional PEC address of the competent Questura, entered by the host for late Alloggiati filings.';
COMMIT;
