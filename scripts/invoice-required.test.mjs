// Host setting: require the main guest's invoice details (7 Nov 2026).
// Actual server and guest-app functions, extracted by name; fictional data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const api = read('api/guest.js'), app = read('index.html'), console_ = read('host-console.html');
const fnFrom = (src, sig) => { const i = src.indexOf(sig); assert.ok(i >= 0, sig); return src.slice(i, src.indexOf('\n}\n', i) + 2); };
const line = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n', i) + 1); };

// ── Server rule ──
const ctx = vm.createContext({});
vm.runInContext(line(api, 'const ITALY_NAMES = ') + line(api, 'const MAIN_GUEST_TYPES = ') + fnFrom(api, 'function validateInvoiceRequired('), ctx);
const v = (rec, on = true) => [...ctx.validateInvoiceRequired(rec, on)]; // copy: cross-realm arrays
const full = { guest_type: 'single', residence_country: 'Germany', residence_address: 'Hauptstr. 1', residence_postcode: '10115', invoice_email: 'a@example.invalid' };
assert.deepEqual(v({ guest_type: 'single' }, false), [], 'off: nothing required (today\'s behaviour)');
assert.deepEqual(v(full), [], 'foreign resident: no codice fiscale or province needed');
assert.deepEqual(v({ guest_type: 'head', residence_country: 'Germany' }), ['residence_address', 'residence_postcode', 'invoice_email']);
assert.deepEqual(v({ ...full, guest_type: 'group', residence_country: 'Italia' }), ['fiscal_code', 'residence_province'], 'Italian resident: codice fiscale and province too');
assert.deepEqual(v({ ...full, residence_country: 'Italy', fiscal_code: 'RSSMRA80A01H501U', residence_province: 'RM' }), []);
for (const t of ['member', 'group_member', '', undefined]) assert.deepEqual(v({ guest_type: t }), [], 'companions are never asked: ' + t);
// Wired into both write paths; the update path checks the row as it will be, with its saved role.
assert.match(api, /errors\.push\(\.\.\.validateInvoiceRequired\(inRecord, rules\.invoiceRequired\)\);/);
assert.match(api, /const merged = \{ \.\.\.current, \.\.\.fields, guest_type: current\.guest_type \};/);
assert.match(api, /validateInvoiceRequired\(merged, rules\.invoiceRequired\)/);
assert.match(api, /select=region,invoice_required&limit=1/);
assert.match(api.match(/const PROPERTY_PUBLIC_FIELDS = (\[[\s\S]*?\]);/)[1], /'invoice_required'/, 'the guest app can read the setting');

// ── Guest app rule ──
const g = vm.createContext({ propertyData: { invoice_required: true }, lang: 'it', T: { it: {
  val_invoice_address_required: 'ADDR', val_invoice_postcode_required: 'CAP', val_invoice_email_required: 'MAIL', val_fiscal_code_required: 'CF', val_residence_province: 'PROV' } },
  isItalianCountry: c => /^ital/i.test(c) });
vm.runInContext(fnFrom(app, 'function _invoiceRequired(') + fnFrom(app, 'function _invoiceRequiredErrors('), g);
const vals = o => k => o[k];
const gErr = (get, c) => [...g._invoiceRequiredErrors(get, c)];
assert.deepEqual(gErr(vals({}), 'Germany'), ['ADDR', 'CAP', 'MAIL']);
assert.deepEqual(gErr(vals({ address: 'x', postcode: '1', email: 'e' }), 'Italia'), ['CF', 'PROV']);
assert.deepEqual(gErr(vals({ address: 'x', postcode: '1', email: 'e', fiscal: 'f', province: 'RM' }), 'Italia'), []);
g.propertyData = { invoice_required: false }; assert.deepEqual(gErr(vals({}), 'Italia'), [], 'off: optional as before');
assert.match(app, /const req = _invoiceRequiredErrors\(k => document\.getElementById\(ids\[k\]\)\?\.value, country\);/, 'new check-in path');
assert.match(app, /const _req = _invoiceRequiredErrors\(k => document\.getElementById\(_edIds\[k\] \+ idx\)\?\.value, _rcVal\);/, 'edit path');
assert.match(app, /if \(main && _invoiceRequired\(\)\) \{[\s\S]{0,300}toggleInvoiceSection\(true\);/, 'section opens with the required label');
assert.match(app, /invoice_toggle_required: "Dati per la fattura \(richiesti dall'host\)"/);

// ── Host console setting ──
assert.match(console_, /<input type="checkbox" id="propInvoiceRequired"/);
assert.match(console_, /invoice_required: document\.getElementById\('propInvoiceRequired'\)\?\.checked === true,/);
assert.match(console_, /'questura_pec','invoice_required'\]/);
assert.match(console_, /el\('propInvoiceRequired'\)\.checked = data\.invoice_required === true;/);
assert.match(console_, /invoice_required_label: 'Richiedi i dati per la fattura all’ospite principale'/);

// ── Migration ──
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite(); await db.exec('create table public.properties(id serial primary key);');
  const sql = read('supabase/migrations/20261107090000_invoice_required.sql'); await db.exec(sql); await db.exec(sql);
  await db.query('insert into public.properties default values');
  assert.equal((await db.query('select invoice_required from public.properties')).rows[0].invoice_required, false, 'default off');
}
console.log('PASS invoice required: off by default (optional as before); on → main guest (single/head/group) needs street, postcode, invoice email, plus codice fiscale and province when resident in Italy; companions never; enforced on insert and edit server-side with the saved role; guest app opens the section with the required label and checks both paths; console switch saved and filled; migration default false');
