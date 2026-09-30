-- Round 44 Phase 0.5 · Per-property Alloggiati Web credentials
--
-- Encrypted at rest with server-side AES-256-GCM. The client NEVER sees
-- plaintext; it also never SELECTs the ciphertext columns. All CRUD goes
-- through /api/alloggiati.js (action-routed) with the service_role key,
-- and the API is the only surface that has ALLOGGIATI_ENC_KEY.
--
-- Why per-property (not per-owner):
--   Alloggiati issues Utente + WsKey per STRUTTURA (host structure). A
--   host with three separate structures uses three different accounts.
--   Same account can cover multiple apartments via the GestioneAppartamenti
--   SOAP calls, so we allow the same credential row to be copied to
--   another property in the UI ("Copy from another property" — same
--   pattern Round 37 (redux) uses for tourist tax).
--
-- Key handling gotchas:
--   • WsKey rotates DAILY on the portal side. wskey_expires_at tracks
--     when the current value stops working; a background job re-runs
--     GenerateToken close to expiry (not part of this migration).
--   • credentials_enc holds a JSON blob {utente, password, wskey}
--     encrypted as a single ciphertext with credentials_nonce (12 bytes
--     base64). Storing three fields separately would need three nonces
--     and lets an observer of the DB see WHICH field failed to decrypt.
--   • enc_key_id records which env-var key encrypted this row
--     ('v1' initially). Rotating keys later (introducing 'v2') stays a
--     schema-free code change.
--
-- RLS: deny by default. authenticated + anon get NO read/write.
-- service_role has full access. The API endpoint is the single gate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.host_alloggiati_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id         uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  credentials_enc     text NOT NULL,
  credentials_nonce   text NOT NULL,
  enc_key_id          text NOT NULL DEFAULT 'v1',
  verified_at         timestamptz,
  wskey_expires_at    timestamptz,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT host_alloggiati_credentials_property_unique UNIQUE (property_id)
);

COMMENT ON TABLE  public.host_alloggiati_credentials IS
  'Round 44 · Alloggiati Web login credentials, encrypted at rest with AES-GCM. All CRUD via /api/alloggiati.js only.';
COMMENT ON COLUMN public.host_alloggiati_credentials.credentials_enc IS
  'Base64 AES-256-GCM ciphertext of {"utente":"...","password":"...","wskey":"..."}.';
COMMENT ON COLUMN public.host_alloggiati_credentials.credentials_nonce IS
  'Base64 12-byte nonce paired with credentials_enc. Unique per row/update.';
COMMENT ON COLUMN public.host_alloggiati_credentials.enc_key_id IS
  'Which server-side key encrypted this row. "v1" today; introducing "v2" enables rolling rotation.';
COMMENT ON COLUMN public.host_alloggiati_credentials.verified_at IS
  'Last time GenerateToken + Authentication_Test both returned success. NULL = never verified.';
COMMENT ON COLUMN public.host_alloggiati_credentials.wskey_expires_at IS
  'When the current WsKey stops working (portal enforces ~24h). A cron regenerates before this.';
COMMENT ON COLUMN public.host_alloggiati_credentials.last_error IS
  'Latest failure message from the portal (host-visible via the status endpoint). NULL when healthy.';

CREATE INDEX IF NOT EXISTS host_alloggiati_credentials_expires_idx
  ON public.host_alloggiati_credentials (wskey_expires_at)
  WHERE wskey_expires_at IS NOT NULL;

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_host_alloggiati_credentials_touch ON public.host_alloggiati_credentials;
CREATE TRIGGER trg_host_alloggiati_credentials_touch
  BEFORE UPDATE ON public.host_alloggiati_credentials
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.host_alloggiati_credentials ENABLE ROW LEVEL SECURITY;

-- Deny all client access. service_role bypasses RLS by design.
-- The /api/alloggiati.js endpoint uses SUPABASE_SERVICE_ROLE_KEY and is
-- the single trusted path to this table. authenticated and anon get
-- explicit deny policies (belt-and-braces alongside the enabled RLS).
DROP POLICY IF EXISTS host_alloggiati_deny_authenticated ON public.host_alloggiati_credentials;
CREATE POLICY host_alloggiati_deny_authenticated
  ON public.host_alloggiati_credentials
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS host_alloggiati_deny_anon ON public.host_alloggiati_credentials;
CREATE POLICY host_alloggiati_deny_anon
  ON public.host_alloggiati_credentials
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

-- No table grants to authenticated/anon. service_role gets everything.
REVOKE ALL ON public.host_alloggiati_credentials FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_alloggiati_credentials TO service_role;

COMMIT;

/*
-- ROLLBACK — run manually if the migration needs undoing.
BEGIN;
DROP TABLE IF EXISTS public.host_alloggiati_credentials;
DROP FUNCTION IF EXISTS public.tg_touch_updated_at();
COMMIT;
*/

-- Verification — expected shape:
--   • 1 table, 1 unique index, 1 trigger, 1 partial index
--   • RLS enabled + 2 restrictive deny policies
--   • authenticated / anon have zero table grants
--   • service_role has SELECT/INSERT/UPDATE/DELETE
SELECT
  (SELECT COUNT(*) FROM pg_tables
    WHERE schemaname='public' AND tablename='host_alloggiati_credentials') AS tables,
  (SELECT COUNT(*) FROM pg_indexes
    WHERE schemaname='public' AND tablename='host_alloggiati_credentials') AS indexes,
  (SELECT relrowsecurity FROM pg_class
    WHERE relname='host_alloggiati_credentials') AS rls_enabled,
  (SELECT COUNT(*) FROM pg_policies
    WHERE schemaname='public' AND tablename='host_alloggiati_credentials') AS policies,
  (SELECT string_agg(grantee || ':' || privilege_type, ', ' ORDER BY grantee, privilege_type)
     FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='host_alloggiati_credentials'
      AND grantee IN ('authenticated','anon','service_role')) AS grants;
