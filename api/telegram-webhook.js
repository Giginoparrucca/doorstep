// api/telegram-webhook.js — Round 42.
//
// Receives Telegram updates. Authenticated by the X-Telegram-Bot-Api-Secret-Token
// header (constant-time compare); returns 200 always after auth so Telegram
// doesn't back off.
//
// Commands:
//   /start <token>  — validate the link token, bind chat_id to host, ack in IT/EN
//   /start          — instructions to link from the host console
//   /stop           — disable telegram for the chat_id owner (if any)
//
// No CORS — Telegram calls this directly.

import crypto from 'crypto';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEGRAM_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET    = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const APP_BASE_URL      = process.env.APP_BASE_URL || 'https://welcomebnb.vercel.app';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const got = req.headers['x-telegram-bot-api-secret-token'] || '';
  if (!WEBHOOK_SECRET || !_constantTimeEq(String(got), WEBHOOK_SECRET)) {
    return res.status(401).end();
  }
  if (!SERVICE_KEY || !TELEGRAM_TOKEN) return res.status(200).end(); // ack

  try {
    const update = req.body || {};
    const msg = update.message;
    if (!msg || !msg.chat || typeof msg.text !== 'string') return res.status(200).end();

    const chatId = msg.chat.id;
    const text = String(msg.text || '').trim();

    if (text === '/stop' || text.startsWith('/stop ')) {
      await _stopForChat(chatId);
      await _reply(chatId, 'Avvisi disattivati. Per riattivare, collega di nuovo Telegram dalla console WelcomeBnB.\n\nAlerts disabled. To re-enable, link Telegram again from your WelcomeBnB console.');
      return res.status(200).end();
    }

    if (text.startsWith('/start')) {
      const token = text.split(/\s+/, 2)[1] || '';
      if (!token) {
        await _reply(chatId, `👋 Ciao! Per ricevere gli avvisi, apri la console: ${APP_BASE_URL}/host-console.html → Avvisi → Collega Telegram.\n\nHi! To receive alerts, open your host console → Alerts → Link Telegram.`);
        return res.status(200).end();
      }
      const bound = await _consumeToken(token, chatId);
      if (bound.ok) {
        await _reply(chatId, '✅ Collegato a WelcomeBnB. Riceverai qui gli avvisi quando un ospite ha bisogno di te.\n\n✅ Linked. You will receive alerts here when a guest needs you.');
      } else {
        await _reply(chatId, `⚠️ Link non valido o scaduto (${bound.reason}). Genera un nuovo link dalla console.\n\n⚠️ Link invalid or expired (${bound.reason}). Please generate a fresh link from the console.`);
      }
      return res.status(200).end();
    }

    // Any other message — quietly acknowledge.
    return res.status(200).end();
  } catch (e) {
    console.warn('[telegram-webhook] error:', e && e.message || e);
    return res.status(200).end();
  }
}

function _constantTimeEq(a, b) {
  const A = Buffer.from(a || '', 'utf8');
  const B = Buffer.from(b || '', 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

async function _consumeToken(token, chatId) {
  const rows = await _get(`telegram_link_tokens?token=eq.${encodeURIComponent(token)}&select=host_id,expires_at,used_at&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return { ok: false, reason: 'unknown token' };
  if (row.used_at) return { ok: false, reason: 'already used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const hostId = row.host_id;
  const nowIso = new Date().toISOString();

  // Upsert settings for the host (bind chat + enable). If the host already
  // has a row, PATCH; otherwise POST with defaults.
  const existing = await _get(`host_notification_settings?host_id=eq.${encodeURIComponent(hostId)}&select=host_id&limit=1`);
  if (Array.isArray(existing) && existing.length > 0) {
    await _patch(`host_notification_settings?host_id=eq.${encodeURIComponent(hostId)}`, {
      telegram_chat_id: chatId,
      telegram_enabled: true,
      updated_at: nowIso,
    });
  } else {
    await _post(`host_notification_settings`, {
      host_id: hostId,
      telegram_chat_id: chatId,
      telegram_enabled: true,
      updated_at: nowIso,
    });
  }
  // Mark the token used.
  await _patch(`telegram_link_tokens?token=eq.${encodeURIComponent(token)}`, { used_at: nowIso });
  return { ok: true };
}

async function _stopForChat(chatId) {
  await _patch(
    `host_notification_settings?telegram_chat_id=eq.${encodeURIComponent(chatId)}`,
    { telegram_enabled: false, telegram_chat_id: null, updated_at: new Date().toISOString() },
  );
}

async function _reply(chatId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch (e) { console.warn('[telegram-webhook] reply failed:', e && e.message || e); }
}

async function _get(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' },
  });
  if (!r.ok) return null;
  return r.json();
}
async function _post(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}
async function _patch(path, body) {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}
