// 25 Nov 2026 — one look for the admin tables («Utenti» and Ops → Hosts &
// Properties, Daniele: «use for the Ops property table the same UI that we
// have on the user tab»). A table when it fits the content area, measured
// (Windows display scaling and zoom make the window width a poor guide);
// otherwise each row becomes a stacked card with a «Sort by» menu, so nothing
// scrolls sideways. Markup contract:
//   <div class="u-wrap" data-table-fit> [.u-sortbar] <table class="u-tbl"> …
//   first cell td.u-main (name line .u-nameline with .u-name and .u-icons,
//   then .u-sub lines); other cells <td><span class="u-lbl">label</span>
//   <span class="u-val">value</span></td>.
(function (root) {
  'use strict';
  const CSS = `.u-tbl{width:100%;border-collapse:collapse;font-size:0.8rem;table-layout:auto}
.u-tbl th,.u-tbl td{padding:4px 5px;text-align:left;vertical-align:middle;border-bottom:1px solid var(--border);overflow-wrap:anywhere;line-height:1.3}
.u-tbl th{font-size:0.74rem}.u-lbl{display:none}.u-sortbar{display:none}
.u-tbl tr[hidden]{display:none!important}
.u-who{min-width:0}.u-nameline{display:flex;align-items:center;gap:6px;min-width:0}.u-nameline [data-users-open],.u-nameline .u-name{min-width:0}
.u-sub{font-size:0.72rem;color:var(--ink-soft)}.u-icons{display:inline-flex;gap:3px;flex:0 0 auto}
.u-dl{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:1px solid var(--border);border-radius:6px;background:var(--white);color:var(--warm,#1849A9);cursor:pointer;font:inherit;font-size:0.8rem;padding:0;margin-left:4px;vertical-align:middle}
.u-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.u-wrap:not(.u-cards) .u-who{max-width:200px}.u-wrap:not(.u-cards) .u-who .u-sub,.u-wrap:not(.u-cards) .u-who [data-users-open],.u-wrap:not(.u-cards) .u-who .u-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}.u-wrap:not(.u-cards) .u-nameline{max-width:200px}.u-wrap:not(.u-cards) .u-nameline [data-users-open],.u-wrap:not(.u-cards) .u-nameline .u-name{flex:0 1 auto;max-width:none}
.u-wrap:not(.u-cards) .u-act{width:18px;height:18px;font-size:0.66rem;border-radius:5px}
.u-wrap:not(.u-cards) .u-nameline{line-height:1.2}
.u-wrap:not(.u-cards) .u-sub{line-height:1.25}
.u-wrap:not(.u-cards) .u-tbl td[data-days] .u-val,.u-wrap:not(.u-cards) .u-tbl td[data-terms] .u-val,.u-wrap:not(.u-cards) .u-tbl td[data-last] .u-val,.u-wrap:not(.u-cards) .u-tbl td[data-reg] .u-val,.u-wrap:not(.u-cards) .u-tbl td[data-reg] .u-val div,.u-wrap:not(.u-cards) .u-tbl td[data-nowrap] .u-val{white-space:nowrap}
.u-wrap:not(.u-cards) .u-tbl td[data-num]{text-align:center}
.u-wrap:not(.u-cards) .u-tbl td[data-next] .u-val{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;max-width:170px;white-space:normal;font-size:0.76rem;line-height:1.25}
.u-act{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid var(--border);border-radius:7px;text-decoration:none;font-size:0.85rem;background:var(--white);color:inherit;cursor:pointer;font-family:inherit;padding:0}
.u-wrap.u-cards .u-tbl thead{display:none}
.u-wrap.u-cards .u-tbl,.u-wrap.u-cards .u-tbl tbody,.u-wrap.u-cards .u-tbl tr,.u-wrap.u-cards .u-tbl td{display:block;width:auto}
.u-wrap.u-cards .u-tbl tr{border:1px solid var(--border);border-radius:10px;margin:0 0 10px;padding:6px 12px;background:var(--white)}
.u-wrap.u-cards .u-tbl td{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:5px 0;border:0}
.u-wrap.u-cards .u-tbl td.u-main{display:block;padding-bottom:8px;border-bottom:1px solid var(--border)}
.u-wrap.u-cards .u-tbl td:empty,.u-wrap.u-cards .u-tbl td.u-none{display:none}
.u-wrap.u-cards .u-lbl{display:inline;color:var(--ink-soft);font-size:0.74rem;flex:0 0 auto}
.u-wrap.u-cards .u-val{text-align:right;min-width:0}
.u-wrap.u-cards .u-sortbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.u-wrap.u-cards .u-act{width:44px;height:44px}`;
  const style = () => `<style data-table-ui>${CSS}</style>`;
  // Table or cards for one wrapper (or every [data-table-fit] on the page).
  function fit(wrap) {
    const list = wrap ? [wrap] : [...document.querySelectorAll('[data-table-fit]')];
    for (const w of list) {
      w.classList.remove('u-cards');
      const t = w.querySelector('table');
      const tooWide = (t && t.scrollWidth > w.clientWidth + 1) || document.documentElement.scrollWidth > root.innerWidth + 1;
      if (tooWide) w.classList.add('u-cards');
    }
  }
  let timer = null;
  if (typeof root.addEventListener === 'function') root.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => fit(), 120); });
  root.AdminTableUI = { css: CSS, style, fit };
})(typeof window !== 'undefined' ? window : globalThis);
