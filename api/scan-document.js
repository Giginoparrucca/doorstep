// api/scan-document.js — WelcomeBnB ID / passport scan endpoint.
//
// Round 18.1: accepts an image OR a PDF; Claude reads PDFs natively.
// Round 33: origin allowlist, guest-token auth (identity from token, not body),
// size cap (14 MB base64 ≈ 10 MB decoded), session/property rate limits,
// per-property monthly budget cap, api_usage recording. Rate-limit /
// over-budget returns a clean 429 / 402 — the guest UI already has a
// manual-entry fallback, so a hard error is fine here.

import { verifyFromAuthHeader } from './_guest-token.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_BASE64_LEN            = 14_000_000;   // ~10 MB decoded
const SCAN_SESSION_HOURLY_LIMIT = 5;
const SCAN_PROPERTY_DAILY_LIMIT = 60;

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Token auth ───────────────────────────────────────────────────
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const v = verifyFromAuthHeader(auth);
  if (!v.ok) return res.status(401).json({ error: 'Invalid or missing guest token' });
  const propertyId = v.payload.p;
  const sessionId  = v.payload.s;

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { image_base64, media_type, is_pdf } = req.body || {};
  if (!image_base64) return res.status(400).json({ error: 'No document provided' });

  // ── Size cap ─────────────────────────────────────────────────────
  if (typeof image_base64 !== 'string' || image_base64.length > MAX_BASE64_LEN) {
    return res.status(413).json({
      error: 'Document too large. Please upload a smaller image (max ~10 MB).',
      max_base64_length: MAX_BASE64_LEN,
    });
  }

  // ── Rate limit + monthly budget ──────────────────────────────────
  if (SERVICE_KEY) {
    const gate = await checkScanLimits(propertyId, sessionId);
    if (!gate.ok) {
      res.setHeader('Retry-After', String(gate.retry_after_seconds || 3600));
      const msg = gate.reason === 'monthly_budget'
        ? 'Monthly scan budget reached for this property. Please enter your details manually.'
        : 'Too many scans in a short period. Please wait a moment and try again — or enter your details manually.';
      // 402 for budget (payment/plan-shaped), 429 for rate limit.
      const status = gate.reason === 'monthly_budget' ? 402 : 429;
      return res.status(status).json({
        error: msg,
        reason: gate.reason,
        retry_after_seconds: gate.retry_after_seconds,
      });
    }
  }

  try {
    // Round 18.1 — the guest may upload an image OR a PDF. Anthropic's API
    // uses two different content block types (image vs document).
    const isPDF = is_pdf === true || media_type === 'application/pdf';
    const docBlock = isPDF
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image_base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } };

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
          content: [docBlock, { type: 'text', text: extractionPrompt }],
        }],
      }),
    });
    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message });

    // Record api_usage. Anthropic returns usage in the response body.
    const u = data.usage || {};
    recordUsage({
      property_id: propertyId,
      session_id: sessionId,
      endpoint: 'scan',
      input_tokens: (u.input_tokens || 0)
        + (u.cache_creation_input_tokens || 0)
        + (u.cache_read_input_tokens || 0),
      output_tokens: u.output_tokens || 0,
    }).catch(e => console.warn('[scan] usage insert failed:', e));

    const text = data.content?.find(c => c.type === 'text')?.text || '';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const extracted = JSON.parse(clean);
      return res.status(200).json({ success: true, data: extracted });
    } catch (e) {
      return res.status(422).json({ error: 'Could not parse response', raw: text });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// ── Round 33 helpers ──────────────────────────────────────────────────

function resolveOrigin(origin) {
  if (!origin) return null;
  if (origin === 'https://welcomebnb.vercel.app') return origin;
  if (/^http:\/\/localhost(:\d+)?$/.test(origin)) return origin;
  if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) return origin;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) return origin;
  return null;
}

async function checkScanLimits(propertyId, sessionId) {
  const now = new Date();
  const hourAgoISO = new Date(now.getTime() - 3600 * 1000).toISOString();
  const dayAgoISO  = new Date(now.getTime() - 86400 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  try {
    const dailyRes = await pgrestGET(
      `api_usage?property_id=eq.${encodeURIComponent(propertyId)}` +
      `&endpoint=eq.scan&created_at=gte.${encodeURIComponent(dayAgoISO)}` +
      `&select=id`,
      { headers: { Prefer: 'count=exact' } },
    );
    const dailyCount = readCount(dailyRes.headers.get('content-range'), dailyRes.data);
    if (dailyCount >= SCAN_PROPERTY_DAILY_LIMIT) {
      return { ok: false, reason: 'property_daily', retry_after_seconds: 3600 };
    }

    if (sessionId) {
      const hourlyRes = await pgrestGET(
        `api_usage?session_id=eq.${encodeURIComponent(sessionId)}` +
        `&endpoint=eq.scan&created_at=gte.${encodeURIComponent(hourAgoISO)}` +
        `&select=id`,
        { headers: { Prefer: 'count=exact' } },
      );
      const hourlyCount = readCount(hourlyRes.headers.get('content-range'), hourlyRes.data);
      if (hourlyCount >= SCAN_SESSION_HOURLY_LIMIT) {
        return { ok: false, reason: 'session_hourly', retry_after_seconds: 900 };
      }
    }

    // Monthly budget — shared with chat.js. This is a combined cap.
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
    // Fail OPEN on gate errors so a Supabase blip doesn't block check-ins.
    console.warn('[scan] limit check failed, allowing request through:', e);
    return { ok: true };
  }
}

function readCount(rangeHeader, dataFallback) {
  if (rangeHeader) {
    const m = rangeHeader.match(/\/(\d+)$/);
    if (m) return Number(m[1]);
  }
  return Array.isArray(dataFallback) ? dataFallback.length : 0;
}

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
    if (!r.ok) console.warn('[scan] api_usage insert failed:', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.warn('[scan] api_usage insert exception:', e);
  }
}
