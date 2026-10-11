import assert from 'node:assert/strict';
import { deploymentConfig } from '../lib/deployment-config.mjs';
const prod = deploymentConfig({});
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
console.log('PASS deployment configuration: no demo schedules; production settings preserved; invalid modes fail closed.');
