-- Round 76 Phase 3 — the other retention limits of Annex B, as one scheduled purge.
--
-- Annex B of the host agreement (legal/ALLEGATO_A_DPA_v1.md, section 9):
--   receipts and filing log           5 years from filing             (DM 7/1/2013 art. 4-bis)
--   statistics fields                 end of the 12th month after the stay: sex,
--     (and any identity left)         birth year, citizenship, residence; identity
--                                     fields and photos of rows never filed too
--   tourist-tax record                5 years after the end of the tax year (the
--                                     check-in row is deleted; rows whose guest asked
--                                     for an invoice stay 10 years from the stay)
--   reservations                      10 years from check-out
--   reservation e-mail and phone      12 months from check-out
--   marketing consents                24 months from the stay; withdrawals 24 months
--   guest chat                        12 months from the stay (anonymised Q&A kept)
--   door-access audit                 12 months (the whole entry booking goes)
--   host notification log             12 months
--   closed host accounts              10 years after the account is gone
--   (admin audit: 2 years, Round 67 job; analytics: 180 days, daily purge)
--
-- retention_purge(p_dry_run) counts (dry run) or applies every rule and
-- returns the counts as jsonb. It runs inside the existing daily purge
-- (purge_old_data_cron, 02:00) with the same preview/live switch, and its
-- counts are stored in data_purge_log.legal; purge_old_data_admin(true)
-- previews it in the admin Ops «Run preview».
--
-- Guards keep refusing everything else. The only exception is the
-- transaction-local flag welcomebnb.retention_purge, set by this function
-- alone: filed check-ins may then be deleted or have statistics fields
-- cleared, host-terms evidence of a closed account may be deleted.
-- Old receipts go through storage_purge_queue as bucket 'receipts' with
-- reason 'receipt_5y' only.
--
-- The old 90-day deletion of resolved chats contradicted Annex B (12 months
-- from the stay); purge_old_data now uses 365 days and this purge applies
-- the stay-based rule.
--
-- Re-runnable. service_role only. Rollback: restore purge_old_data_cron /
-- purge_old_data_admin from Round 12, drop public.retention_purge(boolean),
-- restore the previous guard bodies (Rounds 69, 76 Phase 2, 14 Nov hotfix).

alter table public.checkins alter column sex drop not null;
alter table public.checkins alter column citizenship drop not null;
alter table public.checkins add column if not exists statistics_erased_at timestamptz;
comment on column public.checkins.statistics_erased_at is
  'Round 76: statistics fields (sex, birth year, citizenship, residence) erased at the end of the 12th month after the stay (Annex B).';

alter table public.data_purge_log add column if not exists legal jsonb;

-- Old receipts may be queued for deletion, nothing else outside 'documents'.
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.storage_purge_queue'::regclass and contype = 'c' loop
    execute format('alter table public.storage_purge_queue drop constraint %I', c);
  end loop;
end $$;
alter table public.storage_purge_queue add constraint storage_purge_queue_bucket_check
  check (bucket = 'documents' or (bucket = 'receipts' and reason = 'receipt_5y'));

-- Filed-edit lock: the Phase 2 minimisation exception, plus the retention
-- step, which may also clear sex and citizenship. Names, stay dates, nights
-- and guest type never change.
create or replace function public.checkins_prevent_filed_edit()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  changed boolean := false;
  old_locked boolean;
  new_locked boolean;
  minimise boolean := current_setting('welcomebnb.identity_minimise', true) = 'on';
  retention boolean := current_setting('welcomebnb.retention_purge', true) = 'on';
begin
  old_locked := old.alloggiati_status in ('filed', 'filing');
  new_locked := new.alloggiati_status in ('filed', 'filing');
  if not old_locked then return new; end if;
  if not new_locked then return new; end if;

  if (minimise or retention)
     and new.document_type is null and new.document_number is null and new.doc_issue_place is null
     and new.place_of_birth is null and new.province_of_birth is null and new.state_of_birth is null
     and new.birth_province is null and new.birth_country is null and new.date_of_birth is null
     and new.surname is not distinct from old.surname and new.name is not distinct from old.name
     and new.arrival_date is not distinct from old.arrival_date and new.departure_date is not distinct from old.departure_date
     and new.nights is not distinct from old.nights and new.guest_type is not distinct from old.guest_type
     and ((new.sex is not distinct from old.sex and new.citizenship is not distinct from old.citizenship)
          or (retention and new.sex is null and new.citizenship is null)) then
    return new;
  end if;

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

-- 14 Nov hotfix guard: a filed check-in may be deleted only by the retention
-- step (its tax and receipt periods are over).
create or replace function public.checkins_protect_filed()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if session_user in ('postgres', 'supabase_admin')
     and coalesce(current_setting('request.jwt.claims', true), '') = '' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' and current_setting('welcomebnb.retention_purge', true) = 'on' then
    return old;
  end if;
  if coalesce(old.is_test, false) is true
     or (old.filed_at is null and coalesce(old.alloggiati_status, '') <> 'filed') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'checkin_filed_retained: a check-in filed to Alloggiati cannot be deleted'
      using errcode = 'P0001';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    raise exception 'checkin_filed_retained: a check-in filed to Alloggiati cannot be moved to the trash'
      using errcode = 'P0001';
  end if;
  if old.filed_at is not null and new.filed_at is null then
    raise exception 'checkin_filed_retained: the filing date of a filed check-in cannot be cleared'
      using errcode = 'P0001';
  end if;
  if coalesce(new.is_test, false) is true then
    raise exception 'checkin_filed_retained: a filed check-in cannot become a test record'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.checkins_protect_filed() from public;

-- Round 69 evidence guard: still append-only; rows of a closed account may
-- be deleted by the retention step only (10 years after closure).
create or replace function public.host_terms_acceptances_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if old.receipt_email_id is null and new.receipt_email_id is not null
       and (to_jsonb(new) - 'receipt_email_id') = (to_jsonb(old) - 'receipt_email_id') then
      return new;
    end if;
  end if;
  if tg_op = 'DELETE' and current_setting('welcomebnb.retention_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'host_terms_acceptances is append-only' using errcode = '42501';
end $$;

create or replace function public.retention_purge(p_dry_run boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_today date := (now() at time zone 'Europe/Rome')::date;
  r jsonb := jsonb_build_object('dry_run', p_dry_run);
  n integer;
begin
  -- Rows past each limit, in the order they are applied.
  create temp table if not exists _rp_receipts(id uuid) on commit drop;
  create temp table if not exists _rp_stats(id uuid) on commit drop;
  create temp table if not exists _rp_tax(id uuid) on commit drop;
  create temp table if not exists _rp_chat(property_id uuid, booking_code text) on commit drop;
  create temp table if not exists _rp_hosts(id uuid) on commit drop;
  truncate _rp_receipts, _rp_stats, _rp_tax, _rp_chat, _rp_hosts;

  -- 1. Alloggiati receipts and filing log: 5 years from filing.
  insert into _rp_receipts select c.id from public.checkins c
   where c.receipt_path is not null and coalesce(c.filed_at, c.submitted_at, c.created_at) <= now() - interval '5 years';
  r := r || jsonb_build_object('receipts', (select count(*) from _rp_receipts),
    'filing_log', (select count(*) from public.alloggiati_filing_log where run_at <= now() - interval '5 years'));

  -- 2. Statistics fields (and any identity left): end of the 12th month after the stay.
  insert into _rp_stats select c.id from public.checkins c
   where c.statistics_erased_at is null
     and now() >= (date_trunc('month', coalesce(c.departure_date, c.arrival_date, c.created_at::date)::timestamp) + interval '13 months') at time zone 'Europe/Rome';
  r := r || jsonb_build_object('statistics', (select count(*) from _rp_stats));

  -- 3. Tourist-tax record: 5 years after the end of the tax year; with invoice
  --    data, 10 years from the stay. A receipt still inside its 5 years keeps the row.
  insert into _rp_tax select c.id from public.checkins c
   where (c.receipt_path is null or coalesce(c.filed_at, c.submitted_at, c.created_at) <= now() - interval '5 years')
     and ((coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is null
            and v_today >= make_date(extract(year from coalesce(c.arrival_date, c.departure_date, c.created_at::date))::int + 6, 1, 1))
      or (coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is not null
            and v_today >= (coalesce(c.departure_date, c.arrival_date, c.created_at::date) + interval '10 years')::date));
  r := r || jsonb_build_object(
    'tax_records', (select count(*) from _rp_tax t join public.checkins c on c.id = t.id where coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is null),
    'invoice_records', (select count(*) from _rp_tax t join public.checkins c on c.id = t.id where coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is not null));

  -- 4. Reservation e-mail and phone: 12 months from check-out. Reservations: 10 years.
  r := r || jsonb_build_object(
    'contacts', (select count(*) from public.ota_reservations o
      where coalesce(o.checkout_date, o.checkin_date, o.created_at::date) + interval '12 months' <= v_today
        and (o.contact_email is not null or o.contact_phone is not null or o.phone_last4 is not null or coalesce(o.raw, '{}'::jsonb) ? 'description')),
    'reservations', (select count(*) from public.ota_reservations o
      where coalesce(o.checkout_date, o.checkin_date, o.created_at::date) + interval '10 years' <= v_today),
    'dismissed', (select count(*) from public.host_dismissed_bookings where dismissed_at <= now() - interval '10 years'));

  -- 5. Marketing: 24 months from the stay; withdrawals kept 24 months as proof.
  r := r || jsonb_build_object('marketing', (select count(*) from public.marketing_consents m
    where (m.withdrawn_at is not null and m.withdrawn_at <= now() - interval '24 months')
       or (m.withdrawn_at is null and coalesce(
            (select max(o.checkout_date) from public.ota_reservations o where o.property_id = m.property_id and o.booking_code = m.booking_code),
            (coalesce(m.consent_given_at, m.created_at) at time zone 'Europe/Rome')::date) + interval '24 months' <= v_today)));

  -- 6. Guest chat: 12 months from the stay, and no message in the last 12 months.
  insert into _rp_chat
    select x.property_id, x.booking_code from (
      select m.property_id, m.booking_code, max(m.created_at) last_at from public.chat_messages m group by 1, 2) x
     where x.last_at <= now() - interval '12 months'
       and coalesce((select max(o.checkout_date) from public.ota_reservations o where o.property_id = x.property_id and o.booking_code = x.booking_code),
                    (x.last_at at time zone 'Europe/Rome')::date) + interval '12 months' <= v_today;
  r := r || jsonb_build_object('chat', (select count(*) from public.chat_messages m join _rp_chat d
    on d.property_id = m.property_id and d.booking_code is not distinct from m.booking_code));

  -- 7. Door-access audit (whole entry booking) and host notification log: 12 months.
  r := r || jsonb_build_object(
    'entry', (select count(*) from entry_access.bookings b
      where coalesce(b.departure_date, b.arrival_date, b.created_at::date) + interval '12 months' <= v_today),
    'notifications', (select count(*) from public.notification_log where created_at <= now() - interval '12 months'));

  -- 8. Closed host accounts: 10 years after the account is gone (last record).
  insert into _rp_hosts select h.id from (
      select user_id id, coalesce(updated_at, created_at) at from public.host_subscriptions
      union all select user_id, created_at from public.billing_events
      union all select host_id, created_at from public.host_terms_acceptances) h
    where h.id is not null and not exists (select 1 from auth.users u where u.id = h.id)
    group by h.id having max(h.at) <= now() - interval '10 years';
  r := r || jsonb_build_object('closed_accounts', (select count(*) from _rp_hosts));

  if p_dry_run then return r; end if;

  perform set_config('welcomebnb.retention_purge', 'on', true);

  insert into public.storage_purge_queue (bucket, path, reason)
    select 'receipts', c.receipt_path, 'receipt_5y' from public.checkins c join _rp_receipts t on t.id = c.id
    union select 'receipts', l.receipt_path, 'receipt_5y' from public.alloggiati_filing_log l
     where l.run_at <= now() - interval '5 years' and l.receipt_path is not null
    on conflict (bucket, path) do nothing;
  update public.checkins c set receipt_path = null from _rp_receipts t where t.id = c.id;
  delete from public.alloggiati_filing_log where run_at <= now() - interval '5 years';

  insert into public.storage_purge_queue (bucket, path, reason)
    select 'documents', p.path, 'retention_12m' from public.checkins c join _rp_stats t on t.id = c.id
      cross join lateral unnest(array[c.id_photo_path, c.selfie_photo_path]) p(path) where p.path is not null
    on conflict (bucket, path) do nothing;
  update public.checkins c set
    id_photo_path = null, selfie_photo_path = null, keybox_code = null,
    age_at_arrival = coalesce(c.age_at_arrival, case when c.date_of_birth is not null and c.arrival_date is not null
                                then extract(year from age(c.arrival_date, c.date_of_birth))::smallint end),
    document_type = null, document_number = null, doc_issue_place = null,
    place_of_birth = null, province_of_birth = null, state_of_birth = null,
    birth_province = null, birth_country = null, date_of_birth = null,
    sex = null, birth_year = null, citizenship = null,
    residence_country = case when coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is null then null else c.residence_country end,
    residence_place = case when coalesce(c.fiscal_code, c.invoice_email, c.residence_address) is null then null else c.residence_place end,
    identity_erased_at = coalesce(c.identity_erased_at, now()), statistics_erased_at = now()
   from _rp_stats t where t.id = c.id;

  insert into public.storage_purge_queue (bucket, path, reason)
    select 'documents', p.path, 'retention_tax' from public.checkins c join _rp_tax t on t.id = c.id
      cross join lateral unnest(array[c.id_photo_path, c.selfie_photo_path]) p(path) where p.path is not null
    on conflict (bucket, path) do nothing;
  delete from public.checkins c using _rp_tax t where t.id = c.id;

  update public.ota_reservations o set contact_email = null, contact_phone = null, phone_last4 = null,
         raw = case when o.raw is null then null else o.raw - 'description' end
   where coalesce(o.checkout_date, o.checkin_date, o.created_at::date) + interval '12 months' <= v_today
     and (o.contact_email is not null or o.contact_phone is not null or o.phone_last4 is not null or coalesce(o.raw, '{}'::jsonb) ? 'description');
  delete from public.ota_reservations o where coalesce(o.checkout_date, o.checkin_date, o.created_at::date) + interval '10 years' <= v_today;
  delete from public.host_dismissed_bookings where dismissed_at <= now() - interval '10 years';

  delete from public.marketing_consents m
    where (m.withdrawn_at is not null and m.withdrawn_at <= now() - interval '24 months')
       or (m.withdrawn_at is null and coalesce(
            (select max(o.checkout_date) from public.ota_reservations o where o.property_id = m.property_id and o.booking_code = m.booking_code),
            (coalesce(m.consent_given_at, m.created_at) at time zone 'Europe/Rome')::date) + interval '24 months' <= v_today);

  delete from public.chat_messages m using _rp_chat d
   where d.property_id = m.property_id and d.booking_code is not distinct from m.booking_code;

  delete from entry_access.bookings b where coalesce(b.departure_date, b.arrival_date, b.created_at::date) + interval '12 months' <= v_today;
  delete from public.notification_log where created_at <= now() - interval '12 months';

  delete from public.host_terms_acceptances a using _rp_hosts h where a.host_id = h.id;
  delete from public.billing_events b using _rp_hosts h where b.user_id = h.id;
  delete from public.host_subscriptions s using _rp_hosts h where s.user_id = h.id;

  perform set_config('welcomebnb.retention_purge', 'off', true);
  return r;
end $$;

revoke all on function public.retention_purge(boolean) from public, anon, authenticated;
grant execute on function public.retention_purge(boolean) to service_role;

-- The daily purge runs the legal limits too, with the same preview/live switch.
create or replace function public.purge_old_data_cron()
returns public.data_purge_log language plpgsql security definer set search_path = public as $$
declare
  v_live_after timestamptz;
  v_dry_run    boolean;
  v_log        public.data_purge_log;
  v_trigger    text;
  v_orphans    integer;
  v_legal      jsonb;
begin
  select live_after into v_live_after from public.purge_settings where id = 1;
  if v_live_after is null then
    v_dry_run := true;  v_trigger := 'cron:no-settings';
  elsif now() < v_live_after then
    v_dry_run := true;  v_trigger := 'cron:soft-launch';
  else
    v_dry_run := false; v_trigger := 'cron';
  end if;

  v_log := public.purge_old_data(v_dry_run, v_trigger);
  v_orphans := public.enqueue_orphan_documents(v_dry_run);
  v_legal := public.retention_purge(v_dry_run);
  update public.data_purge_log set orphans_queued = v_orphans, legal = v_legal where id = v_log.id;
  v_log.orphans_queued := v_orphans;
  v_log.legal := v_legal;
  return v_log;
end;
$$;

create or replace function public.purge_old_data_admin(p_dry_run boolean default true)
returns public.data_purge_log language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_log public.data_purge_log;
  v_legal jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin privileges required';
  end if;
  v_email := coalesce(auth.email(), 'unknown');
  v_log := public.purge_old_data(p_dry_run, 'manual:' || v_email);
  v_legal := public.retention_purge(p_dry_run);
  update public.data_purge_log set legal = v_legal where id = v_log.id;
  v_log.legal := v_legal;
  return v_log;
end;
$$;

-- Resolved chats: 12 months (Annex B), no longer 90 days.
do $$
declare d text;
begin
  if to_regprocedure('public.purge_old_data(boolean,text)') is not null then
    d := pg_get_functiondef('public.purge_old_data(boolean,text)'::regprocedure);
    if d like '%v_chat_resolved_d  INTEGER := 90;%' then
      execute replace(d, 'v_chat_resolved_d  INTEGER := 90;', 'v_chat_resolved_d  INTEGER := 365;');
    end if;
    if pg_get_functiondef('public.purge_old_data(boolean,text)'::regprocedure) not like '%v_chat_resolved_d  INTEGER := 365;%' then
      raise exception 'purge_old_data: resolved-chat period not updated';
    end if;
  end if;
end $$;
