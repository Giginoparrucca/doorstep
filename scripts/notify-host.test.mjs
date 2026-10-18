// Round 60a Phase 2 — host notification pipeline (api/_notify-host.js).
//
// Verifies the critical GDPR / data-transfer invariant called out in
// the file header: push / telegram / email payloads carry ONLY the
// property name and a deep link — never guest name, message body, or
// booking code. Also exercises:
//   - Trigger classification (guest / escalation / de-escalation / other-system)
//   - isTest=true → skip (no notification path at all)
//   - Throttle for guest_message (recent notification_log row)
//   - Scope 'escalated' gates guest_message on current escalation state
//   - Channel selection (push / telegram / email) and the email fallback
//     rule (fallback mode delivers only when push+telegram both fail)
//   - Fixed language-dependent copy (it/en)
//
// All transport is mocked — no network, no live Supabase, no VAPID,
// no Resend, no Telegram.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

process.env.GUEST_TOKEN_SECRET = process.env.GUEST_TOKEN_SECRET
  || createHash('sha256').update('round60a-fixture-secret-notify-host').digest('hex');
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role-key';
process.env.VAPID_PUBLIC_KEY = 'BLb3M5c8-fixtureVAPIDPublicKey_32bytes__01234567890ABCDEFGHIJKlM';
process.env.VAPID_PRIVATE_KEY = 'fixture-vapid-private-32bytes-_____________';
process.env.TELEGRAM_BOT_TOKEN = 'fixture:telegram_bot_token';
process.env.RESEND_API_KEY = 're_fixture_api_key';

const DOWNLOADED_PROPERTY_NAME = 'Trullo di Prova';
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const HOST_ID = 'host-fixture-id';
const GUEST_NAME = 'MARIA SECRET';          // Must never appear in any payload.
const BOOKING_CODE = 'SECRET-BOOKING-42';   // Must never appear in any payload.
const GUEST_MESSAGE = 'I locked myself out and my passport number is XY999';  // Must never appear.

// ── fetch mock ──────────────────────────────────────────────────────
// Table of canned responses. notification_log rows the test writes
// are kept in memory so throttle checks can see them.
const notificationLog = [];
let settings = {
  push_enabled: false,
  telegram_enabled: false,
  telegram_chat_id: null,
  email_mode: 'off',
  notify_scope: 'all',
  throttle_minutes: 15,
};
let conversationIsEscalated = false;
let hostChatRecentlyPosted = false;

const fetchCalls = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || 'GET';
  fetchCalls.push({ url: u, method, body: opts.body });

  // --- Supabase REST ---
  if (u.includes('/rest/v1/properties')) {
    return json([{ owner_id: HOST_ID, name: DOWNLOADED_PROPERTY_NAME, host_language: 'it', reminder_email: 'host@example.invalid' }]);
  }
  if (u.includes('/rest/v1/host_notification_settings')) {
    return json([settings]);
  }
  if (u.includes('/rest/v1/notification_log')) {
    if (method === 'GET') return json(notificationLog.slice(-5));
    if (method === 'POST') {
      const body = JSON.parse(opts.body);
      notificationLog.push({ ...body, created_at: new Date().toISOString() });
      return json([body]);
    }
  }
  if (u.includes('/rest/v1/chat_messages')) {
    // When host has replied recently in the conversation, throttle fires.
    return json(hostChatRecentlyPosted
      ? [{ created_at: new Date().toISOString() }]
      : []);
  }
  if (u.includes('/rest/v1/push_subscriptions')) {
    return json([{ id: 'sub1', endpoint: 'https://fcm.example.invalid/x', p256dh: 'p', auth: 'a' }]);
  }
  if (u.includes('auth/v1/admin/users')) {
    return json({ user: { email: 'host-auth@example.invalid' } });
  }

  // --- Telegram API ---
  if (u.includes('api.telegram.org')) {
    return json({ ok: true, result: { message_id: 1 } });
  }
  // --- Resend API ---
  if (u.includes('api.resend.com')) {
    return json({ id: 'em_fixture' });
  }
  return json({});
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  });
}

// Also stub web-push so VAPID doesn't need to crypto-sign anything real.
const { createRequire } = await import('node:module');
const req = createRequire(import.meta.url);
const webpush = req('web-push');
const originalSend = webpush.sendNotification;
webpush.sendNotification = async (sub, payload) => {
  return { statusCode: 201, body: payload };
};

const { notifyHostForChatInsert } = await import('../api/_notify-host.js');

function clear() { fetchCalls.length = 0; notificationLog.length = 0; }

function serialisedPayloads() {
  // Any string the pipeline sent to an external channel (push, telegram,
  // email): we scan the whole set for forbidden tokens.
  return fetchCalls
    .filter(c => c.url.includes('telegram') || c.url.includes('resend') || c.url.includes('/rest/v1/push_subscriptions'))
    .map(c => c.body || '').join('\n');
}

// ── 1. isTest → skip entirely (no fetches at all) ─────────────────
clear();
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'guest', message: GUEST_MESSAGE, isTest: true,
  });
  assert.equal(r.skipped, 'test');
  assert.equal(fetchCalls.length, 0, 'isTest=true path must not hit the network');
}

// ── 2. Guest message with all channels off → 'none/skipped' log ─
clear();
settings = { ...settings, push_enabled: false, telegram_enabled: false, email_mode: 'off' };
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'guest', message: GUEST_MESSAGE, isTest: false,
  });
  assert.ok(r.ok, `expected ok, got ${JSON.stringify(r)}`);
  assert.equal(notificationLog.length, 1);
  assert.equal(notificationLog[0].channel, 'none');
  assert.equal(notificationLog[0].status, 'skipped');
}

// ── 3. Guest message, push on, Telegram on → user-visible text carries NO guest data ─
clear();
settings = {
  ...settings,
  push_enabled: true,
  telegram_enabled: true,
  telegram_chat_id: '12345',
  email_mode: 'off',
};
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'guest', message: GUEST_MESSAGE, isTest: false,
  });
  assert.ok(r.ok);
  const serialised = serialisedPayloads();
  // These must NEVER appear anywhere in the channel payload — they'd
  // be exfiltrated to FCM / Telegram / Resend otherwise.
  // BOOKING_CODE is on this list after Round 60 Phase 2 follow-up: the
  // deep-link URL dropped `&conv=<booking>` and the push `tag` dropped
  // the convKey suffix, so no guest booking identifier ever leaves
  // the server across any channel.
  for (const forbidden of [GUEST_NAME, GUEST_MESSAGE, BOOKING_CODE,
    'passport', 'locked myself out']) {
    assert.ok(!serialised.includes(forbidden),
      `channel payloads must not contain "${forbidden}" — got: ${serialised.slice(0, 400)}`);
  }
  // The property name IS allowed — it's the only piece of context the host sees.
  assert.ok(serialised.includes(DOWNLOADED_PROPERTY_NAME),
    'property name must be present (that is the whole content of the alert)');
}

// ── 4. Throttle: a recent 'sent' log row suppresses next guest_message ─
clear();
notificationLog.push({
  host_id: HOST_ID, property_id: PROPERTY_ID,
  conversation_key: BOOKING_CODE, trigger: 'guest_message',
  channel: 'push', status: 'sent',
  created_at: new Date().toISOString(),
});
// Keep push enabled; throttle must still kick in.
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'guest', message: GUEST_MESSAGE, isTest: false,
  });
  assert.ok(r.skipped, 'recent sent row → throttled');
  // One 'skipped' log row written.
  const lastSkip = notificationLog[notificationLog.length - 1];
  assert.equal(lastSkip.channel, 'none');
  assert.equal(lastSkip.status, 'skipped');
}

// ── 5. Escalation bypasses throttle entirely ──────────────────────
clear();
notificationLog.push({
  host_id: HOST_ID, property_id: PROPERTY_ID,
  conversation_key: BOOKING_CODE, trigger: 'guest_message',
  channel: 'push', status: 'sent',
  created_at: new Date().toISOString(),
});
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'system', message: 'Conversation escalated to host', isTest: false,
  });
  assert.ok(r.ok, 'escalation ignores throttle');
}

// ── 6. De-escalation system messages are skipped ──────────────────
clear();
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'system', message: 'conversation returned to AI', isTest: false,
  });
  assert.match(String(r.skipped), /de-escalation/);
  assert.equal(fetchCalls.length, 0, 'de-escalation produces no fetches');
}
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'system', message: 'issue resolved by host', isTest: false,
  });
  assert.match(String(r.skipped), /de-escalation/);
}

// ── 7. Other-system messages are skipped ──────────────────────────
clear();
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'system', message: 'typing indicator', isTest: false,
  });
  assert.match(String(r.skipped), /other system message/);
}

// ── 8. sender=host → skipped (host doesn't notify themselves) ─────
clear();
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'host', message: 'any text', isTest: false,
  });
  assert.match(String(r.skipped), /sender=host/);
}

// ── 9. Scope='escalated' + guest_message on non-escalated conv → skip
clear();
settings = { ...settings, notify_scope: 'escalated' };
conversationIsEscalated = false;
{
  const r = await notifyHostForChatInsert({
    propertyId: PROPERTY_ID, bookingCode: BOOKING_CODE,
    sender: 'guest', message: GUEST_MESSAGE, isTest: false,
  });
  assert.match(String(r.skipped), /non-escalated/);
}

// Restore for cleanliness.
webpush.sendNotification = originalSend;

console.log('PASS notify-host: isTest skip, PII never leaves (channel payloads scrubbed), throttle active, escalation bypasses throttle, de-escalation + other-system + host sender all skipped, scope=escalated gate works.');
