-- Round 74 Phase 5 — WBNB-Y002: atomic rate limits on server-controlled keys.
--
-- rate_counters      one row per (scope, key, window); service_role only.
-- rate_take(scope, key, window_seconds, limit)
--   Reserves one slot in a single statement (INSERT … ON CONFLICT DO UPDATE …
--   RETURNING), so parallel requests can never all pass a "count then insert"
--   check. Returns {allowed, hits, limit, retry_after}. Keys are built by the
--   server (hashed client address, property, booking) — never a value the
--   client chooses. Old windows are pruned opportunistically.
-- ai_month_tokens(property)
--   Sum of input + output tokens this calendar month (UTC), computed in the
--   database instead of fetching every usage row (the audit's unpaginated
--   aggregate). service_role only.
-- Re-runnable. Rollback: drop function public.rate_take(text, text, integer, integer),
--   public.ai_month_tokens(uuid); drop table public.rate_counters;
create table if not exists public.rate_counters (
  scope text not null check (length(scope) between 1 and 40),
  key text not null check (length(key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (scope, key, window_start)
);
alter table public.rate_counters enable row level security;
revoke all on public.rate_counters from public, anon, authenticated;
grant select, insert, update, delete on public.rate_counters to service_role;

create or replace function public.rate_take(p_scope text, p_key text, p_window_seconds integer, p_limit integer)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_start timestamptz;
  v_hits integer;
begin
  if p_scope is null or p_key is null or p_window_seconds is null or p_window_seconds < 1 or p_limit is null or p_limit < 1 then
    raise exception 'rate_take: invalid arguments' using errcode = '22023';
  end if;
  v_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_counters as rc (scope, key, window_start, hits)
  values (p_scope, p_key, v_start, 1)
  on conflict (scope, key, window_start) do update set hits = rc.hits + 1
  returning hits into v_hits;
  -- Prune a little on every call (cheap, bounded).
  delete from public.rate_counters
   where ctid in (select ctid from public.rate_counters where window_start < now() - interval '2 days' limit 50);
  return jsonb_build_object('allowed', v_hits <= p_limit, 'hits', v_hits, 'limit', p_limit,
    'retry_after', greatest(1, ceil(extract(epoch from (v_start + make_interval(secs => p_window_seconds) - now())))::int));
end $$;

create or replace function public.ai_month_tokens(p_property uuid)
returns bigint language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0)::bigint
    from public.api_usage
   where property_id = p_property and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'
$$;

revoke all on function public.rate_take(text, text, integer, integer), public.ai_month_tokens(uuid) from public, anon, authenticated;
grant execute on function public.rate_take(text, text, integer, integer), public.ai_month_tokens(uuid) to service_role;
