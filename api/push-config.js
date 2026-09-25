// api/push-config.js — Round 42.
// Returns { vapidPublicKey } for the host console. The public key is
// safe to expose — it's the browser-facing half of the VAPID pair, and
// any web-push spec-compliant client is supposed to fetch it publicly.
//
// Round 42.6 — do NOT gate this on Origin. Same-origin browser GETs
// omit the Origin header per spec, so a strict CORS reject bounced
// the host console's own fetch('/api/push-config') call. applyCors
// still fires so the response carries Vary/Access-Control-* headers,
// but a missing/unknown origin is not a reason to refuse.

import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST' });
  }
  const key = process.env.VAPID_PUBLIC_KEY || '';
  if (!key) return res.status(500).json({ error: 'VAPID_PUBLIC_KEY not configured' });
  return res.status(200).json({ vapidPublicKey: key });
}
