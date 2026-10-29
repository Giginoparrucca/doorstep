// Guest gateway must deliver host-written instructions the guest app reads
// via _propTextLang (checkin/checkout instructions, transport info). Runs the
// actual doProperty projection with stubbed reads, like cover-layout.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api = fs.readFileSync(new URL('../api/guest.js', import.meta.url), 'utf8');
const fields = api.match(/const PROPERTY_PUBLIC_FIELDS = (\[[\s\S]*?\]);/)[1];
const gated = api.match(/const PROPERTY_POST_CHECKIN_FIELDS = new Set\((\[[\s\S]*?\])\)/)[1];

const row = {
  id: 'fixture', name: 'Fixture',
  checkin_instructions: 'legacy in', checkin_instructions_it: 'Entrate dal cancello', checkin_instructions_en: 'Enter by the gate',
  checkout_instructions: 'legacy out', checkout_instructions_it: 'Lasciate le chiavi', checkout_instructions_en: 'Leave the keys',
  transport_info: 'legacy bus', transport_info_it: 'Bus a 50 m', transport_info_en: 'Bus 50 m away',
  host_email: 'private', owner_id: 'private',
};

let allowed = false, response, status;
const ctx = vm.createContext({
  encodeURIComponent,
  PROPERTY_PUBLIC_FIELDS: vm.runInNewContext(fields),
  PROPERTY_POST_CHECKIN_FIELDS: new Set(vm.runInNewContext(gated)),
  pgrestGET: async () => ({ ok: true, json: async () => [row] }),
  callRPC: async () => ({ ok: true, json: async () => null }),
  entryReleaseAllows: async () => allowed,
  loadGuestPropertyAccess: async () => ({
    policy: { state: allowed ? 'legacy_available' : 'locked', reason: 'stub', allow_entry: allowed, submitted: null, expected: null, release_at: null },
    entryProperty: {}, room: null,
  }),
  resolveGuestRoom: async () => null,
  Number: { isFinite: Number.isFinite }, Date,
});
const start = api.indexOf('async function doProperty(');
vm.runInContext(api.slice(start, api.indexOf('\n}\n', start) + 2), ctx);
const res = { setHeader() {}, status(v) { status = v; return this; }, json(v) { response = v; return v; } };

const PUBLIC = ['checkout_instructions', 'checkout_instructions_it', 'checkout_instructions_en',
  'transport_info', 'transport_info_it', 'transport_info_en'];
const ENTRY = ['checkin_instructions', 'checkin_instructions_it', 'checkin_instructions_en'];

// Before entry is released: check-out/transport visible, check-in hidden.
await ctx.doProperty(res, 'fixture', 'BOOK', false);
assert.equal(status, 200);
for (const k of PUBLIC) assert.equal(response.property[k], row[k], `${k} reaches the guest before release`);
for (const k of ENTRY) assert.ok(!(k in response.property), `${k} hidden until entry is released`);
assert.ok(!('host_email' in response.property) && !('owner_id' in response.property), 'private fields stay out');

// After release: everything visible.
allowed = true;
await ctx.doProperty(res, 'fixture', 'BOOK', false);
for (const k of [...PUBLIC, ...ENTRY]) assert.equal(response.property[k], row[k], `${k} reaches the guest after release`);

// Every per-language text the guest app reads through _propTextLang is allowlisted.
const guest = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const allow = new Set(vm.runInNewContext(fields));
for (const [, base] of guest.matchAll(/_propTextLang\(d, '([a-z_]+)'/g)) {
  for (const k of [base, `${base}_it`, `${base}_en`]) assert.ok(allow.has(k), `${k} read by guest app but missing from PROPERTY_PUBLIC_FIELDS`);
}

console.log('PASS guest gateway delivers check-out/transport text from the booking link, check-in instructions only after entry release, and allowlists every _propTextLang field the guest app reads');
