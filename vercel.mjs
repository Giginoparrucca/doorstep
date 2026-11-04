// Vercel reads this file statically: buildCommand, outputDirectory and the
// other static keys (framework, installCommand, …) must be literal values in
// this object, not computed (since 4 Nov 2026 a computed object fails with
// "Dynamic values found in static properties"). Only the runtime parts come
// from lib/deployment-config.mjs; scripts/deployment-config.test.mjs checks
// both stay in step.
import { deploymentConfig } from './lib/deployment-config.mjs';

const dynamic = deploymentConfig();

export const config = {
  buildCommand: 'node scripts/build-config.mjs',
  outputDirectory: '.',
  regions: dynamic.regions,
  rewrites: dynamic.rewrites,
  crons: dynamic.crons,
  functions: dynamic.functions,
  headers: dynamic.headers,
};
