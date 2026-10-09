-- migration_round49_phase5_alerts.sql
--
-- Round 49 Phase 5 — alerts + dedup state.
--
-- The autofile tick (Phase 3) runs every 10 min. Four alerts need to
-- fire once per property per day (or once per row per failure cluster)
-- without re-firing on every subsequent tick. The dedup state lives
-- as compact columns right next to the data they describe:
--
--   properties.alloggiati_autofile_alerts jsonb — one key per alert
--     kind ('digest' | 'heads_up' | 'overdue'), value is the Rome
--     date-only ISO string ('2026-10-09') of the last send. The tick
--     writes { kind: today_rome } when it fires, and checks the stored
--     value before firing again. One jsonb column keeps the schema
--     flat; the whole value is clobbered on each write, which is safe
--     because the tick runs serially per property.
--
--   checkins.autofile_last_alert_at timestamptz — per-row dedup for
--     the "3 consecutive failures" alert. The tick won't re-alert a
--     row whose last_alert_at is less than 24h old.
--
-- Also: a tiny SECURITY DEFINER function to bump autofile_attempts
-- atomically. PostgREST doesn't support `col = col + 1` expressions in
-- UPDATE bodies, so Phase 3's _bumpAttempts stub left attempts at 0.
-- Fixing that here unblocks the 3-failures alert.

alter table public.properties
  add column if not exists alloggiati_autofile_alerts jsonb not null default '{}'::jsonb;

alter table public.checkins
  add column if not exists autofile_last_alert_at timestamptz;

comment on column public.properties.alloggiati_autofile_alerts is
  'Round 49 Phase 5: dedup state for the daily autofile alerts. Keys: digest, heads_up, overdue. Values: Rome date-only ISO (yyyy-mm-dd) of the last send.';
comment on column public.checkins.autofile_last_alert_at is
  'Round 49 Phase 5: dedup state for the 3-consecutive-failures alert on this row. Re-alerts only after a 24h cooldown.';

-- Atomic bump. One row's attempts is at most 10 or so (we alert at 3),
-- so returning the new value lets the caller decide "should I alert?"
-- in one roundtrip.
create or replace function public.bump_autofile_attempts(p_ids uuid[])
returns table (id uuid, attempts int)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ids is null or cardinality(p_ids) = 0 then return; end if;
  return query
    update public.checkins
       set autofile_attempts = coalesce(autofile_attempts, 0) + 1
     where public.checkins.id = any (p_ids)
    returning public.checkins.id, public.checkins.autofile_attempts;
end
$$;
revoke execute on function public.bump_autofile_attempts(uuid[]) from public, anon, authenticated;
grant   execute on function public.bump_autofile_attempts(uuid[]) to service_role;

comment on function public.bump_autofile_attempts is
  'Round 49 Phase 5: SECURITY DEFINER atomic increment of autofile_attempts for the given ids. Returns {id, attempts} so the tick can see which rows crossed the 3-failure threshold. service_role only.';

-- Verification queries (safe to re-run):
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='properties' and column_name='alloggiati_autofile_alerts';
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='checkins' and column_name='autofile_last_alert_at';
-- select proname, prosecdef from pg_proc
--   where proname='bump_autofile_attempts' and pronamespace='public'::regnamespace;
-- select public.bump_autofile_attempts(array[]::uuid[]);  -- empty return set
