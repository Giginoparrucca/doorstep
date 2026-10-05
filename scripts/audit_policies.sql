-- scripts/audit_policies.sql
--
-- Round 48 — read-only audit queries. Run after every migration that
-- touches RLS or grants. Three outputs:
--   1) Any policy whose USING or WITH CHECK is `true` (wide open).
--   2) Table grants held by `anon`.
--   3) Every policy on `storage.objects`.
--
-- Acceptable "wide open" survivors after Round 48:
--   - service_role policies on any table (expected; the role bypasses RLS).
--   - `recommendations.Guests read recos` and `rules.Guests read rules`
--     (anon SELECT; these tables are deliberately public-read for the
--     guest app's recos + rules screens).
--   - `analytics_events.Anyone insert analytics` and
--     `analytics_events.Auth insert analytics` (anon/auth INSERT; event
--     capture needs them).
--   - [Phase 2/3 only] `checkins.anon_select_checkins`,
--     `checkins.anon_insert_checkins`,
--     `properties.Guests read any property by ID`,
--     `marketing_consents.marketing_consents_anon_withdraw` — these
--     stay until Phase 2 ships the gateway and Phase 3 revokes anon.
-- Anything else fails the review.

-- 1 — wide-open policies
select schemaname, tablename, policyname, cmd, roles::text, qual, with_check
from pg_policies
where (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
order by 1,2,3;

-- 2 — table grants to anon
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by 1,2;

-- 3 — storage policies
select policyname, cmd, roles::text, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
