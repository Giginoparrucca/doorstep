// 14 Nov 2026 — a check-in filed to Alloggiati cannot be deleted (TULPS
// art. 109). Real migration in PGlite (twice) next to the real filed-edit
// lock; every deletion route probed as the API roles. Console: «Elimina»
// hidden for filed guests, refusal explained. Fictional data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261114090000_filed_checkins_retained.sql';

let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  const lockSrc = read('migration_round49_autofile.sql');
  const at = lockSrc.indexOf('create or replace function public.checkins_prevent_filed_edit()');
  const lockFn = lockSrc.slice(at, lockSrc.indexOf('$$;', at) + 3);
  const owner = '00000000-0000-4000-8000-000000000001', P = '00000000-0000-4000-8000-0000000000aa';
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.properties(id uuid primary key, owner_id uuid);
    create table public.checkins(id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id) on delete cascade,
      booking_code text, is_test boolean default false, guest_type text, surname text, name text, sex text, date_of_birth date, place_of_birth text,
      birth_province text, birth_country text, citizenship text, document_type text, document_number text, doc_issue_place text,
      arrival_date date, departure_date date, nights int, alloggiati_status text default 'pending', filed_at timestamptz, deleted_at timestamptz,
      unlocked_at timestamptz, unlock_reason text);
    alter table public.checkins enable row level security;
    create policy owner_all on public.checkins for all to authenticated
      using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()))
      with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid()));
    grant all on public.checkins to authenticated, anon; grant select, delete on public.properties to authenticated;
    alter table public.properties enable row level security;
    create policy owner_props on public.properties for all to authenticated using (owner_id = auth.uid());
    grant all on public.checkins, public.properties to service_role;
    ${lockFn}
    create trigger checkins_filed_edit_guard before update on public.checkins for each row execute function public.checkins_prevent_filed_edit();
    -- shape of production purge_booking: SECURITY DEFINER, owner check, plain DELETE
    create function public.purge_booking(p uuid, code text) returns int language plpgsql security definer set search_path = public as $$
      declare n int; begin delete from public.checkins where property_id = p and booking_code = code; get diagnostics n = row_count; return n; end $$;
    grant execute on function public.purge_booking(uuid, text) to authenticated;`);
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  await db.query('insert into public.properties values ($1,$2)', [P, owner]);
  const add = code => db.query(`insert into public.checkins(property_id,booking_code,guest_type,surname,arrival_date) values ($1,$2,'head','FICTIONAL','2026-11-01') returning id`, [P, code]).then(r => r.rows[0].id);
  const filed = await add('FILED'); await db.query(`update public.checkins set alloggiati_status = 'filed', filed_at = now() where id = $1`, [filed]);
  const filedAtOnly = await add('FILEDAT'); await db.query(`update public.checkins set filed_at = now(), alloggiati_status = 'pending' where id = $1`, [filedAtOnly]);
  const unfiled = await add('OPEN'), testFiled = await add('TEST');
  await db.query(`update public.checkins set is_test = true, alloggiati_status = 'filed', filed_at = now() where id = $1`, [testFiled]);
  // API requests always carry claims (PostgREST sets request.jwt.claims).
  const as = (role, fn) => db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ role, sub: owner }), role === 'authenticated' ? owner : '']);
    return fn(tx);
  });
  const blocked = /checkin_filed_retained/;
  for (const role of ['authenticated', 'service_role']) {
    for (const id of [filed, filedAtOnly]) {
      await assert.rejects(as(role, tx => tx.query('delete from public.checkins where id = $1', [id])), blocked, `${role}: no delete`);
      await assert.rejects(as(role, tx => tx.query('update public.checkins set deleted_at = now() where id = $1', [id])), blocked, `${role}: no trash`);
      await assert.rejects(as(role, tx => tx.query('update public.checkins set filed_at = null where id = $1', [id])), blocked, `${role}: filed_at kept`);
      await assert.rejects(as(role, tx => tx.query('update public.checkins set is_test = true where id = $1', [id])), blocked, `${role}: not turned into a test row`);
    }
  }
  await assert.rejects(as('authenticated', tx => tx.query(`select public.purge_booking($1, 'FILED')`, [P])), blocked, 'SECURITY DEFINER purge refused too');
  await assert.rejects(as('authenticated', tx => tx.query('delete from public.checkins where property_id = $1', [P])), blocked, 'bulk delete refused as a whole');
  await assert.rejects(as('service_role', tx => tx.query('delete from public.properties where id = $1', [P])), blocked, 'property cascade refused');
  await assert.rejects(as('authenticated', tx => tx.query('truncate public.checkins')), /permission denied/, 'TRUNCATE revoked');
  // Still allowed: correction unlock and re-file, other columns, unfiled and test rows.
  await as('authenticated', tx => tx.query(`update public.checkins set alloggiati_status = 'correction', unlocked_at = now(), unlock_reason = 'typo' where id = $1`, [filed]));
  await as('authenticated', tx => tx.query(`update public.checkins set surname = 'FICTIONAL-FIX' where id = $1`, [filed]));
  await as('authenticated', tx => tx.query(`update public.checkins set alloggiati_status = 'filed', filed_at = now() where id = $1`, [filed]));
  await assert.rejects(as('authenticated', tx => tx.query('delete from public.checkins where id = $1', [filed])), blocked, 'still kept after a correction');
  assert.equal((await as('authenticated', tx => tx.query('update public.checkins set deleted_at = now() where id = $1 returning id', [unfiled]))).rows.length, 1, 'unfiled row can be trashed');
  assert.equal((await as('authenticated', tx => tx.query('delete from public.checkins where id = $1 returning id', [unfiled]))).rows.length, 1, 'unfiled row can be deleted');
  assert.equal((await as('authenticated', tx => tx.query('delete from public.checkins where id = $1 returning id', [testFiled]))).rows.length, 1, 'test rows can be deleted');
  // Maintenance session (SQL editor / pg_cron: no API claims) can still act deliberately.
  assert.equal((await db.query('delete from public.checkins where id = $1 returning id', [filedAtOnly])).rows.length, 1, 'maintenance bypass');
  assert.equal((await db.query('select count(*)::int n from public.checkins where id = $1', [filed])).rows[0].n, 1);
}

// Console: «Elimina» hidden for filed guests; refusal explained in IT/EN.
const html = read('host-console.html');
const i = html.indexOf('function _isFiledRetained('); assert.ok(i >= 0);
const ctx = vm.createContext({}); vm.runInContext(html.slice(i, html.indexOf('\n}\n', i) + 2), ctx);
assert.equal(ctx._isFiledRetained({ alloggiati_status: 'filed', filed_at: '2026-11-01T10:00:00Z', is_test: false }), true);
assert.equal(ctx._isFiledRetained({ alloggiati_status: 'correction', filed_at: '2026-11-01T10:00:00Z', is_test: false }), true, 'in correction: still kept');
assert.equal(ctx._isFiledRetained({ alloggiati_status: 'pending', filed_at: null, is_test: false }), false);
assert.equal(ctx._isFiledRetained({ alloggiati_status: 'filed', filed_at: '2026-11-01T10:00:00Z', is_test: true }), false, 'test rows');
assert.match(html, /\$\{_isFiledRetained\(c\) \? '' : `<button type="button" onclick="event\.stopPropagation\(\);_closeRowMenus\(\);deleteCheckin\(/);
assert.match(html, /if \(_isFiledRetained\(allCheckins\.find\(c => c\.id === id\)\)\) \{ toast\(h\('delete_filed_blocked'\)\); return; \}/);
assert.match(html, /toast\(\/checkin_filed_retained\/\.test\(error\.message \|\| ''\) \? h\('delete_filed_blocked'\)/);
assert.match(html, /delete_filed_blocked: 'Questo ospite è già stato inviato ad Alloggiati: il record va conservato \(art\. 109 TULPS\)/);
assert.match(html, /delete_filed_blocked: 'This guest was filed to Alloggiati/);
console.log('PASS filed check-ins retained: for filed rows (status filed or filed_at set), host and service_role cannot delete, trash, clear filed_at or turn into test rows; SECURITY DEFINER purge, bulk delete and property cascade refused; TRUNCATE revoked; correction unlock/edit/re-file still works and the row stays; unfiled and test rows deletable; maintenance session bypass; migration re-runnable (PGlite); console hides «Elimina» on filed guests and explains a refusal in IT/EN');
