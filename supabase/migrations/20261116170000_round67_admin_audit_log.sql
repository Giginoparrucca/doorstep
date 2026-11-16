-- Round 67 Phase 5 — admin audit log: a tamper-evident journal of every
-- privileged access (who did what, when, to which record).
--
-- admin_access_events   append-only. No UPDATE/DELETE/TRUNCATE for any role;
--                       the only deletion is the 2-year retention purge.
--                       Every row carries row_hash = sha256(prev_hash ||
--                       content), chained in insertion order, so an edit or a
--                       removed row is detectable (admin_audit_verify).
--                       metadata holds IDs, kinds and counts only: a value
--                       that looks like an email address is refused.
-- admin_audit_record()  SECURITY INVOKER insert, EXECUTE service_role only;
--                       occurred_at is always now() (no back-dating: the
--                       column is not insertable).
-- admin_audit_verify()  first broken row (or null when the chain holds).
-- admin_audit_purge()   deletes rows older than 2 years (daily pg_cron job
--                       welcomebnb_admin_audit_purge).
-- admin_impersonation_log inserts (admin.html «view as host») are mirrored
-- into the journal by trigger.
--
-- Re-runnable. Rollback:
--   select cron.unschedule('welcomebnb_admin_audit_purge');
--   drop trigger if exists admin_impersonation_audit on public.admin_impersonation_log;
--   drop function public.admin_impersonation_audit(), public.admin_audit_record(uuid, text, text, text, text, text, text, jsonb),
--     public.admin_audit_verify(), public.admin_audit_purge(), public.admin_access_events_guard(), public.admin_access_events_chain();
--   drop table public.admin_access_events;
create table if not exists public.admin_access_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text check (actor_email is null or length(actor_email) <= 320),
  action text not null check (action ~ '^(host_health_read|audit_read|dsar_(export|erase_preview|erase)|billing_[a-z_]{2,40}|invite_(send|resend|revoke|link)|alloggiati_admin_[a-z_]{2,40}|alloggiati_support_read|impersonation_view)$'),
  outcome text not null default 'ok' check (outcome in ('requested', 'ok', 'refused', 'error')),
  target_table text check (target_table is null or target_table ~ '^[a-z][a-z0-9_]{1,62}$'),
  target_id text check (target_id is null or length(target_id) <= 100),
  request_fingerprint text check (request_fingerprint is null or request_fingerprint ~ '^[0-9a-f]{16,64}$'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and length(metadata::text) <= 4000
           and metadata::text !~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'),
  prev_hash text,
  row_hash text
);
create index if not exists admin_access_events_time_idx on public.admin_access_events (occurred_at desc);
create index if not exists admin_access_events_action_idx on public.admin_access_events (action, occurred_at desc);

-- Content that the hash covers (stable text form).
create or replace function public.admin_access_events_content(e public.admin_access_events)
returns text language sql immutable set search_path = pg_catalog as $$
  select concat_ws('|', e.id::text, to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(e.actor_id::text, ''),
    coalesce(e.actor_email, ''), e.action, e.outcome, coalesce(e.target_table, ''), coalesce(e.target_id, ''),
    coalesce(e.request_fingerprint, ''), e.metadata::text)
$$;

create or replace function public.admin_access_events_chain() returns trigger
language plpgsql set search_path = public, pg_catalog as $$
begin
  -- One writer at a time, so the chain follows insertion order.
  perform pg_advisory_xact_lock(hashtext('public.admin_access_events'));
  new.occurred_at := now();
  select e.row_hash into new.prev_hash from public.admin_access_events e order by e.id desc limit 1;
  new.prev_hash := coalesce(new.prev_hash, 'genesis');
  new.row_hash := encode(sha256(convert_to(new.prev_hash || '|' || public.admin_access_events_content(new), 'UTF8')), 'hex');
  return new;
end $$;
drop trigger if exists admin_access_events_chain on public.admin_access_events;
create trigger admin_access_events_chain before insert on public.admin_access_events
  for each row execute function public.admin_access_events_chain();

-- Append-only. The retention purge (and only it) may delete rows older than
-- two years.
create or replace function public.admin_access_events_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' and current_setting('welcomebnb.admin_audit_purge', true) = 'on'
     and old.occurred_at < now() - interval '2 years' then
    return old;
  end if;
  raise exception 'admin_access_events is append-only' using errcode = '42501';
end $$;
drop trigger if exists admin_access_events_append_only on public.admin_access_events;
create trigger admin_access_events_append_only before update or delete on public.admin_access_events
  for each row execute function public.admin_access_events_guard();
drop trigger if exists admin_access_events_no_truncate on public.admin_access_events;
create trigger admin_access_events_no_truncate before truncate on public.admin_access_events
  for each statement execute function public.admin_access_events_guard();

create or replace function public.admin_audit_record(p_actor_id uuid, p_actor_email text, p_action text, p_outcome text,
  p_target_table text, p_target_id text, p_fingerprint text, p_metadata jsonb)
returns bigint language sql volatile security invoker set search_path = public, pg_catalog as $$
  insert into public.admin_access_events (actor_id, actor_email, action, outcome, target_table, target_id, request_fingerprint, metadata)
  values (p_actor_id, p_actor_email, p_action, coalesce(p_outcome, 'ok'), p_target_table, p_target_id, p_fingerprint, coalesce(p_metadata, '{}'::jsonb))
  returning id
$$;

-- First row whose hash or link does not match (null = intact). Starts from
-- the oldest remaining row, so the retention purge does not break it.
create or replace function public.admin_audit_verify()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  e public.admin_access_events;
  v_prev text := null;
  v_n bigint := 0;
begin
  for e in select * from public.admin_access_events order by id loop
    if v_prev is not null and e.prev_hash is distinct from v_prev then
      return jsonb_build_object('ok', false, 'broken_at', e.id, 'reason', 'link', 'checked', v_n);
    end if;
    if e.row_hash is distinct from encode(sha256(convert_to(e.prev_hash || '|' || public.admin_access_events_content(e), 'UTF8')), 'hex') then
      return jsonb_build_object('ok', false, 'broken_at', e.id, 'reason', 'content', 'checked', v_n);
    end if;
    v_prev := e.row_hash; v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'checked', v_n);
end $$;

create or replace function public.admin_audit_purge()
returns integer language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare v_n integer;
begin
  perform set_config('welcomebnb.admin_audit_purge', 'on', true);
  delete from public.admin_access_events where occurred_at < now() - interval '2 years';
  get diagnostics v_n = row_count;
  perform set_config('welcomebnb.admin_audit_purge', 'off', true);
  return v_n;
end $$;

-- «View as host» in admin.html writes admin_impersonation_log from the
-- browser; mirror it into the journal.
create or replace function public.admin_impersonation_audit() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.admin_access_events (actor_id, actor_email, action, outcome, target_table, target_id, metadata)
  values (new.admin_id, new.admin_email, 'impersonation_view', 'ok', 'properties', new.property_id::text,
          jsonb_build_object('source', 'admin_impersonation_log', 'mode', left(coalesce(new.action, ''), 40)));
  return new;
end $$;
do $$ begin
  if to_regclass('public.admin_impersonation_log') is not null then
    execute 'drop trigger if exists admin_impersonation_audit on public.admin_impersonation_log';
    execute 'create trigger admin_impersonation_audit after insert on public.admin_impersonation_log for each row execute function public.admin_impersonation_audit()';
  end if;
end $$;

alter table public.admin_access_events enable row level security;
revoke all on public.admin_access_events from public, anon, authenticated, service_role;
grant select on public.admin_access_events to service_role;
grant insert (actor_id, actor_email, action, outcome, target_table, target_id, request_fingerprint, metadata) on public.admin_access_events to service_role;
revoke all on function public.admin_audit_record(uuid, text, text, text, text, text, text, jsonb), public.admin_audit_verify(), public.admin_audit_purge(),
  public.admin_access_events_guard(), public.admin_access_events_chain(), public.admin_impersonation_audit(),
  public.admin_access_events_content(public.admin_access_events) from public, anon, authenticated;
grant execute on function public.admin_audit_record(uuid, text, text, text, text, text, text, jsonb), public.admin_audit_verify(),
  public.admin_access_events_content(public.admin_access_events), public.admin_access_events_chain() to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('welcomebnb_admin_audit_purge') where exists (select 1 from cron.job where jobname = 'welcomebnb_admin_audit_purge');
    perform cron.schedule('welcomebnb_admin_audit_purge', '50 2 * * *', 'select public.admin_audit_purge()');
  end if;
end $$;
