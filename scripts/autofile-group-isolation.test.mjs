// Automatic Alloggiati filing keeps booking groups apart (Nov 2026 incident:
// one unresolvable citizenship left a member without its leader, the portal
// rejected the whole batch, and an unrelated valid group was never sent).
// Runs the actual processPropertyAutofile from api/alloggiati.js with
// fictional rows and a stubbed portal. No network, no real data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { supabaseAuthHeaders } from '../api/_supabase-auth.js';
import { createFilingEvidence } from '../api/_alloggiati-evidence.js';

const api = fs.readFileSync(new URL('../api/alloggiati.js', import.meta.url), 'utf8');
const extract = name => { const s = api.indexOf('async function ' + name + '('); return api.slice(s, api.indexOf('\n}\n', s) + 2); };
const property = '00000000-0000-4000-8000-000000000001';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Group A: leader + member; group B: leader + member.
const rows = [
  { id: id(11), booking_code: 'FICTIONAL-A', guest_type: 'head' },
  { id: id(12), booking_code: 'FICTIONAL-A', guest_type: 'member' },
  { id: id(21), booking_code: 'FICTIONAL-B', guest_type: 'head' },
  { id: id(22), booking_code: 'FICTIONAL-B', guest_type: 'member' },
].map(r => ({ ...r, property_id: property, arrival_date: '2026-10-26', submitted_at: '2026-10-26T00:00:00Z' }));
const lineOf = r => 'LINE-' + r.id.slice(-2);

async function run({ warnOn = [], rejectOn = [], rejectOnRetest = [] } = {}) {
  const patches = [], tests = [], sends = [], released = [];
  const RealDate = Date;
  class Clock extends RealDate { constructor(...a) { super(...(a.length ? a : ['2026-10-26T03:00:00Z'])); } static now() { return new Clock().getTime(); } }
  const context = vm.createContext({
    supabaseAuthHeaders, console: { warn() {}, error() {} }, Date: Clock, Set, Map, encodeURIComponent,
    createFilingEvidence, logFiling: async () => {}, redactSupport: v => v,
    AllogRecords: {
      autofileDueAt: () => new Date('2026-10-26T02:00:00Z'),
      buildBatch: list => ({
        lines: list.map(lineOf), rowMeta: list.map(r => ({ checkin_id: r.id })),
        warnings: list.map((r, i) => warnOn.includes(r.id) ? `⚠ Row ${i + 1}: X Y — couldn't resolve citizenship "ZZZ"` : null).filter(Boolean),
      }),
    },
    _romeDateYmd: () => '2026-10-26',
    sbGet: async q => {
      if (q.startsWith('checkins?')) return q.includes('select=booking_code') ? [] : rows;
      if (q.startsWith('host_alloggiati_credentials?')) return [{}];
      if (q.startsWith('alloggiati_filing_log?')) return [];
      throw Error('Unexpected query ' + q);
    },
    decryptCredentials: async () => ({ utente: 'USER', password: 'PASS', wskey: 'KEY' }),
    generateToken: async () => ({ token: 'TOKEN' }),
    soapTest: async ({ rows: lines }) => {
      const reject = tests.length === 0 ? rejectOn : rejectOnRetest;
      tests.push([...lines]);
      const perRow = lines.map(l => ({ ok: !reject.some(rid => lineOf({ id: rid }) === l), erroreDes: 'Fictional rejection' }));
      return { overall: { ok: perRow.every(r => r.ok) }, perRow };
    },
    soapSend: async ({ rows: lines }) => { sends.push([...lines]); return { overall: { ok: true }, perRow: lines.map(() => ({ ok: true })) }; },
    sbPatch: async (q, patch) => { patches.push({ q: decodeURIComponent(q), patch }); },
    SUPABASE_URL: 'https://fictional.invalid', SERVICE_KEY: 'FICTIONAL',
    fetch: async (_url, init) => ({ ok: true, json: async () => JSON.parse(init.body).p_ids }),
    _releaseClaimAndStamp: async (ids, reason) => { released.push({ ids: [...ids], reason }); },
    _bumpAttempts: async () => [], maybeFireFailuresAlert: async () => {}, maybeFireRejectionAlert: async () => {},
  });
  vm.runInContext(extract('pauseAutofileRows') + '\n' + extract('processPropertyAutofile'), context);
  const summary = await context.processPropertyAutofile({ id: property, alloggiati_autofile_mode: 'live' });
  return { patches, tests, sends, released, summary };
}
const stamped = (r, code) => r.patches.filter(p => p.patch.autofile_last_error === code).flatMap(p => (p.q.match(/[0-9a-f-]{36}/g) || []));

// 1. All valid: one batch with both groups, sent once.
let r = await run();
assert.deepEqual(r.sends, [rows.map(lineOf)]);

// 2. Our check fails group A's leader: its member is held back too; group B is sent.
r = await run({ warnOn: [id(11)] });
assert.deepEqual(stamped(r, 'builder_warning'), [id(11)]);
assert.deepEqual(stamped(r, 'group_member_invalid'), [id(12)], 'the leaderless member is held back');
assert.deepEqual(r.tests, [[lineOf(rows[2]), lineOf(rows[3])]], 'only group B is tested');
assert.deepEqual(r.sends, [[lineOf(rows[2]), lineOf(rows[3])]], 'group B is sent');

// 3. Portal Test rejects one row of group A: group A released, group B re-tested and sent.
r = await run({ rejectOn: [id(12)] });
assert.equal(r.tests.length, 2, 'remaining groups are tested again');
assert.deepEqual(r.tests[1], [lineOf(rows[2]), lineOf(rows[3])]);
assert.deepEqual(r.released[0], { ids: [id(11), id(12)], reason: 'test_rejected' }, 'whole group A released');
assert.deepEqual(r.sends, [[lineOf(rows[2]), lineOf(rows[3])]], 'group B sent after its own clean Test');

// 4. The re-test also rejects: nothing is sent (never Send after a rejected Test).
r = await run({ rejectOn: [id(12)], rejectOnRetest: [id(21)] });
assert.equal(r.tests.length, 2);
assert.deepEqual(r.sends, [], 'no Send when the re-test rejects');

// 5. Every group rejected: no re-test, no Send.
r = await run({ rejectOn: [id(12), id(22)] });
assert.equal(r.tests.length, 1);
assert.deepEqual(r.sends, []);

console.log('PASS autofile group isolation (actual processPropertyAutofile): all-valid batch sent once; a failing row holds back only its own group (member stamped group_member_invalid) while other groups are tested and sent; a portal Test rejection releases the rejected groups and re-tests the rest, sending only after that Test passes in full; a rejected re-test or all-rejected batch sends nothing');
