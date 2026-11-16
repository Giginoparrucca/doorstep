-- Round 74 Phase 1 — WBNB-R001: booking recovery without pattern matching.
--
-- guest_recover_booking(property, arrival, surname, doc_last4, is_test)
--   Literal comparison only (no LIKE/ILIKE, so `*`, `%`, `_` are ordinary
--   characters that simply never match a stored surname):
--     surname   lower-cased, trimmed, inner spaces collapsed, equal;
--     doc_last4 the last 4 letters/digits of the document number, equal
--               (Daniele's decision D1, 16 Nov 2026);
--     arrival date equal, same property, same test mode, not deleted.
--   Returns {found:true, booking_code, guests} only when exactly ONE booking
--   code matches; otherwise {found:false} (no match, ambiguous, wrong proof
--   all look the same). Never returns personal data.
-- SECURITY DEFINER, fixed search_path, service_role only (api/guest.js calls
-- it after verifying the guest token and the rate limit).
-- Re-runnable. Rollback: drop function public.guest_recover_booking(uuid, date, text, text, boolean);
create or replace function public.guest_recover_booking(p_property uuid, p_arrival date, p_surname text, p_doc_last4 text, p_is_test boolean)
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare
  v_surname text := lower(regexp_replace(btrim(coalesce(p_surname, '')), '\s+', ' ', 'g'));
  v_doc text := upper(coalesce(p_doc_last4, ''));
  v_codes text[];
  v_guests int;
begin
  if p_property is null or p_arrival is null or length(v_surname) < 1 or length(v_surname) > 80
     or v_doc !~ '^[A-Z0-9]{4}$' then
    return jsonb_build_object('found', false);
  end if;
  select array_agg(distinct c.booking_code), count(*)::int into v_codes, v_guests
  from public.checkins c
  where c.property_id = p_property
    and c.arrival_date = p_arrival
    and c.is_test = coalesce(p_is_test, false)
    and c.deleted_at is null
    and c.booking_code is not null
    and lower(regexp_replace(btrim(coalesce(c.surname, '')), '\s+', ' ', 'g')) = v_surname
    and right(upper(regexp_replace(coalesce(c.document_number, ''), '[^A-Za-z0-9]', '', 'g')), 4) = v_doc;
  if v_codes is null or array_length(v_codes, 1) <> 1 then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'booking_code', v_codes[1],
    'guests', (select count(*)::int from public.checkins c where c.property_id = p_property and c.booking_code = v_codes[1]
               and c.is_test = coalesce(p_is_test, false) and c.deleted_at is null));
end $$;
revoke all on function public.guest_recover_booking(uuid, date, text, text, boolean) from public, anon, authenticated;
grant execute on function public.guest_recover_booking(uuid, date, text, text, boolean) to service_role;
