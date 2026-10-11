-- Round 50 Phase 2 rebuild-verify evidence producer.
-- Run against the demo project (never production). The result is a single
-- JSON row that scripts/demo-rebuild-verify.mjs validates against the known
-- fingerprints. Reads catalog + storage.buckets; writes nothing.
--
-- Supabase SQL editor usage: paste and run; copy the JSON cell into a file
-- (e.g. evidence.json) and feed it to the Node validator.

WITH schema_shape AS (
  SELECT jsonb_build_object(
    'tables', (
      SELECT jsonb_agg(jsonb_build_object('n', table_name, 'rls', c.relrowsecurity, 'fs', c.relforcerowsecurity) ORDER BY table_name)
      FROM information_schema.tables i
      JOIN pg_class c ON c.oid = (i.table_schema || '.' || i.table_name)::regclass
      WHERE i.table_schema = 'public' AND i.table_type = 'BASE TABLE'
    ),
    'columns', (
      SELECT jsonb_agg(jsonb_build_object('t', table_name, 'c', column_name, 'd', data_type, 'n', is_nullable, 'g', column_default) ORDER BY table_name, ordinal_position)
      FROM information_schema.columns
      WHERE table_schema = 'public'
    ),
    'constraints', (
      SELECT jsonb_agg(jsonb_build_object('t', table_name, 'n', constraint_name, 'y', constraint_type) ORDER BY table_name, constraint_name)
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
    ),
    'indexes', (
      SELECT jsonb_agg(jsonb_build_object('t', tablename, 'n', indexname) ORDER BY tablename, indexname)
      FROM pg_indexes WHERE schemaname = 'public'
    ),
    'policies', (
      SELECT jsonb_agg(jsonb_build_object('t', tablename, 'n', policyname, 'c', cmd, 'r', roles::text) ORDER BY tablename, policyname)
      FROM pg_policies WHERE schemaname = 'public'
    ),
    'functions', (
      SELECT jsonb_agg(jsonb_build_object('n', p.proname, 'args', pg_get_function_arguments(p.oid), 'sd', p.prosecdef, 'lang', l.lanname) ORDER BY p.proname, pg_get_function_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public'
    ),
    'triggers', (
      SELECT jsonb_agg(jsonb_build_object('t', event_object_table, 'n', trigger_name, 'e', event_manipulation, 'tim', action_timing) ORDER BY event_object_table, trigger_name, event_manipulation)
      FROM information_schema.triggers WHERE trigger_schema = 'public'
    ),
    'buckets', (
      SELECT jsonb_agg(jsonb_build_object('id', id, 'public', public) ORDER BY id)
      FROM storage.buckets
    ),
    'storage_policies', (
      SELECT jsonb_agg(jsonb_build_object('n', policyname, 'c', cmd) ORDER BY policyname)
      FROM pg_policies WHERE schemaname = 'storage'
    )
  ) AS snapshot
),
migrations AS (
  SELECT jsonb_agg(jsonb_build_object(
    'version', version,
    'name', name,
    'sha256', encode(digest(array_to_string(statements, E';\n'), 'sha256'), 'hex')
  ) ORDER BY version) AS migrations
  FROM supabase_migrations.schema_migrations
)
-- Replace ':ref' with the demo project ref (e.g. 'wmegnnlmcrabndyzywmj') or
-- pipe through: `jq --arg r wmegnnlmcrabndyzywmj '.projectRef=$r'`.
SELECT jsonb_build_object(
  'projectRef', NULL::text,
  'migrations', (SELECT migrations FROM migrations),
  'schema', jsonb_build_object(
    'fingerprint', encode(digest(snapshot::text, 'sha256'), 'hex'),
    'tables', jsonb_array_length(snapshot->'tables'),
    'columns', jsonb_array_length(snapshot->'columns'),
    'constraints', jsonb_array_length(snapshot->'constraints'),
    'indexes', jsonb_array_length(snapshot->'indexes'),
    'policies', jsonb_array_length(snapshot->'policies'),
    'functions', jsonb_array_length(snapshot->'functions'),
    'triggers', jsonb_array_length(snapshot->'triggers'),
    'buckets', jsonb_array_length(snapshot->'buckets'),
    'storage_policies', jsonb_array_length(snapshot->'storage_policies')
  ),
  'isolation', jsonb_build_object(
    'auth_users', (SELECT COUNT(*) FROM auth.users),
    'storage_objects', (SELECT COUNT(*) FROM storage.objects),
    'vault_secrets', (SELECT COUNT(*) FROM vault.secrets),
    'pg_cron_extension', (SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_cron'),
    'pg_net_extension', (SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_net'),
    'cron_schema', (SELECT COUNT(*) FROM pg_namespace WHERE nspname = 'cron'),
    'production_properties_rows', (SELECT COUNT(*) FROM public.properties WHERE is_test = false),
    'production_checkins_rows', (SELECT COUNT(*) FROM public.checkins WHERE is_test = false),
    'ota_reservations_rows', (SELECT COUNT(*) FROM public.ota_reservations),
    'host_alloggiati_credentials_rows', (SELECT COUNT(*) FROM public.host_alloggiati_credentials),
    'alloggiati_filing_log_rows', (SELECT COUNT(*) FROM public.alloggiati_filing_log),
    'admin_users_rows', (SELECT COUNT(*) FROM public.admin_users),
    'notification_log_rows', (SELECT COUNT(*) FROM public.notification_log)
  )
) AS evidence
FROM schema_shape;
