-- Round 74 Phase 4 — WBNB-Y001: document uploads only through a server-issued
-- signed upload URL (api/guest.js upload_url).
--
-- 1. api_usage.endpoint accepts 'upload_sign' (the per-address / per-property
--    signing limit).
-- 2. Bucket `documents`: 10 MB per file and only JPEG, PNG, WebP, HEIC/HEIF
--    images and PDF (production 16 Nov 2026: 20 objects, all JPEG, max 3.3 MB).
-- The anonymous INSERT policy is removed by the NEXT migration
-- (20261116120000_round74_drop_anon_document_uploads.sql), applied only after
-- the signed path is verified in production.
-- Re-runnable. Rollback: restore the previous endpoint list; set the bucket's
-- file_size_limit and allowed_mime_types back to null.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'api_usage_endpoint_check' and conrelid = 'public.api_usage'::regclass)
     and position('upload_sign' in pg_get_constraintdef((select oid from pg_constraint where conname = 'api_usage_endpoint_check' and conrelid = 'public.api_usage'::regclass))) = 0 then
    alter table public.api_usage drop constraint api_usage_endpoint_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'api_usage_endpoint_check' and conrelid = 'public.api_usage'::regclass) then
    alter table public.api_usage add constraint api_usage_endpoint_check check (endpoint = any (array['chat', 'scan', 'chat_write', 'token_mint', 'tax_parse', 'checkin_lookup', 'checkin_write', 'upload_sign']));
  end if;
end $$;

update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
 where id = 'documents';
