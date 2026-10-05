-- migration_round49_autofile.sql
--
-- Round 49 Phase 2 — data model for the automatic Alloggiati Web
-- filer. Pure schema change: adds columns, a filing-log audit table
-- with no-UPDATE/no-DELETE enforcement, a SECURITY DEFINER row-
-- claimer, and widens the Round 48 Phase 4 lock trigger to treat
-- the new `'filing'` state like `'filed'` for personal fields.
--
-- Shipping order matters: this migration lands FIRST (Phase 2), the
-- api/alloggiati.js `autofile_tick` action lands next (Phase 3) and
-- only begins creating `'filing'` rows after the lock-trigger widening
-- here is live. The guest gateway's `checkin_update` filter is
-- tightened in the same PR as this migration so the brief overlap
-- window — tick landed but guest client still filters only `neq.filed`
-- — cannot let a guest edit a `'filing'` row.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. properties — autofile mode + consent audit
-- ─────────────────────────────────────────────────────────────────────────
alter table public.properties
  add column if not exists alloggiati_autofile_mode text not null default 'off',
  add column if not exists alloggiati_autofile_consent_at timestamptz,
  add column if not exists alloggiati_autofile_consent_by uuid;

-- Mode CHECK deliberately named so Round 50+ can find it (same
-- lesson as api_usage_endpoint_check in Round 48).
alter table public.properties
  drop constraint if exists properties_alloggiati_autofile_mode_check;
alter table public.properties
  add constraint properties_alloggiati_autofile_mode_check
  check (alloggiati_autofile_mode in ('off','dry_run','live'));

comment on column public.properties.alloggiati_autofile_mode is
  'Round 49: off | dry_run | live. live mode files to the portal on behalf of the host; dry_run runs SOAP Test only and sends a daily digest.';
comment on column public.properties.alloggiati_autofile_consent_at is
  'Timestamp of the host flipping alloggiati_autofile_mode to ''live''. Required before any live filing.';
comment on column public.properties.alloggiati_autofile_consent_by is
  'auth.uid() of the host who granted autofile consent — kept as an audit trail.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. checkins — per-row autofile state
-- ─────────────────────────────────────────────────────────────────────────
-- The Round 48 Phase 4 lock trigger already protects filed rows from
-- edit. Phase 2 of Round 49 adds 'filing' as a transient claim state
-- and five tracking columns. All are opt-in: default values preserve
-- existing behaviour on untouched rows.
alter table public.checkins
  add column if not exists autofile_attempts int not null default 0,
  add column if not exists autofile_last_attempt_at timestamptz,
  add column if not exists autofile_last_error text,
  add column if not exists autofile_claimed_at timestamptz,
  add column if not exists autofile_excluded boolean not null default false;

comment on column public.checkins.autofile_attempts is
  'Round 49: how many times the autofile tick has tried to file this row. Reset to 0 only when the row flips to ''filed''.';
comment on column public.checkins.autofile_last_attempt_at is
  'Last tick (success OR fail OR dry-run) that touched this row.';
comment on column public.checkins.autofile_last_error is
  'Shortest meaningful tag for the latest tick failure: group_already_filed | past_portal_window | portal_<code> | network | validation_<field>.';
comment on column public.checkins.autofile_claimed_at is
  'When claim_autofile_rows() flipped alloggiati_status to ''filing'' for this row. Stale claims (>20 min) are reset on the next tick.';
comment on column public.checkins.autofile_excluded is
  'Host flipped "Non inviare" on this row (no-show, duplicate, etc.). The autofile tick skips excluded rows; the manual Send action still files them.';

-- No CHECK on alloggiati_status in the live schema today (verified
-- 2026-10-05), so there is nothing to loosen for 'filing' — it's a
-- free-text column. If a future round adds a CHECK, remember to
-- include 'filing' alongside 'pending', 'filed' and 'correction'.

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Widen the Round 48 lock trigger to cover 'filing'
-- ─────────────────────────────────────────────────────────────────────────
-- `'filing'` means "claimed by the autofile tick; a SOAP Send is in
-- flight". Guest or host writes to identity/document/stay fields must
-- NOT race the in-flight send — same guarantee the Phase 4 trigger
-- already provides for 'filed'.
--
-- Transitions allowed by the trigger:
--   pending  → filing        (claim_autofile_rows)
--   filing   → filed          (SOAP success)
--   filing   → pending        (SOAP failure / stale-claim reset)
--   filing   → correction     (host unlock, same path as filed → correction)
-- The trigger only raises when BOTH old and new are in {'filed','filing'}
-- and a protected column changed.
create or replace function public.checkins_prevent_filed_edit()
returns trigger
language plpgsql
as $$
declare
  changed boolean := false;
  old_locked boolean;
  new_locked boolean;
begin
  old_locked := old.alloggiati_status in ('filed', 'filing');
  new_locked := new.alloggiati_status in ('filed', 'filing');
  if not old_locked then return new; end if;
  if not new_locked then return new; end if;

  changed := (
       new.surname         is distinct from old.surname
    or new.name            is distinct from old.name
    or new.sex             is distinct from old.sex
    or new.date_of_birth   is distinct from old.date_of_birth
    or new.place_of_birth  is distinct from old.place_of_birth
    or new.birth_province  is distinct from old.birth_province
    or new.birth_country   is distinct from old.birth_country
    or new.citizenship     is distinct from old.citizenship
    or new.document_type   is distinct from old.document_type
    or new.document_number is distinct from old.document_number
    or new.doc_issue_place is distinct from old.doc_issue_place
    or new.arrival_date    is distinct from old.arrival_date
    or new.departure_date  is distinct from old.departure_date
    or new.nights          is distinct from old.nights
    or new.guest_type      is distinct from old.guest_type
  );

  if changed then
    raise exception 'checkin_locked_filed'
      using hint = 'This row is in state ' || old.alloggiati_status
                 || '. Unlock it for correction before editing identity, document or stay fields.',
            errcode = 'P0001';
  end if;

  return new;
end
$$;
-- Trigger `checkins_filed_edit_guard` from Round 48 Phase 4 picks up
-- the new function body automatically (CREATE OR REPLACE keeps the
-- same oid). No DROP TRIGGER needed, which also sidesteps the
-- pgrst_drop_watch hang Round 48 bumped into.

-- ─────────────────────────────────────────────────────────────────────────
-- 4. alloggiati_filing_log — immutable audit
-- ─────────────────────────────────────────────────────────────────────────
-- Required by Round 44 before any live filing. One row per attempt
-- (manual OR autofile OR autofile_dry_run), covering both success and
-- failure. The point of making it immutable is that a host disputing a
-- filing can produce the receipt + the exact row set + the time, and
-- nobody (not even the gateway) could have retroactively rewritten it.
create table if not exists public.alloggiati_filing_log (
  id          uuid        primary key default gen_random_uuid(),
  property_id uuid        not null references public.properties(id) on delete cascade,
  run_at      timestamptz not null default now(),
  trigger     text        not null,
  checkin_ids uuid[]      not null,
  outcome     text        not null,
  error_code  text,
  error_detail text,
  receipt_path text,
  actor       uuid
);

alter table public.alloggiati_filing_log
  drop constraint if exists alloggiati_filing_log_trigger_check;
alter table public.alloggiati_filing_log
  add constraint alloggiati_filing_log_trigger_check
  check (trigger in ('host','autofile','autofile_dry_run'));

create index if not exists alloggiati_filing_log_property_run_at_idx
  on public.alloggiati_filing_log (property_id, run_at desc);

alter table public.alloggiati_filing_log enable row level security;

-- Hosts read their own property's log; admins read everything.
drop policy if exists alloggiati_filing_log_host_read on public.alloggiati_filing_log;
create policy alloggiati_filing_log_host_read
  on public.alloggiati_filing_log
  for select
  to authenticated
  using (
    is_admin()
    or exists (
      select 1 from public.properties p
      where p.id = alloggiati_filing_log.property_id
        and p.owner_id = auth.uid()
    )
  );

-- NO insert policy for authenticated/anon — inserts flow through the
-- SECURITY DEFINER `log_alloggiati_filing` function (granted to the
-- service_role only).
-- NO update, delete or truncate policy for anyone, service_role
-- included. Even if a future RLS mistake re-exposed the table, the
-- grants below ensure nothing can modify a row post-insert.
revoke update, delete, truncate on public.alloggiati_filing_log from authenticated;
revoke update, delete, truncate on public.alloggiati_filing_log from anon;
revoke update, delete, truncate on public.alloggiati_filing_log from service_role;
revoke update, delete, truncate on public.alloggiati_filing_log from public;

-- service_role still needs INSERT + SELECT (so it can call the
-- SECURITY DEFINER function and read-back for the host console);
-- authenticated needs SELECT because the policy above gates by
-- property ownership.
grant select         on public.alloggiati_filing_log to authenticated;
grant select, insert on public.alloggiati_filing_log to service_role;

comment on table public.alloggiati_filing_log is
  'Round 49: immutable audit of every Alloggiati filing attempt (manual, autofile, autofile_dry_run). No UPDATE/DELETE policy by design — the only writer is log_alloggiati_filing() under the service role.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. log_alloggiati_filing — the only writer
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.log_alloggiati_filing(
  p_property_id  uuid,
  p_trigger      text,
  p_checkin_ids  uuid[],
  p_outcome      text,
  p_error_code   text default null,
  p_error_detail text default null,
  p_receipt_path text default null,
  p_actor        uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if p_property_id is null then raise exception 'property_id required'; end if;
  if p_trigger not in ('host','autofile','autofile_dry_run') then
    raise exception 'invalid trigger: %', p_trigger;
  end if;
  if p_checkin_ids is null or cardinality(p_checkin_ids) = 0 then
    raise exception 'checkin_ids required';
  end if;
  if p_outcome is null or length(p_outcome) = 0 then
    raise exception 'outcome required';
  end if;

  insert into public.alloggiati_filing_log
    (property_id, trigger, checkin_ids, outcome, error_code, error_detail, receipt_path, actor)
  values
    (p_property_id, p_trigger, p_checkin_ids, p_outcome, p_error_code, p_error_detail, p_receipt_path, p_actor)
  returning id into new_id;

  return new_id;
end
$$;

revoke execute on function public.log_alloggiati_filing(uuid, text, uuid[], text, text, text, text, uuid) from public, anon, authenticated;
grant   execute on function public.log_alloggiati_filing(uuid, text, uuid[], text, text, text, text, uuid) to service_role;

comment on function public.log_alloggiati_filing is
  'Round 49: SECURITY DEFINER insert into alloggiati_filing_log. The only writer — the table''s RLS has no insert policy. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. claim_autofile_rows — atomic claim
-- ─────────────────────────────────────────────────────────────────────────
-- Two things happen in one call so overlapping ticks (an earlier tick
-- that didn't finish in 10 min + the next tick) can't double-claim:
--
--   (a) Reset stale claims: `'filing'` rows whose autofile_claimed_at is
--       older than 20 min flip back to `'pending'`. Autofile ticks
--       typically run under 60 s per property; 20 min is forgiving
--       enough that even an unlucky SOAP timeout cascade can clear
--       itself without a human.
--   (b) Claim the requested id set: flip qualifying rows to
--       `'filing'` and return their ids. The RETURNING clause only
--       sees the rows the UPDATE actually touched — i.e., the rows
--       that passed the WHERE filter. Rows already filed, excluded,
--       deleted, or belonging to another property get silently
--       skipped and the caller treats "I asked for 5 ids but got 3
--       back" as "the other 2 are no longer candidates".
create or replace function public.claim_autofile_rows(
  p_property uuid,
  p_ids      uuid[]
) returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  -- (a) Reset stale claims across the whole table. Cheap because
  -- autofile_claimed_at has very few non-null rows and the status
  -- filter is a single partial match. Keep this update narrow so it
  -- doesn't accidentally touch rows the tick is actively claiming.
  update public.checkins
     set alloggiati_status = 'pending',
         autofile_claimed_at = null,
         autofile_last_error = coalesce(autofile_last_error, 'stale_claim_reset')
   where alloggiati_status = 'filing'
     and autofile_claimed_at is not null
     and autofile_claimed_at < now() - interval '20 minutes';

  -- (b) Claim.
  return query
    update public.checkins
       set alloggiati_status = 'filing',
           autofile_claimed_at = now()
     where id = any (p_ids)
       and property_id = p_property
       and coalesce(alloggiati_status, 'pending') not in ('filed','filing')
       and not autofile_excluded
       and deleted_at is null
    returning id;
end
$$;

revoke execute on function public.claim_autofile_rows(uuid, uuid[]) from public, anon, authenticated;
grant   execute on function public.claim_autofile_rows(uuid, uuid[]) to service_role;

comment on function public.claim_autofile_rows is
  'Round 49: SECURITY DEFINER atomic claim. Resets stale claims (>20 min) and flips qualifying rows to ''filing''. service_role only.';

-- ─────────────────────────────────────────────────────────────────────────
-- Verification queries (safe to re-run in the SQL editor)
-- ─────────────────────────────────────────────────────────────────────────
-- select column_name, column_default, is_nullable, data_type
--   from information_schema.columns
--   where table_schema='public' and table_name='properties'
--     and column_name like 'alloggiati_autofile_%';
-- select column_name, column_default from information_schema.columns
--   where table_schema='public' and table_name='checkins'
--     and column_name like 'autofile_%';
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid='public.alloggiati_filing_log'::regclass or conname='properties_alloggiati_autofile_mode_check';
-- select grantee, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='alloggiati_filing_log'
--   group by grantee order by grantee;
-- Live tests:
-- select public.claim_autofile_rows('<property>'::uuid, array[]::uuid[]);  -- empty set
-- select public.log_alloggiati_filing('<property>'::uuid, 'host', array['<row>'::uuid], 'test', null, null, null, null);
