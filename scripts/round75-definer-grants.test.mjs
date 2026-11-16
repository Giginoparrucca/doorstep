// Round 75 Phase 2 — SECURITY DEFINER review: the 6 functions no page needs
// are no longer executable by anon/authenticated (service_role and the cron
// owner keep them); the 14 kept ones are the ones pages call. Migration twice
// in PGlite on stand-ins with the production signatures; code search proves
// no page or browser code calls a revoked function.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { PGlite } = await import('@electric-sql/pglite');
const REVOKED = ['purge_old_data(boolean, text)', 'purge_old_api_usage(boolean)', 'capture_chat_qa_pairs()', 'purge_booking(uuid, text)',
  'get_entry_access_booking_state(uuid, text, boolean)', 'get_reservation_keybox(uuid, text)'];
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;`);
for (const sig of REVOKED) {
  const args = sig.slice(sig.indexOf('(') + 1, -1).split(',').map(a => a.trim()).filter(Boolean).map((t, i) => `p${i} ${t}`).join(', ');
  await db.exec(`create function public.${sig.slice(0, sig.indexOf('('))}(${args}) returns int language sql security definer as $$ select 1 $$;
    grant execute on function public.${sig} to public, anon, authenticated;`);
}
const sql = read('supabase/migrations/20261116150000_round75_definer_grants.sql');
await db.exec(sql); await db.exec(sql);
for (const sig of REVOKED) {
  for (const role of ['anon', 'authenticated']) assert.equal((await db.query(`select has_function_privilege('${role}', 'public.${sig}', 'EXECUTE') a`)).rows[0].a, false, `${role} ${sig}`);
  assert.equal((await db.query(`select has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') a`)).rows[0].a, true, `service_role ${sig}`);
}
await new PGlite().exec(sql); // absent functions are skipped
// No browser page calls a revoked function; the server calls keybox with the service key.
const pages = ['index.html', 'host-console.html', 'admin.html', 'demo-launch.html'].map(read).join('\n')
  .split('\n').filter(l => !/^\s*(\/\/|\*|<!--)/.test(l)).join('\n'); // code, not comments
for (const sig of REVOKED) assert.ok(!new RegExp('\\b' + sig.slice(0, sig.indexOf('(')) + '\\b(?!_)').test(pages), 'no page calls ' + sig);
const guest = read('api/guest.js'); const i = guest.indexOf('rpc/get_reservation_keybox');
assert.ok(i > 0 && /supabaseAuthHeaders\(SERVICE_KEY\)/.test(guest.slice(i, i + 300)), 'keybox read with the service key');
// The kept functions are the ones pages/server call with a user JWT.
for (const f of ['accept_my_invite', 'entry_access_confirm_roster', 'entry_access_set_release', 'host_access_state']) assert.ok(read('host-console.html').includes(f), f);
for (const f of ['list_hosts_for_admin', 'purge_old_data_admin', 'record_qa_exclusion', 'remove_qa_exclusion', 'set_purge_live_after']) assert.ok(read('admin.html').includes(f), f);
console.log('PASS round75 definer grants: purge_old_data, purge_old_api_usage, capture_chat_qa_pairs, purge_booking, get_entry_access_booking_state, get_reservation_keybox no longer executable by anon/authenticated (service_role keeps them; re-run safe; absent skipped); no page calls them; keybox read with the service key; kept functions are the ones the host console and admin page call');
