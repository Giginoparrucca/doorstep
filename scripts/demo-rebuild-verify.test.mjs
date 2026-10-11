#!/usr/bin/env node
// Negative tests for scripts/demo-rebuild-verify.mjs: changing any of the
// expected values must flip the verdict from PASS to FAIL.
import assert from 'node:assert/strict';
import { EXPECTED, verify } from './demo-rebuild-verify.mjs';

const good = {
  projectRef: EXPECTED.projectRef,
  migrations: EXPECTED.migrations.map(m => ({ version: m.version, name: m.name, sha256: m.sha256 })),
  schema: { ...EXPECTED.schema },
  isolation: {
    auth_users: EXPECTED.isolation.auth_users_max,
    storage_objects: EXPECTED.isolation.storage_objects,
    vault_secrets: EXPECTED.isolation.vault_secrets,
    pg_cron_extension: EXPECTED.isolation.pg_cron_extension,
    pg_net_extension: EXPECTED.isolation.pg_net_extension,
    cron_schema: EXPECTED.isolation.cron_schema,
    production_properties_rows: EXPECTED.isolation.production_properties_rows,
    production_checkins_rows: EXPECTED.isolation.production_checkins_rows,
    ota_reservations_rows: EXPECTED.isolation.ota_reservations_rows,
    host_alloggiati_credentials_rows: EXPECTED.isolation.host_alloggiati_credentials_rows,
    alloggiati_filing_log_rows: EXPECTED.isolation.alloggiati_filing_log_rows,
    admin_users_rows: EXPECTED.isolation.admin_users_rows,
    notification_log_rows: EXPECTED.isolation.notification_log_rows,
  },
};

assert.equal(verify(good).passed, true, 'baseline PASS');
console.log('PASS baseline evidence passes');

const mutations = [
  { label: 'wrong project ref', patch: ev => ({ ...ev, projectRef: 'jcjwaqqabgwqhhzhfbts' }) },
  { label: 'missing migration', patch: ev => ({ ...ev, migrations: ev.migrations.slice(0, 2) }) },
  { label: 'tampered migration sha256', patch: ev => ({ ...ev, migrations: ev.migrations.map((m, i) => i === 0 ? { ...m, sha256: 'deadbeef'.padEnd(64, '0') } : m) }) },
  { label: 'renamed migration', patch: ev => ({ ...ev, migrations: ev.migrations.map((m, i) => i === 0 ? { ...m, name: 'renamed' } : m) }) },
  { label: 'schema shape drift (tables)', patch: ev => ({ ...ev, schema: { ...ev.schema, tables: ev.schema.tables + 1 } }) },
  { label: 'schema fingerprint drift', patch: ev => ({ ...ev, schema: { ...ev.schema, fingerprint: 'different' } }) },
  { label: 'vault secret appeared', patch: ev => ({ ...ev, isolation: { ...ev.isolation, vault_secrets: 1 } }) },
  { label: 'cron installed', patch: ev => ({ ...ev, isolation: { ...ev.isolation, pg_cron_extension: 1 } }) },
  { label: 'production rows leaked in', patch: ev => ({ ...ev, isolation: { ...ev.isolation, production_properties_rows: 3 } }) },
  { label: 'extra auth users above bound', patch: ev => ({ ...ev, isolation: { ...ev.isolation, auth_users: 99 } }) },
];

for (const { label, patch } of mutations) {
  const mutated = patch(JSON.parse(JSON.stringify(good)));
  assert.equal(verify(mutated).passed, false, label + ' must FAIL');
  console.log('PASS ' + label);
}

console.log('PASS rebuild-verify negative tests');
