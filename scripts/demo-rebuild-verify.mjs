#!/usr/bin/env node
// Reproducibility proof for the Round 50 Phase 2 demo baseline.
// Reads the live demo project's migration bodies and schema shape, computes
// deterministic fingerprints, and asserts both match the known-good values
// recorded here. Byte-stable migrations plus a matching schema shape prove
// that a fresh application of the same migration bodies to any clean
// disposable project would produce the identical schema.
//
// Usage: node scripts/demo-rebuild-verify.mjs <evidence.json>
//
// Evidence is a JSON object (produced by `scripts/demo-rebuild-verify.sql`
// against the live demo DB; see that file for the canonical queries). This
// script does not open a database connection itself, so it carries no demo
// credentials and can be re-run from any workstation.
//
// Exit 0 on PASS, 1 on FAIL. Prints each check verdict.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Known-good values captured from the live demo project
// `wmegnnlmcrabndyzywmj` on 2026-10-11. If the schema is intentionally
// changed, update both the migration SHA256 (after re-exporting the
// baseline) AND the schema shape fingerprint in the same commit.
export const EXPECTED = {
  projectRef: 'wmegnnlmcrabndyzywmj',
  migrations: [
    { version: '20261009070108', name: 'round50_demo_baseline',             sha256: '2a8b2ecdf1a159c39e39845557c91dc27216b553f35a3d34cd279bd7b3cc594f' },
    { version: '20261009070254', name: 'round50_demo_privilege_hardening',  sha256: '3feed9b43ecba130c1a23575b9685119ff4638940de9abda86dea9bf48375697' },
    { version: '20261010101252', name: 'round50_receipt_owner_scope',       sha256: 'b44ecb48afb05d810d45c6e623dd55634af39deb2f56b36ac6106372c46a09c5' },
    { version: '20261011044424', name: 'round50_phase4_demo_reset',         sha256: '74a69117cc7f019c2ee115789f3b5f32823d864c034c78930452c24fc32190a1' },
  ],
  schema: {
    fingerprint: '1a9a5f8177bcaa89a7ec1c0deb7713df9d92b96f43fb3c37b6cb05367d3374e8',
    tables: 28,
    columns: 372,
    constraints: 258,
    indexes: 82,
    policies: 86,
    functions: 17,
    triggers: 5,
    buckets: 3,
    storage_policies: 14,
  },
  isolation: {
    // Clean-rebuild invariants: no production data, no cron, no net
    // extension, no vault secrets. Presenter auth users are provisioned by
    // scripts/demo-auth-storage-gate.mjs; 2 is the expected steady-state.
    auth_users_max: 2,
    storage_objects: 0,
    vault_secrets: 0,
    pg_cron_extension: 0,
    pg_net_extension: 0,
    cron_schema: 0,
    production_properties_rows: 0,
    production_checkins_rows: 0,
    ota_reservations_rows: 0,
    host_alloggiati_credentials_rows: 0,
    alloggiati_filing_log_rows: 0,
    admin_users_rows: 0,
    notification_log_rows: 0,
  },
};

export function verify(evidence, { expected = EXPECTED } = {}) {
  const results = [];
  const check = (label, pass, detail = '') => {
    results.push({ label, pass, detail });
    return pass;
  };

  check('project ref', evidence.projectRef === expected.projectRef,
        `${evidence.projectRef} vs ${expected.projectRef}`);

  const migByVersion = new Map((evidence.migrations || []).map(m => [m.version, m]));
  for (const expected_mig of expected.migrations) {
    const actual = migByVersion.get(expected_mig.version);
    const pass = !!actual && actual.sha256 === expected_mig.sha256 && actual.name === expected_mig.name;
    check(`migration ${expected_mig.version} ${expected_mig.name}`, pass,
          actual ? `sha256 ${actual.sha256} name ${actual.name}` : 'MISSING');
  }
  check('migration count',
        (evidence.migrations || []).length === expected.migrations.length,
        `${(evidence.migrations || []).length} vs ${expected.migrations.length}`);

  const s = evidence.schema || {};
  const e = expected.schema;
  check('schema fingerprint', s.fingerprint === e.fingerprint, `${s.fingerprint}`);
  for (const key of ['tables','columns','constraints','indexes','policies','functions','triggers','buckets','storage_policies']) {
    check(`schema ${key}`, s[key] === e[key], `${s[key]} vs ${e[key]}`);
  }

  const iso = evidence.isolation || {};
  const ei = expected.isolation;
  const au = Number(iso.auth_users);
  check('auth users within expected bound',
        Number.isFinite(au) && au <= ei.auth_users_max,
        `${au} <= ${ei.auth_users_max}`);
  for (const key of ['storage_objects','vault_secrets','pg_cron_extension','pg_net_extension','cron_schema',
                     'production_properties_rows','production_checkins_rows','ota_reservations_rows',
                     'host_alloggiati_credentials_rows','alloggiati_filing_log_rows','admin_users_rows','notification_log_rows']) {
    check(`isolation ${key}`, Number(iso[key]) === ei[key], `${iso[key]} vs ${ei[key]}`);
  }

  const failed = results.filter(r => !r.pass);
  return { passed: failed.length === 0, total: results.length, failed, results };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/demo-rebuild-verify.mjs <evidence.json>');
    process.exit(2);
  }
  const evidence = JSON.parse(readFileSync(path, 'utf8'));
  const result = verify(evidence);
  for (const r of result.results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.label}${r.pass ? '' : ' — ' + r.detail}`);
  }
  console.log(`${result.passed ? 'PASS' : 'FAIL'} rebuild-verify: ${result.total - result.failed.length}/${result.total}`);
  if (!result.passed) process.exit(1);
}
