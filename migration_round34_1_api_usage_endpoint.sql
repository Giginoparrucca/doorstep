-- Round 34.1 (numbered 34.2 in commits/CHANGELOG — see CHANGELOG entry
-- for the collision with the earlier Round 34.1 escalation hotfix).
--
-- Widens api_usage.endpoint CHECK constraint to include 'token_mint',
-- which the new rate-limit on POST /api/guest-token records once per
-- successful mint. Must be applied BEFORE deploying that code, or
-- INSERT into api_usage fails against the old constraint and the
-- mint rate limit silently degrades to no-limit (recordUsage swallows
-- failures with console.warn).
--
-- Safe to re-run.

BEGIN;
ALTER TABLE public.api_usage DROP CONSTRAINT IF EXISTS api_usage_endpoint_chk;
ALTER TABLE public.api_usage ADD CONSTRAINT api_usage_endpoint_chk
  CHECK (endpoint IN ('chat', 'scan', 'chat_write', 'token_mint'));
COMMIT;
