import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../lib/alloggiati-records.js'), R = require('../lib/regional-exports.js');
const root = new URL('./fixtures/compliance/', import.meta.url);
const rows = JSON.parse(readFileSync(new URL('guests.json', root), 'utf8'));
const before = JSON.stringify(rows);
const batch = A.buildBatch(rows);
assert.deepEqual(batch.warnings, []); assert.equal(batch.groupCount, 3);
assert.deepEqual(batch.rowMeta.map(r => r.checkin_id), ['family-head', 'family-member', 'foreign-single', 'group-head', 'group-member']);
assert.equal(batch.lines.length, 5);
for (const line of batch.lines) {
  assert.equal(line.length, 168); assert.match(line, /^[\x20-\x7e]+$/);
}
// Assert layout independently of the saved baseline; these fields caused
// historical portal failures and cannot be blessed by updating a golden.
assert.equal(batch.lines[0].slice(0, 14), '1701/05/202603');
assert.equal(batch.lines[0].slice(105, 134), '412058091RM100000100100000100');
assert.equal(batch.lines[2].slice(105, 116), '           ', 'foreign comune AND provincia stay blank');
assert.equal(batch.lines[2].slice(116, 134), '100000215100000215');
assert.equal(batch.lines[2].slice(12, 14), '01');
assert.equal(batch.lines[0].slice(134, 139), 'IDENT');
assert.equal(batch.lines[2].slice(134, 139), 'PASOR');
assert.equal(batch.lines[3].slice(134, 139), 'PATEN');
for (const index of [1, 4]) assert.equal(batch.lines[index].slice(134), ' '.repeat(34), 'members omit document fields');

let checked = 0;
function golden(name, body) {
  assert.deepEqual(Buffer.from(body, 'utf8'), readFileSync(new URL(name, root)), name + ' exact bytes (including padding/BOM/CRLF)');
  checked++;
}
golden('alloggiati.txt', batch.lines.join('\r\n'));
const property = { id: 'fixture-property', name: 'Fictional & House', ross1000_codice: 'FICTIONAL-001', rooms_available: 3, beds_available: 6 };
const daily = Object.fromEntries(R.days('2026-05-01', '2026-05-04').map(date => [date,
  { open: 'SI', rooms: 3, beds: 6, occupied: date === '2026-05-01' ? 3 : date === '2026-05-04' ? 0 : 2 }]));
for (const format of ['ross', 'umbria', 'trento', 'ps', 'summary']) {
  const result = R.generate({ property, rows, daily, format, code: '12345', start: '2026-05-01', end: '2026-05-04', allog: A });
  assert.deepEqual(result.errors, [], format);
  assert.ok(result.files.length > 0);
  golden(format + '.json', JSON.stringify(result.files, null, 2) + '\n');
  if (format === 'ps') assert.equal(result.files[0].content, batch.lines.join('\r\n'), 'SPOT Easy agrees with national record layout');
  if (format !== 'ps') assert.ok(result.files.every(f => !/ESEMPIO|FICTIONAL-PASS|FICTIONAL-ID|FICTIONAL-DRIVE/.test(f.content)), format + ' excludes identity');
}
assert.equal(JSON.stringify(rows), before, 'serializers leave fixture input unchanged');
console.log('PASS ' + checked + ' committed synthetic goldens: Alloggiati, ROSS1000, Umbria, Trento STU, SPOT Easy PS and manual-reference CSV; independent record offsets/group/document/privacy checks');
