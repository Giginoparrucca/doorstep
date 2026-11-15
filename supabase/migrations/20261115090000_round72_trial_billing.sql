-- Round 72 Phase 1 — trial and billing data model. Specification:
-- PLAN_round72_trial_billing.md. Nothing here charges anyone and nothing is
-- visible to hosts while billing_settings.launch_at is NULL (the switch):
-- every host is 'prelaunch'.
--
-- billing_settings      single row (id = 1): launch switch, trial/grace days,
--                       price, VAT, bank-transfer details. Hosts read it (the
--                       paywall shows price and IBAN); service_role writes.
-- host_subscriptions    one row per host account (user_id, no FK to
--                       auth.users: accounting records outlive the account).
--                       Host reads own, admins read all, service_role writes,
--                       nobody deletes.
-- billing_events        append-only audit (no UPDATE/DELETE/TRUNCATE for any
--                       role, owner included). Host reads own, admins all,
--                       service_role inserts.
-- billing_access_state(user, now)  pure state computation (not granted to
--                       clients; tests pass a fixed now).
-- host_access_state(user)  state for the console/paywall; creates the row
--                       lazily after launch. A host may only ask for itself
--                       unless admin or service_role.
-- host_can_write(user)  false only in read_only (used by Phase 2 RLS and
--                       server choke points).
-- accept_my_invite()    Round 51 RPC, unchanged, plus: after launch it opens
--                       the new host's 30-day trial.
--
-- Day rule (Europe/Rome): trial_ends_at is the Rome midnight that starts the
-- first paid day. "N days left" counts Rome calendar days including today,
-- so it rounds up (never "0 days" with part of the last day left).
-- Re-runnable: create if not exists / or replace / seed on conflict do nothing.
-- Rollback: drop function public.host_can_write(uuid), public.host_access_state(uuid),
--   public.billing_access_state(uuid, timestamptz), public.billing_day_start(date),
--   public.billing_events_guard(); drop table public.billing_events,
--   public.host_subscriptions, public.billing_settings; re-create accept_my_invite
--   from 20261115090000's header (Round 51 body).

create table if not exists public.billing_settings (
  id smallint primary key default 1 check (id = 1),
  launch_at timestamptz,
  trial_days integer not null default 30 check (trial_days between 1 and 365),
  grace_days integer not null default 7 check (grace_days between 0 and 60),
  annual_price_cents integer not null default 6000 check (annual_price_cents >= 0),
  vat_rate numeric(5,2) not null default 22 check (vat_rate between 0 and 100),
  bank_transfer_iban text check (bank_transfer_iban is null or bank_transfer_iban ~ '^[A-Z]{2}[0-9A-Z ]{13,40}$'),
  bank_transfer_holder text check (bank_transfer_holder is null or length(bank_transfer_holder) between 1 and 200),
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.host_subscriptions (
  user_id uuid primary key,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  status text not null default 'trialing'
    check (status in ('trialing', 'active', 'past_due', 'expired', 'free_forever', 'canceled')),
  free_forever_reason text check (free_forever_reason is null or length(free_forever_reason) between 1 and 500),
  paid_until timestamptz,
  payment_method text check (payment_method is null or payment_method in ('bank_transfer', 'stripe')),
  stripe_customer_id text check (stripe_customer_id is null or length(stripe_customer_id) <= 100),
  stripe_subscription_id text check (stripe_subscription_id is null or length(stripe_subscription_id) <= 100),
  reminders_sent jsonb not null default '{}'::jsonb check (jsonb_typeof(reminders_sent) = 'object'),
  read_only_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'free_forever' or free_forever_reason is not null)
);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  actor text not null check (length(actor) between 1 and 320),
  action text not null check (action in ('trial_started', 'trial_extended', 'trial_end_set', 'trial_shortened',
    'free_forever_on', 'free_forever_off', 'marked_paid', 'expired', 'read_only', 'reminder_sent')),
  old_value jsonb,
  new_value jsonb,
  reason text check (reason is null or length(reason) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists billing_events_user_idx on public.billing_events (user_id, created_at desc);

create or replace function public.billing_events_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'billing_events is append-only' using errcode = '42501';
end $$;
drop trigger if exists billing_events_append_only on public.billing_events;
create trigger billing_events_append_only before update or delete on public.billing_events
  for each row execute function public.billing_events_guard();
drop trigger if exists billing_events_no_truncate on public.billing_events;
create trigger billing_events_no_truncate before truncate on public.billing_events
  for each statement execute function public.billing_events_guard();

-- Rome midnight starting the given calendar day.
create or replace function public.billing_day_start(p_day date) returns timestamptz
language sql immutable set search_path = pg_catalog as $$
  select (p_day::timestamp at time zone 'Europe/Rome')
$$;

-- Pure computation. Order: prelaunch, free (free_forever or admin account),
-- active (paid_until in the future), trial, grace, read_only.
create or replace function public.billing_access_state(p_user uuid, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  s public.billing_settings;
  sub public.host_subscriptions;
  v_today date := (p_now at time zone 'Europe/Rome')::date;
  v_end timestamptz; v_grace_end timestamptz;
  v_info jsonb;
begin
  select * into s from public.billing_settings where id = 1;
  v_info := jsonb_build_object(
    'price_eur', round(coalesce(s.annual_price_cents, 6000) / 100.0, 2),
    'vat_rate', coalesce(s.vat_rate, 22),
    'grace_days', coalesce(s.grace_days, 7),
    'bank_transfer_iban', s.bank_transfer_iban,
    'bank_transfer_holder', s.bank_transfer_holder);
  if s.launch_at is null or s.launch_at > p_now then
    return v_info || jsonb_build_object('state', 'prelaunch');
  end if;
  if exists (select 1 from public.admin_users a join auth.users u on lower(u.email) = lower(a.email) where u.id = p_user) then
    return v_info || jsonb_build_object('state', 'free', 'reason', 'admin');
  end if;
  select * into sub from public.host_subscriptions where user_id = p_user;
  if not found then
    return v_info || jsonb_build_object('state', 'none');
  end if;
  if sub.status = 'free_forever' then
    return v_info || jsonb_build_object('state', 'free', 'reason', 'free_forever');
  end if;
  if sub.paid_until is not null and sub.paid_until > p_now then
    return v_info || jsonb_build_object('state', 'active', 'paid_until', sub.paid_until);
  end if;
  if sub.trial_ends_at is not null and sub.trial_ends_at > p_now then
    return v_info || jsonb_build_object('state', 'trial', 'trial_ends_at', sub.trial_ends_at,
      'days_left', ((sub.trial_ends_at - interval '1 microsecond') at time zone 'Europe/Rome')::date - v_today + 1);
  end if;
  v_end := greatest(coalesce(sub.trial_ends_at, '-infinity'::timestamptz), coalesce(sub.paid_until, '-infinity'::timestamptz));
  if v_end = '-infinity'::timestamptz then v_end := s.launch_at; end if;
  v_grace_end := public.billing_day_start(((v_end - interval '1 microsecond') at time zone 'Europe/Rome')::date + 1 + coalesce(s.grace_days, 7));
  if p_now < v_grace_end then
    return v_info || jsonb_build_object('state', 'grace', 'ended_at', v_end, 'grace_ends_at', v_grace_end,
      'grace_days_left', ((v_grace_end - interval '1 microsecond') at time zone 'Europe/Rome')::date - v_today + 1);
  end if;
  return v_info || jsonb_build_object('state', 'read_only', 'ended_at', v_end, 'since', v_grace_end);
end $$;

create or replace function public._billing_caller_may_read(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select p_user = auth.uid()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or public.is_admin()
$$;

-- Console/paywall state. After launch, a host with no row (no invite, e.g.
-- demo) gets one lazily: trial from max(account creation, launch).
create or replace function public.host_access_state(p_user uuid default auth.uid())
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  s public.billing_settings;
  v_start timestamptz; v_end timestamptz;
  v_state jsonb;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if not public._billing_caller_may_read(p_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_state := public.billing_access_state(p_user, now());
  if v_state ->> 'state' = 'none' then
    select * into s from public.billing_settings where id = 1;
    select greatest(u.created_at, s.launch_at) into v_start from auth.users u where u.id = p_user;
    v_start := coalesce(v_start, greatest(now(), s.launch_at));
    v_end := public.billing_day_start((v_start at time zone 'Europe/Rome')::date + s.trial_days);
    insert into public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
    values (p_user, v_start, v_end, 'trialing') on conflict (user_id) do nothing;
    if found then
      insert into public.billing_events (user_id, actor, action, new_value, reason)
      values (p_user, 'system', 'trial_started', jsonb_build_object('trial_started_at', v_start, 'trial_ends_at', v_end), 'first login after launch');
    end if;
    v_state := public.billing_access_state(p_user, now());
  end if;
  return v_state;
end $$;

create or replace function public.host_can_write(p_user uuid default auth.uid())
returns boolean language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if p_user is null then return false; end if;
  if not public._billing_caller_may_read(p_user) then return false; end if;
  return coalesce(public.billing_access_state(p_user, now()) ->> 'state', '') <> 'read_only';
end $$;

-- Round 51 accept_my_invite, body unchanged, plus the Round 72 trial start.
create or replace function public.accept_my_invite()
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
DECLARE
  _email text := LOWER(COALESCE(auth.email(), ''));
  _row   public.pilot_invites;
  _s     public.billing_settings;
  _start timestamptz;
BEGIN
  IF _email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_session');
  END IF;
  SELECT * INTO _row FROM public.pilot_invites WHERE email = _email;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_row', 'email', _email);
  END IF;
  IF _row.status = 'accepted' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'email', _email);
  END IF;
  UPDATE public.pilot_invites SET status='accepted', accepted_at=now() WHERE email = _email;
  -- Round 72: after launch, a new host's trial starts at acceptance.
  SELECT * INTO _s FROM public.billing_settings WHERE id = 1;
  IF _s.launch_at IS NOT NULL AND _s.launch_at <= now() AND auth.uid() IS NOT NULL THEN
    _start := greatest(now(), _s.launch_at);
    INSERT INTO public.host_subscriptions (user_id, trial_started_at, trial_ends_at, status)
    VALUES (auth.uid(), _start, public.billing_day_start((_start AT TIME ZONE 'Europe/Rome')::date + _s.trial_days), 'trialing')
    ON CONFLICT (user_id) DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.billing_events (user_id, actor, action, new_value, reason)
      VALUES (auth.uid(), 'system', 'trial_started',
        jsonb_build_object('trial_started_at', _start,
          'trial_ends_at', public.billing_day_start((_start AT TIME ZONE 'Europe/Rome')::date + _s.trial_days)),
        'invite accepted');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'email', _email, 'accepted_at', now());
END;
$$;

alter table public.billing_settings enable row level security;
alter table public.host_subscriptions enable row level security;
alter table public.billing_events enable row level security;

revoke all on public.billing_settings, public.host_subscriptions, public.billing_events from public, anon, authenticated, service_role;
grant select on public.billing_settings, public.host_subscriptions, public.billing_events to authenticated;
grant select, insert, update on public.billing_settings, public.host_subscriptions to service_role;
grant select, insert on public.billing_events to service_role;

drop policy if exists billing_settings_read on public.billing_settings;
create policy billing_settings_read on public.billing_settings for select to authenticated using (true);
drop policy if exists host_subscriptions_read on public.host_subscriptions;
create policy host_subscriptions_read on public.host_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists billing_events_read on public.billing_events;
create policy billing_events_read on public.billing_events for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke all on function public.billing_events_guard(), public.billing_day_start(date),
  public.billing_access_state(uuid, timestamptz), public._billing_caller_may_read(uuid),
  public.host_access_state(uuid), public.host_can_write(uuid), public.accept_my_invite() from public, anon;
revoke all on function public.billing_access_state(uuid, timestamptz), public._billing_caller_may_read(uuid), public.billing_events_guard() from authenticated;
grant execute on function public.billing_access_state(uuid, timestamptz) to service_role;
grant execute on function public.host_access_state(uuid), public.host_can_write(uuid), public.accept_my_invite() to authenticated, service_role;
grant execute on function public.billing_day_start(date) to authenticated, service_role;

comment on table public.billing_settings is 'Round 72: billing switch (launch_at NULL = prelaunch for everyone), trial/grace days, price, VAT, bank details.';
comment on table public.host_subscriptions is 'Round 72: one row per host account; trial, paid_until, free_forever. No FK to auth.users (accounting retention).';
comment on table public.billing_events is 'Round 72: append-only billing audit.';
