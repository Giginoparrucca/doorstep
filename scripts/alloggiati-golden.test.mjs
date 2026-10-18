// Round 60a Phase 2 — Alloggiati .txt synthetic golden.
//
// Fully offline, no real PII. Reads the committed synthetic fixtures
// and compares the buildBatch(rows) output byte-for-byte against the
// committed expected .txt. If the line builder changes any padding,
// code table, group ordering, or produces a different warning set,
// one of these assertions fails.
//
// Where the previous golden-check lived on a gitignored real-PII
// fixture, this one commits both the input (fictional guests) and
// the expected output (168-char fixed-width records), so CI can
// enforce the contract on every PR without touching a real database.
//
// Scenarios covered:
//   1 — Italian single guest, passport, 3-night stay
//   2 — French single guest (foreign-born → provincia must be blank)
//   3 — Group head (Italian) + group member (German, foreign-born)
//   5 — Driving-licence doc_type (falls back to IDENT via lookup
//       default), long multi-night stay (97 nights fits padNum(2))
//
// Every row produces a 168-char record; empty warnings is a hard
// invariant for the synthetic set. If the fixtures grow, keep that
// invariant (fix fixture + regenerate golden in one commit).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const Allog = require('../lib/alloggiati-records.js');

const here = dirname(fileURLToPath(import.meta.url));
const goldDir = resolve(here, 'golden/synthetic');
const fixturesPath = resolve(goldDir, 'alloggiati-fixtures.json');
const expectedPath = resolve(goldDir, 'alloggiati-expected.txt');

const rows = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
assert.ok(Array.isArray(rows) && rows.length >= 4, 'need at least 4 fixtures');

const { lines, warnings, rowMeta, groupCount } = Allog.buildBatch(rows);
assert.equal(lines.length, rows.length, 'one line per fixture row');
assert.equal(warnings.length, 0, `synthetic fixtures should warn-free, got: ${JSON.stringify(warnings)}`);
assert.equal(groupCount, 4, '5 rows across 4 booking codes (one group has 2 members)');
assert.equal(rowMeta.length, rows.length, 'rowMeta parallel to rows');

for (const [i, line] of lines.entries()) {
  assert.equal(line.length, 168, `line ${i} should be 168 chars, got ${line.length}`);
}

// Scenario-specific invariants: a reader of this file can see what
// each fixture is supposed to prove at a glance.
// Field offsets per docs/MANUALEALBERGHI.pdf §12:
//   tipoAll[2] dataArrivo[10] permanenza[2] cognome[50] nome[30] sesso[1]
//   dataNascita[10] comuneNascita[9] provinciaNascita[2] statoNascita[9]
//   cittadinanza[9] tipoDoc[5] numDoc[20] luogoRilascio[9]  → total 168
const italian = lines[0];
assert.equal(italian.slice(0, 2), '16', 'single guest → tipoAll 16');
assert.equal(italian.slice(2, 12), '04/05/2026', 'DD/MM/YYYY arrival');
assert.equal(italian.slice(12, 14), '03', 'nights zero-padded to 2');
assert.equal(italian.slice(14, 64).trimEnd(), 'ROSSI', 'cognome padded to 50');
assert.equal(italian.slice(64, 94).trimEnd(), 'MARIO', 'nome padded to 30');
assert.equal(italian.slice(94, 95), '1', 'sesso M → 1');
assert.equal(italian.slice(95, 105), '15/01/1980', 'dataNascita DD/MM/YYYY');
assert.equal(italian.slice(114, 116), 'RM', 'Italian provincia preserved');

const french = lines[1];
assert.equal(french.slice(105, 114), '         ', 'foreign-born → comune_nascita 9 blanks');
assert.equal(french.slice(114, 116), '  ', 'foreign-born → provincia 2 blanks');
assert.notEqual(french.slice(116, 125).trim(), '', 'foreign-born → statoNascita present');

const groupHead = lines[2];
const groupMember = lines[3];
assert.equal(groupHead.slice(0, 2), '17', 'group head → tipoAll 17');
assert.equal(groupMember.slice(0, 2), '20', 'group member → tipoAll 20');
// Group member has no document — tipoDoc + numDoc + luogoRilascio all blank.
assert.equal(groupMember.slice(134, 139), '     ', 'group member tipoDoc blank');
assert.equal(groupMember.slice(139, 159), '                    ', 'group member numDoc 20 blanks');
assert.equal(groupMember.slice(159, 168), '         ', 'group member luogoRilascio 9 blanks');

const longStay = lines[4];
assert.equal(longStay.slice(12, 14), '97', 'nights 97 fits padNum(2)');

// Byte-for-byte golden comparison.
const expectedBytes = fs.readFileSync(expectedPath);
const actualBytes = Buffer.from(lines.join('\r\n'));
if (!actualBytes.equals(expectedBytes)) {
  const expectedSha = crypto.createHash('sha256').update(expectedBytes).digest('hex');
  const actualSha = crypto.createHash('sha256').update(actualBytes).digest('hex');
  console.error('expected sha256:', expectedSha);
  console.error('actual   sha256:', actualSha);
  // Line-by-line diff for human readability.
  const expLines = expectedBytes.toString('utf8').split('\r\n');
  for (let i = 0; i < Math.max(expLines.length, lines.length); i++) {
    if (expLines[i] !== lines[i]) {
      console.error(`line ${i} differs:`);
      console.error('  expected:', JSON.stringify(expLines[i]));
      console.error('  actual:  ', JSON.stringify(lines[i]));
    }
  }
  assert.fail('Alloggiati golden mismatch — see diff above');
}

console.log(`PASS alloggiati-golden: 5 synthetic rows, 4 groups, byte-identical to committed golden (sha256 ${crypto.createHash('sha256').update(expectedBytes).digest('hex').slice(0,16)}…)`);
