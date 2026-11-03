-- Round 70 Phase 3 — record a late Alloggiati filing made through the
-- Questura (usually by PEC), never as if it came from the portal.
--
-- checkins.filing_method   how a filed row was filed. NULL = earlier rows
--                          (portal send or host "Segna inviato"; not
--                          recorded before Round 70). 'late_questura_pec'
--                          = host declared a late filing to the Questura.
--                          The other values are reserved for recording the
--                          portal and plain host declarations later.
-- checkins.late_pec_sent_on the date the host says the PEC was sent; only
--                          with filing_method = 'late_questura_pec'.
-- filed_at keeps meaning "when it was recorded in WelcomeBnB".
--
-- Grants: hosts (authenticated) already UPDATE their own check-ins through
-- the table-level grant + owner RLS policy, and a new column is covered by
-- that table grant (verified in production after applying); service_role
-- keeps full access (Round 48e). No anon access. The filed lock trigger
-- (checkins_prevent_filed_edit) still protects identity, document and stay
-- fields of filed rows. alloggiati_filing_log is untouched: it stays
-- service-role-only and is never edited.
-- Re-runnable.
-- Rollback: ALTER TABLE public.checkins DROP COLUMN late_pec_sent_on, DROP COLUMN filing_method;
BEGIN;
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS filing_method text,
  ADD COLUMN IF NOT EXISTS late_pec_sent_on date;
ALTER TABLE public.checkins
  DROP CONSTRAINT IF EXISTS checkins_filing_method_check,
  DROP CONSTRAINT IF EXISTS checkins_late_pec_sent_on_check,
  ADD CONSTRAINT checkins_filing_method_check CHECK (filing_method IS NULL OR
    filing_method IN ('portal_autofile', 'portal_host', 'host_declared', 'late_questura_pec')),
  ADD CONSTRAINT checkins_late_pec_sent_on_check CHECK (late_pec_sent_on IS NULL OR
    (filing_method = 'late_questura_pec' AND alloggiati_status = 'filed'));
COMMENT ON COLUMN public.checkins.filing_method IS
  'Round 70: how a filed row was filed (late_questura_pec = late filing declared by the host via the Questura). NULL for earlier rows.';
COMMENT ON COLUMN public.checkins.late_pec_sent_on IS
  'Round 70: date the host declares the PEC to the Questura was sent (late filing only).';
COMMIT;
