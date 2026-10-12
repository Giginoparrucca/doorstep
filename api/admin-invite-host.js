import { rejectInvalidEnvironment, SUPABASE_URL, SUPABASE_ANON_KEY, APP_BASE_URL, HOST_CONSOLE_URL, rejectDemoIntegration } from './_environment.js';
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


const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY  = process.env.RESEND_API_KEY;
const INVITE_FROM = process.env.INVITE_FROM || 'WelcomeBnB <notifiche@welcomebnb.it>';
const INVITE_REPLY_TO = process.env.INVITE_REPLY_TO || 'info@welcomebnb.it';
// Where the invite link lands after Supabase confirms the token. The
// host-console detects type=invite in the URL hash and prompts the
// invitee to set a password. Must be in the Supabase Auth redirect
// allowlist (dashboard → Authentication → URL Configuration).
const INVITE_REDIRECT_TO = HOST_CONSOLE_URL || (APP_BASE_URL ? APP_BASE_URL + '/host-console.html' : '');

const MAX_BODY_BYTES = 4 * 1024;

export default async function handler(req, res) {
  if (rejectInvalidEnvironment(res)) return;
  if (rejectDemoIntegration(res, 'invitations')) return;
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
  if (!['invite', 'resend', 'revoke', 'generate_link'].includes(action)) {
    return res.status(400).json({ error: 'action must be invite | resend | revoke | generate_link' });
  }

  try {
    if (action === 'invite')        return res.status(200).json(await doInvite(email, userId, notes || null));
    if (action === 'resend')        return res.status(200).json(await doResend(email, userId));
    if (action === 'revoke')        return res.status(200).json(await doRevoke(email));
    if (action === 'generate_link') return res.status(200).json(await doGenerateLink(email));
  } catch (e) {
    console.error('[admin-invite-host]', action, email, e);
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}

// ── Actions ─────────────────────────────────────────────────────────────
async function doInvite(email, actorId, notes) {
  // Round 51 hotfix — we no longer rely on Supabase to send the invite
  // email. The default sender `noreply@mail.app.supabase.io` lands in
  // spam often, the recipient lands on the guest `index.html` (because
  // the Supabase Site URL points at the app root), and the body is
  // monolingual English. We solve all three problems by:
  //   1. generating the token-bearing confirmation URL via
  //      `/auth/v1/admin/generatelink` (no email sent), passing a
  //      `redirect_to` of the host console; and
  //   2. sending our own bilingual (IT + EN) HTML email through Resend
  //      from `notifiche@welcomebnb.it`, which already has DKIM/SPF
  //      configured for welcomebnb.it (arrival-reminder sender since
  //      Round 42).
  const linkRes = await _generateInviteLink(email);
  if (!linkRes.ok) {
    console.warn('[admin-invite-host] generatelink failed', email, linkRes.status, linkRes.text?.slice(0, 300));
    return { ok: false, stage: 'generatelink', status: linkRes.status, detail: linkRes.text };
  }
  // Upsert pilot_invites row. Reset a `revoked` row to `invited` so the
  // history stays legible. We do this BEFORE sending so a Resend outage
  // still records the invite (admin can resend / copy link).
  await pgrestPOST('/rest/v1/pilot_invites?on_conflict=email', {
    email,
    status: 'invited',
    invited_at: new Date().toISOString(),
    accepted_at: null,
    invited_by: actorId,
    notes,
  }, { Prefer: 'resolution=merge-duplicates,return=minimal' });

  const sent = await _sendInviteEmail(email, linkRes.url);
  if (!sent.ok) {
    // Record the row anyway; expose the link so the admin can send
    // manually (from their personal mailbox).
    return { ok: false, stage: 'send', detail: sent.error, link: linkRes.url };
  }
  return { ok: true, action: 'invite', email, email_id: sent.id || null, link: linkRes.url };
}

async function doResend(email, actorId) {
  // Guard: only invite/revoke rows can be re-sent. Accepted hosts don't
  // need another invitation.
  const row = await pgrestGET(`/rest/v1/pilot_invites?email=eq.${encodeURIComponent(email)}&select=status`);
  if (!row || row.length === 0) return { ok: false, error: 'no invite row for that email' };
  if (row[0].status === 'accepted') return { ok: false, error: 'already accepted; no resend' };
  const linkRes = await _generateInviteLink(email);
  if (!linkRes.ok) {
    return { ok: false, stage: 'generatelink', status: linkRes.status, detail: linkRes.text };
  }
  await pgrestPATCH(`/rest/v1/pilot_invites?email=eq.${encodeURIComponent(email)}`, {
    status: 'invited',
    invited_at: new Date().toISOString(),
    invited_by: actorId,
  });
  const sent = await _sendInviteEmail(email, linkRes.url);
  if (!sent.ok) {
    return { ok: false, stage: 'send', detail: sent.error, link: linkRes.url };
  }
  return { ok: true, action: 'resend', email, email_id: sent.id || null, link: linkRes.url };
}

// Returns the confirmation URL without sending any email. The admin UI
// then shows a Copy button; the admin can forward the invite from their
// personal mailbox for deliverability.
async function doGenerateLink(email) {
  const linkRes = await _generateInviteLink(email);
  if (!linkRes.ok) return { ok: false, stage: 'generatelink', status: linkRes.status, detail: linkRes.text };
  return { ok: true, action: 'generate_link', email, link: linkRes.url };
}

// ── Invite link + email helpers ─────────────────────────────────────────
async function _generateInviteLink(email) {
  // Try `type=invite` first — that's the right link for a brand new
  // auth user. If GoTrue says the user already exists (422
  // `email_exists`), the invite was previously generated and the user
  // row is still present. In that case a magic-link does the same job
  // for a resend: it signs the user in with a one-time token and the
  // host-console still runs its SIGNED_IN handler to prompt for a
  // password and flip pilot_invites.status → accepted.
  var first = await _callGenerateLink({ type: 'invite', email });
  if (first.ok) return first;
  if (first.status === 422 && /email_exists/i.test(first.text || '')) {
    var second = await _callGenerateLink({ type: 'magiclink', email });
    if (second.ok) return { ok: true, url: second.url, fallback: 'magiclink' };
    return second;
  }
  return first;
}

async function _callGenerateLink(body) {
  if (INVITE_REDIRECT_TO) body.redirect_to = INVITE_REDIRECT_TO;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/generatelink`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text().catch(() => '');
  if (!r.ok) return { ok: false, status: r.status, text };
  let payload = null;
  try { payload = JSON.parse(text); } catch (_) {}
  // GoTrue returns { action_link, email_otp, hashed_token, ... } under
  // `properties`. Different Supabase versions nest it differently; try
  // both shapes.
  const url = (payload && (
    (payload.properties && payload.properties.action_link) ||
    payload.action_link
  )) || null;
  if (!url) return { ok: false, status: r.status, text: 'generatelink response missing action_link' };
  return { ok: true, url };
}

async function _sendInviteEmail(email, actionLink) {
  if (!RESEND_KEY) return { ok: false, error: 'RESEND_API_KEY not set' };
  const subject = 'WelcomeBnB — Il tuo invito · Your invitation';
  const linkEsc = _escAttr(actionLink);
  const html = _renderInviteEmail(linkEsc);
  const plain =
    'Benvenuto in WelcomeBnB!\n\n' +
    "Fai clic sul link qui sotto per creare la tua password e accedere alla console host.\n" +
    actionLink + '\n\n' +
    '— — —\n\n' +
    'Welcome to WelcomeBnB!\n\n' +
    'Click the link below to set your password and sign in to the host console.\n' +
    actionLink + '\n';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: INVITE_FROM,
        to: [email],
        reply_to: INVITE_REPLY_TO,
        subject,
        html,
        text: plain,
        // Lightweight anti-spam headers Resend passes to upstream SMTP.
        // We rely on DKIM+SPF+DMARC on welcomebnb.it (already deployed
        // for notifiche@) for authentication; List-Unsubscribe is a
        // bulk-mail requirement for Gmail/Yahoo 2024.
        headers: {
          'List-Unsubscribe': '<mailto:' + INVITE_REPLY_TO + '?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: t };
    }
    const json = await r.json().catch(() => ({}));
    return { ok: true, status: r.status, id: json.id || null };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function _renderInviteEmail(linkEsc) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f3ee;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f3ee;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr><td style="padding:28px 32px 8px;">
          <div style="font-size:14pt;font-weight:700;letter-spacing:-0.01em;">WelcomeBnB</div>
          <div style="font-size:10pt;color:#6b7280;">Host console · access invitation</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <h2 style="margin:0 0 8px;font-size:16pt;">Benvenuto in WelcomeBnB</h2>
          <p style="margin:0 0 10px;line-height:1.55;">Qualcuno ti ha invitato a usare la console host di WelcomeBnB. Clicca sul pulsante qui sotto per impostare la tua password e accedere.</p>
          <p style="margin:0 0 12px;color:#4b5563;font-size:0.92rem;line-height:1.55;">Questo link scade dopo l'uso o dopo il periodo di validità impostato da Supabase. Se non lo usi oggi, chiedici un nuovo invito.</p>
          <p style="margin:16px 0;"><a href="${linkEsc}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:0.95rem;">Imposta la password e accedi →</a></p>
          <hr style="border:0;border-top:1px solid #e5e7eb;margin:22px 0;">
          <h2 style="margin:0 0 8px;font-size:16pt;">Welcome to WelcomeBnB</h2>
          <p style="margin:0 0 10px;line-height:1.55;">Someone invited you to use the WelcomeBnB host console. Click the button below to set your password and sign in.</p>
          <p style="margin:0 0 12px;color:#4b5563;font-size:0.92rem;line-height:1.55;">This link expires after it is used or after the window set in Supabase. If you don't use it today, ask us for a fresh invite.</p>
          <p style="margin:16px 0;"><a href="${linkEsc}" style="display:inline-block;background:#111827;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:0.95rem;">Set your password and sign in →</a></p>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;color:#6b7280;font-size:0.78rem;line-height:1.5;">
          <p style="margin:0 0 6px;">Se il pulsante non funziona, apri questo link nel browser:<br><span style="word-break:break-all;color:#1f2937;">${linkEsc}</span></p>
          <p style="margin:10px 0 0;">If the button does not work, open this link in your browser:<br><span style="word-break:break-all;color:#1f2937;">${linkEsc}</span></p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function _escAttr(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
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
