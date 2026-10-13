-- Round 52: qualify the outer Storage file path in owner receipt policies.
-- Unqualified name inside the property subquery binds to properties.name.
-- Existing grants, service policy and private bucket remain unchanged.
-- ALTER avoids the historical DROP POLICY event-trigger timeout.
BEGIN;
ALTER POLICY receipts_owner_read ON storage.objects TO authenticated
USING (bucket_id = 'receipts' AND EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id::text = split_part(objects.name, '/', 1) AND p.owner_id = auth.uid()
));
ALTER POLICY receipts_owner_write ON storage.objects TO authenticated
WITH CHECK (bucket_id = 'receipts' AND EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id::text = split_part(objects.name, '/', 1) AND p.owner_id = auth.uid()
));
ALTER POLICY receipts_owner_delete ON storage.objects TO authenticated
USING (bucket_id = 'receipts' AND EXISTS (
  SELECT 1 FROM public.properties p
  WHERE p.id::text = split_part(objects.name, '/', 1) AND p.owner_id = auth.uid()
));
COMMIT;

-- Rollback (restores the previous production policy expressions; files stay):
-- ALTER POLICY receipts_owner_read ON storage.objects USING (
--   bucket_id = 'receipts' AND EXISTS (SELECT 1 FROM public.properties p
--   WHERE p.id::text = split_part(p.name, '/', 1) AND p.owner_id = auth.uid()));
-- ALTER POLICY receipts_owner_write ON storage.objects WITH CHECK (
--   bucket_id = 'receipts' AND EXISTS (SELECT 1 FROM public.properties p
--   WHERE p.id::text = split_part(p.name, '/', 1) AND p.owner_id = auth.uid()));
-- ALTER POLICY receipts_owner_delete ON storage.objects USING (
--   bucket_id = 'receipts' AND EXISTS (SELECT 1 FROM public.properties p
--   WHERE p.id::text = split_part(p.name, '/', 1) AND p.owner_id = auth.uid()));
