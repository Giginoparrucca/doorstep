-- Round 72 Phase 2 — read-only accounts cannot write host data.
--
-- One RESTRICTIVE policy per command on each host-owned table, for the
-- `authenticated` role: it is AND-ed with the existing permissive policies,
-- which stay unchanged. It passes unless host_can_write(auth.uid()) is false,
-- i.e. only for an account in 'read_only' (trial or paid year ended + grace).
-- Before launch, and for trial/grace/active/free accounts and admins, it
-- always passes. service_role (server, autofile, guest check-ins through
-- api/guest.js) bypasses RLS and is untouched.
--
-- Inventory (production policies read 15 Nov 2026):
--   properties              INSERT, UPDATE        (edit properties)
--   rules                   INSERT, UPDATE, DELETE (property content)
--   recommendations         INSERT, UPDATE, DELETE
--   property_rooms          INSERT, UPDATE, DELETE
--   host_share_preferences  INSERT, UPDATE, DELETE
--   ota_reservations        INSERT                 (no new reservations)
--   checkins                INSERT                 (no manual check-ins)
-- Deliberately NOT restricted: checkins UPDATE (marking filed, late PEC,
-- corrections: police filing never stops), ota_reservations UPDATE/DELETE
-- (cancel/assign existing stays), chat_messages (talking to current guests),
-- notification settings, push, onboarding, marketing consents, exports.
-- Re-runnable (creates only missing policies).
-- Rollback: drop policy <table>_round72_read_only_<cmd> on public.<table>; for each.
do $$
declare
  t record;
begin
  for t in select * from (values
    ('properties', 'insert'), ('properties', 'update'),
    ('rules', 'insert'), ('rules', 'update'), ('rules', 'delete'),
    ('recommendations', 'insert'), ('recommendations', 'update'), ('recommendations', 'delete'),
    ('property_rooms', 'insert'), ('property_rooms', 'update'), ('property_rooms', 'delete'),
    ('host_share_preferences', 'insert'), ('host_share_preferences', 'update'), ('host_share_preferences', 'delete'),
    ('ota_reservations', 'insert'),
    ('checkins', 'insert')) as v(tbl, cmd)
  loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl
               and policyname = t.tbl || '_round72_read_only_' || t.cmd) then continue; end if;
    execute format(
      'create policy %I on public.%I as restrictive for %s to authenticated %s',
      t.tbl || '_round72_read_only_' || t.cmd, t.tbl, t.cmd,
      case t.cmd
        when 'insert' then 'with check (public.host_can_write(auth.uid()))'
        when 'delete' then 'using (public.host_can_write(auth.uid()))'
        else 'using (public.host_can_write(auth.uid())) with check (public.host_can_write(auth.uid()))'
      end);
  end loop;
end $$;
