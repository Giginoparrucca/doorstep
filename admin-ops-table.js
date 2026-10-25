// Round 64 Phase 2: local table interaction only; never requests or changes data.
(function (root) {
  'use strict';
  const defaults = () => ({ search: '', city: 'all', filter: 'all', sort: 'lastActive', direction: 'desc' });
  let state = defaults();
  const text = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
  const columns = ['property', 'host', 'city', 'guests', 'completed', 'sent', 'failed', 'usage', 'setup', 'activity', 'lastActive'];
  function selectRows(rows, options) {
    const query = text(options.search).trim();
    const words = query.split(/\s+/).filter(Boolean);
    const filtered = rows.filter(row => {
      if (!words.every(word => text(row.search).includes(word))) return false;
      if (options.city !== 'all' && JSON.stringify(row.city || null) !== options.city) return false;
      switch (options.filter) {
        case 'failures': return row.failed != null && row.failed > 0;
        case 'no_usage': return row.usage === 0;
        case 'low_usage': return row.usage != null && row.usage < 0.5;
        case 'no_bookings': return row.hasBookings === false;
        case 'setup': return row.setup != null && row.setup < 80;
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
  function mount(container) {
    const section = container.querySelector('#opsHostsProperties');
    if (!section || section.dataset.bound) return;
    section.dataset.bound = 'true';
    const tbody = section.querySelector('tbody');
    const elements = [...tbody.querySelectorAll('[data-ops-row]')];
    const rows = elements.map(element => ({ ...JSON.parse(element.dataset.opsRow), element }));
    const search = section.querySelector('[data-ops-search]');
    const city = section.querySelector('[data-ops-city]');
    const filter = section.querySelector('[data-ops-filter]');
    const empty = section.querySelector('[data-ops-empty]');
    const cities = [...new Set(rows.map(row => row.city || null))].sort((a, b) => text(a).localeCompare(text(b)));
    for (const value of cities) {
      const option = section.ownerDocument.createElement('option');
      option.value = JSON.stringify(value); option.textContent = value || '(No city)'; city.append(option);
    }
    if (![...city.options].some(option => option.value === state.city)) state.city = 'all';
    search.value = state.search; city.value = state.city; filter.value = state.filter;
    function apply() {
      const visible = selectRows(rows, state), selected = new Set(visible);
      rows.forEach(row => { row.element.hidden = !selected.has(row); });
      visible.forEach(row => tbody.append(row.element));
      tbody.append(empty); empty.hidden = visible.length > 0;
      empty.firstElementChild.textContent = rows.length ? 'No hosts or properties match these filters.' : 'No hosts or properties yet.';
      section.querySelector('[data-ops-count]').textContent = `${visible.length} of ${rows.length} rows`;
      for (const button of section.querySelectorAll('[data-ops-sort]')) {
        const active = button.dataset.opsSort === state.sort;
        button.closest('th').setAttribute('aria-sort', active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
        button.querySelector('[data-ops-arrow]').textContent = active ? (state.direction === 'asc' ? ' ↑' : ' ↓') : ' ↕';
      }
    }
    search.addEventListener('input', () => { state.search = search.value; apply(); });
    city.addEventListener('change', () => { state.city = city.value; apply(); });
    filter.addEventListener('change', () => { state.filter = filter.value; apply(); });
    section.addEventListener('click', event => {
      const button = event.target.closest('[data-ops-sort], [data-ops-reset]');
      if (!button || !section.contains(button)) return;
      if (button.hasAttribute('data-ops-reset')) {
        state = defaults(); search.value = ''; city.value = 'all'; filter.value = 'all';
      } else {
        const key = button.dataset.opsSort;
        if (!columns.includes(key)) return;
        state.direction = state.sort === key ? (state.direction === 'asc' ? 'desc' : 'asc') : (['property', 'host', 'city'].includes(key) ? 'asc' : 'desc');
        state.sort = key;
      }
      apply();
    });
    apply();
  }
  root.AdminOpsTable = { mount, selectRows };
})(globalThis);
