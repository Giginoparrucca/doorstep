-- Ops: keep pg_cron's run history to 7 days.
-- cron.job_run_details gains a row (plus status updates) for every run of
-- every job and is never cleaned; the 10-minute Alloggiati tick alone adds
-- about 144 rows a day. Deleting old rows daily keeps the table small and
-- avoids needless disk IO (see CHANGELOG "Ops — Production database outage").
-- Separate job so the guest-data purge (welcomebnb_daily_purge) is unchanged.
-- Re-runnable: cron.schedule with an existing name updates that job.
-- Rollback: select cron.unschedule('welcomebnb_cron_history_purge');
select cron.schedule(
  'welcomebnb_cron_history_purge',
  '20 2 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$
);
