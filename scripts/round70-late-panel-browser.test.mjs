// Round 70 Phase 2 — «Invio tardivo» in the console. Actual host-console.html
// code (Round 70 block, row chip, export preparation) with the real
// lib/alloggiati-records.js in Chromium, IT/EN × 390/1440. Fictional rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root), 'utf8');
const source = read('host-console.html');
const Allog = require('../lib/alloggiati-records.js');
const slice = (a, b) => { const i = source.indexOf(a); assert.ok(i > 0, a); return source.slice(i, source.indexOf(b, i)); };
const fn = name => { const i = source.indexOf('function ' + name + '('); assert.ok(i > 0, name); return source.slice(i, source.indexOf('\n}\n', i) + 3); };
const block = slice('// ── Round 70 — «Invio tardivo»: late Alloggiati filing', '// Round 49 Phase 4 — the per-row autofile chip.');
assert.ok(!/innerHTML/.test(block.slice(block.indexOf('function openLateFilingPanel'))), 'panel builds the DOM with textContent');

// Static: the PEC field is saved with the settings, validated, filled.
assert.ok(/settingsKeys = new Set\(\[[^\]]*'questura_pec'[^\]]*\]\)/.test(source), 'questura_pec saved with Settings');
assert.ok(source.includes("questura_pec: (document.getElementById('propQuesturaPec')?.value || '').trim().toLowerCase() || null,"));
assert.ok(source.includes("if (el('propQuesturaPec')) el('propQuesturaPec').value = data.questura_pec || '';"));
assert.ok(source.includes("toast(h('questura_pec_invalid'))"), 'malformed PEC refused before saving');
assert.ok(/\.from\('properties'\)\.update\(update\)\.eq\('id', propertyId\)\.select\('id'\)\.maybeSingle\(\);\n\s+if \(!error && !saved\)/.test(source), 'a 0-row save is reported, never silent');

// Fixture: NOW = 3 Nov 2026 10:00 Rome. Group LATE (arrival 31 Oct) is late;
// group OK (arrival 2 Nov) still fileable; group FUT not arrived.
const NOW = '2026-11-03T09:00:00Z';
const g = (id, code, arrival, type, extra = {}) => ({ id, booking_code: code, arrival_date: arrival, departure_date: '2026-11-07', nights: 4,
  guest_type: type, surname: 'FICTIONAL' + id.slice(-1), name: 'GUEST' + id.slice(-1), sex: 'F', date_of_birth: '1980-01-01',
  place_of_birth: 'Berlin', birth_country: 'Germany', citizenship: 'Germany', document_type: type === 'member' ? '' : 'passport',
  document_number: type === 'member' ? '' : 'FICT123', doc_issue_place: 'Berlin', alloggiati_status: 'pending', is_test: false,
  deleted_at: null, autofile_excluded: false, submitted_at: '2026-10-30T10:00:00Z', property_id: 'p1', ...extra });
const rows = [g('l1', 'CAR-LATE01', '2026-10-31', 'head'), g('l2', 'CAR-LATE01', '2026-10-31', 'member'),
  g('o1', 'CAR-OK0001', '2026-11-02', 'single')];
const lateRows = rows.slice(0, 2);
const expectedFile = Allog.buildBatch(lateRows).lines.join('\r\n');
const prop = { id: 'p1', name: 'Fictional House', cir_code: 'IT000000C2FICTIONAL', address: 'Via Prova 1', zip: '00100', city: 'Roma',
  host_names: 'Fictional Host', host_phone: '+39 000 0000', host_email: 'host@example.invalid', questura_pec: 'gab.quest.fittizia@pecps.example.invalid',
  alloggiati_autofile_mode: 'off' };

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const lang of ['it', 'en']) for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true }); const errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => { page.__alerts = (page.__alerts || []).concat(d.message()); d.accept(); });
    await page.clock.install({ time: new Date(NOW) });
    await page.setContent('<body><div id="out"></div></body>');
    await page.addScriptTag({ content: read('lib/country-iso3.js') });
    await page.addScriptTag({ content: read('lib/alloggiati-records.js') });
    await page.addScriptTag({ content: `var hostLang=${JSON.stringify(lang)}; const HT={en:{},it:{}};
      function h(k){return HT[hostLang][k]||HT.en[k]||k;}
      var propertyData=${JSON.stringify(prop)}, allCheckins=${JSON.stringify(rows)}, toasts=[], downloads=[];
      function toast(m){toasts.push(m);} function track(){}
      function downloadFile(name, content){downloads.push({name, content});}
      const { buildBatch } = window.AllogRecords;
      function _isValidPastDOB(){return true;}
      ${block}
      ${fn('_renderAutofileRowChip')}
      ${fn('_prepareAlloggiatiExport')}` });

    // Chip: late row → «Invio tardivo» button (even with autofile off); fileable row → none.
    const chips = await page.evaluate(() => allCheckins.map(c => _renderAutofileRowChip(c, hostLang === 'it')));
    assert.match(chips[0], lang === 'it' ? /⚠ Invio tardivo/ : /⚠ Late filing/);
    assert.match(chips[1], /late-filing-btn/);
    assert.ok(!/late-filing-btn/.test(chips[2]), 'no late button for a fileable group');

    // Panel: whole group, counts, PEC, file, PEC text.
    await page.evaluate(() => { document.getElementById('out').innerHTML = _renderAutofileRowChip(allCheckins[0], hostLang === 'it'); });
    await page.locator('#out .late-filing-btn').click();
    await page.locator('#lateFilingModal').waitFor();
    assert.match(await page.locator('#lateFilingMeta').textContent(), lang === 'it' ? /2 ospite\/i · prenotazione CAR-LATE01 · arrivo 31\/10\/2026/ : /2 guest\(s\) · booking CAR-LATE01 · arrival 31\/10\/2026/);
    assert.equal(await page.locator('#lateFilingPec').textContent(), prop.questura_pec);
    await page.locator('#lateFilingDownload').click();
    const dl = await page.evaluate(() => downloads.at(-1));
    assert.equal(dl.name, 'alloggiati_INVIO-TARDIVO_CAR-LATE01_arrivo-2026-10-31.txt');
    assert.equal(dl.content, expectedFile, 'file byte-identical to the shared builder for this group');
    assert.ok(!dl.content.includes('FICTIONALo'), 'only this group');
    const subject = await page.locator('#lateFilingSubject').textContent();
    const body = await page.locator('#lateFilingBody').textContent();
    assert.equal(subject, 'Comunicazione tardiva alloggiati – Fictional House – arrivo 31/10/2026');
    assert.match(body, /CIN IT000000C2FICTIONAL/); assert.match(body, /Riferimento prenotazione: CAR-LATE01/); assert.match(body, /Numero di ospiti: 2/);
    for (const r of lateRows) { assert.ok(!body.includes(r.surname) && !body.includes(r.name) && !subject.includes(r.surname), 'no guest names in the PEC text'); }
    assert.ok(!/conform|in regola|compliant/i.test(body), 'never implies compliance');
    if (process.env.LATE_QA_DIR && width === 390) { fs.mkdirSync(process.env.LATE_QA_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.LATE_QA_DIR}/late-panel-${lang}.png`, fullPage: true }); }
    await page.evaluate(() => document.getElementById('lateFilingModal').remove());

    // Export: late rows excluded with the message; only late → no file.
    const prep = await page.evaluate(() => { const p = _prepareAlloggiatiExport(); return p && { n: p.lines.length, late: p.lateExcludedCount }; });
    assert.deepEqual(prep, { n: 1, late: 2 }, 'portal export keeps only the fileable guest');
    assert.match(await page.evaluate(() => toasts.at(-1)), lang === 'it' ? /2 ospite\/i esclusi: il portale non accetta più la loro data di arrivo/ : /2 guest\(s\) excluded: the portal no longer accepts their arrival date/);
    await page.evaluate(() => { allCheckins = allCheckins.slice(0, 2); });
    const none = await page.evaluate(() => _prepareAlloggiatiExport({}));
    assert.equal(none, null, 'no file when every selected guest is late');
    assert.ok((page.__alerts || []).some(m => /late|ritardo/i.test(m)), 'explains why');
    assert.deepEqual(errors, []);
    await page.close();
  }

  // Questura PEC column: real migration in PGlite (format check, re-runnable).
  let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch (_) { PGlite = null; }
  if (PGlite) {
    const db = new PGlite();
    await db.exec('create table public.properties(id serial primary key);');
    const sql = read('supabase/migrations/20261103100000_round70_questura_pec.sql');
    await db.exec(sql); await db.exec(sql);
    await db.query("insert into public.properties(questura_pec) values ('gab.quest.rm@pecps.poliziadistato.it'), (null)");
    for (const bad of ['not-a-pec', 'a@b', 'x@y.z w', 'a'.repeat(250) + '@b.it']) {
      await assert.rejects(db.query('insert into public.properties(questura_pec) values ($1)', [bad]), /check constraint/, bad);
    }
  }
  console.log('PASS round70-late-panel IT/EN 390/1440: late rows get «Invio tardivo» (any autofile mode), fileable rows do not; panel shows the whole group, counts, saved Questura PEC; downloaded .txt byte-identical to the shared builder for that group; PEC text has CIN and booking code, no guest names; portal export leaves late rows out with the message and produces no file when all are late; PEC field saved with Settings, malformed refused, 0-row saves reported; questura_pec CHECK in PGlite');
} finally { await browser.close(); }
