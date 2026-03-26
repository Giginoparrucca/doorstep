export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) { res.status(500).json({ error: 'API key not configured' }); return; }

  try {
    const { image_base64, media_type } = req.body;
    if (!image_base64) { res.status(400).json({ error: 'No image provided' }); return; }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 },
            },
            {
              type: 'text',
              text: `You are a document data extraction system for Italian hotel check-in (Alloggiati Web).

Analyze this identity document and extract data. Return ONLY valid JSON, no markdown:
{
  "surname": "",
  "name": "",
  "sex": "M" or "F",
  "date_of_birth": "YYYY-MM-DD",
  "place_of_birth": "",
  "citizenship": "",
  "document_type": "passport" or "id_card" or "driving",
  "document_number": "",
  "expiry_date": "YYYY-MM-DD",
  "issuing_country": "",
  "confidence": "high" or "medium" or "low"
}

Rules:
- Use ENGLISH country names for citizenship (e.g. "France" not "FRANÇAISE")
- For Italian docs, place_of_birth = Italian city name
- Dates in YYYY-MM-DD format
- Prefer MRZ data if visible (more accurate)
- Empty string for unreadable fields
- surname and name in ALL CAPS as on document`
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (data.error) { res.status(500).json({ error: data.error.message }); return; }

    const text = data.content?.find(c => c.type === 'text')?.text || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
      const extracted = JSON.parse(clean);
      res.status(200).json({ success: true, data: extracted });
    } catch (e) {
      res.status(422).json({ error: 'Could not parse response', raw: text });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
