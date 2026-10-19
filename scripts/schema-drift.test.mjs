// Round 60b Phase 1 — offline test for the pure diff logic.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseFilename, diff, formatFailure } = require('../lib/schema-drift.js');

// parseFilename
assert.deepEqual(
  parseFilename('20261014145714_round57_cover_layout.sql'),
  { fileTimestamp: '20261014145714', name: 'round57_cover_layout', filename: '20261014145714_round57_cover_layout.sql' },
);
assert.equal(parseFilename('garbage.sql'), null, 'non-matching filename rejected');
assert.equal(parseFilename('20261014145714-missing-underscore.sql'), null, 'needs underscore after timestamp');
assert.equal(parseFilename('20261014145714_name_without_sql'), null, 'needs .sql extension');

// diff — all applied → ok
{
  const files = [
    '20261014092200_round55_share_preferences.sql',
    '20261014145714_round57_cover_layout.sql',
    '20261018100000_round60_bnb_rooms.sql',
  ];
  const applied = [
    { version: '20261014092424', name: 'round55_share_preferences' },
    { version: '20261014145714', name: 'round57_cover_layout' },
    { version: '20261018100000', name: 'round60_bnb_rooms' },
  ];
  const r = diff({ files, applied });
  assert.equal(r.ok, true, 'all applied passes');
  assert.deepEqual(r.missing, []);
}

// diff — the Round 57 pre-hotfix state → missing it, by name
{
  const files = [
    '20261014092200_round55_share_preferences.sql',
    '20261014145714_round57_cover_layout.sql',
    '20261018100000_round60_bnb_rooms.sql',
  ];
  const applied = [
    { version: '20261014092424', name: 'round55_share_preferences' },
    { version: '20261018100000', name: 'round60_bnb_rooms' },
  ];
  const r = diff({ files, applied });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 1);
  assert.equal(r.missing[0].name, 'round57_cover_layout');
  assert.equal(r.missing[0].file, '20261014145714_round57_cover_layout.sql');
}

// diff — timestamp drift (Round 55 case) is NOT a failure as long as name matches
{
  const files = ['20261014092200_round55_share_preferences.sql'];
  const applied = [{ version: '20261014092424', name: 'round55_share_preferences' }];
  const r = diff({ files, applied });
  assert.equal(r.ok, true, 'name match wins over timestamp drift');
}

// diff — extra applied rows (no committed file) are NOT a failure
{
  const files = ['20261018100000_round60_bnb_rooms.sql'];
  const applied = [
    { version: '20261018100000', name: 'round60_bnb_rooms' },
    { version: '20260425081207', name: 'historical_mcp_only_migration' },
    { version: '20260711150201', name: 'another_mcp_only' },
  ];
  const r = diff({ files, applied });
  assert.equal(r.ok, true, 'extra applied rows are fine (we only guard one direction)');
}

// diff — multiple missing → all surfaced
{
  const files = [
    '20260101000000_one.sql',
    '20260102000000_two.sql',
    '20260103000000_three.sql',
  ];
  const applied = [{ version: '20260102000000', name: 'two' }];
  const r = diff({ files, applied });
  assert.equal(r.ok, false);
  assert.equal(r.missing.length, 2);
  assert.deepEqual(r.missing.map(m => m.name).sort(), ['one', 'three']);
}

// diff — garbage filename in input is ignored, not crashed on
{
  const r = diff({
    files: ['not-a-migration.sql', '20260101000000_real.sql'],
    applied: [{ version: '20260101000000', name: 'real' }],
  });
  assert.equal(r.ok, true, 'unparseable filenames skipped');
}

// diff — empty inputs
{
  assert.deepEqual(diff({ files: [], applied: [] }), { missing: [], ok: true });
  assert.deepEqual(diff({ files: [], applied: [{ version: 'x', name: 'y' }] }), { missing: [], ok: true });
}

// formatFailure — produces a readable message naming each missing file
{
  const r = diff({
    files: ['20261014145714_round57_cover_layout.sql'],
    applied: [],
  });
  const msg = formatFailure({ missing: r.missing, projectRef: 'jcjwaqqabgwqhhzhfbts' });
  assert.ok(msg.includes('jcjwaqqabgwqhhzhfbts'));
  assert.ok(msg.includes('round57_cover_layout'));
  assert.ok(msg.includes('20261014145714_round57_cover_layout.sql'));
  assert.ok(msg.includes('apply_migration'));
}

console.log('PASS schema-drift diff: parse/filename, name-match wins over timestamp drift, extra applied allowed, missing enumerated, failure message carries project + filename + apply hint');
