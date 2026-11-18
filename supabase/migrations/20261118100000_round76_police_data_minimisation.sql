-- Round 76 Phase 2 — police data minimised after filing.
--
-- DM Interno 7/1/2013 as amended 16/9/2021, art. 4-bis c.2: the structure
-- deletes the data transmitted to Alloggiati as soon as the receipt exists;
-- only the receipt is kept (5 years). Garante, 29/4/2026: no document copies.
-- Annex B of the host agreement (legal/ALLEGATO_A_DPA_v1.md):
--   document photos / selfie  deleted as soon as the filing is recorded
--                             (filed_at or status filed);
--   identity fields           document type, number and issuing place; place,
--                             province and state of birth; full date of birth
--                             (the birth year is kept for statistics and the
--                             exact age at arrival for tourist-tax exemptions) —
--                             erased 24 h after filing (time to correct a
--                             same-day error), or, where the property must also
--                             send regional statistics with the same record,
--                             at the end of the month after departure.
--   kept                      names, sex, citizenship, residence, stay dates,
--                             filing status, receipts (Phase 3 sets their limits).
--
-- minimise_filed_checkins(p_dry_run) is the only path allowed to clear those
-- fields on a filed row: it sets welcomebnb.identity_minimise for its own
-- transaction, which checkins_prevent_filed_edit accepts only for clearing.
-- Hourly pg_cron job welcomebnb_police_minimise. service_role only.
-- Re-runnable. Rollback: select cron.unschedule('welcomebnb_police_minimise');
--   drop function public.minimise_filed_checkins(boolean), public.checkins_identity_due(public.checkins, text);
--   (restore the Round 75 checkins_prevent_filed_edit body; the dropped NOT NULLs can stay).

alter table public.checkins alter column document_type drop not null;
alter table public.checkins alter column document_number drop not null;
alter table public.checkins alter column place_of_birth drop not null;
alter table public.checkins alter column date_of_birth drop not null;
alter table public.checkins add column if not exists birth_year smallint check (birth_year is null or birth_year between 1880 and 2100);
alter table public.checkins add column if not exists age_at_arrival smallint check (age_at_arrival is null or age_at_arrival between 0 and 130);
alter table public.checkins add column if not exists identity_erased_at timestamptz;
comment on column public.checkins.identity_erased_at is
  'Round 76: when the identity fields of a filed row were erased by law (DM 7/1/2013 art. 4-bis). Names, sex, citizenship, residence, birth_year and age_at_arrival remain.';

-- Regions whose statistics export uses the per-guest record (lib/regional-exports.js).
create or replace function public.checkins_identity_due(c public.checkins, p_region text)
returns timestamptz language sql immutable set search_path = pg_catalog as $$
  select case
    when c.filed_at is null and coalesce(c.alloggiati_status, '') <> 'filed' then null
    when p_region in ('Abruzzo','Basilicata','Calabria','Emilia-Romagna','Lazio','Liguria','Lombardia','Marche','Molise','Piemonte',
                      'Sardegna','Veneto','Campania','Friuli-Venezia Giulia','Puglia','Sicilia','Toscana','Trentino','Alto Adige','Umbria','Valle d''Aosta')
      then greatest(coalesce(c.filed_at, c.submitted_at, c.created_at) + interval '24 hours',
                    (date_trunc('month', coalesce(c.departure_date, c.arrival_date, (coalesce(c.filed_at, c.created_at))::date)::timestamp) + interval '2 months') at time zone 'Europe/Rome')
    else coalesce(c.filed_at, c.submitted_at, c.created_at) + interval '24 hours'
  end
$$;

-- The filed-edit lock (Rounds 48/49/75) with one exception: the minimisation
-- step may set the identity fields to NULL.
create or replace function public.checkins_prevent_filed_edit()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  changed boolean := false;
  old_locked boolean;
  new_locked boolean;
begin
  old_locked := old.alloggiati_status in ('filed', 'filing');
  new_locked := new.alloggiati_status in ('filed', 'filing');
  if not old_locked then return new; end if;
  if not new_locked then return new; end if;

  if current_setting('welcomebnb.identity_minimise', true) = 'on'
     and new.document_type is null and new.document_number is null and new.doc_issue_place is null
     and new.place_of_birth is null and new.province_of_birth is null and new.state_of_birth is null
     and new.birth_province is null and new.birth_country is null and new.date_of_birth is null
     and new.surname is not distinct from old.surname and new.name is not distinct from old.name
     and new.sex is not distinct from old.sex and new.citizenship is not distinct from old.citizenship
     and new.arrival_date is not distinct from old.arrival_date and new.departure_date is not distinct from old.departure_date
     and new.nights is not distinct from old.nights and new.guest_type is not distinct from old.guest_type then
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

create or replace function public.minimise_filed_checkins(p_dry_run boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_photos integer;
  v_identity integer;
begin
  -- Photos: as soon as the filing is recorded.
  select count(*) into v_photos from public.checkins c
   where (c.filed_at is not null or c.alloggiati_status = 'filed') and (c.id_photo_path is not null or c.selfie_photo_path is not null);
  -- Identity: when due.
  select count(*) into v_identity from public.checkins c join public.properties p on p.id = c.property_id
   where c.identity_erased_at is null and public.checkins_identity_due(c, p.region) <= now();

  if not p_dry_run then
    insert into public.storage_purge_queue (bucket, path, reason)
    select 'documents', x.path, 'filed_minimised' from (
      select c.id_photo_path path from public.checkins c where (c.filed_at is not null or c.alloggiati_status = 'filed') and c.id_photo_path is not null
      union
      select c.selfie_photo_path from public.checkins c where (c.filed_at is not null or c.alloggiati_status = 'filed') and c.selfie_photo_path is not null) x
    on conflict (bucket, path) do nothing;
    update public.checkins set id_photo_path = null, selfie_photo_path = null
     where (filed_at is not null or alloggiati_status = 'filed') and (id_photo_path is not null or selfie_photo_path is not null);

    perform set_config('welcomebnb.identity_minimise', 'on', true);
    update public.checkins c set
      birth_year = coalesce(c.birth_year, extract(year from c.date_of_birth)::smallint),
      age_at_arrival = coalesce(c.age_at_arrival, case when c.date_of_birth is not null and c.arrival_date is not null then extract(year from age(c.arrival_date, c.date_of_birth))::smallint end),
      document_type = null, document_number = null, doc_issue_place = null,
      place_of_birth = null, province_of_birth = null, state_of_birth = null,
      birth_province = null, birth_country = null, date_of_birth = null,
      identity_erased_at = now()
     from public.properties p
     where p.id = c.property_id and c.identity_erased_at is null and public.checkins_identity_due(c, p.region) <= now();
    perform set_config('welcomebnb.identity_minimise', 'off', true);
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'photos', v_photos, 'identity', v_identity);
end $$;

revoke all on function public.minimise_filed_checkins(boolean), public.checkins_identity_due(public.checkins, text) from public, anon, authenticated;
grant execute on function public.minimise_filed_checkins(boolean) to service_role;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('welcomebnb_police_minimise') where exists (select 1 from cron.job where jobname = 'welcomebnb_police_minimise');
    perform cron.schedule('welcomebnb_police_minimise', '17 * * * *', 'select public.minimise_filed_checkins(false)');
  end if;
end $$;
