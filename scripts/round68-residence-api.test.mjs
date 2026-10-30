// Round 68 — guest gateway enforces residence and checks invoice details,
// even when the browser check is bypassed. Runs the actual doCheckinInsert /
// doCheckinUpdate from api/guest.js against stubbed REST reads and writes.
// Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const source = fs.readFileSync(new URL('../api/guest.js', import.meta.url), 'utf8');
const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const handlers = slice('async function doCheckinInsert(', '// ── action: checkin_lookup');
const helpers = source.slice(source.indexOf('function pickFields('));
const list = name => vm.runInNewContext(source.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`))[1]);

const VALID_CF = 'TSTFNC90C41Z404Q'; // synthetic, see scripts/codice-fiscale.test.mjs
let region = 'Puglia';
let regionReadOk = true;
let currentRow = null;
let inserted = [];
let patched = [];

const ctx = vm.createContext({
  console, Date, Promise, encodeURIComponent, Number, Set,
  SUPABASE_URL: 'https://database.invalid', SERVICE_KEY: 'test',
  supabaseAuthHeaders: () => ({}),
  CHECKIN_WRITE_FIELDS: list('CHECKIN_WRITE_FIELDS'),
  CHECKIN_READ_FIELDS: list('CHECKIN_READ_FIELDS'),
  CodiceFiscale: createRequire(import.meta.url)('../lib/codice-fiscale.js'),
  mintWalkinCode: () => 'WB-TEST',
  recordUsage: async () => {},
  submitEntryCheckin: async () => ({ enabled: false }),
  callRPC: async () => ({ ok: true, json: async () => null }),
  entryReleaseAllows: async () => true,
  pgrestGET: async (path) => {
    if (path.startsWith('properties?')) {
      if (!regionReadOk) return { ok: false, json: async () => null };
      return { ok: true, json: async () => [{ region }] };
    }
    if (path.startsWith('checkins?')) return { ok: true, json: async () => (currentRow ? [currentRow] : []) };
    return { ok: true, json: async () => [] };
  },
  fetch: async (url, opts = {}) => {
    if (opts.method === 'POST' && url.endsWith('/checkins')) {
      const row = JSON.parse(opts.body);
      inserted.push(row);
      return { ok: true, json: async () => [{ ...row, id: 'new-row' }] };
    }
    if (opts.method === 'PATCH' && url.includes('/checkins?id=eq.')) {
      const patch = JSON.parse(opts.body);
      patched.push(patch);
      return { ok: true, json: async () => [{ ...currentRow, ...patch, guest_type: 'member' }] };
    }
    return { ok: true, json: async () => null, text: async () => '' };
  },
});
vm.runInContext(helpers + '\n' + handlers, ctx);

const base = {
  guest_type: 'single', surname: 'Prova', name: 'Ospite', sex: 'F', date_of_birth: '1990-03-01',
  citizenship: 'Italia', document_type: 'IDENT', document_number: 'TEST000',
  arrival_date: '2026-11-02', departure_date: '2026-11-05', nights: 3,
};

async function insert(record) {
  let status, body;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return b; } };
  await ctx.doCheckinInsert(res, 'property', 'BOOK', 'session', { record }, false);
  return { status, body };
}
async function update(fields) {
  let status, body;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return b; } };
  await ctx.doCheckinUpdate(res, 'property', 'BOOK', 'session', { id: 'row-1', fields }, false, Math.floor(Date.now() / 1000) + 3600);
  return { status, body };
}

// ── Residence on insert ────────────────────────────────────────────────
for (const r of ['Puglia', null]) { // includes a property with no region set
  region = r;
  let out = await insert({ ...base });
  assert.equal(out.status, 400, `missing residence rejected (region ${r})`);
  assert.deepEqual([...out.body.fields], ['residence_country']);
  out = await insert({ ...base, residence_country: 'Italia' });
  assert.deepEqual([...out.body.fields], ['residence_place'], 'Italian resident needs a comune');
  out = await insert({ ...base, residence_country: 'Italia', residence_place: 'Bari' });
  assert.equal(out.status, 200, 'Italian resident with comune accepted');
  out = await insert({ ...base, residence_country: 'Germany' });
  assert.equal(out.status, 200, 'foreign resident without city accepted');
}

// Members need their own residence too.
region = 'Puglia';
let out = await insert({ ...base, guest_type: 'member', document_type: '', document_number: '' });
assert.deepEqual([...out.body.fields], ['residence_country'], 'member residence required');

// Alto Adige: postcode required for every guest.
region = 'Alto Adige';
out = await insert({ ...base, residence_country: 'Germany' });
assert.deepEqual([...out.body.fields], ['residence_postcode'], 'Alto Adige needs postcode');
out = await insert({ ...base, guest_type: 'member', document_type: '', document_number: '',
  residence_country: 'Austria', residence_postcode: '6020' });
assert.equal(out.status, 200, 'Alto Adige member with postcode accepted');
assert.equal(inserted.at(-1).residence_postcode, '6020');

// Region unreadable → fail closed, nothing inserted.
region = 'Puglia'; regionReadOk = false;
const before = inserted.length;
out = await insert({ ...base, residence_country: 'Germany' });
assert.equal(out.status, 503); assert.equal(inserted.length, before);
regionReadOk = true;

// ── Invoice details ───────────────────────────────────────────────────
const it = { ...base, residence_country: 'Italia', residence_place: 'Bari' };
out = await insert({ ...it, fiscal_code: 'TSTFNC90C41Z404A' });
assert.deepEqual([...out.body.fields], ['fiscal_code'], 'wrong check character rejected');
out = await insert({ ...it, fiscal_code: ' tstfnc90c41z404q ', residence_address: ' Via Prova 1 ',
  residence_postcode: ' 70121 ', residence_province: 'ba' });
assert.equal(out.status, 200);
const saved = inserted.at(-1);
assert.equal(saved.fiscal_code, VALID_CF, 'codice fiscale normalised');
assert.equal(saved.residence_address, 'Via Prova 1');
assert.equal(saved.residence_postcode, '70121');
assert.equal(saved.residence_province, 'BA', 'provincia uppercased');
out = await insert({ ...it, fiscal_code: '', residence_province: '' });
assert.equal(out.status, 200, 'empty invoice section submits as today');
assert.equal(inserted.at(-1).fiscal_code, null); assert.equal(inserted.at(-1).residence_province, null);
out = await insert({ ...it, residence_province: 'BAR' });
assert.deepEqual([...out.body.fields], ['residence_province']);
out = await insert({ ...it, residence_address: 'x'.repeat(121) });
assert.deepEqual([...out.body.fields], ['residence_address']);

// ── Residence on update (older rows) ───────────────────────────────────
region = 'Puglia';
currentRow = { id: 'row-1', residence_country: null, residence_place: null, residence_postcode: null };
out = await update({ surname: 'Corretto' });
assert.equal(out.status, 400, 'editing an old row without residence asks for it');
assert.deepEqual([...out.body.fields], ['residence_country']);
assert.equal(patched.length, 0, 'nothing written');
out = await update({ surname: 'Corretto', residence_country: 'Italia', residence_place: 'Lecce' });
assert.equal(out.status, 200, 'old row saved once residence is added');
assert.equal(patched.at(-1).residence_place, 'Lecce');

currentRow = { id: 'row-1', residence_country: 'France', residence_place: null, residence_postcode: null };
out = await update({ surname: 'Corretto' });
assert.equal(out.status, 200, 'row that already has residence edits freely');
out = await update({ fiscal_code: 'BADCODE' });
assert.deepEqual([...out.body.fields], ['fiscal_code']);
out = await update({ fiscal_code: '' });
assert.equal(out.status, 200); assert.equal(patched.at(-1).fiscal_code, null, 'clearing stores null');

region = 'Alto Adige';
out = await update({ surname: 'Corretto' });
assert.deepEqual([...out.body.fields], ['residence_postcode'], 'Alto Adige edit needs postcode');

// Door-code validation is untouched.
assert.ok(!/residence|fiscal_code/.test(fs.readFileSync(new URL('../api/_entry-submission-validation.js', import.meta.url), 'utf8')),
  'entry-release validation does not depend on residence or invoice fields');

console.log('PASS round68-residence-api: residence required on insert and update for main guests and members on every property (incl. no region), comune for Italians, postcode in Alto Adige, fail-closed region read; invoice fields normalised, codice fiscale/provincia/length checks; entry validation untouched');
