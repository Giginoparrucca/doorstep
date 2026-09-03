-- Round 34: close the cross-property guest chat read leak.
--
-- Round 12.1 tightened the anon SELECT policy on chat_messages to
--   (property_id IS NOT NULL AND is_test = false AND deleted_at IS NULL)
-- but the whole scoping still lived client-side: the guest app added a
-- .eq('property_id', propertyId) filter that anyone with the anon key
-- (shipped in the client HTML) could simply drop, and read every host's
-- guest messages — names, arrival dates, lockbox codes.
--
-- This migration revokes anon's grant on chat_messages entirely. All
-- guest chat reads/writes now go through api/guest-chat.js, which uses
-- SUPABASE_SERVICE_ROLE_KEY and derives property_id + booking_code from
-- the signed guest-session token payload (Round 33) — never from the
-- request body.
--
-- Host-side policies (chat_messages_host_update, chat_messages_host_delete,
-- "Hosts read own property chat", chat_messages_admin_all,
-- chat_messages_admin_update, "Auth insert chat") stay untouched.
-- Host console reads chat through Supabase Auth + those authenticated
-- policies and is not affected by this migration.
--
-- Diagnostic snapshot taken 2026-09-01 (pg_policies query, service role):
--   Anon policies present:
--     - "Anyone insert chat"          INSERT anon    (with_check TRUE — anyone in the world)
--     - "Guests read live chat by property"  SELECT anon
--       qual = (property_id IS NOT NULL AND is_test = FALSE AND deleted_at IS NULL)
--   Anon grants present:
--     DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--   Service_role grants present:
--     REFERENCES, TRIGGER, TRUNCATE  (missing CRUD — the Round 28 gotcha again)
--
-- Apply via Supabase SQL editor OR via MCP. This is the HIGH-RISK round;
-- keep the ROLLBACK block at the bottom of this file open in a second
-- Supabase tab while you deploy the guest-app changes.

BEGIN;

-- Drop the two anon policies (must use the exact names above).
DROP POLICY IF EXISTS "Anyone insert chat"              ON public.chat_messages;
DROP POLICY IF EXISTS "Guests read live chat by property" ON public.chat_messages;

-- Revoke every anon CRUD grant. anon keeps REFERENCES/TRIGGER/TRUNCATE
-- (those are meaningless for an anon caller and REVOKE-ing them isn't
-- necessary; the DML grants are what matter).
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.chat_messages FROM anon;

-- Ensure service_role can CRUD. Same Round 28 lesson as chat_messages'
-- own history — SQL-editor-created tables don't inherit defaults here.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO service_role;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (uncomment the block below and run to fully restore Round
-- 12.1's shape). Round 34's api/guest-chat.js will start 500-ing on
-- writes if service_role loses its grant, so if you're rolling back
-- keep the GRANT to service_role and only re-open anon.
-- ─────────────────────────────────────────────────────────────────────
-- BEGIN;
--   -- Re-grant anon CRUD (the pre-Round-34 state).
--   GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO anon;
--   -- Re-create the Round 12.1 SELECT policy verbatim.
--   CREATE POLICY "Guests read live chat by property"
--     ON public.chat_messages FOR SELECT TO anon
--     USING (property_id IS NOT NULL AND is_test = FALSE AND deleted_at IS NULL);
--   -- Re-create the unrestricted anon INSERT policy (this is the exact
--   -- pre-Round-34 policy; if you're rolling back you probably want to
--   -- also plan a real fix soon — this policy lets anyone insert any
--   -- row into any property's chat).
--   CREATE POLICY "Anyone insert chat"
--     ON public.chat_messages FOR INSERT TO anon
--     WITH CHECK (TRUE);
-- COMMIT;
