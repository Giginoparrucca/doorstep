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
//   POST   ?action=verify  { property_id }       → { verified, verified_at?, token_expires_at?, error?, error_code? }
//   POST   ?action=delete  { property_id }       → { configured: false }
//
// Future phases (Phase 2 = validate, Phase 3 = send) will add
// ?action=validate / ?action=send here. Keeping them in ONE file
// preserves the function budget.
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
import { encryptCredentials, decryptCredentials } from './_alloggiati-crypto.js';
import { generateToken, authenticationTest } from './_alloggiati-soap.js';

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
// Round 44 Phase 1 hotfix — use PATCH for partial updates on rows
// that already exist. Can't rely on sbUpsert here: Postgres checks
// NOT NULL constraints on the pre-INSERT row BEFORE ON CONFLICT can
// redirect to UPDATE, so an upsert body missing credentials_enc
// always fails 23502 even when a row for property_id exists.
async function sbPatch(pathAndQuery, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sbPatch ${res.status}: ${await res.text().catch(() => '')}`);
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

  if (action === 'verify') {
    // Round 44 Phase 1 — hit Alloggiati's SOAP endpoint with the
    // stored credentials and stamp verified_at + last_error on the row.
    //
    // Return contract (always HTTP 200 for a completed attempt, even
    // when the portal rejected the credentials — the client renders
    // the result differently for `verified: true` vs `verified: false`):
    //   { verified: true,  verified_at, token_expires_at }
    //   { verified: false, error, error_code }
    //
    // We NEVER return the token to the client. It lives only in this
    // function's memory during the two SOAP calls and is discarded.
    let row;
    try {
      const rows = await sbGet(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&select=credentials_enc,credentials_nonce,enc_key_id&limit=1`
      );
      row = Array.isArray(rows) && rows[0];
    } catch (e) {
      console.warn('[alloggiati] verify: row lookup failed:', e.message);
      return res.status(500).json({ error: 'Credential lookup failed' });
    }
    if (!row) {
      return res.status(400).json({ error: 'No credentials saved for this property yet' });
    }

    let creds;
    try {
      creds = await decryptCredentials(row);
    } catch (e) {
      console.error('[alloggiati] verify: decrypt failed:', e.message);
      // Stamp the row so the UI shows the honest state — "we can't
      // read your stored credentials, please re-enter". Common causes
      // are a rotated ALLOGGIATI_ENC_KEY without background re-encrypt.
      const stampErr = 'Stored credentials unreadable — please re-enter them.';
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: stampErr },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: stampErr,
        error_code: 'decrypt_failed',
      });
    }

    // Two SOAP calls: GenerateToken → Authentication_Test. Failure of
    // either one is treated as a verification failure with the
    // portal's own error message surfaced to the host.
    let token, tokenExpires;
    try {
      const t = await generateToken(creds);
      token = t.token;
      tokenExpires = t.expires || null;
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati portal rejected the credentials';
      console.warn('[alloggiati] verify: GenerateToken failed:', e.code, portalMsg);
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: portalMsg },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: portalMsg,
        error_code: e.code || 'portal_error',
      });
    }

    try {
      await authenticationTest({ utente: creds.utente, token });
    } catch (e) {
      const portalMsg = e.message || 'Alloggiati authentication test failed';
      console.warn('[alloggiati] verify: Authentication_Test failed:', e.code, portalMsg);
      try {
        await sbPatch(
          `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
          { verified_at: null, last_error: portalMsg },
        );
      } catch (_) {}
      return res.status(200).json({
        verified: false,
        error: portalMsg,
        error_code: e.code || 'portal_error',
      });
    }

    // Success — stamp the row and forget the token.
    const verifiedAt = new Date().toISOString();
    // Round 44 Phase 1 note — Alloggiati exposes the TOKEN expiry
    // (24 h) through GenerateToken, but NOT the underlying WsKey
    // expiry (set by the host at the portal, up to 12 months). We
    // keep wskey_expires_at null; a future admin UI can let the host
    // record their portal-set expiry manually.
    try {
      await sbPatch(
        `host_alloggiati_credentials?property_id=eq.${encodeURIComponent(propertyId)}`,
        { verified_at: verifiedAt, last_error: null },
      );
    } catch (e) {
      console.error('[alloggiati] verify: stamp failed:', e.message);
      // Don't fail the whole call — the credentials DID verify; the
      // client just won't see the timestamp until the next status
      // load. Return `verified: true` with a soft warning.
      return res.status(200).json({
        verified: true,
        verified_at: verifiedAt,
        token_expires_at: tokenExpires,
        warning: 'Verification succeeded but the timestamp could not be saved.',
      });
    }
    return res.status(200).json({
      verified: true,
      verified_at: verifiedAt,
      token_expires_at: tokenExpires,
    });
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
