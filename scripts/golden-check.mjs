#!/usr/bin/env node
// scripts/golden-check.mjs
//
// Round 49 Phase 1 — byte-identity check for the Alloggiati line
// builder refactor.
//
// Reads a set of representative check-in rows from
// `scripts/golden/fixtures.json` (gitignored because it contains
// real guest PII — one host populates it from the live DB; the
// file never commits), runs `AllogRecords.buildBatch` on them, and
// writes the generated 168-char lines (CRLF-joined, same as the
// browser export) to `scripts/golden/new-lib.txt`.
//
// The matching browser-side golden (`scripts/golden/old-browser.txt`
// in the current session) is captured by running the host-console
// Export panel BEFORE this PR lands. The two files MUST have the
// same sha256 — paste both sha256sum lines in the PR body (never
// the content).
//
// If `scripts/golden/fixtures.json` is missing, this script prints
// instructions for capturing it from `psql`/Supabase and exits non-
// zero (treated as a soft reminder — the PR can ship with the
// Daniele-run sha256 pasted in). Pure Node, no network, no Supabase
// SDK, no secrets.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const req = createRequire(pathToFileURL(process.cwd() + '/scripts/').href);
const Allog = req('../lib/alloggiati-records.js');

const GOLDEN_DIR = path.resolve('scripts/golden');
const FIX = path.join(GOLDEN_DIR, 'fixtures.json');
const OUT = path.join(GOLDEN_DIR, 'new-lib.txt');

if (!fs.existsSync(FIX)) {
  console.error('✗ No fixture at ' + FIX);
  console.error('');
  console.error('Capture it via Supabase SQL editor (replace the arrival_date');
  console.error('cutoff with whatever covers at least one filed group per host):');
  console.error('');
  console.error('  select json_agg(row_to_json(c)) from (');
  console.error('    select id, surname, name, sex, date_of_birth, place_of_birth,');
  console.error('           birth_province, birth_country, citizenship, document_type,');
  console.error('           document_number, doc_issue_place, arrival_date, departure_date,');
  console.error('           nights, guest_type, booking_code, submitted_at, alloggiati_status');
  console.error('    from public.checkins');
  console.error('    where deleted_at is null and is_test = false');
  console.error('      and arrival_date >= current_date - interval \'60 days\'');
  console.error('    order by submitted_at');
  console.error('  ) c;');
  console.error('');
  console.error('Save the JSON output to scripts/golden/fixtures.json.');
  process.exit(2);
}

const rows = JSON.parse(fs.readFileSync(FIX, 'utf8'));
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('✗ fixtures.json is not a non-empty array');
  process.exit(2);
}

const { lines, warnings, groupCount } = Allog.buildBatch(rows);
const body = lines.join('\r\n');

fs.writeFileSync(OUT, body);
const sha = crypto.createHash('sha256').update(body).digest('hex');

console.log('rows:        ' + rows.length);
console.log('groups:      ' + groupCount);
console.log('lines:       ' + lines.length);
console.log('warnings:    ' + warnings.length);
console.log('output:      ' + path.relative(process.cwd(), OUT));
console.log('sha256:      ' + sha);
console.log('bytes:       ' + Buffer.byteLength(body));
console.log('');
console.log('Browser-side comparison:');
console.log('  Open host-console as the owner → Export & Compliance →');
console.log('  Alloggiati panel → download alloggiati_<today>.txt → sha256sum.');
console.log('  Paste both lines in the PR. They MUST match.');
