// 17 Nov 2026 — admin console in Italian (default) or English, with a
// toggle in the top bar. The console was written partly in English, partly
// in Italian; instead of rewriting ~5,000 lines, this layer translates the
// visible text (text nodes, placeholder/title/aria-label, button values,
// confirm/alert/prompt messages) in both directions from one dictionary
// (admin-i18n-dict.js): exact phrases first, then patterns with values
// ("Action needed (3)"), then the parts of «a · b» / «label: value» texts.
// Anything not in the dictionary (names, e-mails, numbers, guest data) is
// left untouched. The original text of each node is remembered, so switching
// back and forth is lossless, and newly drawn content is translated as it
// appears (MutationObserver).
(function (root) {
  'use strict';
  const KEY = 'wbnb_admin_lang';
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const EN2IT = new Map(), IT2EN = new Map(), PATTERNS = [];
  let lang = 'it';
  try { const v = root.localStorage && root.localStorage.getItem(KEY); if (v === 'en' || v === 'it') lang = v; } catch (_) {}

  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function compile(tpl) {
    const names = [];
    const src = escRe(tpl).replace(/\\\{(\w+)\\\}/g, (_, n) => { names.push(n); return '(.+?)'; });
    return { re: new RegExp('^' + src + '$'), names };
  }
  function fill(tpl, values) { return tpl.replace(/\{(\w+)\}/g, (_, n) => values[n] != null ? values[n] : ''); }

  // dict: array of [en, it]; a «{name}» in both makes it a pattern.
  function add(pairs) {
    for (const [en, it, oneWay] of pairs) {
      if (/\{\w+\}/.test(en)) PATTERNS.push({ en, it, oneWay: oneWay === 'to-it', enRe: compile(en), itRe: compile(it), weight: en.replace(/\{\w+\}/g, '').length + it.replace(/\{\w+\}/g, '').length });
      else {
        if (oneWay !== 'to-en' && !EN2IT.has(en)) EN2IT.set(en, it);
        if (oneWay !== 'to-it' && !IT2EN.has(it)) IT2EN.set(it, en);
      }
    }
  }

  // Most specific patterns first («across {n} property» before «{n} property»).
  function sortPatterns() { PATTERNS.sort((a, b) => b.weight - a.weight); }
  // Short month names in dates («14 Nov», «15 Nov 2026») follow the language.
  const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function months(s, to) {
    const [from, into] = to === 'it' ? [MONTHS_EN, MONTHS_IT] : [MONTHS_IT, MONTHS_EN];
    return s.replace(new RegExp('\\b(\\d{1,2}) (' + from.join('|') + ')\\b', 'g'), (_, d, m) => d + ' ' + into[from.indexOf(m)]);
  }
  function exact(t, to) { return to === 'it' ? EN2IT.get(t) : IT2EN.get(t); }
  function viaPattern(t, to) {
    for (const p of PATTERNS) {
      if (p.oneWay && to !== 'it') continue;
      const from = to === 'it' ? p.enRe : p.itRe;
      const m = from.re.exec(t);
      if (!m) continue;
      // A value never spans the separators of a composite text («a · b»):
      // those are translated part by part instead.
      if (m.slice(1).some(v => / · | — | \| /.test(v))) continue;
      const values = {};
      from.names.forEach((n, i) => { const v = m[i + 1]; values[n] = core(v, to) ?? v; });
      return fill(to === 'it' ? p.it : p.en, values);
    }
    return null;
  }
  // Leading/trailing symbols (emoji, arrows, «:», «…», «(n)») are kept.
  function core(t, to) {
    if (!t) return null;
    const e = exact(t, to); if (e != null) return e;
    const p = viaPattern(t, to); if (p != null) return p;
    const m = /^([^\p{L}\p{N}]*)(.*?)([\s:.,;!?…▾▴▲▼→←·—–\-]*)$/u.exec(t);
    if (m && (m[1] || m[3]) && m[2] && m[2] !== t) {
      const inner = exact(m[2], to) ?? viaPattern(m[2], to);
      if (inner != null) return m[1] + inner + m[3];
    }
    return null;
  }
  function translate(text, to = lang) {
    if (text == null) return text;
    const s = String(text);
    const raw = s.trim();
    if (!raw || !/\p{L}/u.test(raw)) return s;
    // Templates wrap long text over several lines: compare with single spaces.
    const t = raw.replace(/\s+/g, ' ');
    let out = core(t, to);
    if (out == null) {
      // «a · b · c», «label: value», «a — b», «a | b»: translate the parts.
      const parts = t.split(/( · | — | \| |: |\n)/);
      if (parts.length > 1) {
        let changed = false;
        const mapped = parts.map((part, i) => {
          if (i % 2) return part;
          const r = core(part.trim(), to);
          if (r == null) return part;
          changed = true;
          return part.replace(part.trim(), r);
        });
        if (changed) out = mapped.join('');
      }
    }
    return months(out == null ? s : s.replace(raw, out), to);
  }

  // Remember each node's original text; re-derive from it on every change.
  const textState = new WeakMap(), attrState = new WeakMap();
  const SKIP = 'script,style,textarea,code,pre,[data-i18n-skip],[contenteditable="true"]';
  function doText(node) {
    const p = node.parentElement;
    if (!p || p.closest(SKIP)) return;
    let st = textState.get(node);
    if (!st || node.data !== st.out) st = { orig: node.data };
    st.out = translate(st.orig);
    textState.set(node, st);
    if (node.data !== st.out) node.data = st.out;
  }
  function doAttrs(el) {
    if (el.closest(SKIP)) return;
    let map = attrState.get(el);
    const names = ATTRS.slice();
    if (el.tagName === 'INPUT' && /^(button|submit)$/i.test(el.type)) names.push('value');
    for (const a of names) {
      if (!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      map = map || {};
      let st = map[a];
      if (!st || v !== st.out) st = { orig: v };
      st.out = translate(st.orig);
      map[a] = st;
      if (v !== st.out) el.setAttribute(a, st.out);
    }
    if (map) attrState.set(el, map);
  }
  function apply(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 3) return doText(rootNode);
    if (rootNode.nodeType !== 1 && rootNode.nodeType !== 9 && rootNode.nodeType !== 11) return;
    if (rootNode.nodeType === 1) doAttrs(rootNode);
    const walker = (rootNode.ownerDocument || rootNode).createTreeWalker(rootNode, 5 /* element | text */);
    let n;
    while ((n = walker.nextNode())) { if (n.nodeType === 3) doText(n); else doAttrs(n); }
  }

  let observer = null, pending = new Set(), scheduled = false;
  function flush() {
    scheduled = false;
    const nodes = [...pending]; pending.clear();
    if (observer) observer.disconnect();
    try { for (const n of nodes) if (n.isConnected) apply(n); }
    finally { if (observer) observer.observe(root.document.documentElement, OBS); }
  }
  const OBS = { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat('value') };
  function watch() {
    if (observer || !root.MutationObserver) return;
    observer = new root.MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'childList') m.addedNodes.forEach(n => pending.add(n));
        else pending.add(m.target);
      }
      if (!scheduled) { scheduled = true; Promise.resolve().then(flush); }
    });
    observer.observe(root.document.documentElement, OBS);
  }

  // Dialogs raised by the console code.
  for (const fn of ['confirm', 'alert', 'prompt']) {
    const original = root[fn];
    if (typeof original === 'function') root[fn] = function (msg, ...rest) { return original.call(this, translate(msg), ...rest); };
  }

  function renderToggle() {
    const el = root.document.getElementById('adminLangToggle');
    if (!el) return;
    el.querySelectorAll('button[data-lang]').forEach(b => {
      const on = b.dataset.lang === lang;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? '#fff' : 'transparent';
      b.style.color = on ? '#061A3D' : '#fff';
    });
  }
  let titleOrig = null;
  function doTitle() {
    const d = root.document;
    if (titleOrig === null) titleOrig = d.title;
    d.title = translate(titleOrig);
  }
  function setLang(next) {
    if (next !== 'it' && next !== 'en') return;
    lang = next;
    try { root.localStorage.setItem(KEY, lang); } catch (_) {}
    root.document.documentElement.lang = lang;
    if (observer) observer.disconnect();
    apply(root.document.body);
    if (observer) observer.observe(root.document.documentElement, OBS);
    doTitle();
    renderToggle();
  }
  function start() {
    root.document.documentElement.lang = lang;
    apply(root.document.body);
    watch();
    doTitle();
    renderToggle();
  }

  root.AdminI18n = { add: pairs => { add(pairs); sortPatterns(); }, translate, setLang, get lang() { return lang; }, apply, start, _stats: () => ({ phrases: EN2IT.size, patterns: PATTERNS.length }) };
  if (root.ADMIN_I18N_DICT) add(root.ADMIN_I18N_DICT);
  sortPatterns();
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
