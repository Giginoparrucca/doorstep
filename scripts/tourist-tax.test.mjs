import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { hostFunctions } from './helpers/offline.mjs';

const A = createRequire(import.meta.url)('../lib/alloggiati-records.js');
const root = new URL('./fixtures/compliance/', import.meta.url);
const guests = JSON.parse(readFileSync(new URL('guests.json', root), 'utf8'));
let downloads = [], confirmations = 0;
const ctx = hostFunctions(['_ageAtArrival', '_normalizeTaxCfg', 'computeGuestTax', '_seasonMatches',
  '_nightsInsideQuarter', '_groupSizeFor', 'exportPayTourist'], {
  allCheckins: guests, propertyData: { cir_code: 'FICTIONAL-CIN' }, hostLang: 'it',
  lookupStateCode: A.lookupStateCode, lookupPoliceCode: A.lookupPoliceCode,
  isItalianCitizenshipCode: A.isItalianCitizenshipCode, sanitizeAllogName: A.sanitizeAllogName,
  confirm: () => { confirmations++; return true; }, toast: () => {}, track: () => {},
  alert: message => { throw Error('Unexpected export warning: ' + message); },
  downloadFile: (name, text) => downloads.push({ name, text }),
});
const guest = { name: 'ALFA', surname: 'ESEMPIO', date_of_birth: '2000-05-02', arrival_date: '2026-05-01' };
let checks = 0;
function tax(p, c = guest, context = {}) {
  return ctx.computeGuestTax(c, ctx._normalizeTaxCfg(p), { nightsInPeriod: 6, groupSize: 1, ...context });
}
function expect(p, extra, expected, context) {
  const result = tax(p, { ...guest, ...extra }, context);
  for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key + ': ' + JSON.stringify(extra));
  checks++;
}
const legacy = { tax_rate_eur: 3.5, tax_max_nights: 4, tax_exempt_under_age: 15 };
expect(legacy, {}, { amount: 14, taxable_nights: 4, over_cap_nights: 2, rule_exempt_nights: 0 });
expect(legacy, { date_of_birth: '2011-05-02' }, { amount: 0, taxable_nights: 0, over_cap_nights: 2, rule_exempt_nights: 4 });
expect(legacy, { date_of_birth: '2011-05-01' }, { amount: 14, taxable_nights: 4 }, {});
expect(legacy, { date_of_birth: null }, { amount: 14 }, {});
expect({ tax_rate_eur: 2 }, {}, { amount: 12, over_cap_nights: 0 });
expect({ tax_rate_eur: 0 }, {}, { amount: 0 });
expect({ tax_rate_eur: 3.5, tax_max_total_eur: 10 }, {}, { amount: 10 });
expect(legacy, {}, { amount: 0, nights_in_period: 0 }, { nightsInPeriod: 0 });
const youth = { id: 'youth', when: { age_min: 15, age_max: 25 }, effect: { type: 'percent_off', value: 20 } };
const rules = { ...legacy, tax_rules: [youth] };
for (const [dob, amount] of [['2011-05-02', 0], ['2011-05-01', 11.2], ['2000-05-02', 11.2], ['2000-05-01', 14]]) {
  expect(rules, { date_of_birth: dob }, { amount });
}
const groupRule = { id: 'group', when: { group_size_min: 26 }, effect: { type: 'percent_off', value: 20 } };
expect({ ...legacy, tax_rules: [groupRule] }, {}, { amount: 14 }, { groupSize: 25 });
expect({ ...legacy, tax_rules: [groupRule] }, {}, { amount: 11.2 }, { groupSize: 26 });
const seasonal = { id: 'winter', when: { date_from: '11-01', date_to: '03-31' }, effect: { type: 'fixed_rate', value: 1 } };
for (const [arrival, amount] of [['2026-12-15', 4], ['2026-02-15', 4], ['2026-06-15', 14]]) {
  expect({ ...legacy, tax_rules: [seasonal] }, { arrival_date: arrival }, { amount });
}
expect({ ...legacy, tax_rules: [youth, { id: 'fixed', when: {}, effect: { type: 'fixed_rate', value: 2 } }] }, {}, { amount: 8 });
const declared = { ...rules, tax_declared_exemptions: [{ id: 'resident', label: 'Resident', requires_documentation: true }] };
expect(declared, {}, { amount: 11.2, requires_documentation: false });
expect(declared, {}, { amount: 0, requires_documentation: true }, { declaredFlags: ['resident'] });
expect(declared, {}, { amount: 11.2 }, { declaredFlags: ['unknown'] });
assert.equal(ctx._nightsInsideQuarter({ arrival_date: '2026-03-30', departure_date: '2026-04-03', nights: 4 }, '2026-04-01', '2026-06-30'), 2);
const inputSnapshot = JSON.stringify(guests);
ctx.allCheckins = [...guests, { ...guests[0], is_test: true }, { ...guests[0], deleted_at: '2026-01-01' }, { ...guests[0], property_id: 'other' }];
assert.equal(ctx._groupSizeFor(guests[0]), 2, 'group size is property-scoped and excludes test/deleted rows');
assert.equal(ctx._groupSizeFor({ ...guests[0], booking_code: null }), 1);

ctx.allCheckins = [...guests, { ...guests[0], is_test: true, name: 'TEST-EXCLUDED' }, { ...guests[0], deleted_at: '2026-01-01', name: 'DELETED-EXCLUDED' }];
ctx.exportPayTourist();
assert.equal(downloads.length, 1); assert.equal(confirmations, 1, 'historical fixture export requires explicit fallback confirmation');
assert.deepEqual(Buffer.from(downloads[0].text), readFileSync(new URL('paytourist.csv', root)), 'PayTourist golden exact bytes');
const csvRows = downloads[0].text.split('\n').map(line => line.split(','));
assert.equal(csvRows.length, 5); assert.ok(csvRows.every(row => row.length === 19));
assert.deepEqual(csvRows.map(r => r[0]), ['G1', 'G1', 'G2', 'G3', 'G3']);
assert.equal(csvRows[0][1], 'ALFA'); assert.equal(csvRows[2][7], '2');
assert.equal(csvRows[2][12], '100000215', 'foreign birth resolves to state code');
assert.equal(JSON.stringify(guests), inputSnapshot);
ctx.propertyData = {}; ctx.exportPayTourist(); assert.equal(downloads.length, 1, 'missing CIN prevents export');
ctx.propertyData = { cir_code: 'FICTIONAL-CIN' }; ctx.confirm = () => false;
ctx.exportPayTourist(); assert.equal(downloads.length, 1, 'declining historical export prevents download');
console.log('PASS ' + checks + ' actual tourist-tax cases: age-at-arrival/legacy cap/season/group/best-rule/declaration/euro cap/period clipping; synthetic PayTourist bytes, grouping and exclusions');
