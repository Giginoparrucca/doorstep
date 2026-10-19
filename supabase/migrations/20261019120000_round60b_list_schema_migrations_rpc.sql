-- Round 60b Phase 1 — expose supabase_migrations.schema_migrations to the
-- service role via a SECURITY DEFINER function.
--
-- PostgREST only exposes the `public`, `storage` and `graphql_public`
-- schemas by default; `supabase_migrations` is private. The schema-drift
-- guard needs to compare committed migration files against what's
-- applied on prod, and it runs in CI with only the service-role key
-- (not direct DB access). SECURITY DEFINER lets a `public.`-schema
-- function reach into `supabase_migrations` without widening the
-- PostgREST schema list.
--
-- The function is restricted to `service_role` on EXECUTE so anon and
-- authenticated callers cannot enumerate migration history. The service
-- role already bypasses RLS on everything else, so this exposes nothing
-- new to the key the CI already has.
BEGIN;

CREATE OR REPLACE FUNCTION public.list_applied_migrations()
RETURNS TABLE (version text, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = supabase_migrations, pg_temp
AS $$
  SELECT version, name
  FROM supabase_migrations.schema_migrations
  ORDER BY version;
$$;

REVOKE ALL ON FUNCTION public.list_applied_migrations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_applied_migrations() TO service_role;

COMMENT ON FUNCTION public.list_applied_migrations() IS
  'Round 60b: returns supabase_migrations.schema_migrations rows for the schema-drift CI guard. Restricted to service_role.';

NOTIFY pgrst, 'reload schema';
COMMIT;
