-- Round 74 Phase 4 — WBNB-Y001: remove the anonymous upload rule on the
-- documents bucket. Applied only after the signed upload path
-- (20261116110000_round74_document_uploads.sql + api/guest.js upload_url) was
-- verified in production. Signed upload URLs are authorised by their own token
-- and do not need any storage.objects INSERT policy.
-- Re-runnable. Rollback (not recommended): re-create
--   create policy "Allow anonymous uploads" on storage.objects for insert
--   with check (bucket_id = 'documents' and name like 'id-photos/%');
drop policy if exists "Allow anonymous uploads" on storage.objects;
