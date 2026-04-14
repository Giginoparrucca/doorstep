export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { messages, propertyContext, lang } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  const langLabel = lang === 'it' ? 'Italian' : 'English';

  const systemPrompt = `You are the AI concierge for a vacation rental property. You help guests with anything related to the apartment, the neighbourhood, restaurants, activities, and practical questions about their stay. You also know how this app works and can guide guests through it.

PROPERTY INFORMATION:
${propertyContext || 'No property data available.'}

HOW THIS APP WORKS (use this to guide guests):
- This is the Doorstep guest app. Guests access it via a link or QR code from their host.
- The app has 5 tabs at the bottom: Home, Check-in, Rules, Explore, Chat (this conversation).
- **Check-in tab**: Guests must complete online check-in as required by Italian law. The process:
  1. Step 1: Choose guest type (single traveller, family, or group), enter number of guests, pick arrival and departure dates.
  2. Step 2: For each guest, fill in personal details. There are two ways to enter data:
     - **Scan a document**: Tap the "📷 Take Photo" button to use the camera, or "🖼 From Gallery" to upload an existing photo of a passport or ID card. The AI reads the document and auto-fills all the fields (name, date of birth, document number, etc.).
     - **Manual entry**: Fill in all fields by hand — name, surname, sex, date of birth, place of birth, province, citizenship, and document details.
  3. The main guest (capofamiglia/capogruppo) needs to provide a passport or ID card. Other guests in the same family or group do not need a separate document scan.
  4. After submitting all guests, a confirmation screen shows all details with the ability to edit any mistakes.
  5. If a passport photo doesn't scan properly: try better lighting, hold the document flat on a surface, make sure all text is visible and not cut off. They can also just fill in the details manually.
- **Home tab**: Shows property info — WiFi name and password, address, check-in/out time ranges, access method (keybox code, smart lock, etc.), host contact info, and a welcome message.
- **Rules tab**: House rules set by the host. Important rules are highlighted in red.
- **Explore tab**: Hand-picked recommendations from the host — restaurants, bars, sights, beaches, and shops. Each card has a "Open in Maps" button that opens Google Maps with directions.
- **Chat tab**: This AI concierge (you!) for instant help. If the guest needs something you can't handle, they can ask to speak with the host and you'll escalate.
- The language can be switched between English and Italian using the EN/IT toggle at the top right of every screen.

RESPONSE RULES:
- Always respond in ${langLabel} (the guest's chosen language).
- Be warm, helpful, and concise — 2-3 sentences max unless more detail is needed.
- Use the property information above to answer accurately. If you don't know something specific, say so honestly and suggest the guest ask the host.
- For restaurant/bar/activity recommendations, prioritize the ones listed in the property context — the host hand-picked them.
- If the guest asks to "talk to a human", "speak with the host", "contact the host", "parla con una persona", "parlare con l'host", or similar, respond with exactly this marker at the start of your message: [ESCALATE] — then add a friendly message saying you're connecting them with the host who will respond here in this chat.
- Never invent information about the property that isn't in the context above.
- You can share general knowledge about the city, region, culture, transport, weather, etc.
- Format: use **bold** for key info like WiFi passwords, times, names. Keep it scannable on mobile.
- When guiding guests through app features, refer to the specific tab names (Home, Check-in, Rules, Explore) so they know where to go.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: systemPrompt,
        messages: messages.slice(-10),
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.content?.[0]?.text || 'Sorry, I couldn\'t process that. Please try again.';
    const escalated = reply.startsWith('[ESCALATE]');
    const cleanReply = reply.replace('[ESCALATE]', '').trim();

    // Send Telegram notification on escalation
    if (escalated && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const lastGuestMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
        const tgText = `🔔 Doorstep — Guest needs help\n\n"${lastGuestMsg}"\n\nReply from the host console.`;
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: tgText,
          }),
        });
      } catch (e) { console.warn('Telegram notification failed:', e); }
    }

    return res.status(200).json({ reply: cleanReply, escalated });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
}
