import { readEnvironment } from '../lib/environment.mjs';
let config;
let configurationError = false;
try { config = readEnvironment(); } catch { configurationError = true; }
export const APP_ENV = config?.mode || '';
export const IS_DEMO = config?.demo === true;
export const SUPABASE_URL = config?.supabaseUrl || '';
export const SUPABASE_ANON_KEY = config?.publicKey || '';
export const APP_BASE_URL = config?.appOrigin || '';
export const HOST_CONSOLE_URL = config?.hostConsoleUrl || '';
export const ALLOWED_ORIGINS = config?.allowedOrigins || [];
export function environmentReady() { return !configurationError; }
export function rejectInvalidEnvironment(res) {
  if (!configurationError) return false;
  res.status(503).json({ error: 'Environment configuration is invalid', code: 'environment_invalid' });
  return true;
}
export function rejectDemoIntegration(res, integration) {
  if (!IS_DEMO) return false;
  res.status(403).json({ error: 'External integration disabled in demo', code: 'demo_integration_disabled', integration });
  return true;
}
export function assertLiveIntegration(integration) {
  if (configurationError || IS_DEMO) {
    const error = new Error(`External integration unavailable: ${integration}`);
    error.code = configurationError ? 'environment_invalid' : 'demo_integration_disabled';
    throw error;
  }
}
