// api/push-config.js — Round 42.
// Returns { vapidPublicKey } for the host console. The public key is
// safe to expose — it's the browser-facing half of the VAPID pair.
// CORS still enforced so admin.html / index.html origins can call from
// the same allowlist as the rest of the API.

import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST' });
  }
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  return res.status(200).json({ vapidPublicKey: key });
}
