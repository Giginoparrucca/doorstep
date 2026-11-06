// 6 Nov 2026 — the AI reply is saved by the server (host sees it even when
// the guest leaves mid-answer), the guest app saves only when the server
// could not, and inserts retry once on a dropped connection.
// Actual api/chat.js handler with fictional transport only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.GUEST_TOKEN_SECRET = 'fictional-chat-save-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const { signGuestToken } = await import('../api/_guest-token.js');
const { default: handler, insertRowWithRetry } = await import('../api/chat.js');
const pid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', booking = 'SYNTHETIC-SAVE';
const exp = Math.floor(Date.now() / 1000) + 3600;
const tokenFor = t => signGuestToken({ p: pid, b: booking, s: 'fictional-save-session', exp, ...(t ? { t: true } : {}) }).token;
const originalFetch = global.fetch;

async function run(opts = {}) {
  const property = { id: pid, name: 'Fictional rental', city: 'Fictional town', deleted_at: null, entry_checkin_required: true };
  const state = { snapshot_version: 2, property_snapshot: property, current_rows: [], reservation_snapshot: null, room_snapshot: null, room_resolution: 'none',
    booking_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', property_id: pid, booking_code: booking, is_test: false, identity_version: 'v', roster_version: 'r', roster_source: 'host',
    roster_confirmed: true, expected_count: 1, arrival_date: '2099-01-01', departure_date: '2099-01-02', slots: [{ id: 's', ordinal: 1 }], submissions: [], released_manually: false };
  const inserts = []; let usageThrows = opts.usageThrows || 0;
  global.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.includes('api.anthropic.com')) {
      const ev = o => 'data: ' + JSON.stringify(o) + '\n\n';
      return new Response(ev({ type: 'message_start', message: { usage: { input_tokens: 10 } } })
        + ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: '<reply>Prova la **Trattoria** in piazza.[ESCALATE]</reply><followups></followups>' } })
        + ev({ type: 'message_delta', usage: { output_tokens: 7 } }));
    }
    if (url.endsWith('/rest/v1/chat_messages') && init.method === 'POST') { inserts.push({ table: 'chat_messages', row: JSON.parse(init.body) }); return opts.chatSaveFails ? new Response('no', { status: 500 }) : new Response(null, { status: 201 }); }
    if (url.endsWith('/rest/v1/api_usage') && init.method === 'POST') {
      if (usageThrows-- > 0) throw new TypeError('fetch failed: other side closed');
      inserts.push({ table: 'api_usage', row: JSON.parse(init.body) }); return new Response(null, { status: 201 });
    }
    if (url.includes('/properties?')) return Response.json([property]);
    if (url.includes('/rpc/')) return Response.json(state);
    return new Response('[]', { headers: { 'content-range': '0-0/0' } });
  };
  const res = { statusCode: 200, headers: {}, body: null, written: '', writableEnded: false, destroyed: false,
    setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(v) { this.body = v; return this; },
    write(v) { if (this.destroyed) throw new Error('write after the guest left'); this.written += v; if (opts.leaveAfterFirstText && /"type":"text"/.test(v)) this.destroyed = true; },
    end() { if (this.destroyed) throw new Error('end after the guest left'); this.writableEnded = true; } };
  await handler({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer ' + tokenFor(opts.test) },
    body: { stream: true, lang: 'it', messages: [{ role: 'user', content: 'Miglior ristorante vicino?' }] } }, res);
  const done = (res.written.match(/data: (\{"type":"done".*?\})\n\n/) || [])[1];
  return { res, inserts, done: done ? JSON.parse(done) : null };
}

try {
  // The server saves exactly the text the guest saw ([ESCALATE] stripped), then tells the app.
  { const { inserts, done } = await run();
    const bot = inserts.find(i => i.table === 'chat_messages').row;
    assert.deepEqual(bot, { property_id: pid, booking_code: booking, sender: 'bot', message: 'Prova la **Trattoria** in piazza.', is_test: false });
    assert.equal(done.saved, true, 'done event says the reply is saved');
    assert.ok(inserts.some(i => i.table === 'api_usage' && i.row.endpoint === 'chat' && i.row.output_tokens === 7)); }
  // Test sessions stay test rows.
  { const { inserts } = await run({ test: true }); assert.equal(inserts.find(i => i.table === 'chat_messages').row.is_test, true); }
  // Save refused → saved:false, so the guest app saves it as before.
  { const { done } = await run({ chatSaveFails: true }); assert.equal(done.saved, false); }
  // The guest leaves mid-answer: no crash, the reply is still saved.
  { const { inserts, res } = await run({ leaveAfterFirstText: true });
    assert.equal(res.destroyed, true); assert.equal(inserts.filter(i => i.table === 'chat_messages').length, 1, 'saved although the guest left'); }
  // Usage: one dropped connection is retried (it was lost for 3 of 4 web-search answers on 5 Nov).
  { const { inserts } = await run({ usageThrows: 1 }); assert.equal(inserts.filter(i => i.table === 'api_usage').length, 1, 'usage recorded after one retry'); }
  { const { inserts } = await run({ usageThrows: 2 }); assert.equal(inserts.filter(i => i.table === 'api_usage').length, 0, 'gives up after one retry, never breaks the answer'); }
} finally { global.fetch = originalFetch; }

// insertRowWithRetry: HTTP refusals are not retried; network failures once.
{ let calls = 0; assert.equal(await insertRowWithRetry('x', {}, { fetch: async () => { calls++; return new Response('no', { status: 500 }); }, retryDelayMs: 0 }), false); assert.equal(calls, 1); }
{ let calls = 0; assert.equal(await insertRowWithRetry('x', {}, { fetch: async () => { calls++; if (calls === 1) throw new TypeError('fetch failed'); return new Response(null, { status: 201 }); }, retryDelayMs: 0 }), true); assert.equal(calls, 2); }

// Guest app: saves the bot reply only when the server did not.
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(index, /serverSaved = payload\.saved === true;/);
assert.match(index, /if \(!serverSaved\) saveChatMsg\('bot', fullReply\);/);

// Host chat: «no AI reply» note on an unanswered guest message.
{ const html = fs.readFileSync(new URL('../host-console.html', import.meta.url), 'utf8');
  const i = html.indexOf('const _escalatedBefore = i =>'); const j = html.indexOf('container.innerHTML = archivedBanner', i);
  const fnSrc = html.slice(i, j);
  const make = msgs => new Function('selectedMsgs', fnSrc + '; return _noAiReply;')(msgs);
  const old = new Date(Date.now() - 10 * 60000).toISOString(), fresh = new Date().toISOString();
  const g = (t = old) => ({ sender: 'guest', created_at: t, message: 'q' });
  const msgs1 = [g(), { sender: 'system', created_at: old, message: 'Check-in complete: 2 guest(s) registered.' }];
  assert.equal(make(msgs1)(msgs1[0], 0), true, 'the CON-UD97DX case: only a check-in note after the question');
  const msgs2 = [g(), { sender: 'bot', created_at: old, message: 'a' }]; assert.equal(make(msgs2)(msgs2[0], 0), false);
  const msgs3 = [g(fresh)]; assert.equal(make(msgs3)(msgs3[0], 0), false, 'not within 2 minutes');
  const msgs4 = [{ sender: 'system', created_at: old, message: 'Guest requested human assistance — escalating to host.' }, g()]; assert.equal(make(msgs4)(msgs4[1], 1), false, 'escalated: the host answers, not the AI');
  const msgs5 = [g(), g()]; assert.equal(make(msgs5)(msgs5[0], 0), true);
  assert.ok(html.includes("chat_no_ai_reply: 'Nessuna risposta AI registrata"), 'Italian text'); }

console.log('PASS chat server save: AI reply saved by the server with the text the guest saw ([ESCALATE] stripped), booking and test flag; done.saved true/false; saved even when the guest leaves mid-answer (no crash); usage retried once on a dropped connection, never more; guest app saves only when the server could not; host chat marks unanswered guest questions (not when answered, fresh or escalated)');
