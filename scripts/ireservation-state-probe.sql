-- Round 63: transactional synthetic state/permissions probe. Always rolls back.
-- No external HTTP, no guest/reservation writes, no real credential values.
begin;
do $$
declare
  pid uuid; oid uuid; alien uuid := 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  answer jsonb; q text := repeat('a',64); t text := repeat('b',64);
  lease1 uuid := gen_random_uuid(); lease2 uuid := gen_random_uuid();
  version1 text := gen_random_uuid()::text;
begin
  if has_schema_privilege('anon','ireservation_private','USAGE') or
     has_schema_privilege('authenticated','ireservation_private','USAGE') or
     has_schema_privilege('service_role','ireservation_private','USAGE') then raise exception 'private schema exposed'; end if;
  if has_function_privilege('anon','public.ireservation_state(text,jsonb)','EXECUTE') or
     has_function_privilege('authenticated','public.ireservation_state(text,jsonb)','EXECUTE') or
     not has_function_privilege('service_role','public.ireservation_state(text,jsonb)','EXECUTE') then raise exception 'RPC grants incorrect'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='ireservation_private' and c.relkind='r' and not c.relrowsecurity) then raise exception 'RLS missing'; end if;
  select id,owner_id into pid,oid from public.properties p where owner_id is not null and deleted_at is null
    and not exists(select 1 from ireservation_private.connections c where c.property_id=p.id) limit 1;
  if pid is null then raise exception 'no unused property for rolled-back fixture'; end if;
  answer := public.ireservation_state('connection_get',jsonb_build_object('property_id',pid,'owner_id',alien));
  if answer->>'error' is distinct from 'forbidden' then raise exception 'cross-owner read allowed'; end if;
  answer := public.ireservation_state('connection_save',jsonb_build_object('property_id',pid,'owner_id',alien,
    'calendar_id',330,'expected','none','version',version1,'secret','{"fixture":true}'::jsonb));
  if answer->>'error' is distinct from 'forbidden' then raise exception 'cross-owner write allowed'; end if;
  answer := public.ireservation_state('connection_save',jsonb_build_object('property_id',pid,'owner_id',oid,
    'calendar_id',330,'expected','none','version',version1,'secret','{"fixture":true}'::jsonb));
  if answer->>'version' is distinct from version1 then raise exception 'first save failed'; end if;
  answer := public.ireservation_state('connection_save',jsonb_build_object('property_id',pid,'owner_id',oid,
    'calendar_id',331,'expected','none','version','stale','secret','{"fixture":true}'::jsonb));
  if answer->>'error' is distinct from 'conflict' then raise exception 'stale overwrite allowed'; end if;
  answer := public.ireservation_state('connection_verify',jsonb_build_object('property_id',pid,'owner_id',oid,'expected','stale'));
  if answer->>'error' is distinct from 'conflict' then raise exception 'stale verification allowed'; end if;
  answer := public.ireservation_state('connection_verify',jsonb_build_object('property_id',pid,'owner_id',oid,'expected',version1,'error','fixture-sensitive-text'));
  if answer->>'error' is distinct from 'invalid' then raise exception 'untrusted log text allowed'; end if;
  answer := public.ireservation_state('connection_verify',jsonb_build_object('property_id',pid,'owner_id',oid,'expected',version1));
  if answer->>'verified_at' is null then raise exception 'verification failed'; end if;
  answer := public.ireservation_state('connection_disconnect',jsonb_build_object('property_id',pid,'owner_id',oid,'expected',version1,'version','disconnected'));
  if answer->>'secret' is not null or answer->>'version' <> 'disconnected' then raise exception 'disconnect fencing failed'; end if;
  answer := public.ireservation_state('connection_verify',jsonb_build_object('property_id',pid,'owner_id',oid,'expected',version1));
  if answer->>'error' is distinct from 'conflict' then raise exception 'post-disconnect stamp allowed'; end if;

  answer := public.ireservation_state('reserve',jsonb_build_object('scope',q,'daily',1,'rate',5,'burst',10));
  if answer->>'allowed' is distinct from 'true' then raise exception 'first request denied'; end if;
  answer := public.ireservation_state('reserve',jsonb_build_object('scope',q,'daily',1,'rate',5,'burst',10));
  if answer->>'reason' is distinct from 'quota' then raise exception 'daily budget bypass'; end if;
  update ireservation_private.attempts set attempted_at=clock_timestamp()-interval '25 hours' where scope=q;
  answer := public.ireservation_state('reserve',jsonb_build_object('scope',q,'daily',1,'rate',5,'burst',10));
  if answer->>'allowed' is distinct from 'true' then raise exception 'rolling expiry failed'; end if;
  update ireservation_private.partner_state set tokens=0,refilled_at=clock_timestamp()+interval '1 minute' where scope=q;
  answer := public.ireservation_state('reserve',jsonb_build_object('scope',q,'daily',5000,'rate',5,'burst',10));
  if answer->>'reason' is distinct from 'rate' then raise exception 'global rate bypass'; end if;
  answer := public.ireservation_state('pause',jsonb_build_object('scope',q,'seconds',60));
  answer := public.ireservation_state('reserve',jsonb_build_object('scope',q,'daily',5000,'rate',5,'burst',10));
  if answer->>'reason' is distinct from 'quota' then raise exception 'shared 429 pause bypass'; end if;

  answer := public.ireservation_state('token_get',jsonb_build_object('scope',t));
  answer := public.ireservation_state('token_finish',jsonb_build_object('scope',t,'previous','none','version','invalid',
    'secret','{"fixture":true}'::jsonb,'expires_at',clock_timestamp()+interval '1 hour'));
  if answer->>'saved' is distinct from 'false' then raise exception 'token commit without lease'; end if;
  answer := public.ireservation_state('token_claim',jsonb_build_object('scope',t,'version','none','lease',lease1));
  if answer->>'claimed' is distinct from 'true' then raise exception 'auth claim failed'; end if;
  answer := public.ireservation_state('token_claim',jsonb_build_object('scope',t,'version','none','lease',lease2));
  if answer->>'claimed' is distinct from 'false' then raise exception 'two auth holders allowed'; end if;
  answer := public.ireservation_state('token_finish',jsonb_build_object('scope',t,'lease',lease2,'previous','none','version','v2',
    'secret','{"fixture":true}'::jsonb,'expires_at',clock_timestamp()+interval '1 hour'));
  if answer->>'saved' is distinct from 'false' then raise exception 'wrong-holder commit allowed'; end if;
  update ireservation_private.partner_state set lease_until=clock_timestamp()-interval '1 second' where scope=t;
  answer := public.ireservation_state('token_finish',jsonb_build_object('scope',t,'lease',lease1,'previous','none','version','v2',
    'secret','{"fixture":true}'::jsonb,'expires_at',clock_timestamp()+interval '1 hour'));
  if answer->>'saved' is distinct from 'false' then raise exception 'expired lease commit allowed'; end if;
  answer := public.ireservation_state('token_claim',jsonb_build_object('scope',t,'version','none','lease',lease2));
  answer := public.ireservation_state('token_fail',jsonb_build_object('scope',t,'lease',lease1,'blocked',true));
  answer := public.ireservation_state('token_get',jsonb_build_object('scope',t));
  if (answer->>'auth_blocked')::boolean then raise exception 'stale holder blocked current auth'; end if;
  answer := public.ireservation_state('token_finish',jsonb_build_object('scope',t,'lease',lease2,'previous','none','version','v2',
    'secret','{"fixture":true}'::jsonb,'expires_at',clock_timestamp()+interval '1 hour'));
  if answer->>'saved' is distinct from 'true' then raise exception 'valid token commit failed'; end if;
end;
$$;
set local role anon;
do $$begin
  begin perform public.ireservation_state('token_get',jsonb_build_object('scope',repeat('a',64)));
    raise exception 'anonymous execution succeeded';
  exception when insufficient_privilege then null; end;
end;$$;
reset role;
set local role authenticated;
do $$begin
  begin perform public.ireservation_state('token_get',jsonb_build_object('scope',repeat('a',64)));
    raise exception 'authenticated execution succeeded';
  exception when insufficient_privilege then null; end;
end;$$;
reset role;
select 'PASS rolled-back iReservation tenant/CAS/permission/quota/rate/lease tests' as result;
rollback;
