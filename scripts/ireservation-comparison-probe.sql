-- Synthetic private metadata only; always rollback. No OTA/check-in writes.
begin;
do $$
declare pid uuid; oid uuid; rid uuid; alien uuid:=gen_random_uuid(); payload jsonb; answer jsonb; before_rows text; after_rows text;
begin
  if has_function_privilege('anon','public.ireservation_compare_state(text,jsonb)','EXECUTE') or
     has_function_privilege('authenticated','public.ireservation_compare_state(text,jsonb)','EXECUTE') or
     not has_function_privilege('service_role','public.ireservation_compare_state(text,jsonb)','EXECUTE') then raise exception 'comparison grants incorrect'; end if;
  select jsonb_build_array((select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.ota_reservations r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.checkins r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.excluded_booking_codes r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.host_dismissed_bookings r))::text into before_rows;
  select p.id,p.owner_id into pid,oid from public.properties p where p.owner_id is not null and p.deleted_at is null
    and not exists(select 1 from ireservation_private.connections c where c.property_id=p.id) limit 1;
  if pid is null then raise exception 'no unused rolled-back fixture property'; end if;
  payload:=jsonb_build_object('property_id',pid,'owner_id',oid,'expected','fixture-v1');
  insert into ireservation_private.connections(property_id,owner_id,calendar_id,version,secret,verified_at)
    values(pid,oid,330,'fixture-v1','{"fixture":true}',clock_timestamp());
  answer:=public.ireservation_compare_state('mapping_get',payload||jsonb_build_object('owner_id',alien));
  if answer->>'error' is distinct from 'forbidden' then raise exception 'cross-owner comparison allowed'; end if;
  answer:=public.ireservation_compare_state('mapping_save',payload||'{"mapping_version":"none","version":"map-v1","mappings":[]}'::jsonb);
  if answer->>'version' is distinct from 'map-v1' then raise exception 'mapping save failed'; end if;
  answer:=public.ireservation_compare_state('mapping_save',payload||'{"mapping_version":"none","version":"stale","mappings":[]}'::jsonb);
  if answer->>'error' is distinct from 'conflict' then raise exception 'stale mapping overwrite'; end if;
  payload:=payload||'{"mapping_version":"map-v1"}'::jsonb;
  answer:=public.ireservation_compare_state('comparison_context',payload||'{"fromDate":"2026-10-01","toDate":"2026-12-01"}'::jsonb);
  if answer->>'error' is distinct from 'invalid' then raise exception 'unbounded range allowed'; end if;
  answer:=public.ireservation_compare_state('comparison_context',payload||'{"fromDate":"2026-10-01","toDate":"2026-10-31"}'::jsonb);
  if jsonb_typeof(answer->'local') is distinct from 'array' then raise exception 'context failed'; end if;
  if exists(select 1 from jsonb_array_elements(answer->'local') x where x->>'provider_identity' is not null or x ? 'raw' or x ? 'guest_email') then raise exception 'untrusted identity or PII exposed'; end if;
  answer:=public.ireservation_compare_state('comparison_save',payload||'{"report":{"mode":"compare","coverage":"unverified","can_cutover":true}}'::jsonb);
  if answer->>'error' is distinct from 'invalid' then raise exception 'cutover report accepted'; end if;
  answer:=public.ireservation_compare_state('comparison_save',payload||'{"report":{"mode":"compare","coverage":"unverified","can_cutover":false,"counts":{}}}'::jsonb);
  if answer->>'saved' is distinct from 'true' then raise exception 'report save failed'; end if;
  answer:=public.ireservation_compare_state('mapping_get',payload);
  if answer->'report'->>'can_cutover' is distinct from 'false' then raise exception 'report retrieval failed'; end if;
  update ireservation_private.connections set version='fixture-v2' where property_id=pid;
  answer:=public.ireservation_compare_state('comparison_save',payload||'{"report":{"mode":"compare","coverage":"unverified","can_cutover":false}}'::jsonb);
  if answer->>'error' is distinct from 'conflict' then raise exception 'credential rotation race accepted'; end if;
  update ireservation_private.connections set version='fixture-v1' where property_id=pid;
  update ireservation_private.room_mappings set mappings=jsonb_build_array(jsonb_build_object('provider_id',104,'strategy','single_unit','room_id',gen_random_uuid(),'confirmed',true)) where property_id=pid;
  answer:=public.ireservation_compare_state('comparison_context',payload||'{"fromDate":"2026-10-01","toDate":"2026-10-31"}'::jsonb);
  if answer->>'error' is distinct from 'conflict' then raise exception 'deleted room mapping accepted'; end if;
  select jsonb_build_array((select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.ota_reservations r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.checkins r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.excluded_booking_codes r),(select md5(coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text,'')) from public.host_dismissed_bookings r))::text into after_rows;
  if before_rows is distinct from after_rows then raise exception 'calendar was mutated'; end if;
end;$$;
set local role anon;
do $$begin
  begin perform public.ireservation_compare_state('mapping_get','{}'); raise exception 'anonymous execution succeeded';
  exception when insufficient_privilege then null; end;
end;$$;
reset role;
set local role authenticated;
do $$begin
  begin perform public.ireservation_compare_state('mapping_get','{}'); raise exception 'authenticated execution succeeded';
  exception when insufficient_privilege then null; end;
end;$$;
reset role;
select 'PASS rolled-back comparison ownership/CAS/range/minimization/no-cutover/no-calendar-mutation tests' as result;
rollback;
