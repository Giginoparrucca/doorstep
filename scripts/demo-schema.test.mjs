import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderDemoSchema } from './demo-schema.mjs';
if (!process.argv[2]) throw new Error('Pass a private catalog JSON path; metadata snapshots are not published.');
const catalog = JSON.parse(fs.readFileSync(process.argv[2]));
assert.throws(() => renderDemoSchema(catalog, 'jcjwaqqabgwqhhzhfbts'));
assert.throws(() => renderDemoSchema(catalog, ''));
const sql = renderDemoSchema(catalog, 'abcdefghijklmnopqrst');
assert.equal(sql, renderDemoSchema(catalog, 'abcdefghijklmnopqrst'));
assert.equal((sql.match(/CREATE TABLE public\./g) || []).length, catalog.tables.length);
assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length, catalog.tables.length);
assert.match(sql, /alloggiati_autofile_mode text NOT NULL DEFAULT 'off'/);
assert.match(sql, /is_test boolean NOT NULL DEFAULT true/);
assert.doesNotMatch(sql, /cron\.schedule|net\.http|vault\.decrypted_secrets/i);
assert.doesNotMatch(sql, /GRANT (TRUNCATE|TRIGGER|REFERENCES) ON TABLE/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.purge_old_data_cron/);
assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.capture_chat_qa_pairs/);
for (const name of ['documents', 'receipts']) {
  assert.match(sql, new RegExp(`VALUES \\('${name}', '${name}', false,`));
}
const roles = new Set(['anon', 'authenticated', 'service_role']);
for (const g of catalog.grants) assert.ok(roles.has(g.grantee));
for (const f of catalog.functions) {
  if (sql.includes(f.ddl.trimEnd())) assert.ok(sql.includes(`REVOKE ALL ON FUNCTION ${f.identity} FROM PUBLIC, anon, authenticated, service_role;`));
}
console.log(`PASS schema rendering: deterministic, ${catalog.tables.length} RLS tables, private sensitive buckets, no rows/jobs/secrets, demo defaults and target denial.`);
