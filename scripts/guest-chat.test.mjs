import assert from 'node:assert/strict';
import { fixtureEnvironment, call, json, mockNetwork, filterRows } from './helpers/offline.mjs';

fixtureEnvironment();
const { signGuestToken } = await import('../api/_guest-token.js');
const chat = (await import('../api/chat.js')).default;
const guest = (await import('../api/guest.js')).default;
const token = signGuestToken({ p: 'property-a', s: 'session-a', b: 'BOOK-A' }).token;
const db = [
  { id: 'foreign', property_id: 'property-b', booking_code: 'BOOK-B', sender: 'host', message: 'FOREIGN-SECRET' },
  { id: 'other-booking', property_id: 'property-a', booking_code: 'BOOK-B', sender: 'host', message: 'OTHER-BOOKING' },
  { id: 'hidden', property_id: 'property-a', booking_code: 'BOOK-A', sender: 'host', message: 'DELETED', deleted_at: '2026-01-01' },
  { id: 'test', property_id: 'property-a', booking_code: 'BOOK-A', sender: 'host', message: 'TEST', is_test: true },
  { id: 'owned', property_id: 'property-a', booking_code: 'BOOK-A', sender: 'host', message: 'Owned reply' },
].map(r => ({ is_test: false, deleted_at: null, created_at: '2026-01-01T00:00:00Z', ...r }));
let reply = '<reply>Here is the Wi-Fi information.</reply><followups>Where is check-in?\nHow do I leave?</followups>';
let chatCount = 0, writeCount = 0, searchRejected = false, stream = false;
const net = mockNetwork(({ url, method, body }) => {
  if (url.hostname === 'api.anthropic.com') {
    if (searchRejected && body.tools) return json({ error: 'web_search not enabled' }, 400);
    if (stream) {
      const events = [
        { type: 'message_start', message: { usage: { input_tokens: 7 } } },
        ...['<rep', 'ly>Helpful ', 'answer.</reply><followups>Where next?</followups>'].map(text => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } })),
        { type: 'message_delta', usage: { output_tokens: 11 } },
      ];
      const wire = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('');
      return new Response(new ReadableStream({ start(controller) {
        // Deliberately split transport frames, including JSON and tag boundaries.
        const bytes = new TextEncoder().encode(wire);
        for (let i = 0; i < bytes.length; i += 19) controller.enqueue(bytes.slice(i, i + 19));
        controller.close();
      } }));
    }
    return json({ content: [{ type: 'text', text: reply }], usage: { input_tokens: 7, output_tokens: 11 } });
  }
  if (url.pathname === '/rest/v1/api_usage') {
    if (method === 'POST') return json({});
    if (url.searchParams.get('select') === 'input_tokens,output_tokens') return json([]);
    const count = url.searchParams.get('endpoint') === 'eq.chat_write' ? writeCount : chatCount;
    return json([], 200, { 'content-range': '0-0/' + count });
  }
  if (url.pathname === '/rest/v1/properties') {
    // Notification lookup intentionally has no owner: this suite never sends alerts.
    return json([{ id: 'property-a', name: 'Fictional house', city: 'Roma', ai_monthly_token_cap: 1000 }]);
  }
  if (url.pathname === '/rest/v1/recommendations') return json([{ name: 'Fictional Cafe', address: 'Sample street' }]);
  if (url.pathname === '/rest/v1/chat_messages') {
    if (method === 'POST') {
      const row = { id: 'insert-' + db.length, created_at: '2026-01-02T00:00:00Z', deleted_at: null, ...body };
      db.push(row); return json([row]);
    }
    return json(filterRows(db, url.searchParams));
  }
});
const ask = (extra = {}) => call(chat, { messages: [{ role: 'user', content: 'Where is Wi-Fi?' }], ...extra }, { token });
const gateway = body => call(guest, body, { token });
try {
  assert.equal((await call(chat, { messages: [] })).code, 401);
  assert.equal((await ask({ messages: null })).code, 400);
  assert.equal((await ask({ messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })) })).code, 413);
  assert.equal((await ask({ propertyContext: 'x'.repeat(262145) })).code, 413);
  assert.equal(net.calls.length, 0);
  const normal = await ask({ property_id: 'property-b', session_id: 'session-b' });
  assert.equal(normal.code, 200); assert.equal(normal.body.escalated, false);
  assert.equal(normal.body.reply, 'Here is the Wi-Fi information.');
  assert.deepEqual(normal.body.followups, ['Where is check-in?', 'How do I leave?']);
  const aiRequest = net.calls.find(c => c.url.hostname === 'api.anthropic.com').body;
  assert.match(aiRequest.system[1].text, /Fictional Cafe/);
  assert.ok(net.calls.filter(c => c.url.pathname.endsWith('/recommendations')).every(c => c.url.searchParams.get('property_id') === 'eq.property-a'));
  const usage = net.calls.find(c => c.url.pathname.endsWith('/api_usage') && c.method === 'POST').body;
  assert.deepEqual(usage, { property_id: 'property-a', session_id: 'session-a', endpoint: 'chat', input_tokens: 7, output_tokens: 11 });

  reply = '<reply>[ESCALATE] Connecting you with the host.</reply><followups></followups>';
  const escalation = await ask(); assert.equal(escalation.body.escalated, true);
  assert.ok(!escalation.body.reply.includes('[ESCALATE]'));
  reply = '<reply>Helpful answer.</reply><followups></followups>';
  searchRejected = true;
  assert.equal((await ask()).code, 200);
  const retry = net.calls.filter(c => c.url.hostname === 'api.anthropic.com').at(-1).body;
  assert.equal(retry.tools, undefined); assert.match(retry.system[1].text, /LIVE SEARCH UNAVAILABLE/);
  searchRejected = false; stream = true;
  const streamed = await ask({ stream: true });
  const events = streamed.chunks.join('').trim().split('\n\n').map(s => JSON.parse(s.slice(6)));
  assert.equal(events.filter(e => e.type === 'text').map(e => e.text).join(''), 'Helpful answer.');
  assert.equal(events.at(-1).type, 'done'); assert.equal(events.at(-1).escalated, false);
  assert.deepEqual(events.at(-1).followups, ['Where next?']); stream = false;
  chatCount = 300;
  const before = net.calls.filter(c => c.url.hostname === 'api.anthropic.com').length;
  const degraded = await ask({ lang: 'it' });
  assert.equal(degraded.code, 200); assert.equal(degraded.body.escalated, true);
  assert.equal(net.calls.filter(c => c.url.hostname === 'api.anthropic.com').length, before);
  chatCount = 0;

  const stored = await gateway({ action: 'send', sender: 'guest', message: 'Fictional message', property_id: 'property-b', booking_code: 'BOOK-B', is_test: true });
  assert.equal(stored.code, 200);
  assert.deepEqual(db.at(-1), { id: stored.body.id, created_at: '2026-01-02T00:00:00Z', deleted_at: null,
    property_id: 'property-a', booking_code: 'BOOK-A', sender: 'guest', message: 'Fictional message', is_test: false });
  for (const body of [{ sender: 'host', message: 'forged' }, { message: '' }, { message: 'x'.repeat(4001) }]) {
    assert.ok([400, 413].includes((await gateway({ action: 'send', ...body })).code));
  }
  for (const marker of ['Conversation escalated', 'Conversation resolved — returned to AI']) {
    assert.equal((await gateway({ action: 'send', sender: 'system', message: marker })).code, 200);
  }
  const history = await gateway({ action: 'history', property_id: 'property-b', booking_code: 'BOOK-B' });
  assert.equal(history.code, 200); assert.equal(history.body.messages.length, 4);
  assert.ok(history.body.messages.every(r => r.property_id === 'property-a' && r.booking_code === 'BOOK-A'));
  assert.ok(!JSON.stringify(history.body).match(/FOREIGN-SECRET|OTHER-BOOKING|DELETED|"TEST"/));
  const polled = await gateway({ action: 'poll', since: '2026-01-01T12:00:00Z' });
  assert.deepEqual(polled.body.messages.map(r => r.message), ['Conversation escalated', 'Conversation resolved — returned to AI']);
  assert.equal((await gateway({ action: 'poll', since: 'invalid' })).code, 400);
  writeCount = 60;
  const countBefore = db.length;
  assert.equal((await gateway({ action: 'send', message: 'limited' })).code, 429);
  assert.equal(db.length, countBefore);
  console.log('PASS real chat + guest gateway: mocked AI/stream/search fallback/usage, escalation, stored messages, forged identity rejection, history/poll isolation and limits');
} finally { net.restore(); }
