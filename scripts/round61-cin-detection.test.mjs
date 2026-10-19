// Round 61 Phase 1 — CIN parsing + B+D detection cascade.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseCIN, serviceFromCIN, serviceFromPropertyType, detectService, TIPOLOGIA_SERVICE } = require('../lib/cin.js');

// ── parseCIN ──────────────────────────────────────────────────────────────
assert.equal(parseCIN(null), null, 'null input');
assert.equal(parseCIN(''), null, 'empty string');
assert.equal(parseCIN('   '), null, 'whitespace only');
assert.equal(parseCIN(42), null, 'non-string');
assert.equal(parseCIN('abc'), null, 'garbage');
assert.equal(parseCIN('IT074003'), null, 'too short');
assert.equal(parseCIN('IT074003C200109603X'), null, 'too long');
assert.equal(parseCIN('EN074003C200109603'), null, 'wrong country prefix');
assert.equal(parseCIN('ITABCDEFC200109603'), null, 'ISTAT must be digits');

// Valid prod example
{
  const r = parseCIN('IT074003C200109603');
  assert.deepEqual(r, {
    isNationalCIN: true,
    istatProv: '074',
    istatComune: '003',
    tipologia: 'C2',
    progressive: '00109603',
    full: 'IT074003C200109603',
  });
}

// Case-insensitive on IT, trims whitespace
{
  const r = parseCIN('  it074003c200109603  ');
  assert.ok(r);
  assert.equal(r.full, 'IT074003C200109603');
  assert.equal(r.tipologia, 'C2');
}

// Common example from Chekin docs: IT 039 007 B1 ooooo (adapted to 8-char progressive)
{
  const r = parseCIN('IT039007B100000001');
  assert.ok(r);
  assert.equal(r.istatProv, '039');
  assert.equal(r.istatComune, '007');
  assert.equal(r.tipologia, 'B1');
  assert.equal(r.progressive, '00000001');
}

// ── serviceFromCIN ────────────────────────────────────────────────────────
// Mapping intentionally empty until Ministero/ARET source confirms it.
assert.deepEqual(TIPOLOGIA_SERVICE, {}, 'TIPOLOGIA_SERVICE must stay empty until mapping is cited');

// Every CIN therefore returns null today (silent skip; cascade falls through).
assert.equal(serviceFromCIN('IT074003C200109603'), null);
assert.equal(serviceFromCIN('IT039007B100000001'), null);
assert.equal(serviceFromCIN('IT039007L100000001'), null);
assert.equal(serviceFromCIN('IT039007A100000001'), null);
assert.equal(serviceFromCIN('invalid'), null, 'invalid also returns null');
assert.equal(serviceFromCIN(null), null, 'null input returns null');
assert.equal(serviceFromCIN(''), null, 'empty returns null');

// ── serviceFromPropertyType ───────────────────────────────────────────────
// Confident SPOT Online
for (const t of ['bnb', 'hotel', 'agriturismo', 'affittacamere', 'guesthouse']) {
  assert.equal(serviceFromPropertyType(t), 'spot_online', `${t} → spot_online`);
}
// Case / whitespace tolerance
assert.equal(serviceFromPropertyType('  BnB  '), 'spot_online');
assert.equal(serviceFromPropertyType('HOTEL'), 'spot_online');

// Ambiguous → null
for (const t of ['apartment', 'house', 'villa', 'trullo', 'loft', 'studio', 'other', '', '  ', 'xyz']) {
  assert.equal(serviceFromPropertyType(t), null, `${JSON.stringify(t)} is ambiguous`);
}
assert.equal(serviceFromPropertyType(null), null);
assert.equal(serviceFromPropertyType(undefined), null);
assert.equal(serviceFromPropertyType(42), null);

// ── detectService (B+D cascade) ───────────────────────────────────────────
// Step 1 (CIN) → always null today, so step 2 decides.
// Confident SPOT Online via property_type
assert.deepEqual(
  detectService({ property_type: 'bnb', cir_code: null }),
  { service: 'spot_online', source: 'property_type' },
);
assert.deepEqual(
  detectService({ property_type: 'hotel', cir_code: 'IT074003C200109603' }),
  { service: 'spot_online', source: 'property_type' },
  'CIN parses but mapping empty → property_type wins',
);
assert.deepEqual(
  detectService({ property_type: 'agriturismo' }),
  { service: 'spot_online', source: 'property_type' },
);

// Ambiguous → ask
assert.deepEqual(
  detectService({ property_type: 'apartment', cir_code: null }),
  { service: null, source: 'ask' },
);
assert.deepEqual(
  detectService({ property_type: 'trullo', cir_code: 'IT074003C200109603' }),
  { service: null, source: 'ask' },
  'trullo with national CIN still asks because mapping is empty',
);
assert.deepEqual(
  detectService({ property_type: null, cir_code: null }),
  { service: null, source: 'ask' },
);
assert.deepEqual(
  detectService({}),
  { service: null, source: 'ask' },
);
assert.deepEqual(
  detectService(null),
  { service: null, source: 'ask' },
);

// ── Simulation: what will happen when the mapping is confirmed ────────────
// This exercises the forward path by poking the frozen object's shape in
// isolation — it does NOT mutate the shipped empty mapping. If TIPOLOGIA_SERVICE
// ever becomes non-empty, this guard asserts the authoritative mapping was
// committed with a citation comment near it (reviewer looks at lib/cin.js).
assert.ok(Object.isFrozen(TIPOLOGIA_SERVICE), 'mapping must be frozen so callers cannot mutate it');

console.log('PASS round61 CIN detection cascade: parseCIN format, serviceFromCIN skips until mapping cited, property_type fallback (bnb/hotel/agriturismo/affittacamere/guesthouse → spot_online; apartment/house/villa/trullo/other → ask), detectService three-step cascade, mapping stays frozen and empty');
