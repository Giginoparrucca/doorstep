// Round 50: one public configuration contract for build and server.
export const PRODUCTION_REF = 'jcjwaqqabgwqhhzhfbts';
export const PRODUCTION_ORIGIN = 'https://app.welcomebnb.it';
export const LEGACY_ORIGIN = 'https://welcomebnb.vercel.app';
export const PRODUCTION_PUBLIC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
function origin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new Error('Invalid HTTPS origin');
  return url.origin;
}
function keyMatches(key, ref, role, modernPrefix) {
  if (key?.startsWith(modernPrefix) && key.length > 30) return true;
  try {
    const p = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    return p.ref === ref && p.role === role;
  } catch { return false; }
}
export function readEnvironment(env = process.env) {
  const hint = [env.VERCEL_PROJECT_NAME, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).join(' ');
  const mode = env.APP_ENV || 'production';
  if (!['production', 'demo'].includes(mode)) throw new Error('APP_ENV must be production or demo');
  if (mode !== 'demo' && /(^|[.\s-])demo([.\s-]|$)/i.test(hint)) throw new Error('Demo deployment requires APP_ENV=demo');
  const demo = mode === 'demo';
  const ref = demo ? env.DEMO_SUPABASE_PROJECT_REF : PRODUCTION_REF;
  const supabaseUrl = env.SUPABASE_URL || (demo ? '' : `https://${PRODUCTION_REF}.supabase.co`);
  const publicKey = env.SUPABASE_ANON_KEY || (demo ? '' : PRODUCTION_PUBLIC_KEY);
  const appOrigin = env.APP_BASE_URL || (demo ? '' : PRODUCTION_ORIGIN);
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || (demo && ref === PRODUCTION_REF)) throw new Error('Invalid environment project ref');
  if (supabaseUrl !== `https://${ref}.supabase.co`) throw new Error('Supabase URL does not match environment project');
  if (!keyMatches(publicKey, ref, 'anon', 'sb_publishable_')) throw new Error('Public key does not match environment project/role');
  origin(appOrigin);
  if (demo && [PRODUCTION_ORIGIN, LEGACY_ORIGIN].includes(appOrigin)) throw new Error('Demo origin cannot be production');
  const hostConsoleUrl = env.HOST_CONSOLE_URL || `${appOrigin}/host-console.html`;
  const consoleOrigin = new URL(hostConsoleUrl).origin;
  if (demo ? consoleOrigin !== appOrigin : ![appOrigin, PRODUCTION_ORIGIN, LEGACY_ORIGIN].includes(consoleOrigin)) throw new Error('Host console URL crosses environments');
  if (demo) {
    if (!env.SUPABASE_SERVICE_ROLE_KEY || !keyMatches(env.SUPABASE_SERVICE_ROLE_KEY, ref, 'service_role', 'sb_secret_')) throw new Error('Demo service key missing or mismatched');
    if (!env.GUEST_TOKEN_SECRET || env.GUEST_TOKEN_SECRET.length < 32) throw new Error('Independent demo guest-token secret required');
  }
  const allowedOrigins = new Set(demo ? [appOrigin] : [appOrigin, PRODUCTION_ORIGIN, LEGACY_ORIGIN]);
  for (const value of [env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL, env.VERCEL_URL]) {
    if (!value) continue;
    const candidate = origin(value.startsWith('https://') ? value : `https://${value}`);
    if (demo && [PRODUCTION_ORIGIN, LEGACY_ORIGIN].includes(candidate)) throw new Error('Demo deployment origin crosses environments');
    allowedOrigins.add(candidate);
  }
  // Round 51 Phase 3 — contact-widget channels. Each is optional; a
  // channel without a value is hidden in the UI. Email falls back to
  // `info@welcomebnb.it`. In demo mode, the deployer sets dedicated
  // demo values or leaves them unset; a production number must never
  // ship in demo config.
  const supportWhatsapp = _supportWhatsapp(env.SUPPORT_WHATSAPP_E164);
  const supportEmail = _supportEmail(env.SUPPORT_EMAIL || 'info@welcomebnb.it');
  const supportCalendly = _supportCalendly(env.SUPPORT_CALENDLY_URL);
  return Object.freeze({ mode, demo, projectRef: ref, supabaseUrl, publicKey, appOrigin,
    hostConsoleUrl, allowedOrigins: Object.freeze([...allowedOrigins]),
    support: Object.freeze({ whatsapp: supportWhatsapp, email: supportEmail, calendly: supportCalendly }) });
}
// E.164 phone (+ then 7-15 digits). Returns null for anything invalid.
function _supportWhatsapp(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/\s+/g, '');
  return /^\+[0-9]{7,15}$/.test(s) ? s : null;
}
function _supportEmail(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s.toLowerCase() : null;
}
function _supportCalendly(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    if (!/(^|\.)calendly\.com$/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}
// Explicit allowlist: server secrets can never enter the generated browser file.
export function publicConfiguration(config) {
  return { mode: config.mode, projectRef: config.projectRef, supabaseUrl: config.supabaseUrl,
    publicKey: config.publicKey, appOrigin: config.appOrigin, allowedOrigins: config.allowedOrigins,
    support: config.support };
}
