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
    const { image_base64, media_type, is_pdf } = req.body;
    if (!image_base64) { res.status(400).json({ error: 'No document provided' }); return; }

    // Round 18.1 — the guest may upload an image OR a PDF. Anthropic's API
    // uses two different content block types:
    //   • images → { type: 'image', source: {...} }
    //   • PDFs   → { type: 'document', source: {...} }
    // Claude reads PDF documents natively (renders + OCRs the pages), so
    // no client-side PDF→image conversion is needed.
    const isPDF = is_pdf === true || media_type === 'application/pdf';

    const docBlock = isPDF
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: image_base64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 },
        };

    const extractionPrompt = `You are a document data extraction system for Italian hotel check-in (Alloggiati Web).
Analyze this identity document and extract data. Return ONLY valid JSON, no markdown:
{
  "surname": "",
  "name": "",
  "sex": "M" or "F",
  "date_of_birth": "YYYY-MM-DD",
  "place_of_birth": "",
  "birth_country": "",
  "birth_province": "",
  "citizenship": "",
  "document_type": "passport" or "id_card" or "driving",
  "document_number": "",
  "expiry_date": "YYYY-MM-DD",
  "issuing_country": "",
  "confidence": "high" or "medium" or "low"
}
Rules:
- Use ENGLISH country names for citizenship and birth_country (e.g. "France" not "FRANÇAISE", "Switzerland" not "SUISSE")
- place_of_birth = city name as printed on the document (e.g. "ZURICH", "BARI", "LYON"). If an Italian province code appears in brackets like "CIVITAVECCHIA (RM)", put just the city "CIVITAVECCHIA" here.
- birth_province = For Italian documents, extract the 2-letter province code if shown in brackets after the city (e.g. "CIVITAVECCHIA (RM)" → "RM", "BARI (BA)" → "BA"). If not visible, leave empty.
- birth_country = the COUNTRY where the person was born. This is DIFFERENT from citizenship. An Italian citizen can be born in Switzerland. Determine birth_country from the place_of_birth city. If the city is clearly in Italy (e.g. Roma, Milano, Bari, Napoli), set birth_country to "Italy". If the city is foreign (e.g. Zurich, London, Paris), set birth_country to that country.
- citizenship = nationality as printed on the document
- Dates in YYYY-MM-DD format
- Prefer MRZ data if visible (more accurate)
- Empty string for unreadable fields
- surname and name in ALL CAPS as on document
- If the document spans multiple pages, extract from whichever page shows the identity data.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            docBlock,
            { type: 'text', text: extractionPrompt },
          ],
        }],
      }),
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
