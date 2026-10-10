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
