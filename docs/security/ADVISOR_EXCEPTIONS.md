# Supabase security advisor — accepted findings

Re-run 16 Nov 2026 after Round 75 (`get_advisors security`). Each remaining finding is deliberate; re-check this list whenever the advisor output changes.

| Advisor finding | Count | Why it stays |
|---|---|---|
| `extension_in_public` — `pg_net` | 1 | `pg_net` is not relocatable (`extrelocatable = false`); moving it means DROP + CREATE EXTENSION, which drops the `net` request queue and breaks 1 cron job and 6 functions until recreated. All 28 of its objects already live in schema `net`, none in `public` (checked 16 Nov) — the finding is only the extension's registered namespace. Revisit if Supabase offers an in-place move. |
| `authenticated_security_definer_function_executable` | 14 | Each is called by a signed-in page or by RLS and checks the caller itself: `accept_my_invite` (own email), `create_onboarding_test_booking` / `delete_onboarding_test_booking` (property owner), `entry_access_confirm_roster`, `entry_access_set_release`, `entry_access_host_state` (property owner), `host_access_state` (own user unless admin/service), `host_can_write` and `is_admin` (used inside RLS policies), `list_hosts_for_admin`, `purge_old_data_admin`, `record_qa_exclusion`, `remove_qa_exclusion`, `set_purge_live_after` (`is_admin()` inside). The six without a page caller were made server-only in Round 75 Phase 2. |
| `rls_enabled_no_policy` (INFO) | 14 | Deny-by-default tables reached only by the service role or definer functions: `entry_access.*` (5), `ireservation_private.*` (5), `public.host_terms_codes`, `public.rate_counters`, `public.storage_purge_queue`, `public.telegram_link_tokens`. No policy = no client access, which is intended. |

Resolved: `function_search_path_mutable` (7 functions, Round 75 Phase 1); leaked-password protection (enabled by Daniele 16 Nov).
