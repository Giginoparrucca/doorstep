import assert from 'node:assert/strict';
import { deploymentConfig } from '../lib/deployment-config.mjs';
const prod = deploymentConfig({});
assert.equal(prod.functions['api/chat.js'].includeFiles, 'lib/**', 'chat must package the shared entry validator tables');
assert.deepEqual(prod.crons, [
  { path: '/api/ical-sync', schedule: '0 4 * * *' },
  { path: '/api/send-arrival-reminders', schedule: '0 5 * * *' },
]);
const demo = deploymentConfig({ APP_ENV: 'demo' });
assert.deepEqual(demo.crons, []);
const { crons: p, ...productionSettings } = prod;
const { crons: d, ...demoSettings } = demo;
assert.deepEqual(demoSettings, productionSettings);
assert.throws(() => deploymentConfig({ APP_ENV: 'typo' }));
assert.throws(() => deploymentConfig({ VERCEL_PROJECT_NAME: 'welcomebnb-demo' }));
assert.throws(() => deploymentConfig({ VERCEL_PROJECT_PRODUCTION_URL: 'demo.welcomebnb.it' }));
assert.equal(deploymentConfig({ APP_ENV: 'demo', VERCEL_PROJECT_NAME: 'welcomebnb-demo' }).crons.length, 0);
// vercel.mjs: Vercel reads static keys without running code. They must be
// literals in the exported object (no spread, no computed object), and the
// exported config must equal the computed one.
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../vercel.mjs', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export const config = {'));
  assert.ok(body.startsWith('export const config = {'), 'config is an object literal');
  assert.ok(!/\.\.\./.test(body), 'no spread in the exported object');
  for (const key of ['buildCommand', 'outputDirectory']) assert.match(body, new RegExp(`\\n  ${key}: '[^']*',`), key + ' is a literal');
  assert.match(body, /\n  regions: \['dub1'\],/, 'regions is a literal (Dublin)');
  for (const key of ['framework', 'installCommand', 'devCommand', 'nodeVersion', 'git', 'github', 'relatedProjects']) assert.ok(!new RegExp(`\\n  ${key}:\\s*[^'\"\\n]`).test(body) || new RegExp(`\\n  ${key}: ('|null|true|false|\\d)`).test(body), key + ' literal if present');
  const { config } = await import('../vercel.mjs');
  assert.deepEqual(config, deploymentConfig(process.env), 'vercel.mjs exports exactly the computed configuration');
}
console.log('PASS deployment configuration: no demo schedules; production settings preserved; invalid modes fail closed; vercel.mjs static keys are literals and the export equals the computed config.');
