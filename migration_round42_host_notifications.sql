-- Round 42 · Host notifications — Web Push + Telegram + Email
--
-- Four new tables + policies + explicit grants. Every guest-side write to
-- chat_messages goes through api/guest-chat.js (Round 34); on insert, the
-- new shared notifier api/_notify-host.js reads settings from these
-- tables and alerts the host over the enabled channels.
--
-- Rule (Round 20.2 lesson): tables created via SQL don't inherit default
-- grants. RLS policies are not enough. Every table below carries explicit
-- GRANTs for `authenticated` AND `service_role`, plus REVOKE ALL FROM anon.
-- The symptom when a grant is missing is a 0-row write with error:null.
--
-- Alert content is fixed and contains no guest data — see the notifier
-- for the payload. Do not add guest text / names / booking codes to any
-- outbound channel.

BEGIN;

-- ── 1. host_notification_settings ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.host_notification_settings (
  host_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_scope       text NOT NULL DEFAULT 'escalated' CHECK (notify_scope IN ('escalated','all')),
  push_enabled       boolean NOT NULL DEFAULT true,
  telegram_chat_id   bigint,
  telegram_enabled   boolean NOT NULL DEFAULT false,
  email_mode         text NOT NULL DEFAULT 'fallback' CHECK (email_mode IN ('off','fallback','always')),
  notify_email       text,
  throttle_minutes   int NOT NULL DEFAULT 10 CHECK (throttle_minutes BETWEEN 1 AND 120),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.host_notification_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_notification_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_notification_settings TO service_role;

ALTER TABLE public.host_notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hns_self_select ON public.host_notification_settings;
CREATE POLICY hns_self_select ON public.host_notification_settings
  FOR SELECT TO authenticated USING (host_id = auth.uid());

DROP POLICY IF EXISTS hns_self_insert ON public.host_notification_settings;
CREATE POLICY hns_self_insert ON public.host_notification_settings
  FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());

DROP POLICY IF EXISTS hns_self_update ON public.host_notification_settings;
CREATE POLICY hns_self_update ON public.host_notification_settings
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

DROP POLICY IF EXISTS hns_self_delete ON public.host_notification_settings;
CREATE POLICY hns_self_delete ON public.host_notification_settings
  FOR DELETE TO authenticated USING (host_id = auth.uid());


-- ── 2. push_subscriptions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  device_label     text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz,
  failure_count    int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_subscriptions_host_id_idx
  ON public.push_subscriptions (host_id);

REVOKE ALL ON public.push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ps_self_select ON public.push_subscriptions;
CREATE POLICY ps_self_select ON public.push_subscriptions
  FOR SELECT TO authenticated USING (host_id = auth.uid());

DROP POLICY IF EXISTS ps_self_insert ON public.push_subscriptions;
CREATE POLICY ps_self_insert ON public.push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());

DROP POLICY IF EXISTS ps_self_update ON public.push_subscriptions;
CREATE POLICY ps_self_update ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid());

DROP POLICY IF EXISTS ps_self_delete ON public.push_subscriptions;
CREATE POLICY ps_self_delete ON public.push_subscriptions
  FOR DELETE TO authenticated USING (host_id = auth.uid());


-- ── 3. notification_log ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id                bigserial PRIMARY KEY,
  host_id           uuid,
  property_id       uuid,
  conversation_key  text,
  trigger           text CHECK (trigger IN ('escalation','guest_message','test')),
  channel           text CHECK (channel IN ('push','telegram','email','none')),
  status            text CHECK (status IN ('sent','failed','skipped')),
  detail            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_log_conv_idx
  ON public.notification_log (property_id, conversation_key, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_log_host_trigger_idx
  ON public.notification_log (host_id, trigger, created_at DESC);

REVOKE ALL ON public.notification_log FROM anon;
GRANT SELECT ON public.notification_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_log TO service_role;
GRANT USAGE ON SEQUENCE public.notification_log_id_seq TO service_role;

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nl_self_select ON public.notification_log;
CREATE POLICY nl_self_select ON public.notification_log
  FOR SELECT TO authenticated USING (host_id = auth.uid());


-- ── 4. telegram_link_tokens ────────────────────────────────────────────
-- Short-lived (15 min) tokens the host click-links to Telegram with.
-- Only service_role reads/writes these — the webhook validates, the
-- host console never inspects the token payload after the click.
CREATE TABLE IF NOT EXISTS public.telegram_link_tokens (
  token       text PRIMARY KEY,
  host_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.telegram_link_tokens FROM anon;
REVOKE ALL ON public.telegram_link_tokens FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_link_tokens TO service_role;

ALTER TABLE public.telegram_link_tokens ENABLE ROW LEVEL SECURITY;
-- No policies. Service role bypasses RLS; nobody else has any grant.


COMMIT;

-- ROLLBACK BLOCK ─────────────────────────────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS public.telegram_link_tokens;
-- DROP TABLE IF EXISTS public.notification_log;
-- DROP TABLE IF EXISTS public.push_subscriptions;
-- DROP TABLE IF EXISTS public.host_notification_settings;
-- COMMIT;

-- VERIFICATION QUERY (run after apply):
-- SELECT tablename,
--        COALESCE((SELECT bool_or(true) FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename), false) AS has_policies,
--        (SELECT string_agg(policyname||' ['||cmd||']', ', ' ORDER BY policyname)
--         FROM pg_policies WHERE schemaname='public' AND tablename=t.tablename) AS policies,
--        (SELECT string_agg(grantee||':'||privilege_type, ', ' ORDER BY grantee, privilege_type)
--         FROM information_schema.role_table_grants
--         WHERE table_schema='public' AND table_name=t.tablename AND grantee IN ('anon','authenticated','service_role')) AS grants
-- FROM (VALUES ('host_notification_settings'), ('push_subscriptions'), ('notification_log'), ('telegram_link_tokens')) t(tablename);
