-- Round 35: manual "who's paying" ledger for the pilot.
--
-- No billing system yet — that's a Round 36+ decision. In the meantime
-- the admin console needs a place to record which of the pilot hosts
-- is a prospect, on trial, actually paid, or churned, plus the amount
-- they paid, when their trial started, and a free-text notes field for
-- the operator. The Pilot tab reads this to compute "paying hosts" and
-- "AI cost / revenue" without inventing figures.

CREATE TABLE IF NOT EXISTS public.pilot_hosts (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  host_email         text        UNIQUE NOT NULL,
  status             text        NOT NULL DEFAULT 'prospect',
  amount_paid        numeric     NOT NULL DEFAULT 0,
  pilot_started_at   date,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pilot_hosts_status_chk
    CHECK (status IN ('prospect', 'pilot', 'paid', 'churned'))
);

CREATE INDEX IF NOT EXISTS pilot_hosts_status_idx
  ON public.pilot_hosts (status);

-- updated_at trigger — same pattern as ota_reservations (Round 26).
CREATE OR REPLACE FUNCTION public._pilot_hosts_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pilot_hosts_touch_updated_at ON public.pilot_hosts;
CREATE TRIGGER pilot_hosts_touch_updated_at
  BEFORE UPDATE ON public.pilot_hosts
  FOR EACH ROW EXECUTE FUNCTION public._pilot_hosts_touch_updated_at();

-- RLS: admin-only for reads and writes, via the existing is_admin() helper.
-- No anon policy, no general authenticated policy — a non-admin host
-- MUST NOT be able to see who's paying and who isn't.
ALTER TABLE public.pilot_hosts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_hosts_admin_all ON public.pilot_hosts;
CREATE POLICY pilot_hosts_admin_all
  ON public.pilot_hosts FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS pilot_hosts_service_all ON public.pilot_hosts;
CREATE POLICY pilot_hosts_service_all
  ON public.pilot_hosts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Explicit grants — Round 28 lesson: tables created via the SQL editor
-- do not inherit default privileges here. Without these lines the admin
-- console's UPDATE returns { data: [], error: null } and the row never
-- moves.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_hosts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pilot_hosts TO service_role;
