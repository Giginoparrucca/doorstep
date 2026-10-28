import { supabaseAuthHeaders } from '../api/_supabase-auth.js';
// Round 60b Phase 1 — live schema-drift gate.
//
// Reads supabase_migrations.schema_migrations on the production project
// via the service-role REST client and compares it against the committed
// migration file list. Fails if any committed file's migration name has
// no matching applied row.
//
// Needs:
//   SUPABASE_SERVICE_ROLE_KEY   service-role key for the prod project
// Optional:
//   SUPABASE_PROJECT_REF        default jcjwaqqabgwqhhzhfbts (prod)
//   SUPABASE_URL                override the derived URL
//
// Convention: exit code 77 = skipped (POSIX), first stderr line = reason.
// Any other non-zero = failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { diff, formatFailure, parseRequiredNames } = require('../lib/schema-drift.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const migrationsDir = path.resolve(repoRoot, 'supabase', 'migrations');

const projectRef = process.env.SUPABASE_PROJECT_REF || 'jcjwaqqabgwqhhzhfbts';
const supabaseUrl = process.env.SUPABASE_URL || `https://${projectRef}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  process.stderr.write('SKIP SUPABASE_SERVICE_ROLE_KEY not set\n');
  process.exit(77);
}

if (!fs.existsSync(migrationsDir)) {
  console.error(`FAIL migrations directory does not exist: ${migrationsDir}`);
  process.exit(1);
}

const files = fs.readdirSync(migrationsDir)
  .filter(name => name.endsWith('.sql'))
  .sort();

async function readSchemaMigrations() {
  // Supabase's `supabase_migrations` schema is not exposed by PostgREST
  // by default, so a direct SELECT via REST would 404. Round 60b adds a
  // SECURITY DEFINER function `public.list_applied_migrations()` that
  // only service_role can EXECUTE; it returns `{version, name}` rows
  // from the private schema without widening the PostgREST schema list.
  const url = new URL('/rest/v1/rpc/list_applied_migrations', supabaseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseAuthHeaders(serviceKey),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PostgREST responded ${res.status}: ${body.slice(0, 400)}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error(`Expected an array, got ${typeof rows}`);
  }
  return rows;
}

try {
  const applied = await readSchemaMigrations();
  // Extra names strengthen the reviewed-main probe before a pending
  // migration-bearing PR merges. They cannot omit committed file checks.
  const required = parseRequiredNames(process.env.SCHEMA_DRIFT_REQUIRED_MIGRATIONS);
  const result = diff({ files, applied, required });

  if (!result.ok) {
    console.error(formatFailure({ missing: result.missing, projectRef }));
    console.error('');
    console.error('A committed migration file with no matching row on prod is');
    console.error('exactly the Round 57 failure mode. Apply the migration via');
    console.error('Supabase MCP and insert the schema_migrations row before merging.');
    process.exit(1);
  }

  for (const name of required) console.log(`PASS required migration: ${name}`);
  console.log(
    `PASS schema-drift live: ${files.length} committed migration file(s), ` +
    `${applied.length} applied row(s) on project ${projectRef}; ${required.length} additional required name(s); every committed ` +
    `file has a matching applied name.`
  );
} catch (err) {
  console.error('FAIL unable to query prod schema_migrations:', err.message);
  process.exit(1);
}
