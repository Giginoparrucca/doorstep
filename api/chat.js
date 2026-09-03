// api/chat.js — WelcomeBnB chat endpoint
//
// Round 16: Sonnet 4.5 + streaming + vision + contextual followups.
// Round 33: origin allowlist, guest-token auth, size caps, session/property
// rate limits, per-property monthly budget cap, api_usage recording,
// graceful degrade to escalated=true when limited or over budget.
//
// Request shape (unchanged in terms of `content` fields):
//   { messages, propertyContext, lang, stayContext?, imageData?, stream? }
// Identity now comes from the guest token in Authorization: Bearer <token>,
// NEVER from the body. Body-carried property_id / session_id, if any, are
// ignored — the token payload is authoritative.
//
// Returns (non-streaming): { reply, escalated, followups }
// Returns (streaming):     text/event-stream with chunks of
//   data: {"type":"text","text":"..."}
//   data: {"type":"done","escalated":bool,"followups":[...]}

import { verifyFromAuthHeader } from './_guest-token.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Round 33 hard limits — hit before Anthropic is called.
const MAX_MESSAGES     = 40;
const MAX_BODY_BYTES   = 256 * 1024;
const CHAT_SESSION_HOURLY_LIMIT   = 30;
const CHAT_PROPERTY_DAILY_LIMIT   = 300;

export default async function handler(req, res) {
  // ── Origin / CORS ────────────────────────────────────────────────
  const origin = req.headers['origin'] || req.headers['Origin'] || '';
  const allowed = resolveOrigin(origin);
  if (allowed) res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed) return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // ── Token auth ───────────────────────────────────────────────────
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const v = verifyFromAuthHeader(auth);
  if (!v.ok) return res.status(401).json({ error: 'Invalid or missing guest token' });
  const propertyId = v.payload.p;
  const sessionId  = v.payload.s;

  // ── Size caps ────────────────────────────────────────────────────
  let bodyBytes = 0;
  try {
    bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  } catch (_) { bodyBytes = 0; }
  if (bodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large', max_bytes: MAX_BODY_BYTES });
  }

  const {
    messages,
    propertyContext,
    lang,
    stayContext,
    imageData,
    stream: useStream,
  } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }
  if (messages.length > MAX_MESSAGES) {
    return res.status(413).json({ error: 'Too many messages', max_messages: MAX_MESSAGES });
  }

  const langLabel = lang === 'it' ? 'Italian' : 'English';
  const isIT = lang === 'it';

  // ── Rate limit + monthly budget ──────────────────────────────────
  // Both are checked BEFORE any call to Anthropic. If either trips,
  // return the graceful "concierge unavailable" reply with escalated=true,
  // so the guest UI routes the conversation to host chat instead of
  // rendering a broken bubble.
  if (SERVICE_KEY) {
    const gate = await checkChatLimits(propertyId, sessionId);
    if (!gate.ok) {
      console.warn('[chat] gated:', gate.reason, 'property:', propertyId, 'session:', sessionId);
      return degradeReply(res, useStream, isIT, gate.retry_after_seconds);
    }
  }
  // (If SERVICE_KEY is missing the gate is skipped rather than hard-failing —
  //  chat still works but is unmetered. Set SUPABASE_SERVICE_ROLE_KEY in
  //  Vercel to close this hole; a warning log is already emitted at boot.)

  // ── Build the stay context section ────────────────────────────────
  let stayCtx = '';
  if (stayContext && typeof stayContext === 'object') {
    const parts = [];
    if (stayContext.guestName)     parts.push(`Guest name: ${stayContext.guestName}`);
    if (stayContext.guestCountry)  parts.push(`Guest is from: ${stayContext.guestCountry}`);
    if (stayContext.groupSize)     parts.push(`Group size: ${stayContext.groupSize} ${stayContext.groupSize === 1 ? 'person' : 'people'}`);
    if (stayContext.arrivalDate)   parts.push(`Arrival: ${stayContext.arrivalDate}`);
    if (stayContext.departureDate) parts.push(`Departure: ${stayContext.departureDate}`);
    if (stayContext.totalNights)   parts.push(`Total stay: ${stayContext.totalNights} ${stayContext.totalNights === 1 ? 'night' : 'nights'}`);
    if (stayContext.dayOfStay)     parts.push(`Today is day ${stayContext.dayOfStay} of their stay`);
    if (parts.length > 0) {
      stayCtx = `\n\nGUEST CONTEXT (use naturally; never recite back like a database):\n${parts.map(p => '- ' + p).join('\n')}`;
    }
  }

  // ── Fetch today's weather for the property location ──────────────
  let weatherCtx = '';
  try {
    const coords = extractCoordsFromContext(propertyContext);
    if (coords) {
      const fc = await getCachedWeather(coords.lat, coords.lng, isIT);
      if (fc) weatherCtx = `\n\nTODAY'S WEATHER (${fc.label_en}, ${new Date().toLocaleDateString('en-GB')}):\n${fc.summary_en}`;
    }
  } catch (e) { /* weather is decorative — never block the chat */ }

  // ── System prompt — TWO BLOCKS for prompt caching ─────────────────
  const stableSystemBlock = `You are the AI concierge for a vacation rental in Italy. Your name is Sofia. You're warm, observant, and you actually know the place — not the kind of bland AI that reads off a brochure. You give concrete recommendations the way a well-traveled local friend would: opinionated, specific, brief.

CORE TONE
- Warm but not saccharine. No "Hello dear guest!" energy.
- Concrete over vague. "Try Panificio Santa Rita on Via Bovio — they open at 7, the focaccia is still hot at 8" beats "There are many good bakeries nearby."
- Confident when you know, honest when you don't. If something isn't in the property info, say so plainly and suggest asking the host.
- Brief by default: 2-3 sentences. Expand only when the question genuinely needs it (directions, multi-step processes, troubleshooting).
- Mobile-first: short paragraphs, **bold** for things they'll actually need (wifi password, opening time, host phone).
- Match the guest's energy. Casual question → casual reply. Practical urgent question → precise reply.

LANGUAGE
- Always reply in the guest's preferred language (specified in the variable section below). If the guest writes in a different language mid-conversation, switch fluidly.
- Use Italian conventions for time (24h is fine, but "8 di sera" reads more natural than "20:00" in casual replies), distances (km), currency (€).

HOW THIS APP WORKS (for guiding guests through the app itself)
- This is the WelcomeBnB guest app. 5 tabs at the bottom: Home, Check-in, Rules, Explore, Chat.
- **Check-in tab**: Required by Italian law (Alloggiati Web). Process: Step 1 — guest type (single/family/group), count, arrival + departure. Step 2 — personal details, either by **scanning a passport/ID** (📷 button → camera, or 🖼 → gallery) which auto-fills everything, or manually. Only the head guest (capofamiglia/capogruppo) needs a document scan; family members don't. After submitting, a review screen shows all details for editing.
- **Home tab**: WiFi, address, check-in/out times, access method (keybox/smart lock), host contact, welcome message.
- **Rules tab**: House rules. Important ones highlighted in red.
- **Explore tab**: Host's hand-picked recommendations. Each has "Open in Maps" for Google Maps directions.
- **Chat tab**: This conversation with you. Guests can also ask to speak with the host from here.
- Language: EN/IT toggle top-right of every screen.

USING TODAY'S WEATHER (when provided in the variable section)
- Weave it in naturally for relevant questions ("the beach today?" → reference temperature/wind; "is it a good day for a walk?" → reference rain chance). Don't recite the forecast at the guest unprompted.
- If they ask about an outdoor activity and the weather is bad, mention it kindly and suggest an alternative.

WHEN TO ESCALATE TO THE HOST
You should respond with the marker [ESCALATE] at the very start of your message in these cases:
- The guest explicitly asks ("talk to host", "speak with a human", "parla con la persona", "voglio parlare con l'host", etc.)
- They report something requiring host intervention: broken appliance, no hot water, key/keybox not working, noise complaint involving another unit, lockout
- Emotional escalation: clear frustration, anger, or distress that text help won't resolve
- Anything legal, medical, or about a refund/booking change — your role is to support, not adjudicate
- Anything you'd need information you don't have, AND that information would only come from the host (e.g., "is it ok if my friend stays the night?")

Otherwise: handle it yourself.

When you do escalate, the message after [ESCALATE] should be a brief, warm note that you're connecting them with the host who will reply in this same chat.

RESPONSE FORMAT
You must respond in this exact structure, no other text outside it:

<reply>
Your reply to the guest in the guest's chosen language. Use **bold** sparingly for key facts.
</reply>
<followups>
Three short follow-up questions the guest is likely to ask next, in the guest's chosen language, one per line. Each under 7 words. No numbering, no bullets, just the questions on their own lines. These appear as tappable suggestions below your reply. Make them concrete and natural — what would this specific guest, given everything in the variable section, actually ask next? If the conversation is winding down or no good followups exist, leave this section empty.
</followups>

Never put any text outside these two tags. The structure is parsed by the app.`;

  const variableSystemBlock = `GUEST'S CHOSEN LANGUAGE: ${langLabel}

PROPERTY INFORMATION
${propertyContext || 'No property data available.'}${stayCtx}${weatherCtx}`;

  // ── Build the messages array, possibly adding image to the last user msg ──
  let apiMessages = messages.slice(-10).map(m => ({ role: m.role, content: m.content }));
  if (imageData && imageData.data && imageData.mediaType && apiMessages.length > 0) {
    const lastIdx = apiMessages.length - 1;
    const last = apiMessages[lastIdx];
    if (last.role === 'user') {
      apiMessages[lastIdx] = {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageData.mediaType,
              data: imageData.data,
            },
          },
          { type: 'text', text: typeof last.content === 'string' ? last.content : '' },
        ],
      };
    }
  }

  const requestBody = {
    model: 'claude-sonnet-4-5',
    max_tokens: 1024,
    system: [
      { type: 'text', text: stableSystemBlock, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: variableSystemBlock },
    ],
    messages: apiMessages,
    stream: !!useStream,
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error('Anthropic API error:', upstream.status, errText);
      return res.status(500).json({ error: 'AI service error. Please try again.' });
    }

    // ── STREAMING PATH ───────────────────────────────────────────────
    if (useStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let inReply = false;
      let replyBuffer = '';
      let inputTokens  = 0;
      let outputTokens = 0;
      const TAG_OPEN = '<reply>';
      const TAG_CLOSE = '</reply>';

      const flushText = (delta) => {
        fullText += delta;
        let toEmit = '';
        let i = 0;
        while (i < delta.length) {
          if (!inReply) {
            replyBuffer += delta[i];
            if (replyBuffer.length > TAG_OPEN.length) {
              replyBuffer = replyBuffer.slice(-TAG_OPEN.length);
            }
            if (replyBuffer === TAG_OPEN) {
              inReply = true;
              replyBuffer = '';
            }
            i++;
          } else {
            replyBuffer += delta[i];
            const stillCould = TAG_CLOSE.startsWith(replyBuffer);
            if (replyBuffer === TAG_CLOSE) {
              inReply = false;
              replyBuffer = '';
              i++;
              break;
            } else if (!stillCould) {
              toEmit += replyBuffer[0];
              replyBuffer = replyBuffer.slice(1);
            }
            i++;
          }
        }
        if (toEmit) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: toEmit })}\n\n`);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const ev of events) {
            const dataLine = ev.split('\n').find(l => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              // Capture token counts from message_start (input) and
              // message_delta (output). Cache-hit tokens are still charged
              // at a discount but the "did we exceed the budget" logic just
              // sums input + output, which is the right shape for cost.
              if (payload.type === 'message_start' && payload.message?.usage) {
                inputTokens  = payload.message.usage.input_tokens  || 0;
                // cache tokens are counted separately in the message_start
                // usage object; add them so the recorded input reflects
                // actual billable input.
                inputTokens += payload.message.usage.cache_creation_input_tokens || 0;
                inputTokens += payload.message.usage.cache_read_input_tokens || 0;
              }
              if (payload.type === 'message_delta' && payload.usage) {
                outputTokens = payload.usage.output_tokens || outputTokens;
              }
              if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
                flushText(payload.delta.text || '');
              }
            } catch (_) { /* malformed chunk; skip */ }
          }
        }
      } catch (e) {
        console.error('Stream read error:', e);
      }

      const replyMatch = fullText.match(/<reply>([\s\S]*?)<\/reply>/);
      const replyText = replyMatch ? replyMatch[1].trim() : fullText.trim();
      // Round 34.1: Sofia sometimes forgets the [ESCALATE] marker even
      // when she's clearly routing the guest to the host ("connecting
      // you with the host…"). Detect escalation from the reply body and
      // the user's last message too, not just the marker.
      const lastUserMsg = extractLastUserText(messages);
      const escalated = replyText.startsWith('[ESCALATE]')
                     || detectEscalationIntent(replyText, lastUserMsg);
      const followupsMatch = fullText.match(/<followups>([\s\S]*?)<\/followups>/);
      const followups = sanitizeFollowups(followupsMatch ? followupsMatch[1] : '');

      if (escalated && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        notifyTelegram(messages).catch(() => {});
      }

      res.write(`data: ${JSON.stringify({ type: 'done', escalated, followups })}\n\n`);
      res.end();
      // AWAIT the usage insert — Vercel serverless ends the invocation at
      // handler return, so a fire-and-forget promise gets cancelled. The
      // client already has its reply; the await only delays the invocation
      // exit, not the response.
      try {
        await recordUsage({
          property_id: propertyId,
          session_id: sessionId,
          endpoint: 'chat',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
        });
      } catch (e) { console.warn('[chat] usage insert failed:', e); }
      return;
    }

    // ── NON-STREAMING PATH (backward compatible) ────────────────────
    const data = await upstream.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const rawText = data.content?.[0]?.text || '';
    const replyMatch = rawText.match(/<reply>([\s\S]*?)<\/reply>/);
    let replyText = replyMatch ? replyMatch[1].trim() : rawText.trim();
    const cleanReply = replyText.replace('[ESCALATE]', '').trim();
    // Round 34.1: detect escalation from marker OR reply body OR user
    // message content. Sofia sometimes forgets the marker.
    const lastUserMsg = extractLastUserText(messages);
    const escalated = replyText.startsWith('[ESCALATE]')
                   || detectEscalationIntent(cleanReply, lastUserMsg);

    const followupsMatch = rawText.match(/<followups>([\s\S]*?)<\/followups>/);
    const followups = sanitizeFollowups(followupsMatch ? followupsMatch[1] : '');

    if (escalated && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      notifyTelegram(messages).catch(() => {});
    }

    // Record real usage. Await it: Vercel serverless would otherwise
    // cancel the pending PostgREST POST when the handler returns.
    const u = data.usage || {};
    try {
      await recordUsage({
        property_id: propertyId,
        session_id: sessionId,
        endpoint: 'chat',
        input_tokens: (u.input_tokens || 0)
          + (u.cache_creation_input_tokens || 0)
          + (u.cache_read_input_tokens || 0),
        output_tokens: u.output_tokens || 0,
      });
    } catch (e) { console.warn('[chat] usage insert failed:', e); }

    return res.status(200).json({
      reply: cleanReply || (isIT ? 'Scusa, riprova.' : 'Sorry, please try again.'),
      escalated,
      followups,
    });
  } catch (err) {
    console.error('Chat API error:', err);
    if (useStream) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI service unavailable' })}\n\n`);
        res.end();
      } catch (_) {}
      return;
    }
    return res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
}

// ── Round 33 helpers ──────────────────────────────────────────────────

// Allow the guest app and preview URLs. Rejects everything else.
function resolveOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://welcomebnb.vercel.app') return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return null;
}

// Check session hourly + property daily limits + monthly budget. Returns
// { ok: true } or { ok: false, reason, retry_after_seconds }.
async function checkChatLimits(propertyId, sessionId) {
  const now = new Date();
  const hourAgoISO  = new Date(now.getTime() - 3600 * 1000).toISOString();
  const dayAgoISO   = new Date(now.getTime() - 86400 * 1000).toISOString();
  const monthStart  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // A single wide fetch is cheaper than three narrow counts here.
  // We pull the last-day's rows for this property, plus rows for this
  // session in the last hour, plus enough token detail for the month.
  try {
    // 1. Property daily count (last 24h)
    const dailyRes = await pgrestGET(
      `api_usage?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&endpoint=eq.chat&created_at=gte.${encodeURIComponent(dayAgoISO)}` +
      `&select=id`,
      { headers: { Prefer: 'count=exact' } },
    );
    const dailyCount = readCount(dailyRes.headers.get('content-range'), dailyRes.data);
    if (dailyCount >= CHAT_PROPERTY_DAILY_LIMIT) {
      return { ok: false, reason: 'property_daily', retry_after_seconds: 3600 };
    }

    // 2. Session hourly count
    if (sessionId) {
      const hourlyRes = await pgrestGET(
        `api_usage?session_id=eq.${encodeURIComponent(sessionId)}` +
        `&endpoint=eq.chat&created_at=gte.${encodeURIComponent(hourAgoISO)}` +
        `&select=id`,
        { headers: { Prefer: 'count=exact' } },
      );
      const hourlyCount = readCount(hourlyRes.headers.get('content-range'), hourlyRes.data);
      if (hourlyCount >= CHAT_SESSION_HOURLY_LIMIT) {
        return { ok: false, reason: 'session_hourly', retry_after_seconds: 900 };
      }
    }

    // 3. Monthly token budget
    const capRes = await pgrestGET(
      `properties?id=eq.${encodeURIComponent(propertyId)}` +
      `&select=ai_monthly_token_cap`,
    );
    const cap = Number(capRes.data?.[0]?.ai_monthly_token_cap ?? 2_000_000);
    const monthRes = await pgrestGET(
      `api_usage?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&created_at=gte.${encodeURIComponent(monthStart)}` +
      `&select=input_tokens,output_tokens`,
    );
    const spent = (monthRes.data || []).reduce(
      (sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0), 0,
    );
    if (spent >= cap) {
      return { ok: false, reason: 'monthly_budget', retry_after_seconds: 86400 };
    }

    return { ok: true };
  } catch (e) {
    // Fail OPEN on gate errors so a Supabase blip doesn't lock guests out.
    // Round 33's `escalated:true` degrade only fires on positive gate matches.
    console.warn('[chat] limit check failed, allowing request through:', e);
    return { ok: true };
  }
}

function readCount(rangeHeader, dataFallback) {
  // Prefer: count=exact returns Content-Range: "0-49/1234" (or "*/1234")
  if (rangeHeader) {
    const m = rangeHeader.match(/\/(\d+)$/);
    if (m) return Number(m[1]);
  }
  return Array.isArray(dataFallback) ? dataFallback.length : 0;
}

// Small PostgREST helper with service_role. Returns { data, headers }.
async function pgrestGET(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`pgrestGET ${path} → ${r.status} ${t}`);
  }
  const data = await r.json();
  return { data, headers: r.headers };
}

// Insert one api_usage row. Called fire-and-forget after every successful
// Anthropic call. Deliberately best-effort — a failed insert must not
// break the guest UX.
async function recordUsage(row) {
  if (!SERVICE_KEY) return;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/api_usage`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.warn('[chat] api_usage insert failed:', r.status, await r.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('[chat] api_usage insert exception:', e);
  }
}

// Send a graceful "concierge unavailable, connecting you with the host"
// reply with escalated=true. Used for rate-limit / over-budget hits so the
// guest UI routes to host chat instead of rendering a broken bubble.
// Never calls Anthropic. Records NO api_usage row (this fires when we
// deliberately skipped the AI call).
function degradeReply(res, useStream, isIT, retryAfter) {
  const reply = isIT
    ? "Il concierge AI è temporaneamente non disponibile. Ti sto mettendo in contatto con l'host — risponderà qui in chat appena può."
    : "The AI concierge is briefly unavailable. I'm connecting you with the host — they'll reply here in chat shortly.";
  if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
  if (useStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(`data: ${JSON.stringify({ type: 'text', text: reply })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', escalated: true, followups: [] })}\n\n`);
    res.end();
    return;
  }
  return res.status(200).json({ reply, escalated: true, followups: [] });
}

// ─── Round 34.1: escalation detection + followup sanitizer ────────────
// Sofia's system prompt asks her to emit `[ESCALATE]` at the very start
// of her reply for known cases (guest asks for a human, broken appliance,
// etc.). She's inconsistent — sometimes she writes a full "connecting you
// with the host" reply without the marker. We back that up with reply-body
// and user-message pattern matching so `escalated:true` is set reliably,
// which is what makes the guest client start polling for host replies.

const ESCALATION_REPLY_PATTERNS_EN = [
  'connecting you with', 'connect you with',
  'notify the host', 'notified the host', 'notifying the host',
  'reach out to the host', 'reach out to your host',
  'in touch with the host', 'in touch with your host',
  'contacting the host', "i've alerted the host",
  "i'm passing this to", "i'll pass this to",
];
const ESCALATION_REPLY_PATTERNS_IT = [
  'ti sto mettendo in contatto', 'ti metto in contatto',
  'ho avvisato', 'sto contattando', 'ti connetto con',
  'avviso l\'host', 'contatterò',
];
const ESCALATION_USER_PATTERNS_EN = [
  'talk to host', 'talk to the host', 'talk to a host',
  'talk to a human', 'talk to a person', 'talk to someone',
  'speak with the host', 'speak with a human', 'speak to host',
  'reach the host', 'contact the host', 'call the host',
];
const ESCALATION_USER_PATTERNS_IT = [
  'parla con', 'parlare con', 'voglio parlare',
  'contatta l\'host', "chiama l'host", 'chiedi all\'host',
  'contattare l\'host',
];

function detectEscalationIntent(replyText, userMsgText) {
  const r = String(replyText || '').toLowerCase();
  if (ESCALATION_REPLY_PATTERNS_EN.some(p => r.includes(p))) return true;
  if (ESCALATION_REPLY_PATTERNS_IT.some(p => r.includes(p))) return true;
  const u = String(userMsgText || '').toLowerCase();
  if (ESCALATION_USER_PATTERNS_EN.some(p => u.includes(p))) return true;
  if (ESCALATION_USER_PATTERNS_IT.some(p => u.includes(p))) return true;
  return false;
}

function extractLastUserText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      const c = messages[i].content;
      if (typeof c === 'string') return c;
      // vision message: content is an array of blocks; find the text one
      if (Array.isArray(c)) {
        const t = c.find(b => b?.type === 'text');
        if (t) return t.text || '';
      }
    }
  }
  return '';
}

// Never surface internal markers as tappable followup chips. Drop empties,
// drop entries that are (or start with) `[SOMETHING]` — these are always
// internal signals leaking, not questions a guest would ask.
function sanitizeFollowups(raw) {
  return String(raw || '')
    .split('\n')
    .map(s => s.replace(/\[ESCALATE\]/g, '').trim())
    .filter(s => s.length > 0 && s.length < 60 && !/^\[/.test(s))
    .slice(0, 3);
}

async function notifyTelegram(messages) {
  const lastGuestMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  const text = typeof lastGuestMsg === 'string' ? lastGuestMsg : '[image + text]';
  const tgText = `🔔 WelcomeBnB — Guest needs help\n\n"${text}"\n\nReply from the host console.`;
  try {
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: tgText,
      }),
    });
  } catch (e) {
    console.warn('Telegram notification failed:', e);
  }
}

// ─── Weather support (Round 17) ────────────────────────────────────
function extractCoordsFromContext(ctx) {
  if (!ctx || typeof ctx !== 'string') return null;
  const m1 = ctx.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
  const m2 = ctx.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
  return null;
}

function getCachedWeather(lat, lng, isIT) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const now = Date.now();
  globalThis.__wbnb_weather_cache = globalThis.__wbnb_weather_cache || {};
  const cached = globalThis.__wbnb_weather_cache[key];
  if (cached && (now - cached.fetchedAt) < 30 * 60 * 1000) {
    return Promise.resolve(cached.forecast);
  }
  return fetchOpenMeteo(lat, lng).then(forecast => {
    if (forecast) {
      globalThis.__wbnb_weather_cache[key] = { fetchedAt: now, forecast };
    }
    return forecast;
  }).catch(() => null);
}

async function fetchOpenMeteo(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
              `&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m` +
              `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
              `&timezone=auto&forecast_days=1`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.current || !data.daily) return null;
  const c = data.current;
  const d = data.daily;
  const desc = describeWeatherCode(d.weather_code?.[0]);
  return {
    label_en: 'Live forecast',
    summary_en: [
      `Conditions: ${desc.en}`,
      `Now: ${Math.round(c.temperature_2m)}°C, ${Math.round(c.relative_humidity_2m)}% humidity, wind ${Math.round(c.wind_speed_10m)} km/h`,
      `Today: high ${Math.round(d.temperature_2m_max[0])}°C, low ${Math.round(d.temperature_2m_min[0])}°C, rain chance ${d.precipitation_probability_max?.[0] ?? 0}%`,
    ].join('. '),
  };
}

function describeWeatherCode(code) {
  const t = (en, it) => ({ en, it });
  const map = {
    0:  t('clear sky', 'cielo sereno'),
    1:  t('mainly clear', 'prevalentemente sereno'),
    2:  t('partly cloudy', 'parzialmente nuvoloso'),
    3:  t('overcast', 'coperto'),
    45: t('foggy', 'nebbia'),
    48: t('foggy', 'nebbia'),
    51: t('light drizzle', 'pioggerella leggera'),
    53: t('drizzle', 'pioggerella'),
    55: t('heavy drizzle', 'pioggerella intensa'),
    61: t('light rain', 'pioggia leggera'),
    63: t('rain', 'pioggia'),
    65: t('heavy rain', 'pioggia forte'),
    71: t('light snow', 'neve leggera'),
    73: t('snow', 'neve'),
    75: t('heavy snow', 'neve abbondante'),
    77: t('snow grains', 'neve granulare'),
    80: t('rain showers', 'rovesci di pioggia'),
    81: t('rain showers', 'rovesci di pioggia'),
    82: t('heavy rain showers', 'forti rovesci di pioggia'),
    95: t('thunderstorm', 'temporale'),
    96: t('thunderstorm with hail', 'temporale con grandine'),
    99: t('severe thunderstorm', 'temporale violento'),
  };
  return map[code] || t('unsettled', 'variabile');
}
