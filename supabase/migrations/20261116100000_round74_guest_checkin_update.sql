-- Round 74 Phase 2 — WBNB-R002 + WBNB-Y003: guest check-in edits in one
-- trusted, atomic operation.
--
-- guest_update_checkin(property, booking, is_test, id, patch)
--   * The booking is mandatory: a token without a booking code cannot edit
--     anything (R002). The row must match id + property + booking + test
--     mode, not be deleted, and not be filed/filing (same editability rule as
--     before); it is locked for the update.
--   * Only the guest-editable columns are taken from `patch` (the same list
--     as api/guest.js CHECKIN_WRITE_FIELDS minus guest_type, which is fixed
--     at check-in); values are typed by jsonb_populate_record.
--   * A main guest (single/head/group) changing arrival/departure/nights
--     updates the whole party in the same transaction (Y003). Every other
--     row of the booking is locked first; if any is filed, being filed or in
--     correction, the whole edit is refused and nothing changes. Departure
--     must be after arrival; nights are recomputed when not given.
--   * Errors are raised with a stable prefix (booking_required, not_found,
--     already_filed, party_filed, invalid_dates) that the handler maps to a
--     clear answer. Returns the updated row (the handler filters fields).
-- SECURITY DEFINER, fixed search_path, service_role only.
-- Re-runnable. Rollback: drop function public.guest_update_checkin(uuid, text, boolean, uuid, jsonb);
create or replace function public.guest_update_checkin(p_property uuid, p_booking text, p_is_test boolean, p_id uuid, p_patch jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare
  cur public.checkins;
  nxt public.checkins;
  allowed text[] := array['surname','name','sex','date_of_birth','place_of_birth','birth_province','birth_country','citizenship',
    'document_type','document_number','doc_issue_place','arrival_date','departure_date','nights','id_photo_path','docs_status',
    'residence_country','residence_place','fiscal_code','residence_address','residence_postcode','residence_province','invoice_email'];
  clean jsonb;
  dates_changed boolean;
  blocked int;
begin
  if p_booking is null or length(btrim(p_booking)) = 0 then
    raise exception 'booking_required: an edit needs a booking-bound link' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_patch' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into clean
  from jsonb_each(coalesce(p_patch, '{}'::jsonb)) as e(k, v) where k = any(allowed);

  select * into cur from public.checkins
   where id = p_id and property_id = p_property and booking_code = p_booking
     and is_test = coalesce(p_is_test, false) and deleted_at is null
   for update;
  if not found then raise exception 'not_found: no such check-in in this booking' using errcode = 'P0001'; end if;
  if coalesce(cur.alloggiati_status, '') in ('filed', 'filing') then
    raise exception 'already_filed: this check-in has been sent to the police portal' using errcode = 'P0001';
  end if;

  nxt := jsonb_populate_record(cur, clean);
  dates_changed := cur.guest_type in ('single', 'head', 'group')
    and (clean ? 'arrival_date' or clean ? 'departure_date' or clean ? 'nights');
  if dates_changed or clean ? 'arrival_date' or clean ? 'departure_date' then
    if nxt.arrival_date is null or nxt.departure_date is null or nxt.departure_date <= nxt.arrival_date then
      raise exception 'invalid_dates: departure must be after arrival' using errcode = 'P0001';
    end if;
    if not clean ? 'nights' then nxt.nights := nxt.departure_date - nxt.arrival_date; end if;
  end if;

  if dates_changed then
    -- Lock the rest of the party, then refuse before changing anything if
    -- any of it is already with the police portal or in correction.
    perform 1 from public.checkins
     where property_id = p_property and booking_code = p_booking and is_test = coalesce(p_is_test, false)
       and deleted_at is null and id <> p_id
     for update;
    select count(*) into blocked from public.checkins
     where property_id = p_property and booking_code = p_booking and is_test = coalesce(p_is_test, false)
       and deleted_at is null and id <> p_id and coalesce(alloggiati_status, '') in ('filed', 'filing', 'correction');
    if blocked > 0 then
      raise exception 'party_filed: % companion check-in(s) already sent to the police portal; dates cannot change', blocked using errcode = 'P0001';
    end if;
  end if;

  update public.checkins set
    surname = nxt.surname, name = nxt.name, sex = nxt.sex, date_of_birth = nxt.date_of_birth,
    place_of_birth = nxt.place_of_birth, birth_province = nxt.birth_province, birth_country = nxt.birth_country,
    citizenship = nxt.citizenship, document_type = nxt.document_type, document_number = nxt.document_number,
    doc_issue_place = nxt.doc_issue_place, arrival_date = nxt.arrival_date, departure_date = nxt.departure_date,
    nights = nxt.nights, id_photo_path = nxt.id_photo_path, docs_status = nxt.docs_status,
    residence_country = nxt.residence_country, residence_place = nxt.residence_place, fiscal_code = nxt.fiscal_code,
    residence_address = nxt.residence_address, residence_postcode = nxt.residence_postcode,
    residence_province = nxt.residence_province, invoice_email = nxt.invoice_email,
    guest_edited_at = now(), checkin_reopened_at = null
  where id = p_id
  returning * into nxt;

  if dates_changed then
    update public.checkins set arrival_date = nxt.arrival_date, departure_date = nxt.departure_date, nights = nxt.nights
     where property_id = p_property and booking_code = p_booking and is_test = coalesce(p_is_test, false)
       and deleted_at is null and id <> p_id;
  end if;
  return to_jsonb(nxt);
end $$;
revoke all on function public.guest_update_checkin(uuid, text, boolean, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guest_update_checkin(uuid, text, boolean, uuid, jsonb) to service_role;
