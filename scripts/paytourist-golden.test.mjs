// Round 60a Phase 2 — PayTourist CSV golden.
//
// The exportPayTourist function in host-console.html emits a 19-column
// comma-separated row per guest (format documented in-function around
// line 12232). This test extracts the function via VM, runs it against
// synthetic committed fixtures, and compares the resulting CSV
// byte-for-byte against the committed golden.
//
// Reuses the Alloggiati fixtures for the guest set (they're already
// synthetic PII-free). Fixture 5 (97-night stay) is dropped because
// it exceeds the 48-hour "recent" window — PayTourist filters that
// out unless confirm() is accepted. We cover both the ≤48h path
// (first 4 fixtures land, all recent) and the "no recent → all guests"
// path by toggling `today` and confirm().
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const Allog = require('../lib/alloggiati-records.js');

const here = dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
function slice(name) {
  const key = 'function ' + name + '(';
  const start = html.indexOf(key);
  assert.ok(start >= 0, 'cannot find ' + name);
  let end = html.indexOf('\n}', start);
  while (end >= 0) {
    const candidate = html.slice(start, end + 2);
    try { new vm.Script(candidate); return candidate; } catch { /* keep */ }
    end = html.indexOf('\n}', end + 2);
  }
  throw new Error('cannot extract ' + name);
}

const fixtures = JSON.parse(fs.readFileSync(
  new URL('./golden/synthetic/alloggiati-fixtures.json', import.meta.url), 'utf8'));

// Drop the 97-night stay — too far in the past for the 48h filter and
// not needed for PayTourist's CSV surface area.
// Fixtures omit is_test / deleted_at (fields the Alloggiati test
// doesn't care about); PayTourist's first filter needs them set.
const inScope = fixtures
  .filter(f => f.booking_code !== 'FIXTEST-005')
  .map(f => ({ ...f, is_test: false, deleted_at: null }));

const downloads = [];
let confirmSeen = 0;
let toasted = null;
let alerted = null;
// Freeze "now" at 2026-06-01 so the 48h window catches zero arrivals
// and the function takes the "no recent → confirm → all" path. All
// four synthetic scenarios then show up in the CSV, exercising the
// confirm() prompt and the fallback filter.
const ctxFreeze = Date.parse('2026-06-01T10:00:00Z');
const RealDate = Date;
function FrozenDate(arg) {
  if (!(this instanceof FrozenDate)) return new RealDate(ctxFreeze).toString();
  const d = arguments.length === 0 ? new RealDate(ctxFreeze) : new RealDate(arg);
  return d;
}
FrozenDate.now = () => ctxFreeze;
FrozenDate.parse = RealDate.parse.bind(RealDate);
FrozenDate.UTC = RealDate.UTC.bind(RealDate);

const context = vm.createContext({
  console,
  Date: FrozenDate,
  allCheckins: inScope,
  hostLang: 'it',
  propertyData: { cir_code: 'IT048017CNI00042F' },
  confirm: () => { confirmSeen++; return true; },
  toast: (m) => { toasted = m; },
  alert: (m) => { alerted = m; },
  track: () => {},
  downloadFile: (name, content) => { downloads.push({ name, content }); },
  // Lookups come from the shared alloggiati library — real behaviour.
  sanitizeAllogName: Allog.sanitizeAllogName,
  lookupStateCode: Allog.lookupStateCode,
  lookupPoliceCode: Allog.lookupPoliceCode,
  isItalianCitizenshipCode: Allog.isItalianCitizenshipCode,
});
vm.runInContext(slice('exportPayTourist'), context);
context.exportPayTourist();

assert.equal(downloads.length, 1, 'one CSV emitted');
const csv = downloads[0].content;

const goldenPath = resolve(here, 'golden/synthetic/paytourist-expected.csv');
if (process.env.REGEN_PAYTOURIST_GOLDEN) {
  fs.writeFileSync(goldenPath, csv);
  console.log('WROTE golden ' + goldenPath);
  process.exit(0);
}
if (!fs.existsSync(goldenPath)) {
  fs.writeFileSync(goldenPath, csv);
  console.log('CREATED golden ' + goldenPath);
}
const golden = fs.readFileSync(goldenPath, 'utf8');

if (csv !== golden) {
  const expectedLines = golden.split('\n');
  const actualLines = csv.split('\n');
  for (let i = 0; i < Math.max(expectedLines.length, actualLines.length); i++) {
    if (expectedLines[i] !== actualLines[i]) {
      console.error(`line ${i} differs:`);
      console.error('  expected:', JSON.stringify(expectedLines[i]));
      console.error('  actual:  ', JSON.stringify(actualLines[i]));
    }
  }
  assert.fail('PayTourist golden mismatch — regenerate with REGEN_PAYTOURIST_GOLDEN=1 after confirming the change is intentional');
}

// Structural asserts in addition to byte-for-byte.
const rows = csv.split('\n');
assert.equal(rows.length, 4, 'one row per guest in scope');
for (const [i, row] of rows.entries()) {
  const cols = row.split(',');
  assert.equal(cols.length, 19, `row ${i}: 19 CSV columns`);
  assert.ok(/^G\d+$/.test(cols[0]), `row ${i}: group id starts with G`);
  assert.equal(cols[6], 'IT048017CNI00042F', `row ${i}: CIN carried through`);
  assert.ok(['1', '2'].includes(cols[7]), `row ${i}: sex 1 or 2`);
  assert.equal(cols[9], '0', `row ${i}: exemption 0`);
  assert.equal(cols[10], '0', `row ${i}: reduction 0`);
  assert.equal(cols[17], '', `row ${i}: portal id empty`);
  assert.equal(cols[18], '1', `row ${i}: send receipt 1`);
}

// Group grouping — fixture 3 + 4 share booking_code FIXTEST-003, so same G id.
const [, , r3, r4] = rows;
assert.equal(r3.split(',')[0], r4.split(',')[0], 'shared booking_code → shared group id');

const sha = crypto.createHash('sha256').update(csv).digest('hex');
console.log(`PASS paytourist-golden: 4 synthetic rows byte-identical to committed golden (sha256 ${sha.slice(0, 16)}…)`);
