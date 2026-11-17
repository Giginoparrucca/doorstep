-- 17 Nov 2026 — the free trial starts at registration (Daniele): «assume
-- they all started at registration; I will then manually update each user
-- with their actual expiry».
--
-- Registration = the day the host created their password: e-mail confirmed,
-- else the accepted invitation, else the account creation. Trial length =
-- billing_settings.trial_days (30); same Rome-day rule as Round 72 (the trial
-- ends at the Rome midnight that starts day «registration day + trial_days»).
--
-- 1. Backfill: every registered host (not admin) without a subscription row
--    gets one now: trial_started_at = registration, trial_ends_at as above,
--    status 'trialing', event trial_started «registration (assumed)». Hosts
--    who never created a password get theirs when they register (2, 3).
-- 2. host_access_state (console, every sign-in): when the host has no row,
--    create it from the registration date, before or after the launch.
-- 3. accept_my_invite: the trial starts when the invitation is accepted,
--    before or after the launch.
-- 4. billing_launch_candidates also returns each existing row's trial end, so
--    «Lancia» can warn about trials that already ended (those hosts would be
--    read-only right after the launch unless their date is changed first).
--
-- Nothing changes for hosts before the launch: billing_access_state still
-- answers «prelaunch» while billing_settings.launch_at is empty, so no
-- banner, reminder or block can fire. Re-runnable (the backfill only touches
-- hosts without a row). Rollback: re-apply the Round 72 definitions of the
-- three functions; rows created here can stay (they are what «Gestisci» edits).

create or replace function public.billing_registration_at(p_user uuid)
returns timestamptz language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(u.email_confirmed_at,
    (select i.accepted_at from public.pilot_invites i where lower(i.email) = lower(u.email) and i.status = 'accepted' limit 1),
    u.created_at)
  from auth.users u where u.id = p_user
$$;
revoke all on function public.billing_registration_at(uuid) from public, anon, authenticated;
grant execute on function public.billing_registration_at(uuid) to service_role;

-- 1. Backfill.
with s as (select trial_days from public.billing_settings where id = 1),
hosts as (
  select u.id, public.billing_registration_at(u.id) as reg
  from auth.users u
  where u.email_confirmed_at is not null
    and not exists (select 1 from public.admin_users a where lower(a.email) = lower(u.email))
    and not exists (select 1 from public.host_subscriptions h where h.user_id = u.id)
),
ins as (
  insert into public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
  select h.id, h.reg, public.billing_day_start((h.reg at time zone 'Europe/Rome')::date + s.trial_days), 'trialing'
  from hosts h cross join s
  on conflict (user_id) do nothing
  returning user_id, trial_started_at, trial_ends_at
)
insert into public.billing_events (user_id, actor, action, new_value, reason)
select user_id, 'system', 'trial_started', jsonb_build_object('trial_started_at', trial_started_at, 'trial_ends_at', trial_ends_at), 'registration (assumed, 17 Nov 2026)'
from ins;

-- 2. First console load: create the row from the registration date.
create or replace function public.host_access_state(p_user uuid default auth.uid())
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  s public.billing_settings;
  v_start timestamptz; v_end timestamptz;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public._billing_caller_may_read(p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.host_subscriptions where user_id = p_user)
     and not exists (select 1 from auth.users u join public.admin_users a on lower(a.email) = lower(u.email) where u.id = p_user) then
    select * into s from public.billing_settings where id = 1;
    v_start := coalesce(public.billing_registration_at(p_user), now());
    v_end := public.billing_day_start((v_start at time zone 'Europe/Rome')::date + s.trial_days);
    insert into public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
    values (p_user, v_start, v_end, 'trialing') on conflict (user_id) do nothing;
    if found then
      insert into public.billing_events (user_id, actor, action, new_value, reason)
      values (p_user, 'system', 'trial_started', jsonb_build_object('trial_started_at', v_start, 'trial_ends_at', v_end), 'registration');
    end if;
  end if;
  return public.billing_access_state(p_user, now());
end $$;

-- 3. Invitation accepted = registration: the trial starts now.
create or replace function public.accept_my_invite()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  _email text := lower(coalesce(auth.email(), ''));
  _row public.pilot_invites;
  _s public.billing_settings;
  _start timestamptz := now();
  _end timestamptz;
begin
  if _email = '' then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select * into _row from public.pilot_invites where email = _email;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_row', 'email', _email);
  end if;
  if _row.status = 'accepted' then
    return jsonb_build_object('ok', true, 'already', true, 'email', _email);
  end if;
  update public.pilot_invites set status = 'accepted', accepted_at = _start where email = _email;
  if auth.uid() is not null and not exists (select 1 from public.admin_users a where lower(a.email) = _email) then
    select * into _s from public.billing_settings where id = 1;
    _end := public.billing_day_start((_start at time zone 'Europe/Rome')::date + _s.trial_days);
    insert into public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
    values (auth.uid(), _start, _end, 'trialing')
    on conflict (user_id) do nothing;
    if found then
      insert into public.billing_events (user_id, actor, action, new_value, reason)
      values (auth.uid(), 'system', 'trial_started', jsonb_build_object('trial_started_at', _start, 'trial_ends_at', _end), 'invite accepted');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'email', _email, 'accepted_at', _start);
end $$;

-- 4. Launch candidates carry the existing trial end (for the warning).
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
      exists (select 1 from public.host_subscriptions s where s.user_id = h.user_id) as has_row,
      (select s.trial_ends_at from public.host_subscriptions s where s.user_id = h.user_id) as trial_ends_at,
      (select s.status from public.host_subscriptions s where s.user_id = h.user_id) as sub_status
    from hosts h join auth.users u on u.id = h.user_id
    where not exists (select 1 from public.admin_users a where lower(a.email) = lower(u.email))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', e.user_id, 'email', e.email, 'properties', e.properties, 'all_test', e.all_test, 'has_row', e.has_row,
      'trial_started_at', coalesce(e.accepted_at, e.created_at),
      'trial_ends_at', e.trial_ends_at, 'subscription_status', e.sub_status,
      'suggested_last_free_day', (select d from launch_day) + 29,
      'earliest_last_free_day', (select d from launch_day) + 6)
    order by e.email), '[]'::jsonb)
  from eligible e
$$;
revoke all on function public.billing_launch_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_launch_candidates(timestamptz) to service_role;
