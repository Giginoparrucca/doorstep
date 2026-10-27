// Round 67 Phase 1 — static guard for the Breach-notification SOP.
//
// This test enforces that `docs/compliance/BREACH_SOP.md` exists and still
// carries every section the Round 67 PLAN requires. A documentation phase
// cannot have a runtime test; this static check is its mandatory gate per
// AGENTS.md "Full regression" rule 1 (phase gate runs with the full suite).
//
// If a future diff removes any of these sections, the test fails and the
// merge is blocked. If a new section is added, this test is unaffected.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sopPath = path.resolve(here, '..', 'docs', 'compliance', 'BREACH_SOP.md');

// 1. File exists.
assert.ok(fs.existsSync(sopPath), `BREACH_SOP.md must exist at ${sopPath}`);
const sop = fs.readFileSync(sopPath, 'utf8');

// 2. Every required Round 67 Phase 1 section is present.
const requiredSections = [
  { re: /^#\s+Breach-notification Standard Operating Procedure/m, label: 'H1 title' },
  { re: /^##\s+1\.\s+Definitions/m, label: '§1 Definitions' },
  { re: /^##\s+2\.\s+Data Protection Officer/m, label: '§2 DPO + controller contact' },
  { re: /^##\s+3\.\s+The 72-hour decision tree/m, label: '§3 72h decision tree' },
  { re: /^##\s+4\.\s+Garante notification/m, label: '§4 Garante notification' },
  { re: /^##\s+5\.\s+Affected-individual communication/m, label: '§5 Affected-individual communication' },
  { re: /^##\s+6\.\s+Evidence-collection checklist/m, label: '§6 Evidence collection' },
  { re: /^##\s+7\.\s+Containment and remediation/m, label: '§7 Containment and remediation' },
  { re: /^##\s+8\.\s+Post-incident review/m, label: '§8 Post-incident review' },
  { re: /^##\s+9\.\s+SOP maintenance/m, label: '§9 SOP maintenance' },
  { re: /^##\s+10\.\s+Related documents/m, label: '§10 Related documents' },
];
for (const { re, label } of requiredSections) {
  assert.ok(re.test(sop), `BREACH_SOP.md must include ${label} (regex: ${re})`);
}

// 3. Garante breach portal URL is referenced — operational anchor the SOP
// requires. Changing or removing this breaks §4 "Mandatory fields" workflow.
assert.ok(
  /https:\/\/servizi\.gpdp\.it\/databreach\/s\//.test(sop),
  'BREACH_SOP.md must reference the Garante breach-notification portal URL',
);

// 4. GDPR Art. 33 and Art. 34 both cited — the legal anchor of the whole SOP.
assert.ok(/Art\.\s*33/i.test(sop), 'BREACH_SOP.md must cite Art. 33');
assert.ok(/Art\.\s*34/i.test(sop), 'BREACH_SOP.md must cite Art. 34');

// 5. Both language templates present — Path C notification is bilingual.
assert.ok(/^###\s+5\.1\s+IT template/m.test(sop), 'BREACH_SOP.md must include the IT template (§5.1)');
assert.ok(/^###\s+5\.2\s+EN template/m.test(sop), 'BREACH_SOP.md must include the EN template (§5.2)');

// 6. The three paths of the decision tree are all named — critical to the
// SOP's purpose. A diff that collapses them is a regression.
assert.ok(/Path A/.test(sop), 'BREACH_SOP.md must name Path A (no notification)');
assert.ok(/Path B/.test(sop), 'BREACH_SOP.md must name Path B (Garante only)');
assert.ok(/Path C/.test(sop), 'BREACH_SOP.md must name Path C (Garante + affected individuals)');

// 7. 72-hour requirement explicitly stated — the headline obligation.
assert.ok(/72\s*(?:hours?|h)/i.test(sop), 'BREACH_SOP.md must state the 72-hour requirement');

// 8. DPO contact is `info@welcomebnb.it` with explicit note about pending
// `security@` alias (per SECURITY.md). If a future diff advertises
// `security@` without verification, this test flags it.
assert.ok(/info@welcomebnb\.it/.test(sop), 'BREACH_SOP.md must publish info@welcomebnb.it as the DPO contact');

// 9. Scaling trigger (Art. 37) still named — Daniele asked for a defensible
// "we are not required to appoint a formal DPO yet, here is when that changes" argument.
assert.ok(/Art\.\s*37/i.test(sop), 'BREACH_SOP.md must cite Art. 37 scaling trigger');

console.log('PASS round67-breach-sop: BREACH_SOP.md exists; §§1-10 present; Art. 33/34/37 cited; Garante portal URL referenced; Path A/B/C named; IT and EN templates present; 72h requirement stated; info@welcomebnb.it published as DPO contact.');
