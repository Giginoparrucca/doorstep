// host-guides.js — Round 43 · "Come funziona" guide layer for the host console.
//
// One "?" pill next to every panel title opens a short illustrated guide
// (3–5 picture steps + FAQ). Each step has a "Mostrami" button that
// dims the page, scrolls the real target into view, draws a ring and
// shows a "Premi qui" tooltip. Feedback (👍/👎) is written to the
// guide_feedback table (Round 43 migration).
//
// Loaded lazily by host-console.html on the first pill click. All CSS
// is injected once here so the console's own stylesheet stays clean.
//
// Contract with the console:
//   - `hostLang`, `sb`, `showPanel(id)`, `showSection(sec, tab)`,
//     `panelSection(id)`, `_isAdminView()`, `IS_ADMIN_VIEW` (optional).
//   - Panel target elements carry `data-guide="<id>"`.
//   - setHostLang() calls HG.onLangSwitch() when the guide is open so
//     the drawer/sheet repaints in the new language.
//   - showPanel() calls HG.mountPill(activePanelId) after the tab strip
//     repaints so the pill lands next to the current title.
//
// Safety:
//   - All DOM built with createElement/textContent; SVG via createElementNS.
//     No innerHTML with any user-derived value.
//   - Feedback insert is skipped in admin view.
//   - Every step's Mostrami has an emptyHint that fires when the target
//     isn't in the DOM yet (e.g. a list is empty).
//
// Size budget: 90 KB unminified. Current file well under.

(function () {
'use strict';

if (window.HG) return;                        // idempotent load
const NS  = 'http://www.w3.org/2000/svg';
// Current language is passed in explicitly by host-console.html via
// HG.setLang(hostLang). We can't read `hostLang` from window because it
// is declared with `let` in the console and let-bindings at top level
// are script-scoped, not properties of window. `HG.setLang` and
// `HG.onLangSwitch` update this value.
let _currentLang = 'it';
// Best-effort initial guess — the console will overwrite this the first
// time it calls setLang/onLangSwitch.
try { if (typeof window.hostLang === 'string') _currentLang = window.hostLang; } catch (_) {}
const HOSTLANG = () => _currentLang;
const IS_IT = () => HOSTLANG() === 'it';
const IS_ADMIN = () => {
  try {
    if (window.IS_ADMIN_VIEW === true) return true;
    if (typeof window._isAdminView === 'function') return !!window._isAdminView();
  } catch (_) {}
  return false;
};

// ═════════════════════════════════════════════════════════════════════
// 1 · CSS  (ported from design-ref/Come funziona guides.html + tuned
//   for the console's own tokens)
// ═════════════════════════════════════════════════════════════════════
const CSS = `
.cf-pill{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 5px;border-radius:999px;border:1px solid rgba(0,91,255,.12);background:#fff;color:#005BFF;font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;transition:background .15s,border-color .15s;line-height:1;vertical-align:middle;margin-left:12px}
.cf-pill:hover{background:#EAF3FF;border-color:#005BFF}
.cf-pill:focus-visible{outline:2px solid #005BFF;outline-offset:2px}
.cf-pill .cf-q{width:22px;height:22px;border-radius:50%;background:#EAF3FF;display:flex;align-items:center;justify-content:center;color:#005BFF;flex-shrink:0}
.cf-pill.cf-new{background:#EAF3FF;border-color:rgba(0,91,255,.4);animation:cfPulse 2.4s ease-out infinite}
.cf-pill.cf-new .cf-q{background:#005BFF;color:#fff}
.cf-pill.cf-seen{color:#6B7A90;font-weight:500}
.cf-pill.cf-seen .cf-q{background:transparent;border:1.5px solid #D7E7FF;color:#6B7A90}
@keyframes cfPulse{0%{box-shadow:0 0 0 0 rgba(0,91,255,.35)}70%{box-shadow:0 0 0 10px rgba(0,91,255,0)}100%{box-shadow:0 0 0 0 rgba(0,91,255,0)}}
@media (max-width:720px){.cf-pill{height:36px;font-size:13px;margin-left:8px}}
@media (prefers-reduced-motion:reduce){.cf-pill.cf-new{animation:none}.sp-timer span{animation:none!important}.cf-drawer{animation:none!important}}
.cf-scrim{position:fixed;inset:0;background:rgba(6,26,61,.32);z-index:1900;animation:cfFade .18s ease-out}
@keyframes cfFade{from{opacity:0}to{opacity:1}}
.cf-drawer{position:fixed;top:0;right:0;bottom:0;width:420px;max-width:100vw;background:#fff;box-shadow:-12px 0 40px rgba(6,26,61,.16);display:flex;flex-direction:column;z-index:2000;animation:cfSlide .25s ease-out;font-family:'DM Sans',system-ui,sans-serif;color:#061A3D}
@keyframes cfSlide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
.cf-sheet{position:fixed;left:0;right:0;bottom:0;top:56px;background:#fff;border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(6,26,61,.18);display:flex;flex-direction:column;z-index:2000;font-family:'DM Sans',system-ui,sans-serif;color:#061A3D;animation:cfSheet .28s ease-out}
@keyframes cfSheet{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
.cf-handle{width:44px;height:5px;border-radius:3px;background:#D7E7FF;margin:10px auto 2px;flex-shrink:0}
.cf-scroll{flex:1;overflow-y:auto;overscroll-behavior:contain}
.cf-head{display:flex;gap:12px;align-items:flex-start;padding:20px 20px 16px 24px;border-bottom:1px solid rgba(0,91,255,.12);flex-shrink:0}
.cf-head-m{padding:10px 16px 14px}
.cf-eyebrow{display:flex;align-items:center;gap:6px;font-size:13px;color:#6B7A90;font-weight:500;margin-bottom:6px}
.cf-title{font-family:'Playfair Display',serif;font-weight:500;font-size:22px;line-height:1.2;margin:0 0 10px;text-wrap:pretty}
.cf-time{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:999px;background:#EAF3FF;color:#0047CC;font-size:13px;font-weight:600}
.cf-close{width:44px;height:44px;border-radius:50%;border:1px solid rgba(0,91,255,.12);background:#fff;color:#061A3D;display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer}
.cf-close:hover{background:#EAF3FF}
.cf-close:focus-visible{outline:2px solid #005BFF;outline-offset:2px}
.cf-body{padding:20px 24px 28px;display:flex;flex-direction:column;gap:22px;font-size:15px;line-height:1.5}
.cf-body-m{padding:18px 20px 32px}
.cf-label{font-size:13px;font-weight:600;color:#6B7A90;margin-bottom:6px}
.cf-purpose{font-size:17px;line-height:1.5;text-wrap:pretty;margin:0}
.cf-when{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:12px;background:#EAF3FF;color:#0047CC}
.cf-when svg{flex-shrink:0;margin-top:2px}
.cf-when .cf-label{color:#0047CC}
.cf-when-t{font-size:15px;font-weight:600;color:#061A3D;line-height:1.45}
.cf-steps{display:flex;flex-direction:column;gap:24px;list-style:none;margin:0;padding:0}
.cf-step{display:flex;flex-direction:column;gap:12px}
.cf-frame{border-radius:12px;border:1px solid rgba(0,91,255,.12);overflow:hidden;background:#F8FBFF}
.cf-step-row{display:flex;gap:12px;align-items:flex-start}
.cf-num{width:30px;height:30px;border-radius:50%;background:#005BFF;color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.cf-step-t{font-size:15px;line-height:1.5;padding-top:3px;text-wrap:pretty;margin:0}
.cf-show{align-self:flex-start;margin-left:42px;display:inline-flex;align-items:center;gap:7px;min-height:44px;padding:0 16px;border-radius:8px;border:1.5px solid #005BFF;background:#fff;color:#005BFF;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer}
.cf-show:hover{background:#EAF3FF}
.cf-show:disabled{opacity:.5;cursor:not-allowed}
.cf-show:focus-visible{outline:2px solid #005BFF;outline-offset:2px}
.cf-empty{align-self:flex-start;margin-left:42px;font-size:13px;color:#6B7A90;line-height:1.45;padding-top:2px}
.cf-call{display:flex;gap:12px;padding:16px;border-radius:12px;align-items:flex-start}
.cf-call p{font-size:15px;line-height:1.5;margin:0}
.cf-call-l{font-size:15px;font-weight:700;margin-bottom:3px}
.cf-call-ic{flex-shrink:0;margin-top:1px}
.cf-warn{background:#FBF0DD;border:1.5px solid #E0982E}
.cf-warn .cf-call-ic,.cf-warn .cf-call-l{color:#7A4E0B}
.cf-tip{background:#F8FBFF;border:1px solid rgba(0,91,255,.12)}
.cf-tip .cf-call-ic,.cf-tip .cf-call-l{color:#0047CC}
.cf-h3{font-family:'Playfair Display',serif;font-weight:500;font-size:19px;margin:0 0 10px}
.cf-faq{border:1px solid rgba(0,91,255,.12);border-radius:12px;overflow:hidden}
.cf-q-item+.cf-q-item{border-top:1px solid rgba(0,91,255,.12)}
.cf-q-btn{width:100%;min-height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#fff;border:none;text-align:left;font-family:inherit;font-size:15px;font-weight:600;color:#061A3D;cursor:pointer}
.cf-q-btn svg{flex-shrink:0;color:#005BFF}
.cf-q-item.on .cf-q-btn{background:#F8FBFF}
.cf-a{padding:0 16px 14px;background:#F8FBFF;font-size:15px;line-height:1.5;color:#061A3D;margin:0}
.cf-foot{border-top:1px solid rgba(0,91,255,.12);padding:18px 24px 24px;display:flex;flex-direction:column;gap:14px;flex-shrink:0}
.cf-useful,.cf-help{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:15px;font-weight:500}
.cf-vote{display:inline-flex;align-items:center;gap:6px;min-height:40px;min-width:72px;justify-content:center;padding:0 14px;border-radius:8px;border:1px solid rgba(0,91,255,.12);background:#fff;font-family:inherit;font-size:14px;font-weight:600;color:#061A3D;cursor:pointer}
.cf-vote:hover{border-color:#005BFF;color:#005BFF}
.cf-vote:focus-visible{outline:2px solid #005BFF;outline-offset:2px}
.cf-vote:disabled{opacity:.5;cursor:default}
.cf-contact{display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 14px;border-radius:8px;border:none;background:#EAF3FF;color:#0047CC;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none}
.cf-thanks{color:#2E9E6B;font-weight:600}
/* Spotlight */
.sp-dim{position:fixed;inset:0;background:rgba(6,26,61,.55);z-index:1800;pointer-events:auto;cursor:pointer;animation:cfFade .18s ease-out}
.sp-ring{position:fixed;border-radius:12px;box-shadow:0 0 0 4px #fff,0 0 0 8px #005BFF,0 0 0 16px rgba(0,91,255,.25);z-index:1850;pointer-events:none;animation:spIn .32s ease-out}
@keyframes spIn{from{box-shadow:0 0 0 4px #fff,0 0 0 30px rgba(0,91,255,0)}to{box-shadow:0 0 0 4px #fff,0 0 0 8px #005BFF,0 0 0 16px rgba(0,91,255,.25)}}
.sp-tip{position:fixed;z-index:1860;background:#061A3D;color:#fff;font-family:'DM Sans',system-ui,sans-serif;font-size:15px;font-weight:600;padding:10px 14px 12px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:8px;min-width:120px;max-width:220px;pointer-events:none}
.sp-tip::after{content:"";position:absolute;left:50%;top:100%;transform:translateX(-50%);border:8px solid transparent;border-top-color:#061A3D}
.sp-tip.sp-tip-below::after{top:auto;bottom:100%;border-top-color:transparent;border-bottom-color:#061A3D}
.sp-timer{display:block;height:3px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden}
.sp-timer span{display:block;height:100%;width:100%;background:#fff;animation:spT 4s linear forwards}
@keyframes spT{from{width:100%}to{width:0}}
.sp-resume{position:fixed;right:24px;bottom:24px;z-index:2100;display:flex;align-items:center;gap:12px;min-height:56px;padding:8px 16px 8px 8px;border-radius:14px;border:none;background:#fff;box-shadow:0 10px 30px rgba(6,26,61,.25);color:#061A3D;font-family:'DM Sans',system-ui,sans-serif;cursor:pointer}
.sp-resume-m{left:16px;right:16px;bottom:16px}
.sp-resume-ic{width:40px;height:40px;border-radius:10px;background:#005BFF;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sp-resume-s{display:block;font-size:13px;color:#6B7A90}
.sp-resume-l{display:block;font-size:15px;font-weight:700;color:#0047CC}
`;

// ═════════════════════════════════════════════════════════════════════
// 2 · Tiny DOM helpers
// ═════════════════════════════════════════════════════════════════════
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') { /* forbidden by design */ }
    else n.setAttribute(k, v);
  }
  if (children) appendKids(n, children);
  return n;
}
function svg(tag, attrs, children) {
  const n = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] == null) continue;
    n.setAttribute(k, attrs[k]);
  }
  if (children) for (const c of children) if (c) n.appendChild(c);
  return n;
}
function appendKids(parent, kids) {
  if (!kids) return;
  if (!Array.isArray(kids)) kids = [kids];
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') parent.appendChild(document.createTextNode(c));
    else parent.appendChild(c);
  }
}
function frag(kids) { const f = document.createDocumentFragment(); appendKids(f, kids); return f; }
const $ = (sel, root) => (root || document).querySelector(sel);

// ═════════════════════════════════════════════════════════════════════
// 3 · Icons  (2-arg SVG factory; kept small)
// ═════════════════════════════════════════════════════════════════════
const ICO = {
  q:    () => [svg('path', { d: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01' })],
  clock:() => [svg('circle', { cx: 12, cy: 12, r: 9 }), svg('path', { d: 'M12 7v5l3 2' })],
  x:    () => [svg('path', { d: 'M6 6l12 12M18 6L6 18' })],
  eye:  () => [svg('path', { d: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z' }), svg('circle', { cx: 12, cy: 12, r: 3 })],
  warn: () => [svg('path', { d: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' }), svg('path', { d: 'M12 9v4M12 17h.01' })],
  bulb: () => [svg('path', { d: 'M9 18h6M10 22h4' }), svg('path', { d: 'M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2z' })],
  down: () => [svg('path', { d: 'M6 9l6 6 6-6' })],
  up:   () => [svg('path', { d: 'M18 15l-6-6-6 6' })],
  thumbUp: () => [svg('path', { d: 'M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3z' }), svg('path', { d: 'M7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.3 8a2 2 0 0 1-2 1.7H7' })],
  thumbDn: () => [svg('path', { d: 'M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3z' }), svg('path', { d: 'M17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 5.8 3H17' })],
  mail: () => [svg('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }), svg('path', { d: 'M3 7l9 6 9-6' })],
  book: () => [svg('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z' }), svg('path', { d: 'M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5' })],
};
function icon(name, size, sw) {
  size = size || 20; sw = sw || 1.8;
  const s = svg('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, ICO[name] ? ICO[name]() : []);
  return s;
}

// ═════════════════════════════════════════════════════════════════════
// 4 · Illustration kit  (all primitives return SVG nodes; frame is 320×200)
//   Palette lives here so a repalette is one line. Words in drawings are
//   translatable strings passed as arguments.
// ═════════════════════════════════════════════════════════════════════
const K = {
  bg: '#F8FBFF', t1: '#EAF3FF', t2: '#D7E7FF', white: '#FFFFFF',
  blue: '#005BFF', ink: '#061A3D', soft: '#6B7A90',
  green: '#2E9E6B', greenBg: '#E4F5EC',
  amber: '#E0982E', amberBg: '#FBF0DD', amberInk: '#7A4E0B',
  line: 'rgba(0,91,255,0.14)',
  font: "'DM Sans', system-ui, sans-serif",
};

const Kit = {
  frame(title, kids) {
    const s = svg('svg', {
      viewBox: '0 0 320 200', role: 'img', 'aria-label': title || '',
      style: 'display:block;width:100%;height:auto',
    }, [svg('rect', { x: 0, y: 0, width: 320, height: 200, rx: 10, fill: K.bg })]);
    if (kids) for (const c of kids) if (c) s.appendChild(c);
    return s;
  },
  bar(x, y, w, h, c) { return svg('rect', { x, y, width: w, height: h || 6, rx: (h || 6) / 2, fill: c || K.t2 }); },
  card(x, y, w, h, opts) {
    opts = opts || {};
    return svg('rect', { x, y, width: w, height: h, rx: 8, fill: opts.fill || K.white, stroke: opts.stroke || K.line, 'stroke-width': opts.sw || 1 });
  },
  page(kids) {
    const g = svg('g', {}, [
      svg('rect', { x: 0, y: 0, width: 320, height: 30, rx: 10, fill: K.white }),
      svg('rect', { x: 0, y: 20, width: 320, height: 10, fill: K.white }),
      svg('line', { x1: 0, y1: 30, x2: 320, y2: 30, stroke: K.line }),
      Kit.bar(16, 12, 70, 7, K.t2),
    ]);
    if (kids) for (const c of kids) if (c) g.appendChild(c);
    return g;
  },
  row(x, y, w, opts) {
    opts = opts || {};
    const o = opts.faded ? 0.55 : 1;
    const status = opts.status; const label = opts.statusLabel;
    const kids = [];
    if (opts.hi) kids.push(svg('rect', { x: x - 4, y: y - 4, width: w + 8, height: 30, rx: 7, fill: K.white, stroke: status === 'green' ? K.green : K.blue, 'stroke-width': 2 }));
    if (status === 'green') kids.push(svg('rect', { x: x - 4, y: y - 4, width: 4, height: 30, rx: 2, fill: K.green }));
    kids.push(svg('circle', { cx: x + 10, cy: y + 11, r: 8, fill: K.t1 }));
    kids.push(Kit.bar(x + 26, y + 5, w * 0.34, 6));
    kids.push(Kit.bar(x + 26, y + 14, w * 0.2, 5, K.t1));
    if (label) {
      const pillBg = status === 'green' ? K.greenBg : (status === 'amber' ? K.amberBg : K.blue);
      const pillFg = status === 'green' ? K.green : (status === 'amber' ? K.amberInk : K.white);
      kids.push(svg('rect', { x: x + w - 78, y: y + 3, width: 74, height: 16, rx: 8, fill: pillBg }));
      const t = svg('text', { x: x + w - 41, y: y + 14.5, 'text-anchor': 'middle', 'font-family': K.font, 'font-size': 9.5, 'font-weight': 700, fill: pillFg });
      t.textContent = label;
      kids.push(t);
    }
    const g = svg('g', { opacity: o }, kids);
    return g;
  },
  btn(x, y, w, h, opts) {
    opts = opts || {};
    const active = opts.active !== false;
    const kids = [svg('rect', { x, y, width: w, height: h, rx: 6, fill: active ? K.blue : K.t1 })];
    if (opts.label) {
      const t = svg('text', { x: x + w / 2, y: y + h / 2 + 3.8, 'text-anchor': 'middle', 'font-family': K.font, 'font-size': 10.5, 'font-weight': 700, fill: active ? K.white : K.soft });
      t.textContent = opts.label;
      kids.push(t);
    } else {
      kids.push(Kit.bar(x + 10, y + h / 2 - 3, w - 20, 6, K.t2));
    }
    return svg('g', {}, kids);
  },
  marker(x, y, n) {
    return svg('g', {}, [
      svg('circle', { cx: x, cy: y, r: 12, fill: K.blue, stroke: K.white, 'stroke-width': 3 }),
      (() => { const t = svg('text', { x, y: y + 4.2, 'text-anchor': 'middle', 'font-family': K.font, 'font-size': 12, 'font-weight': 700, fill: K.white }); t.textContent = String(n); return t; })(),
    ]);
  },
  cursor(x, y, ripple) {
    const kids = [];
    if (ripple !== false) {
      kids.push(svg('circle', { cx: x, cy: y, r: 11, fill: 'none', stroke: K.blue, 'stroke-width': 1.5, opacity: 0.45 }));
      kids.push(svg('circle', { cx: x, cy: y, r: 18, fill: 'none', stroke: K.blue, 'stroke-width': 1, opacity: 0.2 }));
    }
    kids.push(svg('path', {
      d: `M${x} ${y} l0 17 l4.5 -4 l3.2 7 l3.2 -1.5 l-3.2 -6.8 l6 -0.4 z`,
      fill: K.ink, stroke: K.white, 'stroke-width': 1.4, 'stroke-linejoin': 'round',
    }));
    return svg('g', {}, kids);
  },
  arrow(d, endX, endY, ang) {
    return svg('g', {}, [
      svg('path', { d, fill: 'none', stroke: K.blue, 'stroke-width': 1.8, 'stroke-dasharray': '4 4', 'stroke-linecap': 'round' }),
      svg('path', { d: 'M0 0 L-7 -4 L-7 4 Z', fill: K.blue, transform: `translate(${endX} ${endY}) rotate(${ang})` }),
    ]);
  },
  file(x, y, label, color) {
    const c = color || K.blue;
    const kids = [
      svg('path', { d: `M${x} ${y} h22 l10 10 v30 a3 3 0 0 1 -3 3 h-26 a3 3 0 0 1 -3 -3 v-37 a3 3 0 0 1 3 -3 z`, fill: K.white, stroke: c, 'stroke-width': 1.8 }),
      svg('path', { d: `M${x + 22} ${y} v10 h10`, fill: 'none', stroke: c, 'stroke-width': 1.8 }),
    ];
    if (label) {
      const t = svg('text', { x: x + 16, y: y + 31, 'text-anchor': 'middle', 'font-family': K.font, 'font-size': 9, 'font-weight': 700, fill: c });
      t.textContent = label;
      kids.push(t);
    }
    return svg('g', {}, kids);
  },
  qr(x, y, size, color) {
    const n = 7, cell = size / n, c = color || K.ink;
    const kids = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const corner = (i < 2 && j < 2) || (i < 2 && j > 4) || (i > 4 && j < 2);
      if (corner || ((i * 3 + j * 5) % 4 === 0)) {
        kids.push(svg('rect', { x: x + j * cell, y: y + i * cell, width: cell - 0.6, height: cell - 0.6, fill: c }));
      }
    }
    return svg('g', {}, kids);
  },
  phone(x, y, w, h, kids) {
    const g = svg('g', {}, [
      svg('rect', { x, y, width: w, height: h, rx: 14, fill: K.white, stroke: K.t2, 'stroke-width': 3 }),
      svg('rect', { x: x + w / 2 - 14, y: y + 6, width: 28, height: 4, rx: 2, fill: K.t2 }),
    ]);
    if (kids) for (const c of kids) if (c) g.appendChild(c);
    return g;
  },
};

// ═════════════════════════════════════════════════════════════════════
// 5 · Step frames  (a factory per id; label object supplies translated
//   words. Frames named ci* = check-in, ex* = export, cm* = compliance,
//   ct* = chat, cl* = calendar. Only the labels used by the built
//   guides are declared here — new guides can register more.)
// ═════════════════════════════════════════════════════════════════════
const FRAMES = {};

// Reusable guest-list card with an optional highlight + status pill.
function guestList(opts) {
  opts = opts || {};
  return svg('g', {}, [
    Kit.card(20, 42, 280, 146),
    Kit.bar(34, 56, 80, 7),
    Kit.row(36, 78, 248, { hi: opts.hi, status: opts.statusFirst, statusLabel: opts.badgeFirst, faded: opts.faded }),
    Kit.row(36, 112, 248, { faded: opts.faded, status: opts.statusRest, statusLabel: opts.badgeRest }),
    Kit.row(36, 146, 248, { faded: opts.faded, status: opts.statusRest, statusLabel: opts.badgeRest }),
  ]);
}

// checkins
FRAMES.ci1 = (L) => Kit.frame(L.title_ci1, [Kit.page(), guestList({ hi: true, faded: true, badgeFirst: L.new }), Kit.marker(22, 89, 1)]);
FRAMES.ci2 = (L) => Kit.frame(L.title_ci2, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 70, 7),
  Kit.btn(154, 50, 134, 22, { label: L.gen }),
  svg('g', { opacity: '0.5' }, [Kit.row(36, 90, 130), Kit.row(36, 124, 130), Kit.row(36, 158, 130)]),
  Kit.arrow('M236 78 C 240 96, 244 104, 244 116', 244, 120, 90),
  Kit.file(228, 124, L.txt),
  Kit.cursor(266, 64),
  Kit.marker(154, 50, 2),
]);
FRAMES.ci3 = (L) => Kit.frame(L.title_ci3, [
  svg('rect', { x: 20, y: 14, width: 280, height: 176, rx: 8, fill: K.white, stroke: K.line }),
  svg('path', { d: 'M20 22 a8 8 0 0 1 8 -8 h264 a8 8 0 0 1 8 8 v14 h-280 z', fill: K.t1 }),
  svg('circle', { cx: 34, cy: 25, r: 3, fill: K.t2 }),
  svg('circle', { cx: 44, cy: 25, r: 3, fill: K.t2 }),
  svg('circle', { cx: 54, cy: 25, r: 3, fill: K.t2 }),
  (() => { const t = svg('text', { x: 160, y: 28.5, 'text-anchor': 'middle', 'font-family': K.font, 'font-size': 10, 'font-weight': 600, fill: K.soft }); t.textContent = L.portal; return t; })(),
  Kit.bar(40, 50, 90, 7), Kit.bar(40, 62, 140, 5, K.t1),
  svg('rect', { x: 40, y: 78, width: 240, height: 68, rx: 8, fill: K.bg, stroke: K.blue, 'stroke-width': 1.8, 'stroke-dasharray': '5 4' }),
  Kit.file(144, 90, L.txt),
  Kit.btn(196, 156, 84, 22, { label: L.sendFile }),
  Kit.cursor(250, 170),
  Kit.marker(40, 78, 3),
]);
FRAMES.ci4 = (L) => Kit.frame(L.title_ci4, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 70, 7),
  Kit.btn(196, 50, 92, 22, { label: L.mark }),
  Kit.row(36, 84, 248, { status: 'green', statusLabel: L.sent }),
  Kit.row(36, 118, 248, { status: 'green', statusLabel: L.sent }),
  svg('g', { opacity: '0.5' }, [Kit.row(36, 152, 248)]),
  Kit.cursor(250, 64),
  Kit.marker(196, 50, 4),
]);
FRAMES.ci5 = (L) => Kit.frame(L.title_ci5, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 60, 7),
  Kit.file(52, 76, L.receipt),
  Kit.arrow('M92 96 C 130 96, 160 96, 190 96', 190, 96, 0),
  Kit.btn(196, 84, 92, 22, { label: L.upload }),
  Kit.row(36, 132, 248, { status: 'green', statusLabel: L.sent }),
  Kit.marker(196, 84, 5),
]);

// export
FRAMES.ex1 = (L) => Kit.frame(L.title_ex1, [
  Kit.page(),
  Kit.card(20, 42, 280, 46, { stroke: K.blue, sw: 1.6 }),
  Kit.bar(34, 54, 90, 6, K.blue),
  Kit.bar(34, 66, 180, 5, K.t1),
  Kit.bar(34, 76, 140, 5, K.t1),
  Kit.card(20, 100, 280, 40),
  Kit.bar(34, 112, 60, 5, K.t2),
  Kit.card(20, 152, 280, 40),
  Kit.bar(34, 164, 70, 5, K.t2),
  Kit.marker(20, 42, 1),
]);
FRAMES.ex2 = (L) => Kit.frame(L.title_ex2, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 80, 7),
  Kit.btn(30, 96, 200, 26, { label: L.gen }),
  Kit.arrow('M136 128 C 138 148, 138 156, 138 168', 138, 172, 90),
  Kit.file(118, 156, L.txt),
  Kit.cursor(230, 108),
  Kit.marker(30, 96, 2),
]);
FRAMES.ex3 = (L) => Kit.frame(L.title_ex3, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 80, 7),
  Kit.btn(30, 96, 130, 26, { label: L.gen, active: false }),
  Kit.btn(170, 96, 118, 26, { label: L.openPortal }),
  Kit.cursor(258, 108),
  Kit.marker(170, 96, 3),
]);

// compliance
FRAMES.cm1 = (L) => Kit.frame(L.title_cm1, [
  Kit.page(),
  Kit.card(20, 42, 280, 40, { fill: K.t1, stroke: 'rgba(0,91,255,0.25)' }),
  Kit.bar(34, 54, 100, 6, K.blue),
  Kit.bar(34, 66, 220, 5, K.t2),
  Kit.card(20, 92, 280, 32),
  Kit.bar(34, 102, 80, 5, K.t2), Kit.bar(34, 112, 180, 5, K.t1),
  Kit.card(20, 128, 280, 32),
  Kit.bar(34, 138, 60, 5, K.t2), Kit.bar(34, 148, 200, 5, K.t1),
  Kit.card(20, 164, 280, 32),
  Kit.bar(34, 174, 70, 5, K.t2), Kit.bar(34, 184, 170, 5, K.t1),
  Kit.marker(20, 42, 1),
]);
FRAMES.cm2 = (L) => Kit.frame(L.title_cm2, [
  Kit.page(),
  Kit.card(20, 42, 280, 40),
  Kit.bar(34, 54, 90, 6, K.blue),
  Kit.btn(180, 52, 108, 22, { label: L.openExport }),
  Kit.cursor(258, 64),
  Kit.marker(180, 52, 2),
]);

// chat
FRAMES.ct1 = (L) => Kit.frame(L.title_ct1, [
  Kit.page(),
  Kit.card(20, 42, 280, 30),
  Kit.bar(34, 54, 80, 5, K.soft),
  svg('rect', { x: 34, y: 50, width: 200, height: 14, rx: 3, fill: K.t1 }),
  (() => { const t = svg('text', { x: 42, y: 60, 'font-family': K.font, 'font-size': 9, 'font-weight': 700, fill: K.blue }); t.textContent = L.pick; return t; })(),
  Kit.cursor(220, 60),
  Kit.card(20, 82, 280, 30, { fill: K.amberBg, stroke: 'rgba(224,152,46,0.45)' }),
  (() => { const t = svg('text', { x: 30, y: 100, 'font-family': K.font, 'font-size': 10, 'font-weight': 600, fill: K.amberInk }); t.textContent = '⚠️ ' + L.needsYou; return t; })(),
  Kit.card(20, 122, 280, 68),
  Kit.bar(34, 134, 180, 5, K.t2),
  Kit.bar(34, 146, 140, 5, K.t2),
  Kit.bar(34, 158, 200, 5, K.t2),
  Kit.marker(20, 42, 1),
]);
FRAMES.ct2 = (L) => Kit.frame(L.title_ct2, [
  Kit.page(),
  Kit.card(20, 42, 280, 100),
  Kit.bar(34, 54, 190, 5, K.t2),
  Kit.bar(34, 66, 160, 5, K.t2),
  svg('rect', { x: 20, y: 152, width: 280, height: 40, rx: 8, fill: K.white, stroke: K.line }),
  svg('rect', { x: 30, y: 162, width: 168, height: 20, rx: 4, fill: K.t1 }),
  Kit.btn(208, 160, 82, 22, { label: L.send }),
  Kit.cursor(258, 172),
  Kit.marker(208, 160, 2),
]);
FRAMES.ct3 = (L) => Kit.frame(L.title_ct3, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.bar(34, 56, 80, 7),
  Kit.btn(190, 50, 98, 22, { label: L.resolve }),
  Kit.card(30, 86, 260, 30, { fill: K.greenBg, stroke: 'rgba(46,158,107,0.45)' }),
  (() => { const t = svg('text', { x: 40, y: 104, 'font-family': K.font, 'font-size': 10, 'font-weight': 600, fill: K.green }); t.textContent = '✓ ' + L.resolved; return t; })(),
  Kit.cursor(260, 62),
  Kit.marker(190, 50, 3),
]);
FRAMES.ct4 = (L) => Kit.frame(L.title_ct4, [
  Kit.page(),
  Kit.card(20, 42, 280, 40, { fill: K.t1, stroke: 'rgba(0,91,255,0.25)' }),
  (() => { const t = svg('text', { x: 34, y: 60, 'font-family': K.font, 'font-size': 11, 'font-weight': 700, fill: K.blue }); t.textContent = '🔔 ' + L.alerts; return t; })(),
  Kit.bar(34, 68, 160, 5, K.t2),
  Kit.card(20, 92, 280, 100),
  Kit.btn(30, 106, 130, 22, { label: L.enablePush }),
  Kit.btn(30, 136, 110, 22, { label: L.linkTg, active: false }),
  Kit.bar(30, 168, 240, 5, K.t2),
  Kit.marker(30, 106, 4),
]);

// calendar
FRAMES.cl1 = (L) => Kit.frame(L.title_cl1, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  Kit.btn(30, 54, 22, 22, { label: '‹' }),
  (() => { const t = svg('text', { x: 160, y: 71, 'text-anchor': 'middle', 'font-family': 'Playfair Display, serif', 'font-size': 14, 'font-weight': 500, fill: K.ink }); t.textContent = L.month; return t; })(),
  Kit.btn(58, 54, 22, 22, { label: '›', active: false }),
  Kit.btn(228, 54, 60, 22, { label: L.today }),
  Kit.bar(30, 90, 260, 5, K.t2),
  Kit.bar(30, 106, 260, 60, K.t1),
  Kit.marker(228, 54, 1),
]);
FRAMES.cl2 = (L) => Kit.frame(L.title_cl2, [
  Kit.page(),
  Kit.card(20, 42, 280, 146),
  svg('rect', { x: 30, y: 60, width: 260, height: 20, rx: 4, fill: K.greenBg, stroke: K.green, 'stroke-width': 1.5 }),
  (() => { const t = svg('text', { x: 42, y: 73, 'font-family': K.font, 'font-size': 10, 'font-weight': 700, fill: K.green }); t.textContent = L.checkedIn; return t; })(),
  svg('rect', { x: 30, y: 96, width: 260, height: 20, rx: 4, fill: K.amberBg, stroke: K.amber, 'stroke-width': 1.5 }),
  (() => { const t = svg('text', { x: 42, y: 109, 'font-family': K.font, 'font-size': 10, 'font-weight': 700, fill: K.amberInk }); t.textContent = L.waiting; return t; })(),
  Kit.cursor(260, 106),
  Kit.marker(30, 96, 2),
]);
FRAMES.cl3 = (L) => Kit.frame(L.title_cl3, [
  Kit.page(),
  Kit.card(60, 44, 200, 148, { sw: 1.5, stroke: K.blue }),
  Kit.bar(74, 58, 120, 7, K.blue),
  Kit.bar(74, 74, 160, 5, K.t2),
  Kit.bar(74, 88, 140, 5, K.t2),
  Kit.btn(74, 108, 110, 22, { label: L.openLink }),
  Kit.bar(74, 148, 100, 5, K.t2),
  Kit.marker(60, 44, 3),
]);
FRAMES.cl4 = (L) => {
  const parts = [
    Kit.phone(90, 12, 140, 180),
  ];
  // grid
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    parts.push(svg('rect', { x: 100 + j * 24, y: 60 + i * 20, width: 22, height: 18, rx: 2, fill: (i === 2 && j === 2) ? K.blue : K.t1 }));
  }
  parts.push(Kit.cursor(180, 92));
  parts.push(Kit.marker(122, 100, 4));
  return Kit.frame(L.title_cl4, parts);
};

// A tiny helper for guides that just need "click this button on this page"
function simpleTargetFrame(pageTitleLabel, buttonLabel) {
  return Kit.frame(pageTitleLabel, [
    Kit.page(),
    Kit.card(20, 42, 280, 146),
    Kit.bar(34, 56, 80, 7),
    Kit.btn(30, 96, Math.min(220, 40 + (buttonLabel.length || 8) * 7), 26, { label: buttonLabel }),
    Kit.cursor(88 + Math.min(220, 40 + (buttonLabel.length || 8) * 7), 108),
    Kit.marker(30, 96, 1),
  ]);
}

// ═════════════════════════════════════════════════════════════════════
// 6 · Guide data
//   Keys = panel ids from SECTIONS in host-console.html.
//   Each guide: it + en. Every step: {t, target, panel?, art, emptyHint?}.
// ═════════════════════════════════════════════════════════════════════
const UI = {
  it: { how: 'Come funziona', purpose: 'A cosa serve', when: 'Quando', step: 'Passo', show: 'Mostrami', faq: 'Domande frequenti', useful: 'Ti è stato utile?', yes: 'Sì', no: 'No', doubt: 'Hai ancora un dubbio?', contact: 'Scrivici', close: 'Chiudi', minute: '1 minuto', thanks: 'Grazie!', tapHere: 'Premi qui', backToGuide: 'Torna alla guida' },
  en: { how: 'How it works', purpose: 'What it’s for', when: 'When', step: 'Step', show: 'Show me', faq: 'Common questions', useful: 'Was this helpful?', yes: 'Yes', no: 'No', doubt: 'Still unsure?', contact: 'Write to us', close: 'Close', minute: '1 minute', thanks: 'Thanks!', tapHere: 'Tap here', backToGuide: 'Back to guide' },
};

// Frame labels — a shared string set for the illustration kit.
const FL = {
  it: {
    title_ci1: 'Ospite nuovo nella lista', title_ci2: 'Genera il file', title_ci3: 'Alloggiati Web', title_ci4: 'Segna inviato', title_ci5: 'Carica la ricevuta',
    title_ex1: 'Trova l’obbligo', title_ex2: 'Genera il file', title_ex3: 'Apri il portale',
    title_cm1: 'I tre obblighi', title_cm2: 'Vai a Export',
    title_ct1: 'Scegli l’ospite', title_ct2: 'Rispondi', title_ct3: 'Risolvi', title_ct4: 'Avvisi',
    title_cl1: 'Cambia mese', title_cl2: 'Colori', title_cl3: 'Dettaglio', title_cl4: 'Tocca un giorno',
    new: 'Nuovo', gen: 'Genera .txt', txt: '.txt', portal: 'Alloggiati Web', sendFile: 'Invia', mark: 'Segna inviato', sent: '✓ Inviato', receipt: 'PDF', upload: 'Carica',
    openPortal: 'Apri portale', openExport: 'Apri Export',
    pick: 'Scegli ospite', needsYou: 'Ha bisogno di te', send: 'Invia', resolve: '✓ Risolvi', resolved: 'Risolto', alerts: 'Avvisi', enablePush: 'Attiva push', linkTg: 'Collega Telegram',
    month: 'settembre 2026', today: 'Oggi', checkedIn: '▬ arrivato', waiting: '▬ in attesa', openLink: 'Apri link',
  },
  en: {
    title_ci1: 'New guest in list', title_ci2: 'Generate the file', title_ci3: 'Alloggiati Web', title_ci4: 'Mark as filed', title_ci5: 'Upload receipt',
    title_ex1: 'Find the obligation', title_ex2: 'Generate the file', title_ex3: 'Open the portal',
    title_cm1: 'Three obligations', title_cm2: 'Go to Export',
    title_ct1: 'Pick the guest', title_ct2: 'Reply', title_ct3: 'Resolve', title_ct4: 'Alerts',
    title_cl1: 'Change month', title_cl2: 'Colours', title_cl3: 'Details', title_cl4: 'Tap a day',
    new: 'New', gen: 'Generate .txt', txt: '.txt', portal: 'Alloggiati Web', sendFile: 'Send', mark: 'Mark filed', sent: '✓ Filed', receipt: 'PDF', upload: 'Upload',
    openPortal: 'Open portal', openExport: 'Open Export',
    pick: 'Pick guest', needsYou: 'Needs you', send: 'Send', resolve: '✓ Resolve', resolved: 'Resolved', alerts: 'Alerts', enablePush: 'Enable push', linkTg: 'Link Telegram',
    month: 'September 2026', today: 'Today', checkedIn: '▬ checked in', waiting: '▬ waiting', openLink: 'Open link',
  },
};
function frame(id) { return FRAMES[id](FL[HOSTLANG()] || FL.it); }

// The guides. Kept flat for readability. Panel names match SECTIONS[].panels.
const GUIDES = {
  // ─── priority 1 ────────────────────────────────────────────────────
  checkins: {
    page: { it: 'Dati Check-in', en: 'Check-in Data' },
    title: { it: 'Inviare gli ospiti alla Polizia', en: 'Sending your guests to the Police' },
    purpose: {
      it: 'Qui vedi gli ospiti registrati e prepari il file per Alloggiati Web.',
      en: 'Here you see registered guests and prepare the file for Alloggiati Web.',
    },
    when: { it: 'Entro 24 ore dall’arrivo di ogni ospite.', en: 'Within 24 hours of each guest’s arrival.' },
    steps: [
      { it: 'L’ospite finisce il check-in online e compare qui.', en: 'When a guest finishes online check-in, they appear here.', target: 'checkin-row-status', art: 'ci1', emptyHint: { it: 'La riga compare quando un ospite completa il check-in.', en: 'The row appears when a guest completes their check-in.' } },
      { it: 'Apri «Export & Conformità» e premi «📥 Genera File Ospiti (.txt)».', en: 'Open Export & Conformità and press “📥 Generate Guest File (.txt)”.', target: 'export-alloggiati-btn', panel: 'export', art: 'ci2' },
      { it: 'Premi «Apri Alloggiati Web», entra e carica il file.', en: 'Press “Open Alloggiati Web”, sign in and upload the file.', target: 'export-alloggiati-link', panel: 'export', art: 'ci3' },
      { it: 'Torna qui. Scarica la ricevuta dal portale.', en: 'Come back here. Download the receipt from the portal.', target: 'checkin-row-status', art: 'ci4' },
      { it: 'Premi «📎 Ricevuta» e scegli il PDF: l’ospite diventa verde.', en: 'Press “📎 Receipt” and pick the PDF: the guest turns green.', target: 'checkin-receipt-btn', art: 'ci5', emptyHint: { it: 'Il pulsante compare quando c’è un ospite da inviare.', en: 'The button appears when a guest is waiting to be filed.' } },
    ],
    warn: { it: 'Obbligo di legge. WelcomeBnB prepara il file, ma a inviarlo sei tu.', en: 'Required by Italian law. WelcomeBnB prepares the file; you send it.' },
    tip: { target: 'checkin-markfiled-btn', it: 'Senza ricevuta? Premi «Segna inviato». Il reminder si ferma.', en: 'No receipt? Press “Mark filed”. The reminder stops.' },
    faq: [
      { q_it: 'Un ospite non compare nella lista.', a_it: 'L’ospite non ha finito il check-in. Mandagli di nuovo il link da «QR Code & Link».', q_en: 'A guest is missing from the list.', a_en: 'The guest hasn’t finished check-in. Send them the link again from QR Code & Link.' },
      { q_it: 'Il portale rifiuta il file.', a_it: 'Di solito un dato è sbagliato. Apri l’ospite dal menu ⋯, premi «Modifica», correggi e genera di nuovo il file.', q_en: 'The portal rejects the file.', a_en: 'Usually one detail is wrong. Open the guest via the ⋯ menu, press “Edit”, fix the field and generate the file again.' },
      { q_it: 'Ho premuto «Segna inviato» per sbaglio.', a_it: 'Non c’è un pulsante per annullare. Apri l’ospite dal menu ⋯, premi «Modifica» e togli manualmente lo stato «inviato».', q_en: 'I pressed “Mark filed” by mistake.', a_en: 'There is no one-click undo. Open the guest via the ⋯ menu, press “Edit” and reset the filed status by hand.' },
    ],
  },

  export: {
    page: { it: 'Export & Conformità', en: 'Export & Compliance' },
    title: { it: 'Preparare i file per i portali', en: 'Preparing the files for the portals' },
    purpose: {
      it: 'Qui scarichi i file da caricare sui portali: Polizia, statistiche e imposta di soggiorno.',
      en: 'Here you download the files to upload to the portals: Police, statistics and tourist tax.',
    },
    when: { it: 'Polizia entro 24 ore. Statistiche ogni mese. Imposta come chiede il comune.', en: 'Police within 24 h. Statistics monthly. Tourist tax as your comune requires.' },
    steps: [
      { it: 'Trova il riquadro dell’obbligo che ti serve.', en: 'Find the card for the obligation you need.', target: 'export-axis-police', art: 'ex1' },
      { it: 'Premi «📥 Genera File Ospiti (.txt)»: il file si scarica.', en: 'Press “📥 Generate Guest File (.txt)”: the file downloads.', target: 'export-alloggiati-btn', art: 'ex2' },
      { it: 'Premi «Apri Alloggiati Web» accanto e carica il file.', en: 'Press “Open Alloggiati Web” next to it and upload the file.', target: 'export-alloggiati-link', art: 'ex3' },
    ],
    warn: { it: 'Ogni portale ha una scadenza. Se la salti, puoi ricevere una sanzione.', en: 'Each portal has its deadline. Missing it can lead to a fine.' },
    faq: [
      { q_it: 'Quali file servono a me?', a_it: 'Apri «Guida Conformità»: ti dice cosa vale per la tua casa.', q_en: 'Which files do I actually need?', a_en: 'Open Compliance Guide: it tells you what applies to your property.' },
      { q_it: 'Non vedo il link PayTourist.', a_it: 'Inseriscilo in «Dettagli Proprietà» e comparirà qui.', q_en: 'I can’t see the PayTourist link.', a_en: 'Add it in Property Details and it will appear here.' },
      { q_it: 'A cosa serve «📋 Esportazione Dati»?', a_it: 'È solo per te: un file con tutti i dati per la tua contabilità.', q_en: 'What is “📋 Raw Data Export” for?', a_en: 'It’s for you only: a file with all your data for your bookkeeping.' },
    ],
  },

  compliance: {
    page: { it: 'Guida Conformità', en: 'Compliance Guide' },
    title: { it: 'I tuoi obblighi, spiegati semplice', en: 'Your obligations, in plain language' },
    purpose: {
      it: 'Qui leggi quali comunicazioni devi fare, a chi, e quando.',
      en: 'Here you read which reports you must file, to whom, and when.',
    },
    when: { it: 'Prima del primo ospite. E ogni volta che hai un dubbio.', en: 'Before your first guest. And any time you’re unsure.' },
    steps: [
      { it: 'Leggi i tre obblighi: Polizia, statistiche, imposta di soggiorno.', en: 'Read the three obligations: Police, statistics, tourist tax.', target: 'compliance-intro', art: 'cm1' },
      { it: 'Per preparare i file, apri «Export & Conformità».', en: 'To prepare the files, open Export & Conformità.', target: 'export-axis-police', panel: 'export', art: 'cm2' },
    ],
    tip: { it: 'Le regole cambiano da comune a comune. Se hai dubbi, chiedi al tuo comune.', en: 'Rules vary by municipality. When in doubt, ask your comune.' },
    faq: [
      { q_it: 'Queste informazioni sono consulenza legale?', a_it: 'No, sono una guida pratica. Verifica sempre con il tuo comune o commercialista.', q_en: 'Is this legal advice?', a_en: 'No, it’s a practical guide. Always confirm with your comune or accountant.' },
    ],
  },

  // ─── priority 2 (calendar + chat) ──────────────────────────────────
  calendar: {
    page: { it: 'Calendario', en: 'Calendar' },
    title: { it: 'Le tue prenotazioni', en: 'Your bookings' },
    purpose: {
      it: 'Qui vedi tutte le prenotazioni del mese, giorno per giorno.',
      en: 'Here you see every booking of the month, day by day.',
    },
    when: { it: 'Quando vuoi sapere chi arriva e chi manca al check-in.', en: 'When you want to know who’s arriving and who’s missing their check-in.' },
    steps: [
      { it: 'Premi ‹ o › per cambiare mese. «Oggi» torna a oggi.', en: 'Press ‹ or › to change month. “Today” returns to today.', target: 'cal-nav', art: 'cl1' },
      { it: 'Verde: l’ospite ha fatto il check-in. Giallo: non ancora.', en: 'Green: the guest has checked in. Amber: not yet.', target: 'cal-bar', art: 'cl2', emptyHint: { it: 'Le barre compaiono quando hai prenotazioni questo mese.', en: 'The bars appear when you have bookings this month.' } },
      { it: 'Premi una prenotazione per vedere dettagli e link dell’ospite.', en: 'Press a booking to see details and the guest link.', target: 'cal-bar', art: 'cl3' },
      { it: 'Sul telefono, tocca un giorno per vedere chi c’è.', en: 'On phone, tap a day to see who’s there.', target: 'cal-day', art: 'cl4', emptyHint: { it: 'Solo su telefono. Su computer, le barre bastano.', en: 'Phone only. On desktop the bars are enough.' } },
    ],
    tip: { it: 'Collega Airbnb o Booking da «Dettagli Proprietà»: le prenotazioni arrivano qui da sole.', en: 'Link Airbnb or Booking from Property Details: bookings arrive here automatically.' },
    faq: [
      { q_it: 'Perché vedo un codice invece del nome?', a_it: 'Da Airbnb e Booking arrivano solo le date. Il nome compare quando l’ospite fa il check-in.', q_en: 'Why do I see a code instead of a name?', a_en: 'Airbnb and Booking only send dates. The name appears once the guest checks in.' },
      { q_it: 'Manca una prenotazione.', a_it: 'In «Dettagli Proprietà», nella sezione «Sincronizzazione calendario (iCal)», premi «🔄 Sincronizza ora».', q_en: 'A booking is missing.', a_en: 'In Property Details, under Calendar sync (iCal), press “🔄 Sync now”.' },
    ],
  },

  chat: {
    page: { it: 'Chat Ospiti', en: 'Guest Chat' },
    title: { it: 'Rispondere agli ospiti', en: 'Replying to guests' },
    purpose: {
      it: 'Qui leggi le chat degli ospiti con l’assistente e rispondi quando chiedono di te.',
      en: 'Here you read guests’ chats with the assistant and reply when they ask for you.',
    },
    when: { it: 'Quando ricevi un avviso, o una volta al giorno.', en: 'When you get an alert, or once a day.' },
    steps: [
      { it: 'Scegli l’ospite da «Conversazioni Attive».', en: 'Pick the guest from “Active Conversations”.', target: 'chat-picker', art: 'ct1' },
      { it: 'Se vedi la banda gialla, l’ospite chiede te. Scrivi e premi «Invia».', en: 'If you see the amber banner, the guest is asking for you. Write and press “Send”.', target: 'chat-send', art: 'ct2', emptyHint: { it: 'Il pulsante compare quando apri una conversazione.', en: 'The button appears when you open a conversation.' } },
      { it: 'Quando hai finito, premi «✓ Risolvi»: l’assistente riprende.', en: 'When done, press “✓ Resolve”: the assistant takes over again.', target: 'chat-resolve', art: 'ct3' },
      { it: 'Apri «Avvisi» per ricevere un avviso sul telefono.', en: 'Open “Alerts” to receive alerts on your phone.', target: 'chat-alerts-card', art: 'ct4' },
    ],
    tip: { it: 'In «Avvisi» premi «📤 Invia avviso di prova» per controllare che funzioni.', en: 'In Alerts, press “📤 Send test alert” to check it works.' },
    faq: [
      { q_it: 'Non ricevo avvisi sull’iPhone.', a_it: 'Aggiungi WelcomeBnB alla schermata Home, aprila da lì e attiva gli avvisi.', q_en: 'I don’t receive alerts on iPhone.', a_en: 'Add WelcomeBnB to your Home Screen, open it from there, then enable alerts.' },
      { q_it: 'Cosa fa «📁 Archivia»?', a_it: 'Nasconde la chat. La ritrovi con «Vedi archivio».', q_en: 'What does “📁 Archive” do?', a_en: 'It hides the chat. Find it again with “View archive”.' },
      { q_it: 'L’assistente risponde da solo?', a_it: 'Sì, alle domande comuni. Quando non sa, chiama te.', q_en: 'Does the assistant reply on its own?', a_en: 'Yes, to common questions. When it doesn’t know, it calls you.' },
    ],
  },
};

// Helper — did the guide for this panel exist?
function guideFor(panelId) { return GUIDES[panelId] || null; }

// ═════════════════════════════════════════════════════════════════════
// 7 · Renderer  (drawer = desktop, sheet = mobile)
// ═════════════════════════════════════════════════════════════════════
const MOBILE_MAX = 720;
const isMobile = () => window.matchMedia && window.matchMedia('(max-width: ' + MOBILE_MAX + 'px)').matches;

let _openState = null;              // { root, panel, activeStep, mobile, scrim, prevFocus }
let _feedbackSent = new Set();      // per-session, per-panel

function openGuide(panelId, opts) {
  opts = opts || {};
  const g = guideFor(panelId);
  if (!g) return;
  closeGuide();
  const mobile = isMobile();
  const lang = HOSTLANG();
  const u = UI[lang] || UI.it;

  const scrim = el('div', { class: 'cf-scrim', onclick: closeGuide });
  document.body.appendChild(scrim);

  const container = mobile ? renderSheet(g, lang, u) : renderDrawer(g, lang, u);
  document.body.appendChild(container);

  const prevFocus = document.activeElement;
  _openState = { root: container, panel: panelId, mobile, scrim, prevFocus, lang };

  // Focus first focusable inside container.
  const first = container.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();

  // Esc + focus trap.
  container.addEventListener('keydown', onKey);
  markSeen(panelId);
  if (opts.activeStep != null) scrollToStep(container, opts.activeStep);
}

function closeGuide() {
  if (!_openState) return;
  const { root, scrim, prevFocus } = _openState;
  if (root && root.parentNode) root.parentNode.removeChild(root);
  if (scrim && scrim.parentNode) scrim.parentNode.removeChild(scrim);
  if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
  _openState = null;
}

function onKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeGuide(); return; }
  if (e.key === 'Tab' && _openState) {
    const focusables = Array.from(_openState.root.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}

function scrollToStep(root, idx) {
  const step = root.querySelectorAll('.cf-step')[idx];
  if (step && step.scrollIntoView) step.scrollIntoView({ behavior: 'auto', block: 'start' });
}

function renderHead(g, lang, u, mobile) {
  const head = el('header', { class: 'cf-head' + (mobile ? ' cf-head-m' : ''), role: 'dialog', 'aria-modal': 'true' }, [
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div', { class: 'cf-eyebrow' }, [icon('book', 16), document.createTextNode(u.how + ' · ' + g.page[lang])]),
      el('h2', { class: 'cf-title', text: g.title[lang] }),
      el('span', { class: 'cf-time' }, [icon('clock', 14), document.createTextNode(u.minute)]),
    ]),
    el('button', { class: 'cf-close', 'aria-label': u.close, onclick: closeGuide }, [icon('x', 22, 2)]),
  ]);
  return head;
}

function renderBody(g, lang, u, mobile) {
  const body = el('div', { class: 'cf-body' + (mobile ? ' cf-body-m' : '') });

  // Purpose
  body.appendChild(el('section', {}, [
    el('div', { class: 'cf-label', text: u.purpose }),
    el('p', { class: 'cf-purpose', text: g.purpose[lang] }),
  ]));

  // When
  body.appendChild(el('section', { class: 'cf-when' }, [
    icon('clock', 22),
    el('div', {}, [
      el('div', { class: 'cf-label', style: { marginBottom: '2px' }, text: u.when }),
      el('div', { class: 'cf-when-t', text: g.when[lang] }),
    ]),
  ]));

  // Steps
  const ol = el('ol', { class: 'cf-steps' });
  g.steps.forEach((s, i) => {
    const li = el('li', { class: 'cf-step' });
    const frameBox = el('div', { class: 'cf-frame' });
    frameBox.appendChild(frame(s.art));
    li.appendChild(frameBox);
    li.appendChild(el('div', { class: 'cf-step-row' }, [
      el('span', { class: 'cf-num', 'aria-label': u.step + ' ' + (i + 1), text: String(i + 1) }),
      el('p', { class: 'cf-step-t', text: s[lang] }),
    ]));
    const btn = el('button', { class: 'cf-show', type: 'button', onclick: () => showMe(s, i) }, [
      icon('eye', 18), document.createTextNode(u.show),
    ]);
    li.appendChild(btn);
    ol.appendChild(li);
  });
  body.appendChild(ol);

  // Warn
  if (g.warn) body.appendChild(callout('warn', lang === 'it' ? 'Attenzione' : 'Important', g.warn[lang]));
  // Tip
  if (g.tip) body.appendChild(callout('tip', lang === 'it' ? 'Suggerimento' : 'Tip', g.tip[lang]));

  // FAQ
  if (g.faq && g.faq.length) {
    const faqSection = el('section');
    faqSection.appendChild(el('h3', { class: 'cf-h3', text: u.faq }));
    const list = el('div', { class: 'cf-faq' });
    g.faq.forEach((f) => {
      const item = el('div', { class: 'cf-q-item' });
      const q = el('button', { class: 'cf-q-btn', type: 'button', 'aria-expanded': 'false' }, [
        el('span', { text: lang === 'it' ? f.q_it : f.q_en }),
        icon('down', 20),
      ]);
      const a = el('p', { class: 'cf-a', text: lang === 'it' ? f.a_it : f.a_en, style: { display: 'none' } });
      q.addEventListener('click', () => {
        const on = item.classList.toggle('on');
        q.setAttribute('aria-expanded', on ? 'true' : 'false');
        a.style.display = on ? '' : 'none';
        q.replaceChild(icon(on ? 'up' : 'down', 20), q.querySelector('svg'));
      });
      item.appendChild(q);
      item.appendChild(a);
      list.appendChild(item);
    });
    faqSection.appendChild(list);
    body.appendChild(faqSection);
  }

  return body;
}

function callout(kind, label, txt) {
  return el('section', { class: 'cf-call cf-' + kind, role: 'note' }, [
    el('span', { class: 'cf-call-ic' }, [icon(kind === 'warn' ? 'warn' : 'bulb', 22)]),
    el('div', {}, [el('div', { class: 'cf-call-l', text: label }), el('p', { text: txt })]),
  ]);
}

function renderFoot(panelId, lang, u) {
  const foot = el('div', { class: 'cf-foot' });
  const usefulRow = el('div', { class: 'cf-useful' });
  usefulRow.appendChild(el('span', { text: u.useful }));

  const votes = el('div', { style: { display: 'flex', gap: '8px' } });
  const already = _feedbackSent.has(panelId);
  const thanks = el('span', { class: 'cf-thanks', text: u.thanks, style: { display: already ? '' : 'none' } });
  const yesBtn = el('button', { class: 'cf-vote', type: 'button', disabled: already ? 'disabled' : null, onclick: () => vote(panelId, true, [yesBtn, noBtn], thanks) }, [icon('thumbUp', 18), document.createTextNode(u.yes)]);
  const noBtn  = el('button', { class: 'cf-vote', type: 'button', disabled: already ? 'disabled' : null, onclick: () => vote(panelId, false, [yesBtn, noBtn], thanks) }, [icon('thumbDn', 18), document.createTextNode(u.no)]);
  votes.appendChild(yesBtn); votes.appendChild(noBtn); votes.appendChild(thanks);
  usefulRow.appendChild(votes);
  foot.appendChild(usefulRow);

  const helpRow = el('div', { class: 'cf-help' });
  helpRow.appendChild(el('span', { text: u.doubt }));
  const subject = encodeURIComponent('Guida ' + panelId);
  helpRow.appendChild(el('a', {
    class: 'cf-contact', href: 'mailto:welcomebnbadmin@gmail.com?subject=' + subject,
  }, [icon('mail', 18), document.createTextNode(u.contact)]));
  foot.appendChild(helpRow);
  return foot;
}

function renderDrawer(g, lang, u) {
  const panelId = _openState ? _openState.panel : null;
  const box = el('aside', { class: 'cf-drawer', 'aria-label': g.title[lang] });
  box.appendChild(renderHead(g, lang, u, false));
  const scroll = el('div', { class: 'cf-scroll' });
  scroll.appendChild(renderBody(g, lang, u, false));
  box.appendChild(scroll);
  box.appendChild(renderFoot(_currentPanelForFoot, lang, u));  // fallback below
  return box;
}
function renderSheet(g, lang, u) {
  const box = el('aside', { class: 'cf-sheet', 'aria-label': g.title[lang] });
  box.appendChild(el('div', { class: 'cf-handle', 'aria-hidden': 'true' }));
  box.appendChild(renderHead(g, lang, u, true));
  const scroll = el('div', { class: 'cf-scroll' });
  scroll.appendChild(renderBody(g, lang, u, true));
  box.appendChild(scroll);
  box.appendChild(renderFoot(_currentPanelForFoot, lang, u));
  return box;
}

// The panel id is known at open time; foot uses it. Since renderDrawer/
// Sheet are called before _openState is set (they build the DOM), we
// pass the current opener through this holder.
let _currentPanelForFoot = null;

function renderRoot(g, lang, u, panelId, mobile) {
  _currentPanelForFoot = panelId;
  return mobile ? renderSheet(g, lang, u) : renderDrawer(g, lang, u);
}

// Replace the naive openGuide with a version that uses renderRoot.
function openGuide2(panelId, opts) {
  opts = opts || {};
  const g = guideFor(panelId);
  if (!g) return;
  closeGuide();
  const mobile = isMobile();
  const lang = HOSTLANG();
  const u = UI[lang] || UI.it;

  const scrim = el('div', { class: 'cf-scrim', onclick: closeGuide });
  document.body.appendChild(scrim);
  const container = renderRoot(g, lang, u, panelId, mobile);
  document.body.appendChild(container);

  const prevFocus = document.activeElement;
  _openState = { root: container, panel: panelId, mobile, scrim, prevFocus, lang };

  const first = container.querySelector('button, [href], [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
  container.addEventListener('keydown', onKey);
  markSeen(panelId);
  if (opts.activeStep != null) scrollToStep(container, opts.activeStep);
}

// ═════════════════════════════════════════════════════════════════════
// 8 · Feedback
// ═════════════════════════════════════════════════════════════════════
function vote(panelId, helpful, btns, thanksEl) {
  btns.forEach(b => b.setAttribute('disabled', 'disabled'));
  _feedbackSent.add(panelId);
  if (thanksEl) thanksEl.style.display = '';
  if (IS_ADMIN()) return;               // admin view: never record
  const sb = window.sb;
  if (!sb || !sb.from) return;
  const lang = HOSTLANG();
  sb.auth.getUser().then(({ data }) => {
    const uid = data && data.user && data.user.id;
    if (!uid) return;
    return sb.from('guide_feedback').insert({
      host_id: uid, panel: panelId, helpful: !!helpful,
      lang: lang === 'it' ? 'it' : 'en',
    }).select();
  }).then(res => {
    if (res && res.error) console.warn('[HG] feedback insert error:', res.error);
    if (res && res.data && res.data.length === 0) console.warn('[HG] feedback blocked by RLS (0 rows)');
  }).catch(err => console.warn('[HG] feedback failed:', err));
}

// ═════════════════════════════════════════════════════════════════════
// 9 · Spotlight  ("Mostrami" → dim + ring + tooltip on the real element)
// ═════════════════════════════════════════════════════════════════════
let _spot = null;

async function showMe(step, stepIdx) {
  if (!_openState) return;
  const panelBefore = _openState.panel;

  // If the step targets another panel, navigate first.
  if (step.panel && typeof window.showPanel === 'function' && step.panel !== currentActivePanelId()) {
    // Hide the drawer visually (don't destroy — we want to return to it).
    hideRoot();
    try { window.showPanel(step.panel); } catch (_) {}
  } else {
    hideRoot();
  }

  // Poll for target (up to ~2s).
  const target = await waitForTarget(step.target, 2000);
  if (!target) {
    // Empty state — show the guide again with an inline note next to that step.
    showRoot();
    showEmptyHint(step, stepIdx);
    return;
  }

  spotlightOn(target, step, stepIdx, panelBefore);
}

function currentActivePanelId() {
  const active = document.querySelector('.panel.active');
  return active ? active.id.replace(/^panel-/, '') : null;
}

function hideRoot() {
  if (!_openState) return;
  _openState.root.style.display = 'none';
  _openState.scrim.style.display = 'none';
}
function showRoot() {
  if (!_openState) return;
  _openState.root.style.display = '';
  _openState.scrim.style.display = '';
}

function waitForTarget(id, timeoutMs) {
  return new Promise(resolve => {
    const started = Date.now();
    const tick = () => {
      const found = document.querySelector('[data-guide="' + id + '"]');
      if (found && found.offsetParent !== null) return resolve(found);
      if (Date.now() - started >= timeoutMs) return resolve(null);
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function spotlightOn(target, step, stepIdx, panelBefore) {
  // Kill any prior spotlight.
  spotlightOff(true);

  target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });

  const dim = el('div', { class: 'sp-dim', onclick: () => spotlightOff(false) });
  document.body.appendChild(dim);

  const r = target.getBoundingClientRect();
  const pad = 6;
  const ring = el('div', {
    class: 'sp-ring',
    style: {
      left: (r.left - pad) + 'px',
      top: (r.top - pad) + 'px',
      width: (r.width + pad * 2) + 'px',
      height: (r.height + pad * 2) + 'px',
    },
    'aria-hidden': 'true',
  });
  document.body.appendChild(ring);

  const u = UI[HOSTLANG()] || UI.it;
  const tip = el('div', { class: 'sp-tip' }, [
    el('span', { text: u.tapHere }),
    el('span', { class: 'sp-timer', 'aria-hidden': 'true' }, [el('span')]),
  ]);
  document.body.appendChild(tip);
  // Position: above target by default, below when near top.
  const spaceAbove = r.top;
  const tipRect = tip.getBoundingClientRect();
  if (spaceAbove > tipRect.height + 24) {
    tip.style.left = Math.max(8, r.left + r.width / 2 - tipRect.width / 2) + 'px';
    tip.style.top  = (r.top - tipRect.height - 12) + 'px';
  } else {
    tip.classList.add('sp-tip-below');
    tip.style.left = Math.max(8, r.left + r.width / 2 - tipRect.width / 2) + 'px';
    tip.style.top  = (r.bottom + 12) + 'px';
  }

  const resume = renderResume(stepIdx, panelBefore);
  document.body.appendChild(resume);

  const timer = setTimeout(() => spotlightOff(false), 4000);
  _spot = { dim, ring, tip, resume, timer, target, stepIdx, panelBefore };
}

function spotlightOff(silent) {
  if (!_spot) return;
  clearTimeout(_spot.timer);
  ['dim', 'ring', 'tip'].forEach(k => {
    if (_spot[k] && _spot[k].parentNode) _spot[k].parentNode.removeChild(_spot[k]);
  });
  const resume = _spot.resume;
  _spot = null;
  if (!silent) {
    // Leave the resume pill in place so the host can return to the guide.
    return;
  }
  if (resume && resume.parentNode) resume.parentNode.removeChild(resume);
}

function renderResume(stepIdx, panelBefore) {
  const lang = HOSTLANG();
  const u = UI[lang] || UI.it;
  const g = guideFor(panelBefore);
  const total = g ? g.steps.length : 0;
  const stepText = u.step + ' ' + (stepIdx + 1) + ' ' + (lang === 'it' ? 'di' : 'of') + ' ' + total;
  const btn = el('button', {
    class: 'sp-resume' + (isMobile() ? ' sp-resume-m' : ''),
    type: 'button',
    onclick: () => {
      const r = btn; if (r && r.parentNode) r.parentNode.removeChild(r);
      openGuide2(panelBefore, { activeStep: stepIdx });
    },
  }, [
    el('span', { class: 'sp-resume-ic' }, [icon('book', 20)]),
    el('span', {}, [
      el('span', { class: 'sp-resume-s', text: stepText }),
      el('span', { class: 'sp-resume-l', text: u.backToGuide }),
    ]),
  ]);
  return btn;
}

function showEmptyHint(step, stepIdx) {
  if (!_openState) return;
  const li = _openState.root.querySelectorAll('.cf-step')[stepIdx];
  if (!li) return;
  const existing = li.querySelector('.cf-empty');
  if (existing) existing.parentNode.removeChild(existing);
  const lang = HOSTLANG();
  const hint = step.emptyHint ? (lang === 'it' ? step.emptyHint.it : step.emptyHint.en) : (lang === 'it' ? 'Nessun elemento da mostrare adesso.' : 'Nothing to show right now.');
  li.appendChild(el('div', { class: 'cf-empty', text: hint }));
  if (li.scrollIntoView) li.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ═════════════════════════════════════════════════════════════════════
// 10 · Pill  (mounted next to #panelTitle by host-console.html's
//   showPanel(). We expose mountPill(panelId) and onLangSwitch().)
// ═════════════════════════════════════════════════════════════════════
const SEEN_KEY = 'wbnb_guide_seen_';

function seenPanels() {
  const out = new Set();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(SEEN_KEY) === 0) out.add(k.slice(SEEN_KEY.length));
    }
  } catch (_) {}
  return out;
}
function isSeen(panelId) { try { return !!localStorage.getItem(SEEN_KEY + panelId); } catch (_) { return true; } }
function markSeen(panelId) { try { localStorage.setItem(SEEN_KEY + panelId, '1'); } catch (_) {} }

function mountPill(panelId) {
  // Remove any existing pill first.
  const prev = document.querySelector('.cf-pill');
  if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
  if (!panelId || !guideFor(panelId)) return;
  const title = document.getElementById('panelTitle');
  if (!title) return;
  const lang = HOSTLANG();
  const seen = isSeen(panelId);
  const label = seen
    ? (lang === 'it' ? 'Come funziona' : 'How it works')
    : (lang === 'it' ? 'Nuovo? Guida da 1 minuto' : 'New? 1-minute guide');
  const pill = el('button', {
    class: 'cf-pill' + (seen ? ' cf-seen' : ' cf-new'),
    type: 'button',
    'aria-label': lang === 'it' ? 'Apri la guida' : 'Open the guide',
    onclick: () => openGuide2(panelId),
  }, [
    el('span', { class: 'cf-q' }, [icon('q', 16, 2.2)]),
    el('span', { text: label }),
  ]);
  // Insert AFTER the title (nextSibling append). Title lives inside a
  // parent container we don't want to disturb — just append there.
  title.parentNode.insertBefore(pill, title.nextSibling);
}

// Set the current language. Called by host-console.html once when HG
// finishes loading (via HG.setLang), and again on every EN/IT toggle
// (via HG.onLangSwitch). Both update _currentLang before repainting.
function setLang(l) {
  if (l === 'en' || l === 'it') _currentLang = l;
}

// Language flip while a guide is open.
function onLangSwitch(l) {
  setLang(l);
  // Re-mount the pill to update its label and pulse state.
  const active = currentActivePanelId();
  if (active) mountPill(active);
  // Repaint the drawer/sheet in place if open.
  if (_openState) {
    const panelId = _openState.panel;
    openGuide2(panelId);
  }
}

// ═════════════════════════════════════════════════════════════════════
// 11 · Dev checker  — window.__checkGuides()
// ═════════════════════════════════════════════════════════════════════
function checkGuides() {
  const report = { missingTargets: [], panelsWithoutGuide: [], stepCount: 0, guideCount: 0 };
  const SECTIONS = window.SECTIONS || {};
  const allPanels = new Set();
  Object.keys(SECTIONS).forEach(sec => (SECTIONS[sec].panels || []).forEach(p => allPanels.add(p)));
  allPanels.forEach(p => { if (!guideFor(p)) report.panelsWithoutGuide.push(p); });
  Object.keys(GUIDES).forEach(panel => {
    const g = GUIDES[panel]; report.guideCount++;
    g.steps.forEach((s, i) => {
      report.stepCount++;
      // Only check targets on the panel that's currently active — most
      // targets are cross-panel and won't be in the DOM.
      const active = currentActivePanelId();
      const wantPanel = s.panel || panel;
      if (wantPanel !== active) return;
      const found = document.querySelector('[data-guide="' + s.target + '"]');
      if (!found) report.missingTargets.push({ panel, step: i + 1, target: s.target });
    });
  });
  console.log('[HG] checkGuides →', report);
  return report;
}

// ═════════════════════════════════════════════════════════════════════
// 12 · Bootstrap
// ═════════════════════════════════════════════════════════════════════
function injectStyle() {
  if (document.getElementById('hg-style')) return;
  const s = document.createElement('style');
  s.id = 'hg-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

injectStyle();

// Public API — everything else stays inside the closure.
window.HG = {
  setLang,
  mountPill,
  onLangSwitch,
  openGuide: openGuide2,
  closeGuide,
  checkGuides,
  guides: GUIDES,       // read-only reference for tests
  version: '43.2',
};
// Alias for the console-side dev command name the spec asks for.
window.__checkGuides = checkGuides;

// Do NOT auto-mount from here — the loader in host-console.html calls
// HG.setLang(hostLang) followed by HG.mountPill(panelId) once the file
// has actually finished loading. Auto-mounting here would race with
// setLang: _currentLang still defaults to 'it' when the IIFE runs, so
// the first pill paint would end up in Italian even for EN hosts.

})();
