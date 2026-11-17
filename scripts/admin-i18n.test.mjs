// 17 Nov 2026 — admin console translation engine (admin-i18n.js) and
// dictionary (admin-i18n-dict.js), without a browser: exact phrases both
// ways, values carried over, composite «a · b» texts, specific patterns before
// general ones, one-way entries, month names, data left alone, dictionary
// consistency (no English phrase with two Italian meanings).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ctx = { localStorage: { getItem: () => null, setItem() {} }, document: { readyState: 'complete', documentElement: {}, body: null, title: 'x', addEventListener() {}, getElementById: () => null } };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(read('admin-i18n-dict.js'), ctx);
vm.runInContext(read('admin-i18n.js'), ctx);
const { translate: T, lang } = ctx.AdminI18n;
assert.equal(lang, 'it', 'Italian by default');
const both = (en, it) => { assert.equal(T(en, 'it'), it, en); assert.equal(T(it, 'en'), en, it); };
both('Action needed', 'Da fare'); both('Users', 'Utenti'); both('Last activity', 'Ultima attività'); both('Extend trial', 'Estendi prova');
both('Action needed (3)', 'Da fare (3)'); both('Trial · ends 22/11/2026 (5 days)', 'Prova · scade il 22/11/2026 (5 gg)'); both('12 days ago', '12 gg fa');
assert.equal(T('2 sessions', 'it'), '2 sessioni'); assert.equal(T('1 property · 0 links · 0 check-ins', 'it'), '1 struttura · 0 link · 0 check-in');
assert.equal(T('across 1 property', 'it'), 'in 1 struttura', 'specific pattern before «{n} property»');
assert.equal(T('Copy link', 'en'), 'Copy link', 'one-way entries never rewrite English'); assert.equal(T('Test check-in', 'en'), 'Test check-in');
assert.equal(T('1 filing overdue (arr. 14 Nov)', 'it'), '1 invio in ritardo (arr. 14 nov)'); assert.equal(T('invitato il 15 nov 2026', 'en'), 'invited on 15 Nov 2026');
assert.equal(T('  Refresh\n  ', 'it'), '  Aggiorna\n  ', 'surrounding whitespace kept'); assert.equal(T('↻ Refresh', 'it'), '↻ Aggiorna'); assert.equal(T('Registrato ▼', 'en'), 'Registered ▼');
assert.equal(T('Where guests drop off in the check-in flow.\n   Big drops between steps signal UX or trust issues — investigate the highest-drop step first.', 'it').startsWith('Dove gli ospiti abbandonano'), true, 'line breaks inside a phrase');
for (const data of ['anna@example.invalid', 'Casa Rossa', 'HMA123', '00000000-0000-4000-8000-000000000001', '42', 'Is there a taxi to the airport?', 'ROSSI MARIO'])
  assert.equal(T(data, 'it'), data, 'data untouched: ' + data);
assert.equal(T('Property: 1 · Rules: 1 · Recos: 0', 'it'), 'Struttura: 1 · Regole: 1 · Consigli: 0');
// Dictionary consistency.
const dict = ctx.ADMIN_I18N_DICT;
const seen = new Map();
for (const [en, it, way] of dict) { if (way === 'to-en') continue; if (seen.has(en)) assert.equal(seen.get(en), it, 'one Italian meaning for «' + en + '»'); seen.set(en, it); }
for (const [en, it] of dict) assert.equal((en.match(/\{\w+\}/g) || []).sort().join(), (it.match(/\{\w+\}/g) || []).sort().join(), 'same values on both sides: ' + en);
assert.ok(dict.length > 700);
// Wiring.
const html = read('admin.html');
assert.match(html, /<script src="\/admin-i18n-dict\.js\?v=1"><\/script>\n<script src="\/admin-i18n\.js\?v=1"><\/script>/);
assert.match(html, /id="adminLangToggle"[^>]*data-i18n-skip/); assert.match(html, /<span class="top-bar-brand" data-i18n-skip>/);
console.log(`PASS admin i18n engine: ${dict.length} dictionary entries, Italian default, exact/pattern/composite translation both ways, specific patterns first, one-way entries, month names, whitespace kept, data untouched, consistent dictionary, wiring`);
