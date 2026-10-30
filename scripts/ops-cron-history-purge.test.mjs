// Ops — pg_cron run history is purged daily and only older than 7 days.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20261030130000_ops_cron_history_purge.sql', import.meta.url), 'utf8');
const code = sql.replace(/--.*$/gm, '');

const m = code.match(/cron\.schedule\(\s*'([^']+)',\s*'([^']+)',\s*\$\$([\s\S]*?)\$\$\s*\)/);
assert.ok(m, 'schedules exactly one named job');
const [, name, schedule, command] = m;
assert.equal(name, 'welcomebnb_cron_history_purge', 'named job (re-running the migration updates it)');
assert.match(schedule, /^\d{1,2} \d{1,2} \* \* \*$/, 'runs once a day');
assert.match(command, /^\s*delete from cron\.job_run_details where end_time < now\(\) - interval '7 days'\s*$/i,
  'deletes only cron run history older than 7 days');
assert.ok(!/purge_old_data|public\./.test(code), 'does not touch the guest-data purge or app tables');

console.log('PASS ops-cron-history-purge: daily named job deletes only cron.job_run_details rows older than 7 days');
