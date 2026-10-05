-- migration_round48e_service_role_crud.sql
--
-- Round 48 Phase 5 — hotfix after a post-ship audit uncovered a latent
-- Round 27 bug.
--
-- The guest gateway's `consent_withdraw` action started returning 500
-- "permission denied for table marketing_consents" as soon as Phase 3
-- revoked the direct anon UPDATE: the gateway calls Supabase REST with
-- the service role key, but service_role had never been granted basic
-- CRUD on `marketing_consents` in the first place. The anon-UPDATE
-- fallback hid it until this round.
--
-- A follow-up audit showed the same latent gap on ten more public
-- tables. Supabase's invariant is that `service_role` has ALL on every
-- public table — anything less is a bug waiting to be surfaced by the
-- next migration that moves a write behind a gateway. This migration
-- restores that invariant.
--
-- Blast radius: service_role is a BYPASSRLS role. Granting it ALL does
-- not open any security hole; every RLS policy still applies to anon
-- and authenticated as before. The grant is a repair, not an
-- escalation.

grant select, insert, update, delete on public.marketing_consents    to service_role;
grant select, insert, update, delete on public.admin_impersonation_log to service_role;
grant select, insert, update, delete on public.admin_users           to service_role;
grant select, insert, update, delete on public.analytics_events      to service_role;
grant select, insert, update, delete on public.analytics_monthly     to service_role;
grant select, insert, update, delete on public.chat_qa_pairs         to service_role;
grant select, insert, update, delete on public.data_purge_log        to service_role;
grant select, insert, update, delete on public.excluded_booking_codes to service_role;
grant select, insert, update, delete on public.host_dismissed_bookings to service_role;
grant select, insert, update, delete on public.purge_settings        to service_role;
grant select, insert, update, delete on public.recommendations       to service_role;
grant select, insert, update, delete on public.rules                 to service_role;

-- Verification:
-- select table_name, string_agg(privilege_type, ',' order by privilege_type) as privs
--   from information_schema.role_table_grants
--   where grantee='service_role' and table_schema='public'
--   group by table_name
--   having privs not like '%SELECT%' or privs not like '%INSERT%'
--      or privs not like '%UPDATE%' or privs not like '%DELETE%';
-- → empty (every public table has full service_role CRUD).
