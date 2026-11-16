-- Round 75 Phase 2 — review of the 20 SECURITY DEFINER functions signed-in
-- users could execute (Supabase advisor lint 0029, 16 Nov 2026).
--
-- Revoked from PUBLIC/anon/authenticated (no page calls them; the server or
-- pg_cron, which runs as postgres, does), granted to service_role:
--   purge_old_data(boolean, text)   no caller check at all: any host could start
--                                   the platform-wide retention purge early.
--   purge_old_api_usage(boolean)    no caller check at all.
--   capture_chat_qa_pairs()         daily cron job; admin check inside.
--   purge_booking(uuid, text)       owner check inside; unused by any page.
--   get_entry_access_booking_state(uuid, text, boolean)  unused by any page.
--   get_reservation_keybox(uuid, text)  called by api/guest.js with the service key.
-- Kept for signed-in users (each checks the caller inside; code search 16 Nov):
--   accept_my_invite, create/delete_onboarding_test_booking (host JWT via
--   api/guest-token.js), entry_access_confirm_roster / _set_release (host
--   console), entry_access_host_state (host JWT via api/_entry-host-state.js),
--   host_access_state (console), host_can_write and is_admin (RLS policies),
--   list_hosts_for_admin, purge_old_data_admin, record/remove_qa_exclusion,
--   set_purge_live_after (admin page; is_admin() inside).
-- Re-runnable; missing functions are skipped.
-- Rollback: grant execute on function <f> to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.purge_old_data(boolean, text)', 'public.purge_old_api_usage(boolean)',
    'public.capture_chat_qa_pairs()', 'public.purge_booking(uuid, text)',
    'public.get_entry_access_booking_state(uuid, text, boolean)', 'public.get_reservation_keybox(uuid, text)']
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
