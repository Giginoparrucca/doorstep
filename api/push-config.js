import { rejectInvalidEnvironment, SUPABASE_URL, SUPABASE_ANON_KEY, rejectDemoIntegration } from './_environment.js';
// api/push-config.js — Round 42, extended in Round 44 Phase 0.5.
//
// Two responsibilities, action-routed to stay under Vercel Hobby's
// 12-function cap (Round 44 consolidation — notify-test.js was folded
// in here to free a slot for /api/alloggiati.js):
//
//   1. Default (GET or POST with no ?action):
//      Returns { vapidPublicKey } for the host console. The public key
//      is safe to expose — it's the browser-facing half of the VAPID
//      pair, and any web-push spec-compliant client is supposed to
//      fetch it publicly.
//
//   2. POST ?action=test (was api/notify-test.js):
//      Sends a "Notifica di prova" through all enabled channels for
//      the caller. Rate-limited to 3 tests per host per 10 minutes.
//
// Round 42.6 — do NOT gate the default GET on Origin. Same-origin
// browser GETs omit the Origin header per spec, so a strict CORS
// reject bounced the host console's own fetch('/api/push-config') call.
// applyCors still fires so the response carries Vary/Access-Control-*
// headers, but a missing/unknown origin is not a reason to refuse.
// The ?action=test branch DOES require a bearer JWT so origin doesn't
// matter there — auth stands on its own.

import { applyCors } from './_cors.js';
import { sendTestNotification } from './_notify-host.js';


const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_RATE_MAX       = 3;
const TEST_RATE_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  if (rejectInvalidEnvironment(res)) return;
  if (rejectDemoIntegration(res, 'push')) return;
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query && String(req.query.action || '').trim()) || '';

  // Send a test notification — extracted from the retired
  // api/notify-test.js. Auth via Bearer JWT + per-host rate limit.
  if (action === 'test') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

    const authHeader = req.headers['authorization'] || req.headers['Authorization'];
    const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });
    let hostId = null;
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
      });
      if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
      const user = await userRes.json();
      hostId = user?.id;
      if (!hostId) return res.status(401).json({ error: 'Invalid token' });
    } catch (_) {
      return res.status(401).json({ error: 'Auth check failed' });
    }

    const since = new Date(Date.now() - TEST_RATE_WINDOW_MS).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/notification_log?host_id=eq.${encodeURIComponent(hostId)}&trigger=eq.test&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${TEST_RATE_MAX + 1}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (r.ok) {
      const rows = await r.json().catch(() => []);
      if (Array.isArray(rows) && rows.length >= TEST_RATE_MAX) {
        res.setHeader('Retry-After', '600');
        return res.status(429).json({ error: 'Too many test notifications — try again later.' });
      }
    }

    const out = await sendTestNotification(hostId);
    return res.status(200).json(out);
  }

  // Default: return the VAPID public key.
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST' });
  }
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  return res.status(200).json({ vapidPublicKey: key });
}
