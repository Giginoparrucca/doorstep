// Round 60a Phase 2 — tourist tax engine (host-console.html).
//
// Verifies the pure `computeGuestTax(checkin, cfg, context)` function
// against the Round 37 (redux) spec in the function body: base rate,
// per-stay nights cap, age exemption via tax_exempt_under_age, declared
// exemptions beating ordinary rules, "best for the guest" rule choice
// (lowest resulting rate, exempt beats anything), and the per-person
// totalCap ceiling.
//
// Pure Node, no DOM, no I/O, no external services. Extracts the
// three functions from host-console.html by text slice so the tested
// code is the exact source that ships to hosts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
function slice(name) {
  const key = 'function ' + name + '(';
  const start = html.indexOf(key);
  assert.ok(start >= 0, 'cannot find ' + name);
  // Simple heuristic: find the matching \n}\n that leaves a valid
  // Script. (Same trick onboarding-test-isolation uses.)
  let end = html.indexOf('\n}', start);
  while (end >= 0) {
    const candidate = html.slice(start, end + 2);
    try { new vm.Script(candidate); return candidate; } catch { /* keep scanning */ }
    end = html.indexOf('\n}', end + 2);
  }
  throw new Error('cannot extract ' + name);
}
const context = vm.createContext({ console });
for (const name of ['_ageAtArrival', '_normalizeTaxCfg', '_seasonMatches', 'computeGuestTax']) {
  vm.runInContext(slice(name), context);
}

// ── Baseline: flat 1.50/night, no cap, no rules.
// Values coming out of the VM live in another realm, so `deepEqual`
// against a main-realm literal mis-fires on empty arrays/objects —
// compare lengths and primitives.
const flat = context._normalizeTaxCfg({ tax_rate_eur: 1.5 });
assert.equal(flat.rules.length, 0, 'no rules when no legacy exemption and no host rules');
assert.equal(flat.cap, null);
assert.equal(flat.baseRate, 1.5);

const stay3 = { surname: 'Rossi', name: 'Mario', date_of_birth: '1980-01-01', arrival_date: '2026-05-04' };
let r = context.computeGuestTax(stay3, flat, { nightsInPeriod: 3, groupSize: 1 });
assert.equal(r.amount, 4.5, '3 × 1.50 = 4.50');
assert.equal(r.taxable_nights, 3);
assert.equal(r.over_cap_nights, 0);
assert.equal(r.rule_applied, null);

// ── Cap at 7 nights.
const capped = context._normalizeTaxCfg({ tax_rate_eur: 2, tax_max_nights: 7 });
r = context.computeGuestTax(stay3, capped, { nightsInPeriod: 10, groupSize: 1 });
assert.equal(r.taxable_nights, 7, '10-night stay capped at 7');
assert.equal(r.over_cap_nights, 3);
assert.equal(r.amount, 14);

// ── Legacy exempt_under_age: a 10-year-old pays nothing when exempt_under_age=15.
const under = context._normalizeTaxCfg({ tax_rate_eur: 2, tax_exempt_under_age: 15 });
assert.ok(under.rules.some(x => x._legacy), 'legacy becomes implicit rule');
const child = { surname: 'Rossi', name: 'Luca', date_of_birth: '2015-06-01', arrival_date: '2026-05-04' };
r = context.computeGuestTax(child, under, { nightsInPeriod: 3, groupSize: 2 });
assert.equal(r.amount, 0, 'child under 15 is exempt');
assert.equal(r.rule_exempt_nights, 3);
assert.ok(r.rule_applied?._legacy, 'legacy rule reported');

// Edge: 14-year-old on arrival stays exempt (exempt_under_age=15 → age_max=14).
const almost15 = { surname: 'R', name: 'A', date_of_birth: '2011-06-01', arrival_date: '2026-05-04' };
r = context.computeGuestTax(almost15, under, { nightsInPeriod: 1, groupSize: 1 });
assert.equal(r.amount, 0);
// 15-year-old on arrival pays.
const just15 = { ...almost15, date_of_birth: '2010-05-04' };
r = context.computeGuestTax(just15, under, { nightsInPeriod: 1, groupSize: 1 });
assert.equal(r.amount, 2);

// ── Host rule: 50% off for groups ≥ 4.
const groupDisc = context._normalizeTaxCfg({
  tax_rate_eur: 2,
  tax_rules: [{ id: 'r1', when: { group_size_min: 4 }, effect: { type: 'percent_off', value: 50 } }],
});
r = context.computeGuestTax(stay3, groupDisc, { nightsInPeriod: 3, groupSize: 4 });
assert.equal(r.effective_rate, 1, '50% off a 2.00 base');
assert.equal(r.amount, 3);
r = context.computeGuestTax(stay3, groupDisc, { nightsInPeriod: 3, groupSize: 3 });
assert.equal(r.amount, 6, 'group of 3 → full rate');

// ── "Best for the guest" selection: exempt beats percent, lower rate beats higher.
const mixed = context._normalizeTaxCfg({
  tax_rate_eur: 2,
  tax_rules: [
    { id: 'r1', when: { group_size_min: 4 }, effect: { type: 'percent_off', value: 50 } },
    { id: 'r2', when: { nights_min: 7 }, effect: { type: 'exempt' } },
    { id: 'r3', when: { group_size_min: 4 }, effect: { type: 'fixed_rate', value: 0.75 } },
  ],
});
r = context.computeGuestTax(stay3, mixed, { nightsInPeriod: 7, groupSize: 4 });
assert.equal(r.amount, 0, 'exempt wins over any discount');
assert.equal(r.rule_applied.id, 'r2');

r = context.computeGuestTax(stay3, mixed, { nightsInPeriod: 3, groupSize: 4 });
// 50% off 2.00 = 1.00 vs. fixed 0.75 → fixed is lower.
assert.equal(r.amount, Math.round(3 * 0.75 * 100) / 100);
assert.equal(r.rule_applied.id, 'r3');

// ── Declared exemption beats every ordinary rule (host-attested documentation).
const declared = context._normalizeTaxCfg({
  tax_rate_eur: 2,
  tax_rules: [{ id: 'r', when: { group_size_min: 1 }, effect: { type: 'percent_off', value: 90 } }],
  tax_declared_exemptions: [{ id: 'd1', label: 'Disability', requires_documentation: true }],
});
r = context.computeGuestTax(stay3, declared, { nightsInPeriod: 3, groupSize: 1, declaredFlags: ['d1'] });
assert.equal(r.amount, 0);
assert.equal(r.declared_applied.id, 'd1');
assert.equal(r.requires_documentation, true);
assert.equal(r.taxable_nights, 0);
assert.equal(r.rule_exempt_nights, 3, 'all nights accounted for under rule_exempt (even though it was declared)');

// ── Per-person totalCap applied last.
const ceiling = context._normalizeTaxCfg({ tax_rate_eur: 5, tax_max_total_eur: 10 });
r = context.computeGuestTax(stay3, ceiling, { nightsInPeriod: 7, groupSize: 1 });
assert.equal(r.amount, 10, 'ceiling clips 7 × 5 = 35 → 10');

// ── No DOB → age bands skip the rule, not block it.
const ageBand = context._normalizeTaxCfg({
  tax_rate_eur: 2,
  tax_rules: [{ id: 'r', when: { age_min: 65 }, effect: { type: 'exempt' } }],
});
const noDOB = { surname: 'X', name: 'Y', arrival_date: '2026-05-04' };
r = context.computeGuestTax(noDOB, ageBand, { nightsInPeriod: 3, groupSize: 1 });
assert.equal(r.amount, 6, 'no DOB → age-banded rule skipped, base rate applies');

// ── Zero nights or missing rate → amount 0, no crash.
r = context.computeGuestTax(stay3, flat, { nightsInPeriod: 0, groupSize: 1 });
assert.equal(r.amount, 0);
r = context.computeGuestTax(stay3, context._normalizeTaxCfg({}), { nightsInPeriod: 3, groupSize: 1 });
assert.equal(r.amount, 0);

// ── Season wrap: 11-01 → 03-31 matches 15 Dec and 15 Feb but not 15 Jun.
assert.equal(context._seasonMatches('2026-12-15', '11-01', '03-31'), true);
assert.equal(context._seasonMatches('2026-02-15', '11-01', '03-31'), true);
assert.equal(context._seasonMatches('2026-06-15', '11-01', '03-31'), false);
assert.equal(context._seasonMatches('2026-05-10', '04-01', '09-30'), true);
assert.equal(context._seasonMatches('2026-11-10', '04-01', '09-30'), false);

console.log('PASS tourist-tax: baseline, cap, age exempt (legacy), group discount, best-rule selection, declared exemptions, totalCap, missing DOB, season wrap, degenerate inputs.');
