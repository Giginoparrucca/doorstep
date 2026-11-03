// Admin console reads every analytics event of the period, not just the first
// 1000 rows PostgREST returns per request (reco clicks and host attribution
// disappeared from the Recommendations registry), and attributes hosts from
// the admin-gated host list. Fictional rows only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('admin.html');
const fn = name => { const i = html.indexOf('async function ' + name + '('); assert.ok(i > 0, name); return html.slice(i, html.indexOf('\n}\n', i) + 3); };

// Static: the period load and the ZIP export page through analytics_events.
const load = fn('loadData');
assert.ok(/readAllRows\(\(\) => applyHiddenFilter\(sb\.from\('analytics_events'\)/.test(load), 'period events are paged');
assert.ok(!/from\('analytics_events'\)[^\n]*\.limit\(/.test(html), 'no single capped read of analytics_events');
assert.ok(/readAllRows\(\(\) => sb\.from\('analytics_events'\)\.select\('\*'\)\)/.test(html), 'export pages too');
assert.ok(/sb\.rpc\('list_hosts_for_admin'\)/.test(load) && /hostEmailById\[h\.user_id\] = h\.email/.test(load), 'host emails from the admin host list');
assert.equal((html.match(/const userIdToEmail = \{ \.\.\.hostEmailById \};/g) || []).length, 3, 'every owner→email map starts from the host list');
assert.equal((html.match(/const userIdToEmail = \{\};/g) || []).length, 0);

// Functional: a PostgREST-like server that never returns more than 1000 rows.
const ctx = vm.createContext({});
vm.runInContext(read('admin-ops-metrics.js'), ctx);
vm.runInContext(fn('readAllRows'), ctx);
const rows = Array.from({ length: 2600 }, (_, i) => ({ id: String(i).padStart(6, '0'), event_type: i === 2500 ? 'guest_reco_clicked' : 'guest_page_view' }));
let requests = 0;
const makeQuery = () => {
  let from = 0, to = 0;
  const q = { order(col, opts) { assert.equal(col, 'id'); assert.equal(opts.ascending, true); return q; },
    range(a, b) { from = a; to = b; return q; },
    then(res, rej) { requests++; return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }).then(res, rej); } };
  return q;
};
const out = await vm.runInContext('readAllRows', ctx)(makeQuery);
assert.equal(out.error, null);
assert.equal(out.data.length, 2600, 'every row, past the 1000-row cap');
assert.ok(out.data.some(e => e.event_type === 'guest_reco_clicked'), 'old clicks are kept');
assert.ok(requests >= 3);
const failed = await vm.runInContext('readAllRows', ctx)(() => ({ order() { return this; }, range() { return Promise.resolve({ error: new Error('denied') }); } }));
assert.equal(failed.data, null); assert.match(String(failed.error.message), /denied/);

console.log('PASS admin events paging: period load and ZIP export read every analytics event past the 1000-row cap (2600 rows, old reco click kept), errors keep the {data,error} shape; host emails come from list_hosts_for_admin for all three owner maps');
