// Round 64 Phase 2: local table interaction only; never requests or changes data.
// 25 Nov 2026: Users-style UI (chips, ▲/▼, cards when it does not fit).
(function (root) {
  'use strict';
  const defaults = () => ({ search: '', city: 'all', filter: 'all', sort: 'lastActive', direction: 'desc' });
  let state = defaults();
  const text = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const columns = ['property', 'host', 'city', 'guests', 'completed', 'sent', 'alloggiati', 'failed', 'usage', 'setup', 'activity', 'lastActive'];
  function selectRows(rows, options) {
    const query = text(options.search).trim();
    const words = query.split(/\s+/).filter(Boolean);
    const filtered = rows.filter(row => {
      if (!words.every(word => text(row.search).includes(word))) return false;
      if (options.city !== 'all' && JSON.stringify(row.city || null) !== options.city) return false;
      switch (options.filter) {
        case 'failures': return row.failed != null && row.failed > 0;
        case 'unconfirmed': return row.unconfirmed != null && row.unconfirmed > 0;
        case 'allog_connection': return row.alloggiati != null && row.alloggiati < 4;
        case 'no_usage': return row.usage === 0;
        case 'low_usage': return row.usage != null && row.usage < 0.5;
        case 'no_bookings': return row.hasBookings === false;
        case 'setup': return row.ready === false || (row.ready == null && row.setup != null && row.setup < 80);
        case 'unavailable': return row.missingMetrics === true;
        case 'no_property': return !row.propertyId;
        default: return true;
      }
    });
    const key = columns.includes(options.sort) ? options.sort : 'lastActive';
    const sign = options.direction === 'asc' ? 1 : -1;
    return filtered.map((row, index) => ({ row, index })).sort((a, b) => {
      const av = a.row[key], bv = b.row[key];
      const missing = v => v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
      if (missing(av) || missing(bv)) return missing(av) === missing(bv) ? a.index - b.index : missing(av) ? 1 : -1;
      const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : text(av).localeCompare(text(bv), undefined, { numeric: true });
      return sign * comparison || a.index - b.index;
    }).map(item => item.row);
  }
  // 25 Nov 2026 — same UI as «Utenti» (admin-table-ui.js): filter chips with
  // counts, sort buttons in the headers (▲/▼), and stacked cards with a
  // «Sort by» menu when the table does not fit.
  const FILTERS = ['all', 'failures', 'unconfirmed', 'allog_connection', 'no_usage', 'low_usage', 'no_bookings', 'setup', 'unavailable', 'no_property'];
  function mount(container) {
    const section = container.querySelector('#opsHostsProperties');
    if (!section || section.dataset.bound) return;
    section.dataset.bound = 'true';
    const tbody = section.querySelector('tbody');
    const elements = [...tbody.querySelectorAll('[data-ops-row]')];
    const rows = elements.map(element => ({ ...JSON.parse(element.dataset.opsRow), element }));
    const search = section.querySelector('[data-ops-search]');
    const city = section.querySelector('[data-ops-city]');
    const sortSel = section.querySelector('[data-ops-sortsel]');
    const dirBtn = section.querySelector('[data-ops-dir]');
    const wrap = section.querySelector('[data-table-fit]');
    const empty = section.querySelector('[data-ops-empty]');
    const cities = [...new Set(rows.map(row => row.city || null))].sort((a, b) => text(a).localeCompare(text(b)));
    for (const value of cities) {
      const option = section.ownerDocument.createElement('option');
      option.value = JSON.stringify(value); option.textContent = value || '(No city)'; city.append(option);
    }
    if (![...city.options].some(option => option.value === state.city)) state.city = 'all';
    if (!FILTERS.includes(state.filter)) state.filter = 'all';
    search.value = state.search; city.value = state.city;
    // Counts on the chips: every row in that group, whatever the search (as «Utenti»).
    for (const chip of section.querySelectorAll('[data-ops-filter]')) {
      const n = selectRows(rows, { ...defaults(), filter: chip.dataset.opsFilter }).length;
      const count = chip.querySelector('[data-ops-filter-count]'); if (count) count.textContent = String(n);
      chip.hidden = n === 0 && chip.dataset.opsFilter !== 'all';
    }
    function apply() {
      const visible = selectRows(rows, state), selected = new Set(visible);
      rows.forEach(row => { row.element.hidden = !selected.has(row); });
      visible.forEach(row => tbody.append(row.element));
      tbody.append(empty); empty.hidden = visible.length > 0;
      empty.firstElementChild.textContent = rows.length ? 'No hosts or properties match these filters.' : 'No hosts or properties yet.';
      section.querySelector('[data-ops-count]').textContent = `${visible.length} of ${rows.length} rows`;
      for (const chip of section.querySelectorAll('[data-ops-filter]')) {
        const on = chip.dataset.opsFilter === state.filter;
        chip.setAttribute('aria-pressed', String(on));
        if (on) chip.hidden = false;
        chip.style.background = on ? 'var(--warm,#005BFF)' : 'var(--white)';
        chip.style.borderColor = on ? 'var(--warm,#005BFF)' : (chip.dataset.opsAlert ? '#F04438' : 'var(--border)');
        chip.style.color = on ? '#fff' : (chip.dataset.opsAlert ? '#B42318' : 'inherit');
      }
      for (const th of section.querySelectorAll('th')) {
        const active = [...th.querySelectorAll('[data-ops-sort]')].some(b => b.dataset.opsSort === state.sort);
        th.setAttribute('aria-sort', active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      }
      for (const button of section.querySelectorAll('[data-ops-sort]')) {
        const arrow = button.querySelector('[data-ops-arrow]');
        if (arrow) arrow.textContent = button.dataset.opsSort === state.sort ? (state.direction === 'asc' ? ' ▲' : ' ▼') : '';
      }
      if (sortSel) sortSel.value = state.sort;
      if (dirBtn) dirBtn.textContent = state.direction === 'asc' ? '▲' : '▼';
      if (wrap && root.AdminTableUI) root.AdminTableUI.fit(wrap);
    }
    const firstDir = key => (['property', 'host', 'city'].includes(key) ? 'asc' : 'desc');
    search.addEventListener('input', () => { state.search = search.value; apply(); });
    city.addEventListener('change', () => { state.city = city.value; apply(); });
    if (sortSel) sortSel.addEventListener('change', () => { if (columns.includes(sortSel.value)) { state.sort = sortSel.value; state.direction = firstDir(state.sort); apply(); } });
    section.addEventListener('click', event => {
      const button = event.target.closest('[data-ops-sort], [data-ops-reset], [data-ops-filter], [data-ops-dir]');
      if (!button || !section.contains(button)) return;
      if (button.hasAttribute('data-ops-reset')) {
        state = defaults(); search.value = ''; city.value = 'all';
      } else if (button.hasAttribute('data-ops-filter')) {
        state.filter = FILTERS.includes(button.dataset.opsFilter) ? button.dataset.opsFilter : 'all';
      } else if (button.hasAttribute('data-ops-dir')) {
        state.direction = state.direction === 'asc' ? 'desc' : 'asc';
      } else {
        const key = button.dataset.opsSort;
        if (!columns.includes(key)) return;
        state.direction = state.sort === key ? (state.direction === 'asc' ? 'desc' : 'asc') : firstDir(key);
        state.sort = key;
      }
      apply();
    });
    apply();
  }
  root.AdminOpsTable = { mount, selectRows, FILTERS };
})(globalThis);
