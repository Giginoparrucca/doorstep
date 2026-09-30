// api/alloggiati.js — Round 44 Phase 0.5
//
// Consolidated Alloggiati Web endpoint. Action-routed to stay under
// Vercel Hobby's 12-function cap. Every action requires a host bearer
// JWT and confirms the caller owns the given property_id before
// touching the credentials row.
//
// Actions
// -------
//   POST   ?action=status  { property_id }       → { configured, verified_at, wskey_expires_at, last_error }
//   POST   ?action=save    { property_id, utente, password, wskey, consent }
//                                                → { configured: true, saved_at }
//   POST   ?action=delete  { property_id }       → { configured: false }
//
// Future phases (Phase 1 = auth verify, Phase 2 = validate, Phase 3 =
// send) will add ?action=verify / ?action=validate / ?action=send
// here. Keeping them in ONE file preserves the function budget.
//
// Security
// --------
// - No client ever receives plaintext credentials. `status` never even
//   returns the ciphertext.
// - The `host_alloggiati_credentials` table is service_role-only (see
//   Round 44 migration): every read/write in this file uses the
//   SERVICE_ROLE_KEY and the endpoint itself is the only trusted path.
// - `save` requires `consent: true` and stamps the row (no separate
//   consent field yet — the presence of any row implies consent was
//   given at save time; a future audit-log addition can capture the
//   timestamp and IP if compliance calls for it).
// - Property ownership is checked against `properties.owner_id`. Admin
//   viewers cannot save credentials on behalf of a host.

import { applyCors } from './_cors.js';
import { encryptCredentials } from './_alloggiati-crypto.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ── auth + property ownership check ─────────────────────────────────
async function resolveHostAndProperty(req, propertyId) {
  if (!propertyId || typeof propertyId !== 'string') {
    return { error: { status: 400, body: { error: 'property_id required' } } };
  }
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!jwt) return { error: { status: 401, body: { error: 'Missing bearer token' } } };

  let hostId = null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return { error: { status: 401, body: { error: 'Invalid token' } } };
    const user = await userRes.json();
    hostId = user?.id;
    if (!hostId) return { error: { status: 401, body: { error: 'Invalid token' } } };
  } catch (_) {
    return { error: { status: 401, body: { error: 'Auth check failed' } } };
  }

  // Ownership check via service_role — properties has RLS but the
  // endpoint enforces its own boundary rather than relying on the
  // caller's JWT alone.
  try {
    const propRes = await fetch(
      `${SUPABASE_URL}/rest/v1/properties?id=eq.${encodeURIComponent(propertyId)}&select=id,owner_id&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!propRes.ok) return { error: { status: 500, body: { error: 'Property lookup failed' } } };
    const rows = await propRes.json();
    const prop = Array.isArray(rows) && rows[0];
    if (!prop) return { error: { status: 404, body: { error: 'Property not found' } } };
    if (prop.owner_id !== hostId) return { error: { status: 403, body: { error: 'Not the property owner' } } };
    return { hostId, propertyId };
  } catch (_) {
    return { error: { status: 500, body: { error: 'Property lookup failed' } } };
  }
}

async function sbGet(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`sbGet ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}
async function sbUpsert(table, body, onConflict) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`sbUpsert ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}
async function sbDelete(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!res.ok) throw new Error(`sbDelete ${res.status}: ${await res.text().catch(() => '')}`);
  return true;
}

// ── main handler ────────────────────────────────────────────────────
export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });

  const action = String((req.query && req.query.action) || '').trim();
  const body = req.body || {};
  const propertyId = String(body.property_id || '').trim();

  const owner = await resolveHostAndProperty(req, propertyId);
  if (owner.error) return res.status(owner.error.status).json(owner.error.body);

  if (action === 'status') {
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=verified_at,wskey_expires_at,last_error,updated_at&limit=1`
      );
      const row = Array.isArray(rows) && rows[0];
      return res.status(200).json({
        configured:        !!row,
        verified_at:       row?.verified_at || null,
        wskey_expires_at:  row?.wskey_expires_at || null,
        last_error:        row?.last_error || null,
        updated_at:        row?.updated_at || null,
      });
    } catch (e) {
      console.warn('[alloggiati] status failed:', e.message);
      return res.status(500).json({ error: 'Status lookup failed' });
    }
  }

  if (action === 'save') {
    if (!body.consent) {
      return res.status(400).json({ error: 'Consent required' });
    }
    const utente   = String(body.utente || '').trim();
    const password = String(body.password || '');
    const wskey    = String(body.wskey || '').trim();
    if (!utente || !password || !wskey) {
      return res.status(400).json({ error: 'utente, password and wskey are all required' });
    }
    let enc;
    try {
      enc = await encryptCredentials({ utente, password, wskey });
    } catch (e) {
      console.error('[alloggiati] encrypt failed:', e.message);
      return res.status(500).json({ error: 'Server misconfigured (encryption)' });
    }
    try {
      const row = {
        property_id:        propertyId,
        credentials_enc:    enc.enc,
        credentials_nonce:  enc.nonce,
        enc_key_id:         enc.keyId,
        // Newly saved credentials haven't been verified against the
        // portal yet — that's Phase 1's job. Clear any stale state so
        // the UI shows an honest "configured but not verified" chip.
        verified_at:        null,
        wskey_expires_at:   null,
        last_error:         null,
      };
      const [saved] = await sbUpsert('host_alloggiati_credentials', row, 'property_id');
      return res.status(200).json({
        configured: true,
        saved_at:   saved?.updated_at || saved?.created_at || null,
      });
    } catch (e) {
      console.error('[alloggiati] save failed:', e.message);
      return res.status(500).json({ error: 'Save failed' });
    }
  }

  if (action === 'delete') {
    try {
      await sbDelete(`host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`);
      return res.status(200).json({ configured: false });
    } catch (e) {
      console.warn('[alloggiati] delete failed:', e.message);
      return res.status(500).json({ error: 'Delete failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
