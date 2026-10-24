-- Phase 2 is private metadata/reporting only. No OTA/check-in writes or jobs.
create table ireservation_private.room_mappings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  connection_version text not null,
  version text not null,
  mappings jsonb not null check (jsonb_typeof(mappings)='array'),
  updated_at timestamptz not null default clock_timestamp()
);
create table ireservation_private.comparison_runs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  connection_version text not null,
  mapping_version text not null,
  report jsonb not null check (jsonb_typeof(report)='object'),
  created_at timestamptz not null default clock_timestamp()
);
create index ireservation_comparison_runs_property_time on ireservation_private.comparison_runs(property_id,created_at desc);
alter table ireservation_private.room_mappings enable row level security;
alter table ireservation_private.comparison_runs enable row level security;
revoke all on ireservation_private.room_mappings,ireservation_private.comparison_runs from public,anon,authenticated,service_role;
create function public.ireservation_compare_state(p_operation text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  pid uuid := (p_payload->>'property_id')::uuid;
  oid uuid := (p_payload->>'owner_id')::uuid;
  c ireservation_private.connections;
  m ireservation_private.room_mappings;
  entry jsonb;
  rooms jsonb;
  locals jsonb;
  report jsonb;
  seen_ids integer[] := '{}';
  assigned uuid[] := '{}';
  room_id uuid;
  provider_id integer;
  whole boolean := false;
  from_date date;
  to_date date;
begin
  if pid is null or oid is null then return jsonb_build_object('error','forbidden'); end if;
  perform 1 from public.properties where id=pid and owner_id=oid and deleted_at is null for share;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ireservation:'||pid::text,0));
  select * into c from ireservation_private.connections where property_id=pid for share;
  if c.owner_id is distinct from oid or c.secret is null then return jsonb_build_object('error','forbidden'); end if;
  if c.version is distinct from p_payload->>'expected' or c.verified_at is null then return jsonb_build_object('error','conflict'); end if;
  select * into m from ireservation_private.room_mappings where property_id=pid for update;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,name),'[]'::jsonb)
    into rooms from public.property_rooms where property_id=pid and deleted_at is null;
  if p_operation='mapping_get' then
    select r.report into report from ireservation_private.comparison_runs r where r.property_id=pid
      and r.connection_version=c.version and r.mapping_version=m.version order by r.created_at desc limit 1;
    return jsonb_build_object('version',coalesce(m.version,'none'),'mappings',
      case when m.connection_version=c.version then coalesce(m.mappings,'[]'::jsonb) else '[]'::jsonb end,
      'stale',m.property_id is not null and m.connection_version is distinct from c.version,'local_rooms',rooms,'report',report);
  elsif p_operation='mapping_save' then
    if coalesce(m.version,'none') is distinct from p_payload->>'mapping_version' then return jsonb_build_object('error','conflict'); end if;
    if jsonb_typeof(p_payload->'mappings') is distinct from 'array' or jsonb_array_length(p_payload->'mappings')>500
      or p_payload->>'version' is null then return jsonb_build_object('error','invalid'); end if;
    for entry in select value from jsonb_array_elements(p_payload->'mappings') loop
      provider_id := (entry->>'provider_id')::integer;
      if provider_id is null or provider_id<=0 or provider_id=any(seen_ids) then return jsonb_build_object('error','invalid'); end if;
      seen_ids := array_append(seen_ids,provider_id);
      if entry->>'strategy'='unmapped' then continue; end if;
      if entry->>'confirmed' is distinct from 'true' then return jsonb_build_object('error','invalid'); end if;
      if entry->>'strategy'='whole_property' then
        if whole or jsonb_array_length(rooms)>0 or entry->>'room_id' is not null then return jsonb_build_object('error','invalid'); end if;
        whole := true;
      elsif entry->>'strategy'='single_unit' then
        room_id := (entry->>'room_id')::uuid;
        if room_id is null or room_id=any(assigned) or not exists(select 1 from public.property_rooms
          where id=room_id and property_id=pid and deleted_at is null) then return jsonb_build_object('error','invalid'); end if;
        assigned := array_append(assigned,room_id);
      else return jsonb_build_object('error','invalid'); end if;
    end loop;
    insert into ireservation_private.room_mappings(property_id,connection_version,version,mappings)
      values(pid,c.version,p_payload->>'version',p_payload->'mappings')
    on conflict(property_id) do update set connection_version=excluded.connection_version,
      version=excluded.version,mappings=excluded.mappings,updated_at=clock_timestamp() returning * into m;
    return jsonb_build_object('version',m.version,'mappings',m.mappings,'local_rooms',rooms,'report',null,'stale',false);
  elsif p_operation in ('comparison_context','comparison_save') then
    if m.connection_version is distinct from c.version or m.version is distinct from p_payload->>'mapping_version' then
      return jsonb_build_object('error','conflict'); end if;
    if exists(select 1 from jsonb_array_elements(m.mappings) x where x->>'strategy'='single_unit' and
      not exists(select 1 from public.property_rooms r where r.id=(x->>'room_id')::uuid and r.property_id=pid and r.deleted_at is null))
      or (jsonb_array_length(rooms)>0 and exists(select 1 from jsonb_array_elements(m.mappings) x where x->>'strategy'='whole_property')) then
      return jsonb_build_object('error','conflict');
    end if;
    if p_operation='comparison_save' then
      report := p_payload->'report';
      if jsonb_typeof(report) is distinct from 'object' or octet_length(report::text)>2000000 or
        report->>'mode' is distinct from 'compare' or report->>'can_cutover' is distinct from 'false' or
        report->>'coverage' is distinct from 'unverified' then return jsonb_build_object('error','invalid'); end if;
      insert into ireservation_private.comparison_runs(property_id,connection_version,mapping_version,report)
        values(pid,c.version,m.version,report);
      delete from ireservation_private.comparison_runs where property_id=pid and id not in
        (select id from ireservation_private.comparison_runs where property_id=pid order by created_at desc limit 20);
      return jsonb_build_object('saved',true,'report',report);
    end if;
    from_date := (p_payload->>'fromDate')::date; to_date := (p_payload->>'toDate')::date;
    if from_date is null or to_date is null or to_date<from_date or to_date-from_date>31 then return jsonb_build_object('error','invalid'); end if;
    -- Phase 2 has no verified native bindings. Do not trust editable raw JSON
    -- as an identity proof: date/room overlap is only a human review candidate.
    select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into locals from
      (select o.id,o.room_id,o.checkin_date,o.checkout_date,o.status,o.entry_type,null::text as provider_identity
       from public.ota_reservations o where o.property_id=pid and o.deleted_at is null
       and o.checkin_date<=to_date and o.checkout_date>from_date order by o.id limit 1001) r;
    return jsonb_build_object('mappings',m.mappings,'local',locals);
  end if;
  return jsonb_build_object('error','invalid');
end;
$$;
revoke all on function public.ireservation_compare_state(text,jsonb) from public,anon,authenticated;
grant execute on function public.ireservation_compare_state(text,jsonb) to service_role;
notify pgrst,'reload schema';
