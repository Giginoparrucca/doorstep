-- migration_round48b_apiusage_check.sql
--
-- Round 48 Phase 2 — widen api_usage.endpoint CHECK to cover the new
-- gateway actions `checkin_lookup` and `checkin_write`.
--
-- Round 34.1 captured the gotcha this guards against: a narrowed CHECK
-- silently disables the rate limit. The gateway's recordUsage() path
-- wraps the INSERT in try/catch; a CHECK violation gets caught and
-- logged, the row never lands, and `select count(*)` returns 0 forever.
--
-- Supabase assigned the original constraint the auto-generated name
-- `api_usage_endpoint_chk`; the replacement is explicitly named
-- `api_usage_endpoint_check` so future rounds can find it with a
-- predictable name.

alter table public.api_usage drop constraint if exists api_usage_endpoint_chk;
alter table public.api_usage drop constraint if exists api_usage_endpoint_check;
alter table public.api_usage add constraint api_usage_endpoint_check
  check (endpoint = any (array[
    'chat'::text, 'scan'::text, 'chat_write'::text, 'token_mint'::text,
    'tax_parse'::text, 'checkin_lookup'::text, 'checkin_write'::text
  ]));
