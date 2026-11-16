// Round 75 Phase 1 — search_path pinned on the 7 advisor-flagged functions,
// behaviour unchanged. Migration run twice in PGlite on stand-ins with the
// production signatures and bodies' essentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create function public.anonymize_text(p_text text) returns text language plpgsql immutable as $$ begin return regexp_replace(p_text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}', '[EMAIL]', 'g'); end $$;
  create function public.compute_season(p_date date) returns text language plpgsql immutable as $$ begin if extract(month from p_date) between 6 and 8 then return 'high'; end if; return 'low'; end $$;
  create table public.t(id int primary key, updated_at timestamptz);
  create function public.tg_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create function public._ota_reservations_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create function public._pilot_hosts_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create function public._tax_rulesets_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
  create function public.checkins_prevent_filed_edit() returns trigger language plpgsql as $$ begin if old.updated_at is not null and new.id <> old.id then raise exception 'checkin_locked_filed'; end if; return new; end $$;
  create trigger touch before update on public.t for each row execute function public.tg_touch_updated_at();
  create trigger lock before update on public.t for each row execute function public.checkins_prevent_filed_edit();
  insert into public.t values (1, null);`);
const sql = fs.readFileSync(new URL('../supabase/migrations/20261116140000_round75_function_search_path.sql', import.meta.url), 'utf8');
await db.exec(sql); await db.exec(sql);
const cfg = (await db.query(`select proname, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by proname`)).rows;
assert.equal(cfg.length, 7);
for (const r of cfg) assert.deepEqual(r.proconfig, ['search_path=pg_catalog'], r.proname);
assert.equal((await db.query(`select public.anonymize_text('mail a@b.it now') v`)).rows[0].v, 'mail [EMAIL] now');
assert.equal((await db.query(`select public.compute_season('2026-07-10') v`)).rows[0].v, 'high');
await db.exec('update public.t set id = 1 where id = 1');
assert.ok((await db.query('select updated_at from public.t')).rows[0].updated_at, 'touch trigger still stamps');
await assert.rejects(db.exec('update public.t set id = 2'), /checkin_locked_filed/, 'guard trigger still guards');
// The migration never fails when a function is absent (re-runnable everywhere).
const empty = new PGlite(); await empty.exec(sql);
console.log('PASS round75 search_path: 7 functions pinned to pg_catalog (re-run safe, absent functions skipped); anonymisation, season, touch and filed-edit triggers behave as before');
