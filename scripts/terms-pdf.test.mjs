// 19 Nov 2026 — lib/terms-pdf.mjs: the host terms receipt as PDF. A real
// PDF; headings, lists, quotes, tables and **bold** rendered as text; every
// page carries the footer with its page number; characters outside the
// standard font are replaced, never thrown. Fictional text only.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { termsPdf } from '../lib/terms-pdf.mjs';
// Standard fonts use WinAnsi (Windows-1252): € and dashes are 0x80/0x96/0x97.
const text = b => { const s = Buffer.from(b).toString('latin1'); const pages = [];
  for (const m of s.matchAll(/stream\r?\n/g)) { const st = m.index + m[0].length, en = s.indexOf('endstream', st);
    try { const t = inflateSync(Buffer.from(b).subarray(st, en)).toString('latin1'); let out = ''; for (const x of t.matchAll(/<([0-9A-Fa-f]+)> Tj/g)) out += Buffer.from(x[1], 'hex').toString('latin1').replace(/\x80/g, '€').replace(/\x97/g, '—').replace(/\x96/g, '–'); if (out) pages.push(out); } catch (_) {} }
  return pages; };
const md = ['# Titolo fittizio', '', 'Paragrafo con **grassetto** e caratteri: à è é ì ò ù € «» — ’ ≥ 5 → ✓ 漢', '', '- voce uno', '- voce due', '', '> nota in corsivo', '',
  '| Dati | Conservazione | Base |', '|---|---|---|', '| Ricevute | 5 anni | DM |', '| Chat | 12 mesi | GDPR |', '', ...Array.from({ length: 120 }, (_, i) => `Riga di riempimento numero ${i + 1} per forzare più pagine.`)].join('\n');
const bytes = await termsPdf({ markdown: md, title: 'Documento fittizio', footer: 'Documento fittizio · SHA-256 ' + 'a'.repeat(64), meta: { date: new Date('2026-11-19T10:00:00Z') } });
assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), '%PDF-');
const doc = await PDFDocument.load(bytes);
assert.equal(doc.getTitle(), 'Documento fittizio'); assert.ok(doc.getPageCount() >= 2, 'long text spans pages');
const pages = text(bytes), all = pages.join('');
assert.equal(pages.length, doc.getPageCount(), 'one content stream per page');
pages.forEach((p, i) => assert.ok(p.replace(/\s+/g, '').includes(`pag.${i + 1}/${pages.length}`), 'footer page number on page ' + (i + 1)));
assert.ok(all.includes('Titolo fittizio') && all.includes('grassetto') && all.includes('voce due') && all.includes('nota in corsivo'));
assert.ok(all.includes('Conservazione: ') && all.includes('5 anni') && all.includes('12 mesi'), 'table rows labelled by the header');
assert.ok(/à è é ì ò ù € «» — ' >= 5 -> v \?/.test(all.replace(/\s+/g, ' ')), 'Italian accents kept; unsupported characters replaced');
assert.ok(!all.includes('**'), 'bold markers not printed');
assert.ok(all.replace(/\s+/g, '').includes('a'.repeat(64)), 'hash in the footer');
console.log(`PASS terms PDF: real A4 PDF (${doc.getPageCount()} pages), headings/lists/quotes/tables/bold as text, footer with page number on every page, Italian accents kept, unsupported characters replaced`);
