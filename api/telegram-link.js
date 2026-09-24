// api/telegram-link.js — Round 42.
// Creates a short-lived link token and returns the t.me URL the host
// clicks to bind their Telegram chat. Rate-limited to 5 tokens per host
// per hour. Uses the parse-tax-delibera.js JWT verification pattern.

import { applyCors } from './_cors.js';
import crypto from 'crypto';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY  = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY        = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_USERNAME  = process.env.TELEGRAM_BOT_USERNAME || '';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured (service key)' });
  if (!TELEGRAM_USERNAME) return res.status(500).json({ error: 'TELEGRAM_BOT_USERNAME not configured' });

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

  // Rate limit: at most RATE_MAX tokens per host per RATE_WINDOW_MS.
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const recent = await pgrestGET(
    `telegram_link_tokens?host_id=eq.${encodeURIComponent(hostId)}&created_at=gte.${encodeURIComponent(since)}&select=token&limit=${RATE_MAX + 1}`,
  );
  if (Array.isArray(recent) && recent.length >= RATE_MAX) {
    res.setHeader('Retry-After', '3600');
    return res.status(429).json({ error: 'Too many link requests — try again later.' });
  }

  // Clean up expired / used tokens for this host (housekeeping).
  const nowIso = new Date().toISOString();
  await pgrestDELETE(
    `telegram_link_tokens?host_id=eq.${encodeURIComponent(hostId)}&or=(expires_at.lt.${encodeURIComponent(nowIso)},used_at.not.is.null)`,
  );

  // Mint a fresh token — 32 bytes → 43 base64url chars.
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  const ok = await pgrestPOST('telegram_link_tokens', {
    token, host_id: hostId, expires_at: expiresAt,
  });
  if (!ok) return res.status(500).json({ error: 'Failed to mint link token' });

  const url = `https://t.me/${TELEGRAM_USERNAME}?start=${encodeURIComponent(token)}`;
  return res.status(200).json({ url, expires_at: expiresAt });
}

async function pgrestGET(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) return null;
  return r.json();
}
async function pgrestPOST(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}
async function pgrestDELETE(path) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  });
}
