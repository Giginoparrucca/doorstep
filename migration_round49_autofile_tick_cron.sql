-- migration_round49_autofile_tick_cron.sql
--
-- Round 49 Phase 3 — Supabase pg_cron + pg_net schedule for the
-- `autofile_tick` endpoint. NOT applied automatically.
--
-- Why not auto-applied: this migration touches a Vault secret.
-- Running it from a session that has credentials would leak the
-- secret into tooling logs. Daniele applies it by hand in the
-- Supabase SQL editor AFTER setting the matching Vercel env var:
--
--   1. In Vercel → Project → Settings → Environment Variables, add
--      AUTOFILE_CRON_SECRET to Production (and Preview, if you want
--      the preview deploys to accept ticks). Value: a 48+ char
--      random string. Redeploy production.
--
--   2. In the Supabase SQL editor, run the vault.create_secret call
--      below with the SAME value, then uncomment the cron.schedule
--      call. The scheduler fires every 10 minutes starting at the
--      next :00/:10/:20/:30/:40/:50 after the schedule lands.
--
--   3. Verify the schedule is live:
--        select jobid, jobname, schedule, active
--          from cron.job
--          where jobname = 'alloggiati-autofile-tick';
--      And watch for successful fires:
--        select runid, status, start_time, end_time, return_message
--          from cron.job_run_details
--          where jobid = (select jobid from cron.job
--                         where jobname='alloggiati-autofile-tick')
--          order by runid desc limit 5;
--
-- The `autofile_tick` endpoint is server-to-server: it has no
-- Origin and no JWT. It authenticates by constant-time comparing
-- the `x-cron-secret` header against the Vercel env var. The CORS
-- gate is bypassed for this one action.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- --- STEP A (by hand, with the real secret) ---
-- select vault.create_secret('<48+ random chars>', 'autofile_cron_secret');
-- (If a secret already exists under that name:
--    update vault.secrets set secret='<new>' where name='autofile_cron_secret';)

-- --- STEP B (by hand, after Vercel env is set + redeployed) ---
-- select cron.schedule('alloggiati-autofile-tick', '*/10 * * * *', $$
--   select net.http_post(
--     url     := 'https://app.welcomebnb.it/api/alloggiati?action=autofile_tick',
--     headers := jsonb_build_object(
--                  'Content-Type', 'application/json',
--                  'x-cron-secret',
--                  (select decrypted_secret
--                     from vault.decrypted_secrets
--                     where name='autofile_cron_secret')),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 55000);
-- $$);

-- --- Unschedule (if you need to disable the tick without redeploying) ---
-- select cron.unschedule('alloggiati-autofile-tick');
