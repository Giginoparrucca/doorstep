import { writeFileSync } from 'node:fs';
import { readEnvironment, publicConfiguration } from '../lib/environment.mjs';
const config = readEnvironment(); // Throws before writing when demo is unsafe/missing.
const json = JSON.stringify(publicConfiguration(config)).replace(/</g, '\\u003c');
writeFileSync(new URL('../app-config.js', import.meta.url),
  `// Generated public configuration. No server credentials.\nwindow.WELCOME_BNB_CONFIG = Object.freeze(${json});\n`);
console.log(`Public application configuration generated for ${config.mode}.`);
if (process.env.DEMO_PHASE2_GATE === '1') {
  const { runGate } = await import('./demo-auth-storage-gate.mjs');
  const result = await runGate();
  writeFileSync(new URL('../phase2-check-result.json', import.meta.url), JSON.stringify({
    ...result, sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA, checkedAt: new Date().toISOString(),
  }));
}
// Opt-in Round 51 live gate; dedicated demo build only. Result contains counts
// and labels, never credentials, tokens or guest data.
if (process.env.ROUND51_HOST_GATE_ORIGIN) {
  const {runHostGate} = await import('./onboarding-host-gate.mjs');
  const result = await runHostGate();
  writeFileSync(new URL('../phase4-check-result.json', import.meta.url), JSON.stringify({
    ...result, sourceCommit: process.env.VERCEL_GIT_COMMIT_SHA, checkedAt: new Date().toISOString(),
  }));
}
// Explicit Round 63 provider probe, run only by an authorized production build.
// Keep runtime integration disabled; never write secrets/provider payloads to output.
if (process.env.IRESERVATION_BUILD_PROBE === 'true') {
  const { runReadProbe } = await import('./ireservation-read-probe.mjs');
  const { safeError } = await import('../api/_ireservation-core.js');
  try {
    const result = await runReadProbe({ ...process.env, IRESERVATION_LIVE_PROBE: 'true' });
    console.log(`PASS iReservation authorized test-property reads: ${result.rooms} rooms, ${result.distributors} distributors, ${result.reservations} test reservations; no reservation or calendar writes`);
  } catch (error) {
    throw new Error('iReservation build probe failed: ' + safeError(error).code);
  }
}
