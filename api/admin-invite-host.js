// api/admin-invite-host.js — Round 38, invite-only host access.
//
// Admin-only endpoint that manages `pilot_invites` and drives Supabase's
// GoTrue admin API to invite / delete pending hosts. Three actions:
//
//   POST { action: 'invite',  email }
//     Sends the Supabase invitation email and inserts (or resets to
//     `invited`) the pilot_invites row.
//
//   POST { action: 'resend',  email }
//     Re-sends the invitation email for an existing pilot_invites row.
//     Only allowed when the row is `invited` or `revoked` — an accepted
//     host doesn't need another invitation.
//
//   POST { action: 'revoke',  email }
//     Marks the row `revoked`. If the auth.users row exists and never
//     signed in, delete the pending user too. Never deletes an
//     accepted host — that would delete a real account with data;
//     the admin has to do that by hand.
//
// Auth:
//   - CORS via api/_cors.js (Round 34.2 allowlist).
//   - Caller's Supabase JWT is verified through the auth endpoint, the
//     exact pattern api/ical-sync.js uses for its USER mode. Then the
//     caller's admin status is confirmed via the `is_admin()` SQL
//     function called through PostgREST with the CALLER's JWT — the
//     endpoint never trusts a client-supplied admin flag.
//
// Env vars:
//   SUPABASE_URL                 — public
//   SUPABASE_ANON_KEY            — public
//   SUPABASE_SERVICE_ROLE_KEY    — server-only; drives auth.admin
//
// NOTE: this endpoint is NOT the gate that stops new signups. That gate
// is the Supabase project setting: Authentication → Sign In / Providers
// → Email → "Allow new users to sign up" = OFF. Without that the
// invite-only flow is cosmetic — sb.auth.signUp() still works.

import { applyCors } from './_cors.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_BODY_BYTES = 4 * 1024;

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed)                 return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  // Body size — the payload is tiny (an email + an action); nothing
  // larger has any legitimate use.
  let bodyBytes = 0;
  try { bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8'); } catch (_) { bodyBytes = 0; }
  if (bodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large' });
  }

  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured (service key missing)' });

  // Bearer token from the caller — verify against the auth endpoint,
  // then confirm admin server-side.
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });
  let userId = null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    userId = user?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
  } catch (_) {
    return res.status(401).json({ error: 'Auth check failed' });
  }
  const isAdmin = await callerIsAdmin(jwt);
  if (!isAdmin) return res.status(403).json({ error: 'Admin only' });

  const { action, email: emailRaw, notes } = req.body || {};
  const email = normEmail(emailRaw);
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!isEmailShape(email)) return res.status(400).json({ error: 'email malformed' });
  if (!['invite', 'resend', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'action must be invite | resend | revoke' });
  }

  try {
    if (action === 'invite') return res.status(200).json(await doInvite(email, userId, notes || null));
    if (action === 'resend') return res.status(200).json(await doResend(email, userId));
    if (action === 'revoke') return res.status(200).json(await doRevoke(email));
  } catch (e) {
    console.error('[admin-invite-host]', action, email, e);
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}

// ── Actions ─────────────────────────────────────────────────────────────
async function doInvite(email, actorId, notes) {
  // Send Supabase's invitation email via the GoTrue admin API.
  const invited = await gotruePost('/auth/v1/admin/invite', { email });
  if (!invited.ok) return { ok: false, stage: 'invite', status: invited.status, detail: invited.text };
  // Upsert pilot_invites row. Reset a `revoked` row to `invited` so the
  // history stays legible.
  await pgrestPOST('/rest/v1/pilot_invites?on_conflict=email', {
    email,
    status: 'invited',
    invited_at: new Date().toISOString(),
    accepted_at: null,
    invited_by: actorId,
    notes,
  }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
  return { ok: true, action: 'invite', email };
}

async function doResend(email, actorId) {
  // Guard: only invite/revoke rows can be re-sent. Accepted hosts don't
  // need another invitation.
  const row = await pgrestGET(`/rest/v1/pilot_invites?email=eq.${encodeURIComponent(email)}&select=status`);
  if (!row || row.length === 0) return { ok: false, error: 'no invite row for that email' };
  if (row[0].status === 'accepted') return { ok: false, error: 'already accepted; no resend' };
  const invited = await gotruePost('/auth/v1/admin/invite', { email });
  if (!invited.ok) return { ok: false, stage: 'resend', status: invited.status, detail: invited.text };
  await pgrestPATCH(`/rest/v1/pilot_invites?email=eq.${encodeURIComponent(email)}`, {
    status: 'invited',
    invited_at: new Date().toISOString(),
    invited_by: actorId,
  });
  return { ok: true, action: 'resend', email };
}

async function doRevoke(email) {
  // Mark row revoked. If the underlying auth.users row exists AND has
  // never signed in AND owns no properties, delete the pending user.
  // Never delete an accepted host — losing an active account this
  // easily is the wrong default.
  await pgrestPATCH(`/rest/v1/pilot_invites?email=eq.${encodeURIComponent(email)}`, {
    status: 'revoked',
  });
  const users = await gotrueGetJSON(`/auth/v1/admin/users?filter=email.eq.${encodeURIComponent(email)}`);
  const target = Array.isArray(users?.users) ? users.users.find(u => (u.email || '').toLowerCase() === email) : null;
  if (!target) return { ok: true, action: 'revoke', email, auth_user_deleted: false, reason: 'no auth user' };
  // Never accepted (no last_sign_in_at) and no properties owned → safe to delete.
  if (target.last_sign_in_at) {
    return { ok: true, action: 'revoke', email, auth_user_deleted: false, reason: 'user has signed in — flag for manual review' };
  }
  const props = await pgrestGET(`/rest/v1/properties?owner_id=eq.${encodeURIComponent(target.id)}&select=id`);
  if (props && props.length > 0) {
    return { ok: true, action: 'revoke', email, auth_user_deleted: false, reason: 'user owns properties — flag for manual review' };
  }
  const del = await gotrueRaw('DELETE', `/auth/v1/admin/users/${encodeURIComponent(target.id)}`);
  if (!del.ok) return { ok: true, action: 'revoke', email, auth_user_deleted: false, reason: 'delete failed: ' + del.text };
  return { ok: true, action: 'revoke', email, auth_user_deleted: true };
}

// ── Helpers ─────────────────────────────────────────────────────────────
function normEmail(s) {
  if (s == null) return '';
  return String(s).trim().toLowerCase();
}
function isEmailShape(s) {
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);
}
async function callerIsAdmin(jwt) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) return false;
    const v = await r.json();
    return v === true;
  } catch (_) { return false; }
}
async function gotruePost(path, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, text };
}
async function gotrueGetJSON(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
async function gotrueRaw(method, path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, text };
}
async function pgrestGET(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error('pgrest GET ' + path + ' → ' + r.status + ' ' + await r.text().catch(() => ''));
  return r.json();
}
async function pgrestPOST(path, body, extraHeaders) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('pgrest POST ' + path + ' → ' + r.status + ' ' + await r.text().catch(() => ''));
  return true;
}
async function pgrestPATCH(path, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('pgrest PATCH ' + path + ' → ' + r.status + ' ' + await r.text().catch(() => ''));
  return true;
}
