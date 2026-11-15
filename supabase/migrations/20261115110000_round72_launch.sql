-- Round 72 Phase 6 — the launch ("Lancia") in one transaction.
--
-- billing_launch_candidates(p_launch_at)
--   Existing hosts who get a subscription row at launch: owners of at least
--   one property, plus accounts with an accepted invite; admin accounts are
--   excluded (they are always free). For each: suggested last free day
--   (launch + 30 days, Rome), earliest allowed (launch + 7), whether a row
--   already exists, and whether every property is a test property (suggested
--   free for life). Reads only.
-- billing_launch(p_launch_at, p_hosts, p_actor, p_dry)
--   p_hosts = [{"user_id": uuid, "last_free_day": "YYYY-MM-DD"} |
--              {"user_id": uuid, "free_forever_reason": "…"}].
--   Validates every entry first (a last free day earlier than launch + 7
--   days refuses the whole launch); then, unless p_dry: sets launch_at (only
--   when still NULL), inserts each host's row with exactly the chosen date
--   (or free for life), logs trial_started / free_forever_on. Existing rows
--   are never touched: pressing Lancia twice creates nothing and moves no
--   date. Returns what was (or would be) done.
-- Both functions: SECURITY DEFINER, service_role only (the admin endpoint
-- checks the caller is admin first).
-- Re-runnable. Rollback: drop function public.billing_launch(timestamptz, jsonb, text, boolean),
--   public.billing_launch_candidates(timestamptz);
create or replace function public.billing_launch_candidates(p_launch_at timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
  with launch_day as (select (p_launch_at at time zone 'Europe/Rome')::date d),
  hosts as (
    select distinct p.owner_id as user_id from public.properties p where p.owner_id is not null and p.deleted_at is null
    union
    select u.id from public.pilot_invites i join auth.users u on lower(u.email) = lower(i.email) where i.status = 'accepted'
  ),
  eligible as (
    select h.user_id, u.email, u.created_at,
      (select i.accepted_at from public.pilot_invites i where lower(i.email) = lower(u.email) and i.status = 'accepted' limit 1) as accepted_at,
      coalesce((select bool_and(p.is_test) from public.properties p where p.owner_id = h.user_id and p.deleted_at is null), false) as all_test,
      (select count(*) from public.properties p where p.owner_id = h.user_id and p.deleted_at is null) as properties,
      exists (select 1 from public.host_subscriptions s where s.user_id = h.user_id) as has_row
    from hosts h join auth.users u on u.id = h.user_id
    where not exists (select 1 from public.admin_users a where lower(a.email) = lower(u.email))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', e.user_id, 'email', e.email, 'properties', e.properties, 'all_test', e.all_test, 'has_row', e.has_row,
      'trial_started_at', coalesce(e.accepted_at, e.created_at),
      'suggested_last_free_day', (select d from launch_day) + 29,
      'earliest_last_free_day', (select d from launch_day) + 6)
    order by e.email), '[]'::jsonb)
  from eligible e
$$;

create or replace function public.billing_launch(p_launch_at timestamptz, p_hosts jsonb, p_actor text, p_dry boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  s public.billing_settings;
  v_launch timestamptz;
  v_day date;
  h jsonb;
  c jsonb;
  v_user uuid; v_last date; v_reason text;
  v_cands jsonb;
  v_created int := 0; v_skipped int := 0; v_free int := 0;
  v_plan jsonb := '[]'::jsonb;
begin
  if p_actor is null or length(p_actor) < 3 then raise exception 'actor required' using errcode = '22023'; end if;
  if jsonb_typeof(p_hosts) is distinct from 'array' then raise exception 'hosts must be an array' using errcode = '22023'; end if;
  select * into s from public.billing_settings where id = 1 for update;
  v_launch := coalesce(s.launch_at, p_launch_at);
  if v_launch is null then raise exception 'launch time required' using errcode = '22023'; end if;
  v_day := (v_launch at time zone 'Europe/Rome')::date;
  v_cands := public.billing_launch_candidates(v_launch);
  -- Validate everything before writing anything.
  for h in select * from jsonb_array_elements(p_hosts) loop
    v_user := (h ->> 'user_id')::uuid;
    if not exists (select 1 from jsonb_array_elements(v_cands) x where (x ->> 'user_id')::uuid = v_user) then
      raise exception 'not an eligible host: %', v_user using errcode = '22023';
    end if;
    v_reason := nullif(trim(coalesce(h ->> 'free_forever_reason', '')), '');
    if v_reason is null then
      v_last := (h ->> 'last_free_day')::date;
      if v_last is null then raise exception 'last free day required for %', v_user using errcode = '22023'; end if;
      if v_last < v_day + 6 then raise exception 'last free day % for % is earlier than launch + 7 days (%)', v_last, v_user, v_day + 6 using errcode = '22023'; end if;
    end if;
  end loop;
  for h in select * from jsonb_array_elements(p_hosts) loop
    v_user := (h ->> 'user_id')::uuid;
    v_reason := nullif(trim(coalesce(h ->> 'free_forever_reason', '')), '');
    v_last := (h ->> 'last_free_day')::date;
    select x into c from jsonb_array_elements(v_cands) x where (x ->> 'user_id')::uuid = v_user limit 1;
    if exists (select 1 from public.host_subscriptions where user_id = v_user) then
      v_skipped := v_skipped + 1;
      v_plan := v_plan || jsonb_build_object('user_id', v_user, 'outcome', 'already_has_row');
      continue;
    end if;
    if p_dry then
      v_plan := v_plan || jsonb_build_object('user_id', v_user, 'outcome', case when v_reason is null then 'would_create' else 'would_set_free' end,
        'last_free_day', v_last, 'free_forever_reason', v_reason);
      continue;
    end if;
    if v_reason is null then
      insert into public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
      values (v_user, (c ->> 'trial_started_at')::timestamptz, public.billing_day_start(v_last + 1), 'trialing');
      insert into public.billing_events (user_id, actor, action, new_value, reason)
      values (v_user, p_actor, 'trial_started', jsonb_build_object('trial_ends_at', public.billing_day_start(v_last + 1), 'last_free_day', v_last, 'launch_at', v_launch), 'launch');
      v_created := v_created + 1;
    else
      insert into public.host_subscriptions (user_id, trial_started_at, status, free_forever_reason)
      values (v_user, (c ->> 'trial_started_at')::timestamptz, 'free_forever', left(v_reason, 500));
      insert into public.billing_events (user_id, actor, action, new_value, reason)
      values (v_user, p_actor, 'free_forever_on', jsonb_build_object('launch_at', v_launch), v_reason);
      v_free := v_free + 1;
    end if;
    v_plan := v_plan || jsonb_build_object('user_id', v_user, 'outcome', case when v_reason is null then 'created' else 'free_forever' end, 'last_free_day', v_last);
  end loop;
  if not p_dry and s.launch_at is null then
    update public.billing_settings set launch_at = v_launch, updated_at = now() where id = 1;
  end if;
  return jsonb_build_object('dry_run', p_dry, 'launch_at', v_launch, 'already_launched', s.launch_at is not null,
    'created', v_created, 'free_forever', v_free, 'skipped_existing', v_skipped, 'hosts', v_plan);
end $$;

revoke all on function public.billing_launch_candidates(timestamptz), public.billing_launch(timestamptz, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_launch_candidates(timestamptz), public.billing_launch(timestamptz, jsonb, text, boolean) to service_role;
