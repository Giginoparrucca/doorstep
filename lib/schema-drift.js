// Round 60b Phase 1 — pure diff logic between committed migration
// filenames and the rows in supabase_migrations.schema_migrations on a
// Supabase database.
//
// Match on the migration NAME (the part after the leading 14-digit
// timestamp), not the full version string. In production right now
// Round 55 is committed as `20261014092200_round55_share_preferences.sql`
// but the applied row is `20261014092424` because of how it was
// registered — the migration is correctly applied, only the recorded
// timestamp drifted. The guard's job is to catch a file whose DDL never
// ran, not to police timestamps.
//
// A migration file whose name has no matching row is a drift the test
// must fail on. A row on prod whose name is not in the committed tree is
// NOT a failure — we only guard against the "committed but never
// applied" direction. Rows applied directly via MCP without a committed
// file (the dominant historical pattern) are fine.

const FILENAME_RE = /^(\d{14})_(.+)\.sql$/;

function parseFilename(filename) {
  const m = FILENAME_RE.exec(filename);
  if (!m) return null;
  return { fileTimestamp: m[1], name: m[2], filename };
}

function parseRequiredNames(value) {
  if (value == null || value === '') return [];
  const names = JSON.parse(value);
  if (!Array.isArray(names) || names.length > 32
    || names.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,99}$/.test(name))) {
    throw new Error('Required migrations must be a JSON array of at most 32 snake_case names');
  }
  return [...new Set(names)];
}

function diff({ files, applied, required = [] }) {
  const parsedFiles = (files || [])
    .map(parseFilename)
    .filter(x => x !== null);
  const appliedNames = new Set((applied || []).map(r => r.name));
  const missing = [];
  for (const f of parsedFiles) {
    if (!appliedNames.has(f.name)) {
      missing.push({ file: f.filename, name: f.name, fileTimestamp: f.fileTimestamp });
    }
  }
  for (const name of parseRequiredNames(JSON.stringify(required))) {
    if (!appliedNames.has(name) && !missing.some(item => item.name === name)) {
      missing.push({ file: 'required migration: ' + name, name, fileTimestamp: null });
    }
  }
  return { missing, ok: missing.length === 0 };
}

function formatFailure({ missing, projectRef }) {
  const header = `Schema drift detected on project ${projectRef}: ` +
    `${missing.length} committed migration file(s) have no matching ` +
    `row in supabase_migrations.schema_migrations.`;
  const lines = missing.map(m => {
    const applyHint = `mcp__Supabase__apply_migration(project_id='${projectRef}', name='${m.name}', ...)`;
    return `  - ${m.file}\n      name: ${m.name}\n      apply: ${applyHint}`;
  });
  return header + '\n' + lines.join('\n');
}

module.exports = { parseFilename, parseRequiredNames, diff, formatFailure };
