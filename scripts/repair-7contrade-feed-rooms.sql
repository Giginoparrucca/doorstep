-- One-property configuration repair; no deletion, guest/date/status changes.
-- Label alone is not room assignment. Cross-check provider category, active
-- room name and persisted source hash before adopting existing OTA rows.
begin;
do $$
declare
  p constant uuid := '6ff7528d-3bfe-4441-9465-c3c04ecc9018';
  feeds jsonb;
  f jsonb;
  rid uuid;
  category text;
  source_hash text;
  feed_key text;
  affected integer := 0;
  n integer;
  before_hash text;
  after_hash text;
begin
  select ical_feeds into feeds from properties where id=p for update;
  if jsonb_array_length(feeds) <> 3 then raise exception 'Expected three feeds'; end if;
  select md5(string_agg((to_jsonb(r)-'room_id'-'uid'-'raw'-'updated_at')::text, '' order by id))
    into before_hash from ota_reservations r where property_id=p;
  for f in select value from jsonb_array_elements(feeds) loop
    category := substring(f->>'url' from '[?&]idroomcategory=([0-9]+)');
    if f->>'platform' <> 'other' or f->>'url' not like 'https://www.bed-and-breakfast.it/export_calendar_ires.cfm?%'
      or (category, f->>'label') not in (('7351','Battaglia'),('7352','Bellatrase'),('7353','Capitignano'))
      then raise exception 'Unexpected feed configuration'; end if;
    select id into strict rid from property_rooms where property_id=p and name=f->>'label' and deleted_at is null;
    if f ? 'room_id' and f->>'room_id' <> rid::text then raise exception 'Existing assignment differs'; end if;
    source_hash := encode(sha256(convert_to('other' || chr(10) || trim(f->>'url'),'UTF8')),'hex');
    feed_key := left(encode(sha256(convert_to('other' || chr(10) || 'room:' || rid::text,'UTF8')),'hex'),32);
    update ota_reservations set room_id=rid,
      uid='wbnb-feed:' || feed_key || ':' || (raw->>'welcomebnb_feed_uid'),
      raw=jsonb_set(raw,'{welcomebnb_feed_key}',to_jsonb(feed_key))
      where property_id=p and platform='other' and deleted_at is null and not is_test
        and room_id is null and raw->>'welcomebnb_feed_source'=source_hash
        and uid=raw->>'welcomebnb_feed_uid' and uid like '%-' || category || '-%-IRES'
        and raw->>'description' like '%CAMERA: ' || (f->>'label') || chr(10) || '%';
    get diagnostics n = row_count;
    affected := affected+n;
    feeds := jsonb_set(feeds, array[(select (ordinality-1)::text from jsonb_array_elements(feeds) with ordinality where value=f)], f || jsonb_build_object('room_id',rid));
  end loop;
  if affected <> 5 then raise exception 'Expected five verified unassigned rows, got %', affected; end if;
  update properties set ical_feeds=feeds where id=p;
  select md5(string_agg((to_jsonb(r)-'room_id'-'uid'-'raw'-'updated_at')::text, '' order by id))
    into after_hash from ota_reservations r where property_id=p;
  if before_hash is distinct from after_hash then raise exception 'Non-routing reservation data changed'; end if;
end $$;
commit;
