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

  const systemPrompt = `You are the AI concierge for a vacation rental property. You help guests with anything related to the apartment, the neighbourhood, restaurants, activities, and practical questions about their stay.

PROPERTY INFORMATION:
${propertyContext || 'No property data available.'}

RULES:
- Always respond in ${langLabel} (the guest's chosen language).
- Be warm, helpful, and concise — 2-3 sentences max unless more detail is needed.
- Use the property information above to answer accurately. If you don't know something specific, say so honestly and suggest the guest ask the host.
- For restaurant/bar/activity recommendations, prioritize the ones listed above — the host hand-picked them.
- If the guest asks to "talk to a human", "speak with the host", "parla con una persona", or similar, respond with exactly this marker at the start of your message: [ESCALATE] — then add a friendly message saying you're connecting them with the host.
- Never invent information about the property that isn't in the context above.
- You can share general knowledge about the city, region, culture, transport, weather, etc.
- Format: use **bold** for key info like WiFi passwords, times, names. Keep it scannable on mobile.`;

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
        messages: messages.slice(-10), // Keep last 10 messages for context
      }),
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    const reply = data.content?.[0]?.text || 'Sorry, I couldn\'t process that. Please try again.';
    const escalated = reply.startsWith('[ESCALATE]');
    const cleanReply = reply.replace('[ESCALATE]', '').trim();

    return res.status(200).json({ reply: cleanReply, escalated });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({ error: 'AI service unavailable. Please try again.' });
  }
}
