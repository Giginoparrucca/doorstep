-- Round 75 Phase 1 — pin search_path on the 7 functions the Supabase security
-- advisor flags as "role mutable search_path" (lint 0011). Their bodies use
-- only built-ins (now(), regexp_replace, extract, NEW/OLD records), so
-- `pg_catalog` is all they need; behaviour is unchanged. A pinned search_path
-- means a caller's own schemas can never shadow what they call.
-- Re-runnable (ALTER … SET is idempotent; missing functions are skipped).
-- Rollback: alter function <name>(<args>) reset search_path;
do $$
declare f text;
begin
  foreach f in array array[
    'public.anonymize_text(text)', 'public.compute_season(date)',
    'public._ota_reservations_touch_updated_at()', 'public._pilot_hosts_touch_updated_at()',
    'public._tax_rulesets_touch_updated_at()', 'public.tg_touch_updated_at()',
    'public.checkins_prevent_filed_edit()']
  loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = pg_catalog', f);
    end if;
  end loop;
end $$;
