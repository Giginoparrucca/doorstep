-- Round 63 Phase 1: no reservation/guest/calendar mutations, no scheduler.
create schema if not exists ireservation_private;
revoke all on schema ireservation_private from public, anon, authenticated, service_role;

create table ireservation_private.connections (
  property_id uuid primary key references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  calendar_id integer not null check (calendar_id > 0),
  version text not null,
  secret jsonb,
  verified_at timestamptz,
  last_error text,
  updated_at timestamptz not null default clock_timestamp(),
  check (secret is null or jsonb_typeof(secret) = 'object')
);
create table ireservation_private.partner_state (
  scope text primary key check (scope ~ '^[a-f0-9]{64}$'),
  version text not null default 'none',
  secret jsonb,
  expires_at timestamptz,
  lease uuid,
  lease_until timestamptz,
  auth_blocked boolean not null default false,
  blocked_until timestamptz,
  tokens numeric not null default 0,
  refilled_at timestamptz not null default clock_timestamp(),
  initialized boolean not null default false
);
create table ireservation_private.attempts (
  scope text not null references ireservation_private.partner_state(scope) on delete cascade,
  attempted_at timestamptz not null
);
create index ireservation_attempts_scope_time on ireservation_private.attempts(scope, attempted_at);
alter table ireservation_private.connections enable row level security;
alter table ireservation_private.partner_state enable row level security;
alter table ireservation_private.attempts enable row level security;
revoke all on all tables in schema ireservation_private from public, anon, authenticated, service_role;

-- Service-only RPC boundary: private tables are never exposed through PostgREST.
-- The service handler verifies the JWT; this function independently rechecks
-- current property ownership and serializes changes, including first-time saves.
create function public.ireservation_state(p_operation text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c ireservation_private.connections;
  s ireservation_private.partner_state;
  pid uuid;
  oid uuid;
  stamp timestamptz := clock_timestamp();
  scope_id text;
  budget integer;
  rate_limit integer;
  burst_limit integer;
  available numeric;
  count_today integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('error','invalid');
  end if;
  if p_operation in ('connection_get','connection_save','connection_disconnect','connection_verify') then
    pid := (p_payload->>'property_id')::uuid;
    oid := (p_payload->>'owner_id')::uuid;
    if pid is null or oid is null then return jsonb_build_object('error','forbidden'); end if;
    perform 1 from public.properties where id=pid and owner_id=oid and deleted_at is null for share;
    if not found then return jsonb_build_object('error','forbidden'); end if;
    perform pg_advisory_xact_lock(hashtextextended('ireservation:' || pid::text, 0));
    select * into c from ireservation_private.connections where property_id=pid for update;
    if c.property_id is not null and c.owner_id <> oid then
      -- Transferred properties must be explicitly re-onboarded by an operator.
      return jsonb_build_object('error','forbidden');
    end if;
    if p_operation='connection_get' then return coalesce(to_jsonb(c), '{}'::jsonb); end if;
    if p_payload->>'expected' is null or (p_payload->>'expected') <> coalesce(c.version,'none') then
      return jsonb_build_object('error','conflict');
    end if;
    if p_operation='connection_save' then
      if (p_payload->>'calendar_id')::integer <= 0 or p_payload->>'version' is null or
         jsonb_typeof(p_payload->'secret') is distinct from 'object' then
        return jsonb_build_object('error','invalid');
      end if;
      insert into ireservation_private.connections(property_id,owner_id,calendar_id,version,secret)
        values(pid,oid,(p_payload->>'calendar_id')::integer,p_payload->>'version',p_payload->'secret')
      on conflict (property_id) do update set calendar_id=excluded.calendar_id,
        version=excluded.version,secret=excluded.secret,verified_at=null,last_error=null,updated_at=stamp
      returning * into c;
    elsif p_operation='connection_disconnect' then
      if c.property_id is not null then
        update ireservation_private.connections set secret=null, version=p_payload->>'version',
          verified_at=null,last_error=null,updated_at=stamp where property_id=pid returning * into c;
      end if;
    else
      if c.secret is null then return jsonb_build_object('error','conflict'); end if;
      if p_payload->>'error' is not null and p_payload->>'error' not in
        ('integration_unavailable','configuration_invalid','configuration_missing','encryption_unavailable',
         'encryption_context_invalid','credentials_unreadable','provider_response_invalid','provider_unreachable',
         'provider_unauthorized','provider_unavailable','provider_rejected','rate_paused','quota_paused',
         'partner_auth_blocked','auth_busy','auth_lease_lost','storage_unavailable') then
        return jsonb_build_object('error','invalid');
      end if;
      update ireservation_private.connections set
        verified_at=case when p_payload->>'error' is null then stamp else null end,
        last_error=p_payload->>'error',updated_at=stamp where property_id=pid returning * into c;
    end if;
    return coalesce(to_jsonb(c), '{}'::jsonb);
  end if;

  if p_operation not in ('reserve','pause','token_get','token_claim','token_finish','token_fail') then
    return jsonb_build_object('error','invalid');
  end if;
  scope_id := p_payload->>'scope';
  if scope_id is null or scope_id !~ '^[a-f0-9]{64}$' then return jsonb_build_object('error','invalid'); end if;
  insert into ireservation_private.partner_state(scope) values(scope_id) on conflict do nothing;
  select * into s from ireservation_private.partner_state where scope=scope_id for update;
  -- Re-read the clock after waiting on a concurrent worker's row lock.
  stamp := clock_timestamp();
  if p_operation='token_get' then return to_jsonb(s); end if;
  if p_operation='reserve' then
    budget := (p_payload->>'daily')::integer;
    rate_limit := (p_payload->>'rate')::integer;
    burst_limit := (p_payload->>'burst')::integer;
    if budget is null or budget not between 1 and 5000 or rate_limit is null or rate_limit not between 1 and 5 or
       burst_limit is null or burst_limit not between 1 and 10 then return jsonb_build_object('error','invalid'); end if;
    if s.blocked_until > stamp then return jsonb_build_object('allowed',false,'reason','quota'); end if;
    delete from ireservation_private.attempts where scope=scope_id and attempted_at <= stamp - interval '24 hours';
    select count(*) into count_today from ireservation_private.attempts where scope=scope_id;
    if count_today >= budget then return jsonb_build_object('allowed',false,'reason','quota'); end if;
    available := case when not s.initialized then burst_limit else
      least(burst_limit, s.tokens + greatest(0,extract(epoch from stamp-s.refilled_at)) * rate_limit) end;
    if available < 1 then return jsonb_build_object('allowed',false,'reason','rate'); end if;
    update ireservation_private.partner_state set tokens=available-1,refilled_at=stamp,initialized=true where scope=scope_id;
    insert into ireservation_private.attempts values(scope_id,stamp);
    return jsonb_build_object('allowed',true,'remaining',budget-count_today-1);
  elsif p_operation='pause' then
    update ireservation_private.partner_state set blocked_until=greatest(coalesce(blocked_until,stamp),
      stamp + make_interval(secs => greatest(1,least(86400,coalesce((p_payload->>'seconds')::integer,86400))))) where scope=scope_id;
    return jsonb_build_object('paused',true);
  elsif p_operation='token_claim' then
    if p_payload->>'lease' is null or s.auth_blocked or s.blocked_until > stamp or s.lease_until > stamp or
       s.version is distinct from p_payload->>'version' then return jsonb_build_object('claimed',false); end if;
    update ireservation_private.partner_state set lease=(p_payload->>'lease')::uuid,
      lease_until=stamp+interval '60 seconds' where scope=scope_id;
    return jsonb_build_object('claimed',true);
  elsif p_operation='token_finish' then
    if s.lease is null or s.lease_until is null or s.lease is distinct from (p_payload->>'lease')::uuid or s.lease_until <= stamp or
       s.version is distinct from p_payload->>'previous' then return jsonb_build_object('saved',false); end if;
    if jsonb_typeof(p_payload->'secret') is distinct from 'object' or p_payload->>'version' is null or
       (p_payload->>'expires_at')::timestamptz <= stamp then return jsonb_build_object('error','invalid'); end if;
    update ireservation_private.partner_state set secret=p_payload->'secret',version=p_payload->>'version',
      expires_at=(p_payload->>'expires_at')::timestamptz,lease=null,lease_until=null,auth_blocked=false,blocked_until=null where scope=scope_id;
    return jsonb_build_object('saved',true);
  else
    if s.lease = (p_payload->>'lease')::uuid then
      update ireservation_private.partner_state set lease=null,lease_until=null,
        auth_blocked=coalesce((p_payload->>'blocked')::boolean,false),blocked_until=stamp+interval '15 seconds' where scope=scope_id;
    end if;
    return jsonb_build_object('released',true);
  end if;
end;
$$;
revoke all on function public.ireservation_state(text,jsonb) from public, anon, authenticated;
grant execute on function public.ireservation_state(text,jsonb) to service_role;
notify pgrst, 'reload schema';
