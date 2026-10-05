-- migration_round48a_policy_lockdown.sql
--
-- Round 48 Phase 1 — DB-only policy lockdown. Zero client impact
-- (verified via grep of index.html / host-console.html / admin.html
-- before shipping). Addresses audit findings #4, #5, #6, #8, #9, #10
-- plus the storage reads on `documents` (hole #2); holes #1 and #3
-- stay until Phase 2 ships the guest gateway and Phase 3 revokes
-- anon table access.
--
-- IMPORTANT: this migration deliberately uses ALTER POLICY (plus
-- CREATE for the new owner-scoped rules) instead of DROP + CREATE.
--
-- Reason: at the time of writing (2026-10-05) `DROP POLICY ...`
-- against this project hangs indefinitely (observed: 60s+ in both
-- the MCP execute_sql and apply_migration paths; the server-side
-- query stalls somewhere behind the `pgrst_drop_watch` event trigger
-- despite no lock contention or active transactions on the target
-- table). CREATE POLICY and ALTER POLICY both complete instantly,
-- so we neuter each wide-open policy by setting its USING / WITH
-- CHECK to `false` (semantically identical to a drop — the policy
-- matches no row and acts as a no-op) and add the new owner-scoped
-- replacements via CREATE.
--
-- Once Supabase support identifies the DROP cause (or on a future
-- maintenance window where the event trigger can be bypassed), a
-- follow-up migration can clean up the neutered rows:
--   DROP POLICY analytics_events_admin_update ON public.analytics_events;
--   DROP POLICY chat_messages_admin_update    ON public.chat_messages;
--   DROP POLICY checkins_admin_update         ON public.checkins;
--   DROP POLICY properties_admin_update       ON public.properties;
--   DROP POLICY recommendations_admin_update  ON public.recommendations;
--   DROP POLICY "Hosts claim unowned properties" ON public.properties;
--   DROP POLICY "Anon read analytics" ON public.analytics_events;
--   DROP POLICY "Allow anonymous reads" ON storage.objects;
--   DROP POLICY "Allow public upload property images" ON storage.objects;
--   DROP POLICY "Allow public delete property images" ON storage.objects;
-- Until then these rows live in pg_policies with USING/WITH CHECK = false.
--
-- The `*_admin_all` policies (one per table, qual=is_admin()) already
-- provide admin access, so neutering the five bogus *_admin_update
-- (qual=true) policies is safe — admin.html keeps working through
-- the _admin_all side. is_admin() is SECURITY DEFINER so there's no
-- recursion when a policy on admin_users calls it.

begin;

-- ──────────────────────────────────────────────────────────────────
-- Hole #4 — five "*_admin_update" policies with qual=true that let
-- ANY authenticated host edit ANY row. Neuter them.
-- ──────────────────────────────────────────────────────────────────
alter policy analytics_events_admin_update on public.analytics_events using (false) with check (false);
alter policy chat_messages_admin_update    on public.chat_messages    using (false) with check (false);
alter policy checkins_admin_update         on public.checkins         using (false) with check (false);
alter policy properties_admin_update       on public.properties       using (false) with check (false);
alter policy recommendations_admin_update  on public.recommendations  using (false) with check (false);

-- ──────────────────────────────────────────────────────────────────
-- Hole #10 — legacy "Hosts claim unowned properties" policy. Round 33
-- removed the client-side claim branch (comment at host-console.html
-- line 14411 confirms). Neuter.
-- ──────────────────────────────────────────────────────────────────
alter policy "Hosts claim unowned properties" on public.properties using (false) with check (false);

-- ──────────────────────────────────────────────────────────────────
-- Hole #5 — authenticated INSERT policies that were with_check=true.
-- Grep confirms: host-console.html inserts chat_messages with
-- `property_id: propertyId` (host's active property, always owned
-- by auth.uid()); no client-side checkins inserts. Owner-scoped
-- rewrite is a drop-in.
-- ──────────────────────────────────────────────────────────────────
alter policy auth_insert_checkins on public.checkins with check (
  is_admin() or exists (
    select 1 from public.properties p
    where p.id = checkins.property_id and p.owner_id = auth.uid()
  )
);
alter policy "Auth insert chat" on public.chat_messages with check (
  is_admin() or exists (
    select 1 from public.properties p
    where p.id = chat_messages.property_id and p.owner_id = auth.uid()
  )
);

-- ──────────────────────────────────────────────────────────────────
-- Hole #6 — analytics_events SELECT was open to anon AND authenticated
-- qual=true. Grep confirms the guest app only INSERTs analytics (and
-- does a lone UPDATE at index.html:2474 that silently fails today
-- because no anon UPDATE policy exists — Phase 2 will move that into
-- the gateway). Host-side SELECTs scope by .eq('property_id', id);
-- admin.html uses select('*') and reaches rows via _admin_all.
-- Keep anon/auth INSERT (event capture still needs them).
-- ──────────────────────────────────────────────────────────────────
alter policy "Anon read analytics" on public.analytics_events using (false);
alter policy "Auth read analytics" on public.analytics_events using (
  is_admin() or exists (
    select 1 from public.properties p
    where p.id = analytics_events.property_id and p.owner_id = auth.uid()
  )
);

-- ──────────────────────────────────────────────────────────────────
-- Hole #2 (part A) — storage.objects bucket `documents` was wide
-- open to anon SELECT and INSERT. Neuter the SELECT; narrow the
-- INSERT to id-photos/* only (the sole path the guest check-in
-- uploader uses, index.html:3406). Round 46 purge uses the
-- service_role which bypasses RLS entirely → still works.
-- ──────────────────────────────────────────────────────────────────
alter policy "Allow anonymous reads" on storage.objects using (false);
alter policy "Allow anonymous uploads" on storage.objects with check (
  bucket_id = 'documents' and storage.objects.name like 'id-photos/%'
);

-- Add owner-scoped read so hosts can preview their guests' ID photos
-- (host-console.html:13683 createSignedUrl call). Covers both
-- id_photo_path AND selfie_photo_path (Round 46 column; 0 rows today
-- but wired in).
create policy documents_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents' and (
      is_admin() or exists (
        select 1 from public.checkins c
        join public.properties p on p.id = c.property_id
        where (c.id_photo_path = storage.objects.name
            or c.selfie_photo_path = storage.objects.name)
          and p.owner_id = auth.uid()
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- Hole #8 — storage.objects bucket `property-images` had public
-- INSERT + DELETE. Public SELECT stays (guest app loads covers
-- directly). Neuter the public writes; add owner-scoped INSERT /
-- UPDATE / DELETE where the property_id embedded in the path is
-- owned by the caller (host-console.html:3680 stores covers as
-- `covers/<property_id>_<timestamp>.<ext>`).
-- ──────────────────────────────────────────────────────────────────
alter policy "Allow public upload property images" on storage.objects with check (false);
alter policy "Allow public delete property images" on storage.objects using (false);

create policy property_images_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'property-images' and (
      is_admin() or exists (
        select 1 from public.properties p
        where p.id::text = split_part(split_part(storage.objects.name, '/', 2), '_', 1)
          and p.owner_id = auth.uid()
      )
    )
  );

create policy property_images_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'property-images' and (
      is_admin() or exists (
        select 1 from public.properties p
        where p.id::text = split_part(split_part(storage.objects.name, '/', 2), '_', 1)
          and p.owner_id = auth.uid()
      )
    )
  );

create policy property_images_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'property-images' and (
      is_admin() or exists (
        select 1 from public.properties p
        where p.id::text = split_part(split_part(storage.objects.name, '/', 2), '_', 1)
          and p.owner_id = auth.uid()
      )
    )
  );

-- ──────────────────────────────────────────────────────────────────
-- Hole #9 — admin_users SELECT was qual=true. is_admin() is SECURITY
-- DEFINER so a policy on admin_users that calls it does NOT recurse.
-- Non-admins can see only their own row.
-- ──────────────────────────────────────────────────────────────────
alter policy admin_users_select_authenticated on public.admin_users using (
  lower(email) = lower(auth.email()) or is_admin()
);

commit;
