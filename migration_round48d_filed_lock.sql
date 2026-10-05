-- migration_round48d_filed_lock.sql
--
-- Round 48 Phase 4 — host-side lock after filing.
--
-- Full Round 48 arc:
--   • Phase 1 (#108) — DB-only policy lockdown (6 of 10 audit holes).
--   • Phase 2 (#109) — guest gateway + edit-until-filed on the guest side.
--   • Phase 3 (#110) — revoke anon access.
--   • Phase 4 (this) — host-side lock after Alloggiati filing + explicit
--                       "Unlock to correct" flow.
--
-- The guest side already enforces "filed = not editable" via the Phase 2
-- gateway's `checkin_update` conditional PATCH (alloggiati_status != 'filed').
-- The host-console does its own direct `sb.from('checkins').update()` as
-- the host, and that path has been able to edit filed rows freely. This
-- migration moves the enforcement from "a filter on the client's PATCH" to
-- a BEFORE UPDATE trigger on the table itself, so the lock applies to
-- every writer — including the service role used by the gateway's own
-- fan-out writes and by api/alloggiati.js.
--
-- The host-console gets a two-step flow: a filed guest's modal opens
-- read-only with an "Unlock to correct" button that flips
-- alloggiati_status to 'correction' (with a required reason + stamp of
-- who did it and when) BEFORE any sensitive field is edited. The 'correction'
-- state is "filed once, needs re-filing after an on-paper correction" —
-- it reads as not-filed to every filter in the codebase that already uses
-- `alloggiati_status != 'filed'` (verified via grep: lines 7080-7081 in
-- host-console use `=== 'filed'` for the strict all-filed badge; everything
-- else uses `!= 'filed'` and already handles 'correction' as not-filed).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Columns
-- ─────────────────────────────────────────────────────────────────────────
-- `guest_edited_at` is also referenced by the Phase 2 gateway's
-- checkin_update action, which has been writing to a column that didn't
-- exist (silently becomes a no-op). This migration finally adds it.
alter table public.checkins
  add column if not exists guest_edited_at timestamptz,
  add column if not exists unlocked_at     timestamptz,
  add column if not exists unlocked_by     uuid,
  add column if not exists unlock_reason   text;

comment on column public.checkins.guest_edited_at is
  'When a guest last edited this row via /api/guest checkin_update. The host console surfaces this so a host who already downloaded a .txt knows to regenerate.';
comment on column public.checkins.unlocked_at is
  'When a host last used "Unlock to correct" on this row (filed → correction).';
comment on column public.checkins.unlocked_by is
  'auth.uid() of the host who performed the unlock.';
comment on column public.checkins.unlock_reason is
  'Short free-text reason captured at unlock time, kept as an audit trail.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BEFORE UPDATE trigger — the actual lock
-- ─────────────────────────────────────────────────────────────────────────
-- Raises `checkin_locked_filed` when:
--   OLD.alloggiati_status = 'filed'
--   AND NEW.alloggiati_status = 'filed'      -- so the unlock path (which
--                                            -- sets NEW to 'correction')
--                                            -- stays allowed
--   AND any guest-identity / document / stay column actually changed
--
-- Status + housekeeping columns (filed_at, receipt_path, deleted_at,
-- filing_reminder_sent_at, checkin_reopened_at, keybox_code,
-- tax_declared_flags, docs_status, puglia_dms_status) stay writable — the
-- host can continue to attach a late receipt, mark a row deleted, etc.
--
-- The trigger applies to the service role too: that's the point. The
-- gateway's own `checkin_update` action already filters by neq.filed, so
-- the trigger is a belt-and-braces redundancy there. For api/alloggiati.js
-- send-stamping, the trigger does not fire because the transition is
-- 'pending'|'correction' → 'filed' (OLD != 'filed').
create or replace function public.checkins_prevent_filed_edit()
returns trigger
language plpgsql
as $$
declare
  changed boolean := false;
begin
  if old.alloggiati_status is distinct from 'filed' then
    return new;
  end if;
  if new.alloggiati_status is distinct from 'filed' then
    -- Explicit flip to another status (e.g. 'correction' via the unlock
    -- flow). Let it through; the field edits still have to pass whatever
    -- validation the client applies.
    return new;
  end if;

  -- Both OLD and NEW are 'filed'. Only block if a sensitive column changed.
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
      using
        hint    = 'This row was already filed on Alloggiati. Unlock it for correction before editing identity, document or stay fields.',
        errcode = 'P0001';
  end if;

  return new;
end
$$;

-- The DROP IF EXISTS hangs on this project behind the same pgrst_drop_watch
-- quirk that bit Phase 1 and Phase 3 (observed: 60s+ timeout on
-- `drop trigger if exists checkins_filed_edit_guard on public.checkins`).
-- Skipped on first apply (nothing to drop), re-apply guidance is to run
-- `drop trigger` by hand in the SQL editor if it ever needs re-creating
-- and wait it out — or just rename the trigger.
create trigger checkins_filed_edit_guard
  before update on public.checkins
  for each row
  execute function public.checkins_prevent_filed_edit();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Verification (safe to run in the SQL editor afterwards)
-- ─────────────────────────────────────────────────────────────────────────
-- -- All 4 columns present:
-- select column_name, data_type from information_schema.columns
--   where table_schema='public' and table_name='checkins'
--     and column_name in ('guest_edited_at','unlocked_at','unlocked_by','unlock_reason');
--
-- -- Trigger attached:
-- select trigger_name, action_timing, event_manipulation
--   from information_schema.triggers
--   where event_object_schema='public' and event_object_table='checkins'
--     and trigger_name='checkins_filed_edit_guard';
--
-- -- Live test (run against a filed row id, as the service role):
-- update public.checkins set surname='X' where id = '<some filed id>';
-- -- → ERROR: checkin_locked_filed
--
-- update public.checkins set filed_at = filed_at where id = '<some filed id>';
-- -- → 0 rows affected or 1 row affected, no error (metadata-only write).
--
-- update public.checkins
--   set alloggiati_status='correction', unlocked_at=now(), unlock_reason='test'
--   where id = '<some filed id>';
-- update public.checkins set surname='X' where id = '<same id>';
-- -- → succeeds (OLD.alloggiati_status is now 'correction', not 'filed').
