// api/guest-token.js — Round 33 guest session token mint endpoint.
//
// POST { property_id, session_id, booking_code? }
//   → { token: '<b64url.b64url>', expires_at: '<iso>' }
//
// The client (guest app) calls this once after propertyId resolves, then
// stores the token in sessionStorage and sends it as
// `Authorization: Bearer <token>` on chat.js / scan-document.js /
// Round 34's guest-chat.js.
//
// This is not a secret-keeping mechanism — property_id is already public in
// the guest URL. The token exists so every AI request is attributable to a
// specific property (meterable, cuttable) instead of being an anonymous
// open POST.
//
// Env: GUEST_TOKEN_SECRET (required), SUPABASE_SERVICE_ROLE_KEY,
//      SUPABASE_URL / SUPABASE_ANON_KEY (defaults below).

import { signGuestToken } from './_guest-token.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same origin allowlist as Round 33 chat/scan hardening — keeps CORS
// consistent so a preview URL that can hit those endpoints can also mint
// a token, but random third-party origins can't.
function resolveOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://welcomebnb.vercel.app') return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return null;
}

export default async function handler(req, res) {
  const origin = req.headers['origin'] || req.headers['Origin'] || '';
  const allowed = resolveOrigin(origin) || 'https://welcomebnb.vercel.app';
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.GUEST_TOKEN_SECRET) {
    console.error('[guest-token] GUEST_TOKEN_SECRET is not set — refusing to mint');
    return res.status(500).json({ error: 'Token minting is not configured' });
  }
  if (!SERVICE_KEY) {
    console.error('[guest-token] SUPABASE_SERVICE_ROLE_KEY is not set — cannot verify property');
    return res.status(500).json({ error: 'Server not configured' });
  }

  const { property_id, session_id, booking_code } = req.body || {};
  if (!property_id || typeof property_id !== 'string') {
    return res.status(400).json({ error: 'property_id required' });
  }
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'session_id required' });
  }
  const bc = booking_code && typeof booking_code === 'string' ? booking_code : null;

  // Verify the property exists and hasn't been soft-deleted. This is the
  // single "does the caller's URL point somewhere real" gate.
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(property_id)}` +
      `&deleted_at=is.null&select=id`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Accept: 'application/json',
        },
      },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('[guest-token] property lookup failed', r.status, t);
      return res.status(500).json({ error: 'Property lookup failed' });
    }
    const rows = await r.json();
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Property not found' });
    }
  } catch (e) {
    console.error('[guest-token] property lookup exception', e);
    return res.status(500).json({ error: 'Property lookup exception' });
  }

  const { token, payload } = signGuestToken({ p: property_id, s: session_id, b: bc });
  return res.status(200).json({
    token,
    expires_at: new Date(payload.exp * 1000).toISOString(),
  });
}
