import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const productionRef = 'jcjwaqqabgwqhhzhfbts';
const quoteId = value => '"' + value.replaceAll('"', '""') + '"';
const quoteText = value => "'" + value.replaceAll("'", "''") + "'";
const excludedFunctions = new Set([
  'purge_old_api_usage', 'aggregate_analytics_monthly', 'purge_old_data',
  'purge_old_data_admin', 'set_purge_live_after', 'capture_chat_qa_pairs',
  'purge_old_id_photos', 'enqueue_orphan_documents', 'purge_old_data_cron',
]);
const fixedSearchPathFunctions = new Set([
  'anonymize_text', 'compute_season', 'tg_touch_updated_at',
  '_ota_reservations_touch_updated_at', '_tax_rulesets_touch_updated_at',
  '_pilot_hosts_touch_updated_at', 'checkins_prevent_filed_edit',
]);

// No network or database execution: render a reviewed schema-only baseline.
// Applying it requires separate project identity, cost and deployment checks.
export function renderDemoSchema(catalog, projectRef) {
  if (!/^[a-z]{20}$/.test(projectRef || '') || projectRef === productionRef) {
    throw new Error('A verified non-production project ref is required');
  }
  const sql = [
    '-- Round 50 Phase 2: schema-only demo baseline. Never apply to production.',
    '-- Generated from catalog metadata; no production rows or secrets.',
    '-- The caller MUST verify project name/ref through the Management API.',
    `-- Intended demo project: ${projectRef}`,
    'BEGIN;',
    'CREATE SCHEMA IF NOT EXISTS extensions;',
    'CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;',
    'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
    'SET LOCAL search_path = public, extensions;',
    ...(catalog.sequences || []),
    ...catalog.tables.map(table => {
      let ddl = table.ddl;
      if (table.name === 'properties') {
        ddl = ddl.replace("alloggiati_autofile_mode text NOT NULL DEFAULT 'live'", "alloggiati_autofile_mode text NOT NULL DEFAULT 'off'");
        ddl = ddl.replace('is_test boolean NOT NULL DEFAULT false', 'is_test boolean NOT NULL DEFAULT true');
      }
      return ddl;
    }),
    ...catalog.constraints.filter(c => c.type !== 'f').map(c => c.ddl),
    ...catalog.constraints.filter(c => c.type === 'f').map(c => c.ddl),
    ...(catalog.indexes || []),
    ...catalog.tables.map(t => `ALTER TABLE public.${quoteId(t.name)} ENABLE ROW LEVEL SECURITY;`),
    'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;',
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;',
  ];
  for (const f of catalog.functions) {
    if (excludedFunctions.has(f.name)) continue;
    sql.push(f.ddl.trimEnd() + ';');
    if (fixedSearchPathFunctions.has(f.name)) {
      sql.push(`ALTER FUNCTION ${f.identity} SET search_path = public, extensions;`);
    }
    sql.push(`REVOKE ALL ON FUNCTION ${f.identity} FROM PUBLIC, anon, authenticated, service_role;`);
    for (const acl of f.acl || []) {
      const role = acl.split('=')[0];
      // Guest access is validated by the server before using this RPC.
      if (f.name === 'get_reservation_keybox' && role === 'authenticated') continue;
      if (['authenticated', 'service_role'].includes(role) && acl.split('=')[1].startsWith('X')) {
        sql.push(`GRANT EXECUTE ON FUNCTION ${f.identity} TO ${role};`);
      }
    }
  }
  for (const t of catalog.triggers || []) sql.push(t.ddl);
  for (const p of catalog.policies) {
    // Policies refer to owner IDs/auth.uid(), not identities or copied accounts.
    let ddl = `CREATE POLICY ${quoteId(p.policyname)} ON ${quoteId(p.schemaname)}.${quoteId(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(role => role === 'public' ? 'PUBLIC' : quoteId(role)).join(', ')}`;
    if (p.qual) ddl += ` USING (${p.qual})`;
    if (p.with_check) ddl += ` WITH CHECK (${p.with_check})`;
    sql.push(ddl + ';');
  }
  for (const g of catalog.grants) {
    if (!['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(g.privilege_type)) continue;
    sql.push(`GRANT ${g.privilege_type} ON TABLE ${quoteId(g.table_schema)}.${quoteId(g.table_name)} TO ${quoteId(g.grantee)};`);
  }
  for (const table of ['storage_purge_queue', 'telegram_link_tokens']) {
    sql.push(`CREATE POLICY demo_deny_direct_access ON public.${quoteId(table)} FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);`);
  }
  for (const g of catalog.sequence_grants || []) {
    sql.push(`GRANT ${g.privilege_type} ON SEQUENCE ${quoteId(g.object_schema)}.${quoteId(g.object_name)} TO ${quoteId(g.grantee)};`);
  }
  for (const b of catalog.buckets) {
    const mime = b.allowed_mime_types ? `ARRAY[${b.allowed_mime_types.map(quoteText).join(',')}]::text[]` : 'NULL';
    sql.push(`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (${quoteText(b.id)}, ${quoteText(b.name)}, ${b.public}, ${b.file_size_limit ?? 'NULL'}, ${mime});`);
  }
  sql.push("NOTIFY pgrst, 'reload schema';", 'COMMIT;');
  const result = sql.join('\n\n') + '\n';
  if (/cron\.schedule|vault\.decrypted_secrets|net\.http|https?:\/\//i.test(result)) {
    throw new Error('Unexpected external integration in baseline');
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , ref, catalogPath, output] = process.argv;
  if (!output) throw new Error('Usage: node scripts/demo-schema.mjs <verified-demo-ref> <private-catalog.json> <output.sql>');
  const catalog = JSON.parse(fs.readFileSync(catalogPath));
  fs.writeFileSync(output, renderDemoSchema(catalog, ref), { mode: 0o600 });
  console.log(`Rendered ${catalog.tables.length} empty tables; no database connection made.`);
}
