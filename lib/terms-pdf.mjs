// Host terms receipt as PDF (19 Nov 2026, Daniele: «the terms received via
// email are in .md format. they should be in pdf»). Renders the accepted
// Markdown text (provider placeholders already filled) to an A4 PDF: headings,
// paragraphs, lists, quotes and tables, with **bold** spans. The footer of
// every page names the document, its version and the SHA-256 of the
// published text the host accepted, and the page number. Standard Helvetica
// (WinAnsi): characters outside it are replaced by close equivalents.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = [595.28, 841.89];
const MARGIN = 56, FOOT = 36;
const INK = rgb(0.024, 0.102, 0.239), SOFT = rgb(0.42, 0.48, 0.56);
const REPLACE = { '‘': "'", '’': "'", '‚': "'", '“': '"', '”': '"', '„': '"', '≥': '>=', '≤': '<=', '→': '->', '←': '<-', '×': 'x', ' ': ' ', ' ': ' ', ' ': ' ', '✓': 'v', '·': '·' };

export async function termsPdf({ markdown, title, footer, meta = {} }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || 'WelcomeBnB'); pdf.setAuthor(meta.author || 'WelcomeBnB'); pdf.setSubject(meta.subject || title || '');
  pdf.setProducer('WelcomeBnB'); pdf.setCreator('WelcomeBnB'); if (meta.date) { pdf.setCreationDate(meta.date); pdf.setModificationDate(meta.date); }
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold), italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const okCache = new Map();
  const clean = s => {
    let out = '';
    for (const ch of String(s)) {
      const r = REPLACE[ch] !== undefined ? REPLACE[ch] : ch;
      for (const c of r) {
        if (!okCache.has(c)) { let ok = true; try { regular.encodeText(c); } catch { ok = false; } okCache.set(c, ok); }
        out += okCache.get(c) ? c : '?';
      }
    }
    return out;
  };
  // Inline **bold** → runs of { text, font }.
  const runs = (text, base = regular) => {
    const out = []; const parts = clean(text).replace(/`/g, '').split('**');
    parts.forEach((p, i) => { if (p) out.push({ text: p, font: i % 2 ? bold : base }); });
    return out;
  };
  let page, y;
  const newPage = () => { page = pdf.addPage(A4); y = A4[1] - MARGIN; };
  newPage();
  const width = A4[0] - 2 * MARGIN;
  const ensure = h => { if (y - h < MARGIN + FOOT) newPage(); };
  // Word-wrap runs into lines of at most maxW points.
  const wrap = (rs, size, maxW) => {
    const words = [];
    for (const r of rs) for (const w of r.text.split(/(\s+)/)) if (w) words.push({ text: w, font: r.font });
    const lines = []; let line = [], w = 0;
    for (const word of words) {
      const ww = word.font.widthOfTextAtSize(word.text, size);
      if (/^\s+$/.test(word.text)) { if (line.length) { line.push(word); w += ww; } continue; }
      if (w + ww > maxW && line.length) { while (line.length && /^\s+$/.test(line.at(-1).text)) line.pop(); lines.push(line); line = []; w = 0; }
      line.push(word); w += ww;
    }
    while (line.length && /^\s+$/.test(line.at(-1).text)) line.pop();
    if (line.length) lines.push(line);
    return lines;
  };
  const draw = (rs, { size = 10, indent = 0, gap = 4, lead = 1.38, color = INK, prefix = null } = {}) => {
    const lines = wrap(rs, size, width - indent);
    for (let i = 0; i < lines.length; i++) {
      ensure(size * lead);
      y -= size * lead;
      if (i === 0 && prefix) page.drawText(prefix, { x: MARGIN + indent - 10, y, size, font: regular, color });
      let x = MARGIN + indent;
      for (const word of lines[i]) { page.drawText(word.text, { x, y, size, font: word.font, color }); x += word.font.widthOfTextAtSize(word.text, size); }
    }
    y -= gap;
  };
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');
  let para = [];
  const flush = () => { if (para.length) { draw(runs(para.join(' ')), { gap: 6 }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); const size = [0, 15, 12.5, 11, 10.5][h[1].length]; y -= h[1].length <= 2 ? 8 : 4; ensure(size * 3); draw(runs(h[2], bold), { size, gap: 4 }); continue; }
    if (/^\s*$/.test(l)) { flush(); continue; }
    if (/^\s*[-*]\s+/.test(l)) { flush(); draw(runs(l.replace(/^\s*[-*]\s+/, '')), { indent: 14, gap: 2, prefix: '•' }); continue; }
    if (/^>\s?/.test(l)) { flush(); draw(runs(l.replace(/^>\s?/, ''), italic), { indent: 10, gap: 4, color: SOFT }); continue; }
    if (/^\|/.test(l)) {
      flush();
      const rows = [];
      for (; i < lines.length && /^\|/.test(lines[i]); i++) if (!/^\|[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|\s*$/g, '').split('|').map(c => c.trim()));
      i--;
      const [head, ...body] = rows;
      // Each row as a small block: first cell bold, the others labelled by the header.
      for (const r of body) {
        ensure(30);
        draw(runs(r[0] || '', bold), { gap: 1 });
        for (let c = 1; c < r.length; c++) if (r[c]) draw([{ text: clean((head && head[c] ? head[c] + ': ' : '')), font: bold }, ...runs(r[c])], { indent: 12, gap: 1, size: 9.5 });
        y -= 5;
      }
      continue;
    }
    para.push(l.trim());
  }
  flush();
  const pages = pdf.getPages();
  pages.forEach((p, n) => {
    const text = clean(`${footer || title || ''} · pag. ${n + 1}/${pages.length}`);
    const lines2 = wrap([{ text, font: regular }], 7, width);
    lines2.forEach((ln, k) => { let x = MARGIN; for (const w of ln) { p.drawText(w.text, { x, y: FOOT - 8 - k * 9, size: 7, font: regular, color: SOFT }); x += regular.widthOfTextAtSize(w.text, 7); } });
  });
  return pdf.save({ useObjectStreams: false });
}
