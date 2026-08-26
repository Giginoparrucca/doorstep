-- Round 32.1 hotfix: the send-arrival-reminders cron uses the
-- SUPABASE_SERVICE_ROLE_KEY to read across all owners' properties and
-- to write arrival_reminder_sent_at. On this project, service_role was
-- missing the CRUD grants on public.properties and public.checkins
-- (same pattern as chat_messages before Round 28) — Postgres error 42501
-- "permission denied for table properties" fired even with the correct
-- service_role JWT, because BYPASSRLS is separate from column grants.
--
-- ota_reservations already got its service_role grants in Round 26's
-- migration.
--
-- Safe to re-run: GRANT is idempotent.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkins   TO service_role;
GRANT USAGE ON SCHEMA public TO service_role;
