#!/usr/bin/env node
// Round 50 — regenerate the Italian onboarding PDF.
//
// Reads docs/DEMO_ONBOARDING_IT.md, renders it to A4 PDF via the
// pre-installed Playwright/Chromium (no npm install), writes the
// result to docs/Onboarding_WelcomeBnB_IT.pdf and prints the sha256
// of both the source and the PDF so CHANGELOG stays truthful.
//
// Usage:  node scripts/demo-onboarding-pdf.mjs
//
// Dependencies: Playwright is already installed under
// /opt/node22/lib/node_modules; Chromium is at /opt/pw-browsers.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// Fallback resolution: pick up the globally-installed Playwright.
let chromium;
try {
  chromium = require('playwright').chromium;
} catch (_) {
  const g = createRequire('/opt/node22/lib/node_modules/.pathstub.js');
  try { chromium = g('playwright').chromium; }
  catch { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; }
}

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, '..', 'docs', 'DEMO_ONBOARDING_IT.md');
const outPath    = resolve(here, '..', 'docs', 'Onboarding_WelcomeBnB_IT.pdf');

const md = readFileSync(sourcePath, 'utf8');
const sourceSha = createHash('sha256').update(md).digest('hex');

// Minimal markdown → HTML renderer. The onboarding script uses a
// deliberately small subset: #/## headings, **bold**, > blockquote,
// - bullet list, | table, inline `code`, paragraphs. Anything outside
// this subset becomes a plain paragraph so the renderer never
// silently drops content.
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function inline(s) {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function toHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Headings.
    const h = line.match(/^(#{1,6}) +(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // Blank line.
    if (/^\s*$/.test(line)) { i++; continue; }
    // Blockquote.
    if (/^> /.test(line)) {
      const chunk = [];
      while (i < lines.length && /^> /.test(lines[i])) {
        chunk.push(lines[i].slice(2));
        i++;
      }
      out.push('<blockquote>' + chunk.map(inline).join('<br>') + '</blockquote>');
      continue;
    }
    // Table: header row | --- | data rows.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[-\s|]+\|?\s*$/.test(lines[i + 1])) {
      const head = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim()));
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        body.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => inline(c.trim())));
        i++;
      }
      out.push('<table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
               body.map(row => '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') +
               '</tbody></table>');
      continue;
    }
    // Bullet list.
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        let item = lines[i].slice(2);
        i++;
        // Continuation lines (indented by two spaces) belong to the current item.
        while (i < lines.length && /^  \S/.test(lines[i])) { item += ' ' + lines[i].trim(); i++; }
        items.push(inline(item));
      }
      out.push('<ul>' + items.map(x => `<li>${x}</li>`).join('') + '</ul>');
      continue;
    }
    // Paragraph: fold consecutive non-blank lines.
    const para = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6} |- |> |\s*\|)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    out.push('<p>' + para.map(l => inline(l)).join('<br>') + '</p>');
  }
  return out.join('\n');
}

const body = toHtml(md);
const stamp = new Date().toISOString().slice(0, 10);
const html = `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <title>Onboarding WelcomeBnB — scaletta italiana</title>
  <style>
    @page { size: A4; margin: 20mm 18mm; }
    html, body { font: 10.5pt/1.45 "DejaVu Sans", "Noto Sans", "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; }
    body { padding: 0; margin: 0; }
    header.doc { border-bottom: 1px solid #d1d5db; padding-bottom: 6px; margin-bottom: 14px; font-size: 9pt; color: #4b5563; }
    header.doc strong { color: #111827; }
    h1 { font-size: 20pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
    h2 { font-size: 13pt; margin: 16pt 0 6pt; color: #111827; break-after: avoid-page; page-break-after: avoid; }
    h3 { font-size: 11pt; margin: 12pt 0 4pt; color: #111827; }
    p { margin: 0 0 7pt; }
    strong { color: #111827; }
    blockquote { margin: 7pt 0; padding: 7pt 10pt; background: #f8fafc; border-left: 3px solid #94a3b8; color: #334155; font-style: italic; }
    ul { margin: 2pt 0 7pt; padding-left: 18pt; }
    li { margin-bottom: 3pt; }
    code { font: 9.5pt/1.4 "DejaVu Sans Mono", "Menlo", monospace; background: #f3f4f6; padding: 0 3pt; border-radius: 2pt; color: #1f2937; }
    table { width: 100%; border-collapse: collapse; margin: 7pt 0 10pt; font-size: 10pt; break-inside: avoid-page; page-break-inside: avoid; }
    thead { background: #f1f5f9; }
    th, td { border: 1px solid #cbd5e1; padding: 5pt 7pt; vertical-align: top; text-align: left; }
    th { font-weight: 600; color: #0f172a; }
    tr { break-inside: avoid-page; page-break-inside: avoid; }
    footer.doc { margin-top: 18pt; border-top: 1px solid #d1d5db; padding-top: 6pt; font-size: 8pt; color: #6b7280; }
  </style>
</head>
<body>
  <header class="doc">
    <strong>Scaletta demo WelcomeBnB · onboarding italiano</strong>
    &nbsp;·&nbsp; Round 50 &nbsp;·&nbsp; generato ${stamp}
    &nbsp;·&nbsp; sorgente sha256 <code>${sourceSha.slice(0, 16)}…</code>
  </header>
  <main>${body}</main>
  <footer class="doc">
    PDF generato automaticamente da <code>docs/DEMO_ONBOARDING_IT.md</code> via
    <code>scripts/demo-onboarding-pdf.mjs</code>. Mantieni script e PDF allineati:
    se cambia la scaletta, rigenera il PDF nello stesso commit.
  </footer>
</body>
</html>`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdfBuf = await page.pdf({
    format: 'A4', margin: { top: '20mm', right: '18mm', bottom: '20mm', left: '18mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `<div style="font-size:7pt; color:#6b7280; width:100%; padding:0 18mm; text-align:right;">
      Pagina <span class="pageNumber"></span> di <span class="totalPages"></span>
    </div>`,
  });
  writeFileSync(outPath, pdfBuf);
  const outSha = createHash('sha256').update(pdfBuf).digest('hex');
  const sizeKb = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`PDF written: ${outPath}`);
  console.log(`  source sha256: ${sourceSha}`);
  console.log(`  pdf sha256:    ${outSha}`);
  console.log(`  size:          ${sizeKb} KB`);
} finally {
  await browser.close();
}
