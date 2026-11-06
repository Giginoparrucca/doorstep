// Arrival/filing reminders at the host's chosen local hour (6 Nov 2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { reminderDue, REMINDER_CATCH_UP_HOURS } = await import('../api/send-arrival-reminders.js');
const { deploymentConfig } = await import('../lib/deployment-config.mjs');
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const romeHour = iso => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(new Date(iso))) % 24;

// Due at the chosen hour and for the catch-up hours after, never before.
assert.equal(REMINDER_CATCH_UP_HOURS, 3);
for (const [h, choice, want] of [[7, 7, true], [6, 7, false], [10, 7, true], [11, 7, false], [9, 9, true], [8, 9, false], [21, 21, true], [23, 21, true], [7, null, true], [6, undefined, false], [7, 3, true], [7, 30, true]])
  assert.equal(reminderDue(h, choice), want, `local ${h} choice ${choice}`);

// The complaint: the old daily job ran at 05:00 UTC = 06:00 in Rome in winter.
// Now the hourly job (minute 5) sends at the chosen local hour in both seasons.
assert.equal(romeHour('2026-11-06T05:05:00Z'), 6); assert.equal(reminderDue(romeHour('2026-11-06T05:05:00Z'), 7), false, 'winter: not at 06:00 any more');
assert.equal(romeHour('2026-11-06T06:05:00Z'), 7); assert.equal(reminderDue(romeHour('2026-11-06T06:05:00Z'), 7), true, 'winter: at 07:00');
assert.equal(romeHour('2026-07-06T05:05:00Z'), 7); assert.equal(reminderDue(romeHour('2026-07-06T05:05:00Z'), 7), true, 'summer: at 07:00');
assert.equal(reminderDue(romeHour('2026-11-06T08:05:00Z'), 9), true, 'a 09:00 choice in winter');

// Hourly schedule (Vercel Pro); demo has none.
assert.deepEqual(deploymentConfig({}).crons.find(c => c.path === '/api/send-arrival-reminders'), { path: '/api/send-arrival-reminders', schedule: '5 * * * *' });

// Server reads the column and gates on it.
const api = read('api/send-arrival-reminders.js');
assert.match(api, /select=id,name,reminder_email,timezone,reminder_hour,/);
assert.match(api, /!force && !reminderDue\(local\.hour, p\.reminder_hour\)/);
assert.match(api, /arrival_reminder_sent_at=is\.null/); assert.match(api, /filing_reminder_sent_at=is\.null/);

// Console: 06:00–21:00 choice, saved by both save paths, filled on load, IT/EN text.
const html = read('host-console.html');
const sel = html.slice(html.indexOf('<select class="form-select" id="propReminderHour">'), html.indexOf('</select>', html.indexOf('id="propReminderHour"')));
assert.deepEqual([...sel.matchAll(/<option value="(\d+)">(\d\d):00<\/option>/g)].map(m => +m[1]), Array.from({ length: 16 }, (_, i) => i + 6));
assert.match(html, /reminder_hour: Math\.min\(21, Math\.max\(6, parseInt\(document\.getElementById\('propReminderHour'\)/);
assert.match(html, /'reminder_email','reminder_hour','timezone'/);
assert.match(html, /\.update\(\{ reminder_email: email \|\| null, timezone, reminder_hour: reminderHour \}\)/);
assert.match(html, /el\('propReminderHour'\)\.value = String\(Number\.isInteger\(data\.reminder_hour\) \? data\.reminder_hour : 7\)/);
assert.match(html, /reminder_hour: 'Ora di invio'/); assert.match(html, /reminder_hour: 'Send time'/);
assert.ok(!/reminders always fire at 07:00/.test(html) && !/partono sempre alle 07:00/.test(html), 'no promise of a fixed 07:00 left');

// Migration: default 7, range 6..21, re-runnable.
let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite(); await db.exec('create table public.properties(id serial primary key);');
  const sql = read('supabase/migrations/20261106090000_reminder_hour.sql'); await db.exec(sql); await db.exec(sql);
  await db.query('insert into public.properties default values');
  assert.equal((await db.query('select reminder_hour from public.properties')).rows[0].reminder_hour, 7);
  for (const ok of [6, 21]) await db.query('update public.properties set reminder_hour=$1', [ok]);
  for (const bad of [5, 22]) await assert.rejects(db.query('update public.properties set reminder_hour=$1', [bad]), /check constraint/);
}
console.log('PASS reminder hour: due at the chosen local hour + 3 catch-up hours, never before; winter 06:00 send gone, 07:00 in both seasons; hourly cron; server gate and sent markers; console 06:00–21:00 choice saved by both paths and filled; migration default 7, range 6..21 (PGlite)');
