// Document country codes ("ITA", "D") translate to Alloggiati state codes;
// the guest app turns scanned codes into accepted names; every country the
// guest form accepts can be translated by the police export. Nov 2026
// incident: citizenship "ITA" from a document scan blocked a whole batch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Allog = require('../lib/alloggiati-records.js');
const ISO = require('../lib/country-iso3.js');

// Every mapped name exists in the official table.
for (const [code, name] of Object.entries(ISO.ISO3)) {
  assert.ok(Allog.STATI[name], `${code} → ${name} must be an Alloggiati state`);
}
assert.ok(Object.keys(ISO.ISO3).length >= 190, 'covers the world');
// Codes resolve, names behave exactly as before.
for (const [v, code] of [['ITA', '100000100'], ['ita', '100000100'], [' ITA ', '100000100'], ['DEU', '100000216'], ['D', '100000216'],
  ['GBR', '100000219'], ['FRA', '100000215'], ['USA', Allog.STATI["STATI UNITI D'AMERICA"]], ['Italy', '100000100'], ['Germania', '100000216']]) {
  assert.equal(Allog.lookupStateCode(v), code, v);
}
assert.equal(Allog.lookupStateCode('XYZ').trim(), '', 'unknown codes stay unresolved');
assert.equal(Allog.lookupStateCode('Wakanda').trim(), '');
assert.equal(ISO.toAllogName('ITALIA'), null, 'only short codes are codes');

// Guest app: accepted set, scan normalisation (actual functions from index.html).
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const slice = (start, end) => { const a = html.indexOf(start); assert.ok(a > 0, start); return html.slice(a, html.indexOf(end, a) + end.length); };
const ctx = vm.createContext({ window: { CountryISO3: ISO } });
vm.runInContext([
  slice('const COUNTRY_ALIASES = {', '};'),
  slice('function _normKey(s) {', '\n}\n'),
  slice('const _wbnbCountryAcceptSet = (() => {', '})();'),
  slice('function _scanCountry(v) {', '\n}\n'),
  slice('function wbnbAcceptsCountry(input) {', '\n}\n'),
  'this.accepted = [..._wbnbCountryAcceptSet]; this._scanCountry = _scanCountry; this.wbnbAcceptsCountry = wbnbAcceptsCountry;',
].join('\n'), ctx);
assert.equal(ctx.wbnbAcceptsCountry('ITA'), false, 'the form itself still rejects raw codes');
assert.equal(ctx._scanCountry('ITA'), 'ITALIA', 'scanned ITA becomes ITALIA');
assert.equal(ctx._scanCountry('D'), 'GERMANIA');
assert.equal(ctx._scanCountry('Italy'), 'Italy', 'accepted names unchanged');
assert.equal(ctx._scanCountry('XYZ'), '', 'unknown scan value left for the guest to pick');
assert.equal(ctx._scanCountry(''), '');
// Every value the guest form accepts must translate (caught SAUDI ARABIA, SLOVACCHIA).
const unresolved = ctx.accepted.filter(v => !Allog.lookupStateCode(v).trim());
assert.deepEqual([...unresolved], [], 'guest-accepted countries the export cannot translate');

// The guest app loads the table, and re-checks countries right before saving.
assert.ok(html.includes('<script src="/lib/country-iso3.js?v=1"></script>'));
const save = slice('async function saveCurrentGuest() {', '\n}\n');
assert.ok(/wbnbAcceptsCountry\(cit\)/.test(save) && /wbnbAcceptsCountry\(bc\)/.test(save), 'pre-save country check');
assert.ok(save.indexOf('wbnbAcceptsCountry(cit)') < save.indexOf("_guestCall('checkin_insert'") || !save.includes("_guestCall('checkin_insert'"), 'check runs before the save call');
// The console loads the table before the Alloggiati library.
const console_ = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
assert.ok(console_.indexOf('/lib/country-iso3.js') < console_.indexOf('/lib/alloggiati-records.js'));

console.log(`PASS country-iso3: ${Object.keys(ISO.ISO3).length} document codes map to Alloggiati states; ITA/D/DEU/GBR resolve, names unchanged, unknowns stay blank; scanned codes become accepted names or are left empty; all ${ctx.accepted.length} guest-accepted countries translate; pre-save check and script order in place`);
