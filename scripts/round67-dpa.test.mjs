// Round 67 Phase 3 — DPA template (GDPR Art. 28) structure check.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const dpa = fs.readFileSync(new URL('docs/compliance/DPA_TEMPLATE.md', root), 'utf8');
const ropa = fs.readFileSync(new URL('docs/compliance/ROPA.md', root), 'utf8');
const headings = [...dpa.matchAll(/^#{2,3} (.+)$/gm)].map(m => m[1]);
const has = (re, what) => assert.ok(headings.some(h => re.test(h)), `missing section: ${what}`);

// Art. 28(3) preamble.
has(/Subject-matter and duration/, 'subject-matter and duration');
has(/Nature and purpose of processing/, 'nature and purpose');
has(/Type of personal data and categories of data subjects/, 'data types and data subjects');
has(/Obligations and rights of the controller/, 'controller obligations and rights');
has(/Processor obligations/, 'processor obligations');

// Art. 28(3)(a)-(h) and the plan's processor clauses.
has(/Documented instructions/, '(a) documented instructions');
has(/Confidentiality/, '(b) confidentiality');
has(/Security measures, Art\. 32/, '(c) security measures');
has(/Sub-processors/, '(d) sub-processors');
has(/data-subject requests/, '(e) data-subject requests');
has(/breach notification/i, '(f) breach notification to controller');
has(/DPIA/, '(f) DPIA and prior consultation');
has(/Deletion or return/, '(g) deletion or return');
has(/audit/i, '(h) information and audit');
has(/SCCs/, 'extra-EU transfers / SCCs');
has(/Approved sub-processors/, 'approved sub-processor list');
has(/Technical and organisational measures/, 'annex of measures');

// Key obligations stated in the body, not just headed.
assert.ok(/art\. 28\(3\)\(h\)/.test(dpa), 'processor must flag unlawful instructions (28(3)(h))');
assert.ok(/entro 24 ore/.test(dpa) && /art\. 33\(2\)/.test(dpa), 'breach notice to host within 24 h, citing 33(2)');
assert.ok(/15 giorni/.test(dpa) && /opporsi/.test(dpa), 'prior notice of new sub-processors with right to object');
assert.ok(/2021\/914/.test(dpa), 'cites the SCC decision');

// Sub-processor list matches the ROPA table.
// Open-Meteo receives property coordinates only, so it is not a sub-processor.
const HEADERS = ['Service', 'Sub-responsabile'];
const names = text => [...text.matchAll(/^\| ([A-Za-z][\w-]+) \|/gm)].map(m => m[1]).filter(n => !HEADERS.includes(n));
const ropaSubs = names(ropa.slice(ropa.indexOf('## Sub-processors'), ropa.indexOf('## Processing activities'))).filter(n => n !== 'Open-Meteo');
const dpaSubs = names(dpa.slice(dpa.indexOf('## 6.'), dpa.indexOf('## 7.')));
assert.ok(ropaSubs.length >= 6, `ROPA sub-processors parsed: ${ropaSubs}`);
for (const n of ropaSubs) assert.ok(dpaSubs.includes(n), `DPA lists ROPA sub-processor ${n}`);
for (const n of dpaSubs) assert.ok(ropaSubs.includes(n), `DPA sub-processor ${n} is in the ROPA`);
assert.ok(/eu-west-1/.test(dpa), 'Supabase region matches ROPA');

// Referenced documents exist.
for (const f of ['docs/compliance/ROPA.md', 'docs/compliance/BREACH_SOP.md', 'PLAN_round67_gdpr_paper_trail.md']) {
  assert.ok(fs.existsSync(new URL(f, root)), `${f} exists`);
}

console.log(`PASS round67-dpa: ${headings.length} sections cover every Art. 28(3) clause; 24 h breach notice, sub-processor objection right and SCCs stated; ${dpaSubs.length} sub-processors match the ROPA`);
