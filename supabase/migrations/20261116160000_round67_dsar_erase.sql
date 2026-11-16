-- Round 67 Phase 4 — data-subject requests (GDPR Art. 15/17/20): erasure.
--
-- dsar_erase(checkins, consents, reservations, chat bookings, dry_run)
--   One transaction, service_role only (called by api/_admin-dsar.js after
--   the admin check; the server finds the rows, this function only acts on
--   the IDs it is given). Erasure is a soft delete followed by the existing
--   sweeps, never an immediate hard delete:
--
--   checkins      not filed → photos queued for deletion (storage_purge_queue)
--                 and paths cleared, row soft-deleted (purge_old_data removes
--                 it after 30 days).
--                 filed to Alloggiati (status filed/filing or filed_at set, real
--                 rows; test rows are erased like any other) →
--                 RETAINED: legal obligation (TULPS art. 109; GDPR Art.
--                 17(3)(b)). Only the photos go (no legal need for them); the
--                 row stays — the checkins_filed_retained_guard refuses the
--                 rest anyway.
--   consents      marketing consent withdrawn now (if not already) and email,
--                 phone and name cleared; the dated row stays as the record
--                 that consent existed and was withdrawn.
--   reservations  contact email/phone (and phone_last4) cleared; the booking
--                 stays in the host's calendar (the host's own record).
--   chat          messages of the given bookings soft-deleted (purge after 30
--                 days).
--
--   p_dry_run (default true) counts and changes nothing.
--   Returns {dry_run, checkins_erased, checkins_retained:[{id,reason}],
--            photos_queued, consents_withdrawn, reservations_redacted,
--            chat_messages_erased}.
--
-- Re-runnable. Rollback: drop function public.dsar_erase(uuid[], uuid[], uuid[], jsonb, boolean);
create or replace function public.dsar_erase(
  p_checkin_ids uuid[], p_consent_ids uuid[], p_reservation_ids uuid[],
  p_chat_bookings jsonb, p_dry_run boolean default true)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  v_retained jsonb;
  v_erase uuid[];
  v_photos integer;
  v_consents integer;
  v_reservations integer;
  v_chat integer;
  v_bookings jsonb := coalesce(p_chat_bookings, '[]'::jsonb);
begin
  if jsonb_typeof(v_bookings) <> 'array' then
    raise exception 'dsar_erase: chat bookings must be an array' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_checkin_ids), 0) + coalesce(cardinality(p_consent_ids), 0)
     + coalesce(cardinality(p_reservation_ids), 0) + jsonb_array_length(v_bookings) > 500 then
    raise exception 'dsar_erase: too many rows for one request' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'reason', 'filed_alloggiati_legal_retention') order by c.id), '[]'::jsonb)
    into v_retained
    from public.checkins c
   where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null and not coalesce(c.is_test, false)
     and (c.filed_at is not null or c.alloggiati_status in ('filed', 'filing'));
  select coalesce(array_agg(c.id order by c.id), '{}')
    into v_erase
    from public.checkins c
   where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null
     and (coalesce(c.is_test, false) or (c.filed_at is null and coalesce(c.alloggiati_status, '') not in ('filed', 'filing')));
  select count(*) into v_photos from (
    select c.id_photo_path p from public.checkins c where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null and c.id_photo_path is not null
    union all
    select c.selfie_photo_path from public.checkins c where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null and c.selfie_photo_path is not null) x;
  select count(*) into v_consents from public.marketing_consents m
   where m.id = any(coalesce(p_consent_ids, '{}')) and (m.email is not null or m.phone is not null or m.guest_name is not null or m.withdrawn_at is null);
  select count(*) into v_reservations from public.ota_reservations r
   where r.id = any(coalesce(p_reservation_ids, '{}')) and (r.contact_email is not null or r.contact_phone is not null or r.phone_last4 is not null);
  select count(*) into v_chat from public.chat_messages m
   where m.deleted_at is null and exists (select 1 from jsonb_array_elements(v_bookings) b
     where (b->>'property_id')::uuid = m.property_id and b->>'booking_code' = m.booking_code);

  if not p_dry_run then
    insert into public.storage_purge_queue (bucket, path, reason)
    select 'documents', x.p, 'dsar_erasure' from (
      select c.id_photo_path p from public.checkins c where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null and c.id_photo_path is not null
      union
      select c.selfie_photo_path from public.checkins c where c.id = any(coalesce(p_checkin_ids, '{}')) and c.deleted_at is null and c.selfie_photo_path is not null) x
    on conflict (bucket, path) do nothing;
    update public.checkins set id_photo_path = null, selfie_photo_path = null
     where id = any(coalesce(p_checkin_ids, '{}')) and deleted_at is null and (id_photo_path is not null or selfie_photo_path is not null);
    update public.checkins set deleted_at = now() where id = any(v_erase) and deleted_at is null;
    update public.marketing_consents set withdrawn_at = coalesce(withdrawn_at, now()), email = null, phone = null, guest_name = null
     where id = any(coalesce(p_consent_ids, '{}'));
    update public.ota_reservations set contact_email = null, contact_phone = null, phone_last4 = null
     where id = any(coalesce(p_reservation_ids, '{}')) and (contact_email is not null or contact_phone is not null or phone_last4 is not null);
    update public.chat_messages m set deleted_at = now()
     where m.deleted_at is null and exists (select 1 from jsonb_array_elements(v_bookings) b
       where (b->>'property_id')::uuid = m.property_id and b->>'booking_code' = m.booking_code);
  end if;

  return jsonb_build_object('dry_run', p_dry_run, 'checkins_erased', cardinality(v_erase), 'checkins_retained', v_retained,
    'photos_queued', v_photos, 'consents_withdrawn', v_consents, 'reservations_redacted', v_reservations, 'chat_messages_erased', v_chat);
end $$;

revoke all on function public.dsar_erase(uuid[], uuid[], uuid[], jsonb, boolean) from public, anon, authenticated;
grant execute on function public.dsar_erase(uuid[], uuid[], uuid[], jsonb, boolean) to service_role;
