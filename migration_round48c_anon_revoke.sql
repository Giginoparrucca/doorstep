-- migration_round48c_anon_revoke.sql
--
-- Round 48 Phase 3 — revoke anon access now that the guest gateway
-- (Phase 2, PR #109) is live and verified in production.
--
-- Closes holes #1, #3 and #7 from the Oct 5 pg_policies audit:
--   #1  checkins.anon_select_checkins / anon_insert_checkins (wide-open)
--   #3  properties."Guests read any property by ID" (wide-open)
--   #7  marketing_consents.marketing_consents_anon_withdraw (wide-open UPDATE)
-- Plus the matching table-level grants and `get_reservation_keybox` RPC.
--
-- Grants and RLS are separate controls. We revoke BOTH the policy and the
-- grant on each table — a policy with no grant blocks writes but reads can
-- still return 404s, and a grant with no policy would let writes through if
-- any future `all`-style policy slipped in.
--
-- DROP POLICY hangs. As in Phase 1, `DROP POLICY` on this project has been
-- stalling indefinitely behind the `pgrst_drop_watch` event trigger (observed
-- 60s+ in both execute_sql and apply_migration paths; no lock contention).
-- `ALTER POLICY … USING (false) WITH CHECK (false)` neuters the policy
-- immediately — it matches no rows regardless of whether a later DROP
-- succeeds. The DROP statements follow; if any hang the ALTER already made
-- the policy harmless. The grants revoke cleanly.

-- ─────────────────────────────────────────────────────────────────────────
-- #1 checkins
-- ─────────────────────────────────────────────────────────────────────────
-- Neuter the two wide-open anon policies. Reads now return 0 rows; inserts
-- are rejected. The gateway's service-role writes bypass RLS so they still
-- succeed.
alter policy "anon_select_checkins" on public.checkins using (false);
alter policy "anon_insert_checkins" on public.checkins with check (false);
-- Attempt the drop. If this hangs, the alter above already blocks everything.
drop policy if exists "anon_select_checkins" on public.checkins;
drop policy if exists "anon_insert_checkins" on public.checkins;
-- Revoke every anon grant on the table. The gateway uses the service role,
-- which is a BYPASSRLS superuser and ignores both the GRANT and the RLS.
revoke select, insert, update, delete, truncate, references, trigger
  on public.checkins from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- #3 properties
-- ─────────────────────────────────────────────────────────────────────────
alter policy "Guests read any property by ID" on public.properties using (false);
drop policy if exists "Guests read any property by ID" on public.properties;
revoke all on public.properties from anon;
-- The FK marketing_consents.property_id → properties.id is validated by a
-- Postgres RI trigger that runs with the inserting role (anon). The trigger
-- reads from `properties`, so without ANY privilege anon INSERT on
-- marketing_consents fails with "permission denied for table properties".
-- Column-level REFERENCES (id) plus SELECT (id) is the minimum that unblocks
-- the FK check without reopening #3: a bare `select *` on properties still
-- returns 401 permission denied, and `select id` is filtered by the policy
-- above (qual=false) → empty array. Verified live post-migration.
grant references (id), select (id) on public.properties to anon;

-- ─────────────────────────────────────────────────────────────────────────
-- ota_reservations
-- ─────────────────────────────────────────────────────────────────────────
-- No wide-open policy here (none ever existed for anon); the open door was
-- the table-level grant. Revoke it. The gateway reads this table via the
-- service role (checkin_list returns the reopen_at flag, checkin_insert
-- clears it).
revoke all on public.ota_reservations from anon;

-- ─────────────────────────────────────────────────────────────────────────
-- #7 marketing_consents
-- ─────────────────────────────────────────────────────────────────────────
-- The UPDATE policy covered the one withdraw flow (set withdrawn_at). The
-- gateway's consent_withdraw action replaces it. Keep anon INSERT alone —
-- marketing_consents.insert is still a direct anon call in index.html by
-- design (the consent card's opt-in flow, Round 26).
alter policy "marketing_consents_anon_withdraw" on public.marketing_consents
  using (false) with check (false);
drop policy if exists "marketing_consents_anon_withdraw" on public.marketing_consents;
-- The anon UPDATE grant was column-scoped to withdrawn_at (see
-- migration_round27_marketing_consent.sql). Revoke that specific column.
revoke update (withdrawn_at) on public.marketing_consents from anon;

-- The anon INSERT policy's WITH CHECK was `EXISTS(SELECT 1 FROM properties
-- WHERE id = property_id)` — defence-in-depth that no longer passes once
-- anon loses RLS access to properties. The FK above enforces exactly the
-- same guarantee ("property_id must refer to a real row"), so swap the
-- EXISTS for a plain NOT NULL check that doesn't query properties.
alter policy "marketing_consents_anon_insert" on public.marketing_consents
  with check (property_id is not null);

-- ─────────────────────────────────────────────────────────────────────────
-- get_reservation_keybox RPC
-- ─────────────────────────────────────────────────────────────────────────
-- Rotating keybox stamping now runs server-side as a side effect of
-- checkin_insert (using the service role). Anon and public have no reason
-- to call it directly anymore.
revoke execute on function public.get_reservation_keybox(uuid, text) from anon, public;

-- ─────────────────────────────────────────────────────────────────────────
-- Verification queries (safe to run in Supabase SQL editor afterwards)
-- ─────────────────────────────────────────────────────────────────────────
-- select policyname, cmd, roles::text, qual, with_check
--   from pg_policies
--   where (tablename='checkins'           and policyname like 'anon_%')
--      or (tablename='properties'         and policyname='Guests read any property by ID')
--      or (tablename='marketing_consents' and policyname='marketing_consents_anon_withdraw');
-- → all four rows gone (or still present but USING/WITH CHECK = false).
--
-- select table_name, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where grantee='anon' and table_schema='public'
--     and table_name in ('checkins','properties','ota_reservations')
--   group by table_name;
-- → empty.
--
-- select has_function_privilege('anon', 'public.get_reservation_keybox(uuid, text)', 'execute');
-- → false.
