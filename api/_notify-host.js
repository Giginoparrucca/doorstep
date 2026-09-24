// api/_notify-host.js — Round 42 shared host-notification pipeline.
//
// Called from api/guest-chat.js on every successful chat_messages insert.
// Never throws to the caller — every error is caught and logged.
//
// **Alert content is fixed and contains no guest data.** Never include the
// message body, guest name, or booking code inside the push / telegram /
// email payload. Only the property name and a deep link. This is a
// GDPR / data-transfer decision — push services and Telegram must never
// carry guest content.
//
// Trigger rules (see README section "Round 42" for the plan spec):
//   isTest === true                               → skip
//   sender === 'system' AND message /escalat/i    → escalation, bypass throttle
//     unless message /resolved|returned to AI/i   → still skip (de-escalation)
//   sender === 'guest'                            → guest_message, throttled
//     scope 'escalated'  → only when conversation is currently escalated
//     scope 'all'        → always
//   anything else                                 → skip
//
// Throttle for guest_message:
//   Skip if there is a `sent` row in notification_log for the same
//   property+conversation within throttle_minutes, OR if the host posted
//   a `host` chat_messages row in the conversation within throttle_minutes
//   (they're actively replying — don't buzz them again).
//
// Channels run under Promise.allSettled with a ~4s overall cap.

import webpush from 'web-push';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const APP_BASE_URL       = process.env.APP_BASE_URL || 'https://welcomebnb.vercel.app';
const VAPID_PUBLIC       = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE      = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT      = process.env.VAPID_SUBJECT || 'mailto:welcomebnbadmin@gmail.com';
const TELEGRAM_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const RESEND_KEY         = process.env.RESEND_API_KEY;
const REMINDER_FROM      = process.env.REMINDER_FROM || 'WelcomeBnB <onboarding@resend.dev>';

const OVERALL_CAP_MS = 4000;

// One-time VAPID setup. Safe to call multiple times — web-push stores globally.
let _vapidReady = false;
function _ensureVapid() {
  if (_vapidReady) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    _vapidReady = true;
    return true;
  } catch (e) {
    console.warn('[notify] VAPID setVapidDetails failed:', e && e.message || e);
    return false;
  }
}

// ── Public: called from api/guest-chat.js after a successful insert ──
export async function notifyHostForChatInsert({ propertyId, bookingCode, sender, message, isTest }) {
  try {
    if (isTest === true) return { skipped: 'test' };
    if (!propertyId || !sender) return { skipped: 'missing args' };

    const senderLc  = String(sender || '').toLowerCase();
    const messageLc = String(message || '').toLowerCase();

    // Classify the trigger.
    let trigger = null;
    if (senderLc === 'system') {
      // De-escalation clues wins over the /escalat/ match; keep in sync with
      // host-console loadHostChat which looks for 'resolved' / 'returned to AI'.
      if (/resolved|returned to ai/i.test(message || '')) return { skipped: 'de-escalation system message' };
      if (/escalat/i.test(message || '')) trigger = 'escalation';
      else return { skipped: 'other system message' };
    } else if (senderLc === 'guest') {
      trigger = 'guest_message';
    } else {
      return { skipped: 'sender=' + senderLc };
    }

    // Look up owner + property basics.
    const propRow = await pgrestGET(
      `properties?id=eq.${encodeURIComponent(propertyId)}&select=owner_id,name,host_language,reminder_email&limit=1`,
    );
    const prop = Array.isArray(propRow) ? propRow[0] : null;
    if (!prop || !prop.owner_id) return { skipped: 'no owner' };

    const hostId       = prop.owner_id;
    const propertyName = prop.name || 'WelcomeBnB';
    const hostLang     = (prop.host_language || 'en').toLowerCase() === 'it' ? 'it' : 'en';
    const convKey      = _convKey(bookingCode);

    // Load settings (or defaults) and, when scope='escalated', the current
    // escalation state of the conversation.
    const settings = await _loadSettings(hostId);
    if (trigger === 'guest_message' && settings.notify_scope === 'escalated') {
      const escalated = await _conversationIsEscalated(propertyId, bookingCode);
      if (!escalated) return { skipped: 'guest_message on non-escalated conv' };
    }

    // Throttle guest_message only. Escalation always fires.
    if (trigger === 'guest_message') {
      const throttled = await _isThrottled({
        hostId, propertyId, convKey, minutes: settings.throttle_minutes,
      });
      if (throttled.reason) {
        await _logRow({ hostId, propertyId, convKey, trigger, channel: 'none', status: 'skipped', detail: throttled.reason });
        return { skipped: throttled.reason };
      }
    }

    // Resolve fallback email address once.
    const emailAddr = await _resolveHostEmail(hostId, settings, prop.reminder_email);

    // Build the fixed payload (no guest data).
    const url = `${APP_BASE_URL}/host-console.html?notify_prop=${encodeURIComponent(propertyId)}&open=chat&conv=${encodeURIComponent(convKey)}`;
    const text = _fixedText(hostLang, propertyName);
    // Same tag across all three channels of the same conversation so the
    // OS collapses re-deliveries.
    const tag = `wbnb-chat-${propertyId}-${convKey}`;

    // Fire enabled channels under an overall cap.
    const results = await _fireChannels({
      settings, hostId, propertyId, convKey, trigger,
      text, url, tag, emailAddr,
    });

    // If nothing was even attempted (all channels off), log a 'none/skipped'.
    if (results.length === 0) {
      await _logRow({ hostId, propertyId, convKey, trigger, channel: 'none', status: 'skipped', detail: 'no channels enabled' });
    }
    return { ok: true, results };
  } catch (e) {
    console.warn('[notify] outer failure:', e && e.message || e);
    return { skipped: 'exception' };
  }
}

// ── Public: called by api/notify-test.js. Bypasses throttle. ─────────
export async function sendTestNotification(hostId) {
  try {
    // Any property the host owns → use its language + name for the payload.
    // If they own none, the test still fires but says "WelcomeBnB".
    const prop = await pgrestGET(
      `properties?owner_id=eq.${encodeURIComponent(hostId)}&is.deleted_at=null&select=id,name,host_language,reminder_email&limit=1`,
    );
    const p = Array.isArray(prop) ? prop[0] : null;
    const propertyId   = p?.id || null;
    const propertyName = p?.name || 'WelcomeBnB';
    const hostLang     = (p?.host_language || 'en').toLowerCase() === 'it' ? 'it' : 'en';
    const settings = await _loadSettings(hostId);
    const emailAddr = await _resolveHostEmail(hostId, settings, p?.reminder_email);

    const url = propertyId
      ? `${APP_BASE_URL}/host-console.html?notify_prop=${encodeURIComponent(propertyId)}&open=chat&conv=_no_code`
      : `${APP_BASE_URL}/host-console.html`;
    const text = _fixedTestText(hostLang, propertyName);
    const tag  = `wbnb-test-${hostId}`;

    const results = await _fireChannels({
      settings, hostId, propertyId, convKey: '_no_code', trigger: 'test',
      text, url, tag, emailAddr,
      // Test bypasses the fallback rule: send email whenever email_mode != 'off'.
      forceEmail: settings.email_mode !== 'off',
    });
    return { ok: true, results };
  } catch (e) {
    console.warn('[notify-test] failure:', e && e.message || e);
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Channel dispatch
// ═════════════════════════════════════════════════════════════════════
async function _fireChannels({ settings, hostId, propertyId, convKey, trigger, text, url, tag, emailAddr, forceEmail }) {
  const results = [];

  const pushEnabled = settings.push_enabled === true;
  const tgEnabled   = settings.telegram_enabled === true && !!settings.telegram_chat_id;
  const wantEmail   = forceEmail
    ? settings.email_mode !== 'off'
    : settings.email_mode === 'always'; // fallback resolved below after push/tg run

  const pushP = pushEnabled ? _sendPush({ hostId, text, url, tag })       : Promise.resolve({ skipped: true });
  const tgP   = tgEnabled   ? _sendTelegram({ chatId: settings.telegram_chat_id, text, url }) : Promise.resolve({ skipped: true });
  const [pushRes, tgRes] = await _cap([pushP, tgP], OVERALL_CAP_MS);

  const pushDelivered = pushRes.status === 'fulfilled' && pushRes.value?.sent > 0;
  const tgDelivered   = tgRes.status === 'fulfilled'   && tgRes.value?.ok === true;

  if (pushEnabled) {
    const s = pushDelivered ? 'sent' : (pushRes.status === 'fulfilled' && pushRes.value?.skipped ? 'skipped' : 'failed');
    const detail = pushRes.status === 'fulfilled'
      ? JSON.stringify(pushRes.value)
      : (pushRes.reason && String(pushRes.reason.message || pushRes.reason)) || 'unknown';
    results.push({ channel: 'push', status: s });
    await _logRow({ hostId, propertyId, convKey, trigger, channel: 'push', status: s, detail });
  }
  if (tgEnabled) {
    const s = tgDelivered ? 'sent' : (tgRes.status === 'fulfilled' && tgRes.value?.skipped ? 'skipped' : 'failed');
    const detail = tgRes.status === 'fulfilled'
      ? JSON.stringify(tgRes.value)
      : (tgRes.reason && String(tgRes.reason.message || tgRes.reason)) || 'unknown';
    results.push({ channel: 'telegram', status: s });
    await _logRow({ hostId, propertyId, convKey, trigger, channel: 'telegram', status: s, detail });
  }

  // Email fallback rule: send if email_mode='always', OR if 'fallback' AND
  // neither push nor telegram delivered. Test flow uses forceEmail.
  const emailFallback = settings.email_mode === 'fallback' && !pushDelivered && !tgDelivered;
  const shouldEmail = forceEmail
    ? settings.email_mode !== 'off'
    : (settings.email_mode === 'always' || emailFallback);

  if (shouldEmail) {
    if (!emailAddr) {
      results.push({ channel: 'email', status: 'failed' });
      await _logRow({ hostId, propertyId, convKey, trigger, channel: 'email', status: 'failed', detail: 'no address' });
    } else {
      const emRes = await _cap1(_sendEmail({ to: emailAddr, text, url }), OVERALL_CAP_MS);
      const ok = emRes.status === 'fulfilled' && emRes.value?.ok === true;
      const s  = ok ? 'sent' : 'failed';
      const detail = emRes.status === 'fulfilled'
        ? JSON.stringify(emRes.value)
        : (emRes.reason && String(emRes.reason.message || emRes.reason)) || 'unknown';
      results.push({ channel: 'email', status: s });
      await _logRow({ hostId, propertyId, convKey, trigger, channel: 'email', status: s, detail });
    }
  }

  return results;
}

// ── Push ───────────────────────────────────────────────────────────────
async function _sendPush({ hostId, text, url, tag }) {
  if (!_ensureVapid()) return { sent: 0, skipped: true, reason: 'no vapid' };
  const subs = await pgrestGET(
    `push_subscriptions?host_id=eq.${encodeURIComponent(hostId)}&select=id,endpoint,p256dh,auth&limit=50`,
  );
  if (!Array.isArray(subs) || subs.length === 0) return { sent: 0, skipped: true, reason: 'no subs' };

  const payload = JSON.stringify({
    title: text.title,
    body:  text.body,
    url,
    tag,
  });
  let sent = 0;
  const results = await Promise.allSettled(subs.map(async s => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 3600, urgency: 'high' },
      );
      sent++;
      await pgrestPATCH(
        `push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
        { last_success_at: new Date().toISOString(), failure_count: 0 },
      );
      return { ok: true, id: s.id };
    } catch (e) {
      const status = e?.statusCode || 0;
      if (status === 404 || status === 410) {
        // Subscription is dead; drop it.
        await pgrestDELETE(`push_subscriptions?id=eq.${encodeURIComponent(s.id)}`);
        return { ok: false, id: s.id, dropped: true, status };
      }
      await pgrestPATCH(
        `push_subscriptions?id=eq.${encodeURIComponent(s.id)}`,
        { failure_count: (s.failure_count || 0) + 1 },
      );
      return { ok: false, id: s.id, status, error: String(e?.body || e?.message || e) };
    }
  }));
  return { sent, tried: subs.length, results: results.map(r => r.status === 'fulfilled' ? r.value : { ok: false, error: String(r.reason) }) };
}

// ── Telegram ───────────────────────────────────────────────────────────
async function _sendTelegram({ chatId, text, url }) {
  if (!TELEGRAM_TOKEN) return { ok: false, skipped: true, reason: 'no bot token' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${text.title}\n${text.body}`,
        reply_markup: {
          inline_keyboard: [[{ text: text.button, url }]],
        },
        disable_web_page_preview: true,
      }),
    });
    if (r.status === 403) {
      // Bot blocked. Disable telegram for the host (best-effort).
      await pgrestPATCH(
        `host_notification_settings?telegram_chat_id=eq.${encodeURIComponent(chatId)}`,
        { telegram_enabled: false, updated_at: new Date().toISOString() },
      );
      return { ok: false, status: 403, dropped: true };
    }
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: t };
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ── Email ──────────────────────────────────────────────────────────────
async function _sendEmail({ to, text, url }) {
  if (!RESEND_KEY) return { ok: false, skipped: true, reason: 'no resend key' };
  const subject = text.title;
  const html = `<!doctype html><html><body style="font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#061A3D;background:#F7F9FC;margin:0;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid rgba(0,91,255,0.12);border-radius:14px;padding:26px 28px;">
      <div style="font-size:1.2rem;font-weight:600;margin-bottom:6px;">${_esc(text.title)}</div>
      <div style="font-size:0.92rem;color:#6B7A90;line-height:1.55;margin-bottom:18px;">${_esc(text.body)}</div>
      <a href="${_escAttr(url)}" style="display:inline-block;background:#005BFF;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:0.9rem;">${_esc(text.button)}</a>
    </div>
  </body></html>`;
  const plain = `${text.title}\n${text.body}\n\n${text.button}: ${url}`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: REMINDER_FROM, to: [to], subject, html, text: plain }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { ok: false, status: r.status, error: t };
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════
function _convKey(bookingCode) {
  return bookingCode && String(bookingCode).trim() ? String(bookingCode).trim() : '_no_code';
}

async function _loadSettings(hostId) {
  const rows = await pgrestGET(
    `host_notification_settings?host_id=eq.${encodeURIComponent(hostId)}&select=notify_scope,push_enabled,telegram_chat_id,telegram_enabled,email_mode,notify_email,throttle_minutes&limit=1`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (row) return row;
  // Defaults — do not insert; the host may never open the Avvisi card.
  return {
    notify_scope: 'escalated',
    push_enabled: true,
    telegram_chat_id: null,
    telegram_enabled: false,
    email_mode: 'fallback',
    notify_email: null,
    throttle_minutes: 10,
  };
}

// Latest non-deleted, non-test system message in the conversation decides.
// Same rule the host console applies in loadHostChat.
async function _conversationIsEscalated(propertyId, bookingCode) {
  const filters = [
    `property_id=eq.${encodeURIComponent(propertyId)}`,
    `sender=eq.system`,
    `is_test=is.false`,
    `deleted_at=is.null`,
  ];
  if (bookingCode && String(bookingCode).trim()) {
    filters.push(`booking_code=eq.${encodeURIComponent(bookingCode)}`);
  } else {
    filters.push(`booking_code=is.null`);
  }
  const path = `chat_messages?${filters.join('&')}&select=message&order=created_at.desc&limit=1`;
  const rows = await pgrestGET(path);
  const last = Array.isArray(rows) && rows[0] ? String(rows[0].message || '') : '';
  if (!last) return false;
  if (/resolved|returned to ai/i.test(last)) return false;
  return /escalat/i.test(last);
}

async function _isThrottled({ hostId, propertyId, convKey, minutes }) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  // Recent 'sent' notification for this conversation?
  const rows = await pgrestGET(
    `notification_log?property_id=eq.${encodeURIComponent(propertyId)}&conversation_key=eq.${encodeURIComponent(convKey)}&status=eq.sent&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
  );
  if (Array.isArray(rows) && rows.length > 0) return { reason: 'throttle: recent alert sent' };
  // Recent host reply?
  const filters = [
    `property_id=eq.${encodeURIComponent(propertyId)}`,
    `sender=eq.host`,
    `is_test=is.false`,
    `deleted_at=is.null`,
    `created_at=gte.${encodeURIComponent(since)}`,
  ];
  if (convKey !== '_no_code') filters.push(`booking_code=eq.${encodeURIComponent(convKey)}`);
  else                        filters.push(`booking_code=is.null`);
  const hRows = await pgrestGET(`chat_messages?${filters.join('&')}&select=id&limit=1`);
  if (Array.isArray(hRows) && hRows.length > 0) return { reason: 'throttle: host active' };
  return { reason: null };
}

async function _resolveHostEmail(hostId, settings, propertyReminderEmail) {
  const explicit = (settings.notify_email || '').trim();
  if (explicit) return explicit;
  if (propertyReminderEmail && String(propertyReminderEmail).trim()) return String(propertyReminderEmail).trim();
  // Fall back to the auth user's email — service_role can read /auth/v1/admin/users.
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(hostId)}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!r.ok) return '';
    const u = await r.json();
    return (u?.email || '').trim();
  } catch (_) { return ''; }
}

async function _logRow({ hostId, propertyId, convKey, trigger, channel, status, detail }) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/notification_log`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        host_id: hostId,
        property_id: propertyId,
        conversation_key: convKey,
        trigger,
        channel,
        status,
        detail: detail ? String(detail).slice(0, 800) : null,
      }),
    });
  } catch (e) { console.warn('[notify] log failed:', e && e.message || e); }
}

// ── Timeout wrappers ───────────────────────────────────────────────────
function _cap(promises, ms) {
  return Promise.race([
    Promise.allSettled(promises),
    new Promise(resolve => setTimeout(
      () => resolve(promises.map(() => ({ status: 'rejected', reason: new Error('timeout') }))),
      ms,
    )),
  ]);
}
function _cap1(promise, ms) {
  return Promise.race([
    Promise.allSettled([promise]).then(a => a[0]),
    new Promise(resolve => setTimeout(
      () => resolve({ status: 'rejected', reason: new Error('timeout') }),
      ms,
    )),
  ]);
}

// ── Text (localised, no guest data) ────────────────────────────────────
function _fixedText(lang, propertyName) {
  if (lang === 'it') {
    return {
      title: `💬 Un ospite ha bisogno di te`,
      body:  `${propertyName} · apri la console per rispondere`,
      button: 'Apri la Chat',
    };
  }
  return {
    title: `💬 A guest needs you`,
    body:  `${propertyName} · open the console to reply`,
    button: 'Open Chat',
  };
}
function _fixedTestText(lang, propertyName) {
  if (lang === 'it') {
    return {
      title: `Notifica di prova ✔`,
      body:  `${propertyName} · questa è una notifica di prova`,
      button: 'Apri la Console',
    };
  }
  return {
    title: `Test notification ✔`,
    body:  `${propertyName} · this is a test notification`,
    button: 'Open the Console',
  };
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}
function _escAttr(s) { return _esc(s).replace(/`/g, '&#96;'); }

// ── PostgREST helpers ──────────────────────────────────────────────────
async function pgrestGET(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`pgrestGET ${path} → ${r.status} ${await r.text().catch(() => '')}`);
  return r.json();
}
async function pgrestPATCH(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.warn(`pgrestPATCH ${path} → ${r.status} ${await r.text().catch(() => '')}`);
}
async function pgrestDELETE(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer: 'return=minimal',
    },
  });
  if (!r.ok) console.warn(`pgrestDELETE ${path} → ${r.status} ${await r.text().catch(() => '')}`);
}
