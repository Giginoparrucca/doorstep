// Round 67 Phase 2 — ROPA (GDPR Art. 30) structure and grounding check.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const doc = fs.readFileSync(new URL('docs/compliance/ROPA.md', root), 'utf8');

// Minimal parser for the subset the register uses: "key: value" and
// "key:" followed by "  - item" lines.
function parseBlock(text) {
  const out = {};
  let key = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      assert.ok(key && Array.isArray(out[key]), `list item without a list key: ${line}`);
      out[key].push(item[1].trim());
      continue;
    }
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    assert.ok(kv, `unparseable line: ${line}`);
    key = kv[1];
    assert.ok(!(key in out), `duplicate key ${key}`);
    out[key] = kv[2] ? kv[2].trim() : [];
  }
  return out;
}

const blocks = [...doc.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => parseBlock(m[1]));
const REQUIRED = ['purpose', 'data_subjects', 'personal_data', 'recipients',
  'international_transfers', 'retention', 'security_measures', 'legal_basis'];
const EXPECTED_IDS = ['guest-checkin-alloggiati', 'tourist-tax-regional', 'entry-codes',
  'marketing-consent', 'guest-chat-ai', 'ical-sync', 'ireservation', 'admin-access',
  'host-accounts', 'analytics', 'document-scan', 'host-terms-acceptance'];

assert.deepEqual(blocks.map(b => b.id), EXPECTED_IDS, 'one block per planned activity, in order (Round 69 adds host-terms-acceptance)');
for (const b of blocks) {
  assert.ok(typeof b.role === 'string' && /controller|processor/.test(b.role), `${b.id}: role names controller/processor`);
  for (const f of REQUIRED) {
    assert.ok(Array.isArray(b[f]) && b[f].length > 0 && b[f].every(Boolean), `${b.id}: ${f} must be a non-empty list`);
  }
  assert.ok(b.legal_basis.every(x => /Art\. 6\(1\)\([a-f]\)/.test(x) || /Art\. 28/.test(x)), `${b.id}: every legal basis cites Art. 6(1)(a-f) or Art. 28`);
  assert.ok(Array.isArray(b.evidence) && b.evidence.length > 0, `${b.id}: cites evidence files`);
  for (const f of b.evidence) assert.ok(fs.existsSync(new URL(f, root)), `${b.id}: evidence file ${f} exists`);
}

// Sub-processors named in the plan, with the real Supabase region.
for (const s of ['Supabase', 'Vercel', 'Anthropic', 'Resend', 'Telegram']) {
  assert.ok(new RegExp(`\\| ${s} \\|`).test(doc), `sub-processor table lists ${s}`);
}
assert.ok(/eu-west-1/.test(doc), 'Supabase region recorded');

// HIGH-GDPR-3 subsection cites line numbers that still match index.html.
const index = fs.readFileSync(new URL('index.html', root), 'utf8').split('\n');
const def = Number(doc.match(/defined at `index\.html:(\d+)`/)?.[1]);
const call = Number(doc.match(/call site, `index\.html:(\d+)`/)?.[1]);
const comment = Number(doc.match(/`index\.html:(\d+)` says the card/)?.[1]);
assert.ok(/^function showConsentCard\(/.test(index[def - 1] || ''), `index.html:${def} is the showConsentCard definition`);
assert.ok(/^\s*showConsentCard\(\);/.test(index[call - 1] || ''), `index.html:${call} is the showConsentCard call`);
assert.ok(/Only shown to the main guest/.test(index[comment - 1] || ''), `index.html:${comment} is the main-guest comment`);
assert.equal(index.filter(l => /showConsentCard\(\);/.test(l)).length, 1, 'exactly one call site');

// Retention jobs the register relies on are the ones the code defines.
const photo = fs.readFileSync(new URL('supabase/migrations/20261019140000_round60c_photo_retention_7days.sql', root), 'utf8');
assert.ok(/p_hours\s+integer DEFAULT 168/.test(photo), 'ID photos: 168 h after arrival');

console.log(`PASS round67-ropa: ${blocks.length} activities carry all eight Art. 30 fields, Art. 6/28 legal bases and existing evidence files; sub-processors listed; consent-card line citations match index.html; 7-day photo retention matches the migration`);
