// Round 68 — lib/codice-fiscale.js. Synthetic codes only, never real ones.
// Expected check characters were derived with an independent
// implementation of the official odd/even tables.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const CF = createRequire(import.meta.url)('../lib/codice-fiscale.js');

const VALID = {
  TSTFNC90C41Z404: 'Q',
  PRVGST85M01H501: 'Z',
  ZZZYYY00A01Z999: 'N',
  DMMSNT72T55F205: 'M',
  PRVGST85M01H5LM: 'C', // omocodia: H501 with the last two digits substituted
};

for (const [body, check] of Object.entries(VALID)) {
  assert.equal(CF.checkChar(body), check, `check character for ${body}`);
  assert.equal(CF.isValid(body + check), true, `${body}${check} is valid`);
  const wrong = String.fromCharCode(65 + ((check.charCodeAt(0) - 65 + 1) % 26));
  assert.equal(CF.isValid(body + wrong), false, `${body}${wrong} has a wrong check character`);
}

// Normalisation: lowercase and spaces are accepted and cleaned.
assert.equal(CF.normalize(' tst fnc 90c41 z404q '), 'TSTFNC90C41Z404Q');
assert.equal(CF.isValid('tstfnc90c41z404q'), true);
assert.equal(CF.isValid('TSTFNC 90C41 Z404Q'), true);

// Shape: wrong length, bad month letter, digits where letters belong,
// non-omocodia letter in a digit slot, empty/null.
for (const bad of ['', null, undefined, 'TSTFNC90C41Z404', 'TSTFNC90C41Z404QQ',
  'TSTFNC90F41Z404Q', '1STFNC90C41Z404Q', 'TSTFNC9AC41Z404Q', 'TSTFNC90C41Z40-Q']) {
  assert.equal(CF.isValid(bad), false, `rejects ${JSON.stringify(bad)}`);
}

// Browser global is published too.
assert.equal(globalThis.CodiceFiscale, CF);

console.log(`PASS codice-fiscale: ${Object.keys(VALID).length} synthetic codes incl. omocodia validate with independently derived check characters; wrong check, bad shape and month rejected; lowercase/spaces normalised`);
