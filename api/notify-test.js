// api/notify-test.js — Round 42.
// Sends a "Notifica di prova" through all enabled channels for the caller.
// Rate-limited to 3 tests per host per 10 minutes.

import { applyCors } from './_cors.js';
import { sendTestNotification } from './_notify-host.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RATE_MAX = 3;
const RATE_WINDOW_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
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

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/notification_log?host_id=eq.${encodeURIComponent(hostId)}&trigger=eq.test&created_at=gte.${encodeURIComponent(since)}&select=id&limit=${RATE_MAX + 1}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  if (r.ok) {
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows) && rows.length >= RATE_MAX) {
      res.setHeader('Retry-After', '600');
      return res.status(429).json({ error: 'Too many test notifications — try again later.' });
    }
  }

  const out = await sendTestNotification(hostId);
  return res.status(200).json(out);
}
