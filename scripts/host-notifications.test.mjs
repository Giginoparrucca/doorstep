import assert from 'node:assert/strict';
import webpush from 'web-push';
import { fixtureEnvironment, json, mockNetwork } from './helpers/offline.mjs';

fixtureEnvironment();
process.env.VAPID_PUBLIC_KEY = 'fixture-public';
process.env.VAPID_PRIVATE_KEY = 'fixture-private';
const originalPush = webpush.sendNotification, originalVapid = webpush.setVapidDetails;
let pushes = [], pushStatus = 0;
const allPushes = [];
webpush.setVapidDetails = () => {};
webpush.sendNotification = async (subscription, payload, options) => {
  pushes.push({ subscription, payload: JSON.parse(payload), options });
  allPushes.push(JSON.parse(payload));
  if (pushStatus) throw Object.assign(Error('Fixture push failure'), { statusCode: pushStatus });
};
const { notifyHostForChatInsert: notify, sendTestNotification, notifyHostAutofileAlert } = await import('../api/_notify-host.js');
const defaults = { notify_scope: 'all', push_enabled: true, telegram_enabled: true,
  telegram_chat_id: 'fixture-chat', email_mode: 'fallback', throttle_minutes: 10, notify_email: 'host@example.invalid' };
let settings, lastSystem, recentAlert, hostReply, telegramStatus, emailStatus;
const reset = () => {
  settings = { ...defaults }; lastSystem = 'Conversation escalated'; recentAlert = false;
  hostReply = false; telegramStatus = 200; emailStatus = 200; pushStatus = 0; pushes = [];
};
reset();
const net = mockNetwork(({ url, method, body }) => {
  if (url.hostname === 'api.telegram.org') return json({}, telegramStatus);
  if (url.hostname === 'api.resend.com') return json({}, emailStatus);
  if (url.pathname.startsWith('/auth/v1/admin/users/')) return json({ email: 'fallback@example.invalid' });
  if (url.pathname === '/rest/v1/properties') return json([{ id: 'property-a', owner_id: 'host-a', name: 'Fictional house', host_language: 'it', reminder_email: 'reminder@example.invalid' }]);
  if (url.pathname === '/rest/v1/host_notification_settings') return json(method === 'GET' ? [settings] : {});
  if (url.pathname === '/rest/v1/notification_log') return json(method === 'GET' ? (recentAlert ? [{ id: 1 }] : []) : {});
  if (url.pathname === '/rest/v1/chat_messages') return json(url.searchParams.get('sender') === 'eq.system'
    ? (lastSystem ? [{ message: lastSystem }] : []) : (hostReply ? [{ id: 'reply' }] : []));
  if (url.pathname === '/rest/v1/push_subscriptions') return json(method === 'GET'
    ? [{ id: 'subscription', endpoint: 'https://push.example.invalid/fixture', p256dh: 'fixture', auth: 'fixture' }] : {});
});
const base = { propertyId: 'property-a', bookingCode: 'BOOK-PRIVATE', sender: 'guest',
  message: 'FICTIONAL-NAME passport FICTIONAL-DOCUMENT private help text', isTest: false };
const outgoing = () => net.calls.filter(c => ['api.telegram.org', 'api.resend.com'].includes(c.url.hostname));
try {
  for (const args of [{ isTest: true }, { sender: 'bot' }, { sender: 'host' },
    { sender: 'system', message: 'Conversation escalated then resolved' }, { sender: 'system', message: 'Other notice' }]) {
    assert.ok((await notify({ ...base, ...args })).skipped);
  }
  assert.equal(net.calls.length, 0);
  settings.notify_scope = 'escalated'; lastSystem = 'Conversation returned to AI';
  assert.match((await notify(base)).skipped, /non-escalated/);
  settings.notify_scope = 'all'; recentAlert = true;
  assert.match((await notify(base)).skipped, /recent alert/);
  recentAlert = false; hostReply = true;
  assert.match((await notify(base)).skipped, /host active/);
  assert.equal(outgoing().length, 0); assert.equal(pushes.length, 0);

  reset();
  const success = await notify(base);
  assert.deepEqual(success.results, [{ channel: 'push', status: 'sent' }, { channel: 'telegram', status: 'sent' }]);
  assert.equal(pushes.length, 1);
  assert.equal(outgoing().filter(c => c.url.hostname === 'api.resend.com').length, 0, 'successful push/TG suppress fallback email');
  assert.match(pushes[0].payload.body, /Fictional house/);
  assert.equal(pushes[0].options.TTL, 3600);
  const tg = outgoing().at(-1).body;
  assert.match(tg.text, /Un ospite ha bisogno di te/);
  // Prose contains no guest identity or message. Existing URL/tag booking-code
  // disclosure is recorded separately in the coverage inventory, not hidden.
  for (const payload of [pushes[0].payload, tg]) {
    assert.ok(!JSON.stringify(payload).match(/FICTIONAL-NAME|FICTIONAL-DOCUMENT|private help text/));
  }

  reset(); pushStatus = 410; telegramStatus = 403;
  const failedChannels = await notify(base);
  assert.deepEqual(failedChannels.results, [{ channel: 'push', status: 'failed' }, { channel: 'telegram', status: 'failed' }, { channel: 'email', status: 'sent' }]);
  assert.ok(net.calls.some(c => c.method === 'DELETE' && c.url.pathname.endsWith('/push_subscriptions')));
  assert.ok(net.calls.some(c => c.method === 'PATCH' && c.body.telegram_enabled === false));
  const email = outgoing().at(-1).body;
  assert.deepEqual(email.to, ['host@example.invalid']);
  assert.ok(!JSON.stringify(email).match(/FICTIONAL-NAME|FICTIONAL-DOCUMENT|private help text/));

  reset(); settings.email_mode = 'always';
  assert.equal((await notify(base)).results.at(-1).channel, 'email');
  reset(); settings.push_enabled = false; settings.telegram_enabled = false; settings.email_mode = 'off';
  assert.deepEqual((await notify(base)).results, []);
  assert.equal(net.calls.at(-1).body.detail, 'no channels enabled');
  reset(); settings.notify_email = ''; recentAlert = true; hostReply = true;
  const bypass = await notify({ ...base, sender: 'system', message: 'Conversation escalated' });
  assert.equal(bypass.ok, true, 'escalation bypasses throttle');
  settings.email_mode = 'always'; settings.notify_email = 'owner@example.invalid';
  const test = await sendTestNotification('host-a'); assert.equal(test.ok, true);
  assert.match(outgoing().filter(c => c.url.hostname === 'api.resend.com').at(-1).body.subject, /prova/);
  settings.email_mode = 'fallback';
  const auto = await notifyHostAutofileAlert({ propertyId: 'property-a', hostId: 'host-a', kind: 'overdue',
    text: { title: 'Filing reminder', body: '2 guests need filing', button: 'Open' } });
  assert.equal(auto.results.at(-1).channel, 'email', 'autofile forces fallback email even after successful push');
  // The round's privacy contract includes routing metadata, not just prose.
  // Keep this gate red until the existing booking-code disclosure is fixed
  // or the user explicitly revises the requirement; never hide it as a skip.
  for (const payload of [...allPushes, ...outgoing().map(c => c.body)]) {
    assert.ok(!JSON.stringify(payload).includes(base.bookingCode),
      'Notification privacy: external payload must not contain the guest booking code (including URL/tag metadata)');
  }
  console.log('PASS real notifier: triggers/de-escalation/test skip, scope/throttle/host reply, push/TG/email precedence, dead subscription cleanup, test/autofile alerts and guest-content exclusion');
} finally {
  webpush.sendNotification = originalPush; webpush.setVapidDetails = originalVapid;
  net.restore();
}
