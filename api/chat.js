// api/chat.js — WelcomeBnB chat endpoint
// Round 16 upgrade: Sonnet 4.5, streaming, vision (photo input), contextual
// followups, richer system prompt, stay-context awareness.
//
// Backward-compatible with the old request shape:
//   { messages, propertyContext, lang }
// New optional fields:
//   { stayContext, imageData, stream }
//   - stayContext: { dayOfStay, totalNights, arrivalDate, departureDate,
//                    groupSize, guestCountry, guestName }
//   - imageData:   { mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
//                    data: '<base64>' }    (image accompanies the last user msg)
//   - stream:      true → response is text/event-stream with SSE chunks
//
// Returns (non-streaming): { reply, escalated, followups: [string, string, string] }
// Returns (streaming):     text/event-stream with chunks of:
//   data: {"type":"text","text":"..."}
//   data: {"type":"done","escalated":bool,"followups":[...]}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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

  const langLabel = lang === 'it' ? 'Italian' : 'English';
  const isIT = lang === 'it';

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
  // Uses open-meteo.com — free, no API key, no rate limits at our scale.
  // We pass coords from the property (if available), otherwise skip.
  // Cached server-side via the global `globalThis.__wbnb_weather_cache`
  // for 30 minutes per coord, so we don't hammer the API on every chat.
  let weatherCtx = '';
  try {
    const coords = extractCoordsFromContext(propertyContext);
    if (coords) {
      const fc = await getCachedWeather(coords.lat, coords.lng, isIT);
      if (fc) weatherCtx = `\n\nTODAY'S WEATHER (${fc.label_en}, ${new Date().toLocaleDateString('en-GB')}):\n${fc.summary_en}`;
    }
  } catch (e) { /* weather is decorative — never block the chat */ }

  // ── System prompt — TWO BLOCKS for prompt caching ─────────────────
  // Block 1 is stable across all guests and changes rarely → cached.
  // Block 2 contains the per-guest variables → not cached.
  // Sonnet 4.5's cache minimum is ~1024 tokens; block 1 is comfortably above.

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

  // Multi-block system with cache_control on the stable block. Anthropic
  // will cache it (cost = 10% of normal input after first hit) and serve
  // it from cache across all guests/properties for 5 minutes per cache key.
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
      res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let inReply = false;     // whether we're currently inside <reply>
      let replyBuffer = '';    // accumulating chars inside <reply> for tag detection
      const TAG_OPEN = '<reply>';
      const TAG_CLOSE = '</reply>';

      // Process SSE chunks from Anthropic and forward only the text deltas
      // that belong INSIDE the <reply> tag. Tags themselves are not streamed
      // to the client.
      const flushText = (delta) => {
        // Append delta to fullText so we can parse out tags + followups at end
        fullText += delta;

        // Walk through delta char by char, deciding whether to emit
        let toEmit = '';
        let i = 0;
        while (i < delta.length) {
          if (!inReply) {
            // Look for opening tag; buffer characters that could be part of it
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
            // Inside reply; look for closing tag
            replyBuffer += delta[i];
            // If replyBuffer can no longer become </reply>, emit its safe prefix
            const stillCould = TAG_CLOSE.startsWith(replyBuffer);
            if (replyBuffer === TAG_CLOSE) {
              inReply = false;
              replyBuffer = '';
              i++;
              // Anything after </reply> belongs to <followups>; we don't stream it
              break;
            } else if (!stillCould) {
              // Flush the first char of replyBuffer; keep checking from the rest
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

          // Anthropic SSE: each event is `event: <type>\ndata: <json>\n\n`
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';
          for (const ev of events) {
            const dataLine = ev.split('\n').find(l => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
                flushText(payload.delta.text || '');
              }
            } catch (_) { /* malformed chunk; skip */ }
          }
        }
      } catch (e) {
        console.error('Stream read error:', e);
      }

      // Parse full text for escalation marker and followups
      const replyMatch = fullText.match(/<reply>([\s\S]*?)<\/reply>/);
      const replyText = replyMatch ? replyMatch[1].trim() : fullText.trim();
      const escalated = replyText.startsWith('[ESCALATE]');
      const followupsMatch = fullText.match(/<followups>([\s\S]*?)<\/followups>/);
      const followups = followupsMatch
        ? followupsMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.length < 60).slice(0, 3)
        : [];

      // Notify Telegram on escalation
      if (escalated && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
        notifyTelegram(messages).catch(() => {});
      }

      res.write(`data: ${JSON.stringify({ type: 'done', escalated, followups })}\n\n`);
      res.end();
      return;
    }

    // ── NON-STREAMING PATH (backward compatible) ────────────────────
    const data = await upstream.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const rawText = data.content?.[0]?.text || '';
    const replyMatch = rawText.match(/<reply>([\s\S]*?)<\/reply>/);
    let replyText = replyMatch ? replyMatch[1].trim() : rawText.trim();
    const escalated = replyText.startsWith('[ESCALATE]');
    const cleanReply = replyText.replace('[ESCALATE]', '').trim();

    const followupsMatch = rawText.match(/<followups>([\s\S]*?)<\/followups>/);
    const followups = followupsMatch
      ? followupsMatch[1].split('\n').map(s => s.trim()).filter(s => s.length > 0 && s.length < 60).slice(0, 3)
      : [];

    if (escalated && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      notifyTelegram(messages).catch(() => {});
    }

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
// Extract lat/lng from the property context. The host console builds
// the context with a "Google Maps: <url>" line; we parse coords out of
// that URL if present. Falls back to scanning for a "@lat,lng" pattern.
function extractCoordsFromContext(ctx) {
  if (!ctx || typeof ctx !== 'string') return null;
  // Pattern 1: Google Maps URL with @lat,lng (the most common form)
  const m1 = ctx.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
  // Pattern 2: explicit "lat,lng" decimal pair
  const m2 = ctx.match(/(-?\d{1,2}\.\d{4,}),\s*(-?\d{1,3}\.\d{4,})/);
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
  return null;
}

// Server-side weather cache keyed by rounded coords. Survives between
// requests on the same warm Vercel instance. 30-minute TTL.
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
  // open-meteo.com — no API key, no rate limits at our scale.
  // We pull current conditions + today's high/low/precip.
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

// WMO weather code → short EN/IT description. Used for the natural-
// language summary that goes into the system prompt.
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
