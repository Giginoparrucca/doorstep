// api/_cors.js — Round 34.2
//
// Single source of truth for the WelcomeBnB origin allowlist. Replaces
// four byte-identical resolveOrigin() copies that lived in chat.js,
// scan-document.js, guest-chat.js and guest-token.js.
//
// The bug that motivated this: the copies each contained
//     if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
// which is meant to allow this project's preview deployments but
// actually matches every deployment on Vercel — anyone with a Vercel
// account could push a page to `anything.vercel.app` and call these
// endpoints from a real browser with a legitimate Origin header.
//
// The new allowlist uses Vercel's own deployment env vars instead of
// pattern-matching hostnames. NO regex matches `.vercel.app` anywhere
// in this file; a receiving reviewer can grep the whole api/ tree and
// verify that in one line.

const PROD_ORIGIN = 'https://welcomebnb.vercel.app';

// Vercel env vars ship without the scheme. Normalise + validate.
function _normalizeVercelHost(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return 'https://' + s;
}

// Built once per lambda cold start. Set contains exact origin strings
// only — no wildcards, no regex.
let _cachedAllowlist = null;
function _list() {
  if (_cachedAllowlist) return _cachedAllowlist;
  const out = new Set([PROD_ORIGIN]);
  const cands = [
    _normalizeVercelHost(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    _normalizeVercelHost(process.env.VERCEL_BRANCH_URL),
    _normalizeVercelHost(process.env.VERCEL_URL),
  ];
  for (const c of cands) if (c) out.add(c);
  _cachedAllowlist = out;
  return _cachedAllowlist;
}

// Returns the allowed origin string when the incoming Origin header
// matches, or null when it doesn't. Callers decide the 403 policy.
export function resolveOrigin(origin) {
  if (!origin) return null;
  if (_list().has(origin)) return origin;
  // Local dev — a browser under attacker control cannot fake a
  // localhost Origin (browsers refuse to set a cross-origin request's
  // Origin header to `http://localhost`), so allowing this is safe.
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  return null;
}

// Sets the CORS response headers and returns the allowed origin (or
// null when disallowed). The caller decides on:
//   - the method allowlist (each endpoint has slightly different rules)
//   - the 403 response
// This keeps control flow in the handler where it's visible and
// grep-able, and avoids `applyCors` accidentally short-circuiting the
// response.
export function applyCors(req, res) {
  const origin = req.headers['origin'] || req.headers['Origin'] || '';
  const allowed = resolveOrigin(origin);
  if (allowed) res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  // POST + OPTIONS covers all four endpoints. Widening this is safe
  // for CORS — the handler still enforces its own method allowlist.
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return allowed;
}
