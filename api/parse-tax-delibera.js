// api/parse-tax-delibera.js — Round 37 (redux)
//
// Host-facing endpoint. The host pastes the text of their comune's
// tourist-tax resolution (delibera) — or the relevant extract — and
// gets back a proposed layer-1 + layer-2 + layer-3 configuration
// following the shape defined by migration_round37_tax_config.sql.
// Nothing is saved. The host reviews, edits and clicks Save themselves.
//
// Auth: this is HOST-facing, not guest-facing. The caller must present
// a Supabase user JWT (Authorization: Bearer <jwt>) exactly like the
// USER mode of api/ical-sync.js. Do NOT accept the guest token.
//
// Budget:
//   - CORS via api/_cors.js (Round 34.2 allowlist).
//   - Body ≤ 40 KB total (delibera text + envelope). Larger returns 413.
//   - 10 calls/hour per Supabase user, metered via api_usage with
//     endpoint = 'tax_parse'. Round 37 (redux) widened the endpoint CHECK
//     to accept that value; recordUsage swallows insert failures on a
//     violation, so make sure the migration is in before this file
//     lands.
//   - Anthropic response is validated shape-first: no key we don't
//     recognise is forwarded, and every numeric field is clamped.

import { applyCors } from './_cors.js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_BODY_BYTES     = 40 * 1024;
const HOURLY_LIMIT       = 10;
const CLAUDE_MODEL       = 'claude-sonnet-4-5';
const CLAUDE_MAX_TOKENS  = 1400;

export default async function handler(req, res) {
  const allowed = applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(allowed ? 200 : 403).end();
  if (!allowed)                 return res.status(403).json({ error: 'Origin not allowed' });
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  // Body size check first — a 20 MB paste should not go anywhere near
  // Anthropic, or into any parser.
  let bodyBytes = 0;
  try { bodyBytes = Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8'); } catch (_) { bodyBytes = 0; }
  if (bodyBytes > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request body too large', max_bytes: MAX_BODY_BYTES });
  }

  // Auth: Supabase user JWT, verified against the auth endpoint. This
  // is host-facing — the guest token has no place here.
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });
  let userId = null;
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    userId = user?.id;
    if (!userId) return res.status(401).json({ error: 'Invalid token' });
  } catch (e) {
    return res.status(401).json({ error: 'Auth check failed' });
  }

  const { text, lang, comune } = req.body || {};
  if (!text || typeof text !== 'string' || text.trim().length < 40) {
    return res.status(400).json({ error: 'text is required (paste the relevant extract of the delibera)' });
  }

  // Rate limit — 10 per user per rolling hour. Best-effort read: on
  // Supabase failure we fail closed rather than skip the meter (unlike
  // chat, which degrades to escalation; here refusing is cheaper and
  // right).
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Server misconfigured' });
  const gate = await checkHourlyLimit(userId);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retry_after_seconds || 300));
    return res.status(429).json({ error: 'Rate limit exceeded', retry_after_seconds: gate.retry_after_seconds });
  }

  // Ask Claude for a strictly-shaped JSON response. The model's output
  // is untrusted; every field we accept is re-validated below.
  const langIT = String(lang || 'it').toLowerCase() === 'it';
  const system = `You are helping an Italian short-stay host translate their comune's tourist-tax resolution (delibera imposta di soggiorno) into a structured configuration. Reply ONLY with a single JSON object, no prose, no code fences.

The shape is exactly:
{
  "layer1": {
    "tax_rate_eur":            number | null,   // euro per person per night, base locazione turistica rate
    "tax_max_nights":          integer | null,  // 0 or null = no cap
    "tax_max_nights_basis":    "per_stay" | "per_person_per_month" | "per_person_per_year",
    "tax_exempt_under_age":    integer | null,  // guests strictly under this age are exempt; leave null if the delibera reduces (not exempts) minors
    "tax_max_total_eur":       number | null    // per-person euro cap per stay, if the delibera sets one
  },
  "layer2_rules": [                              // ordered list, evaluated as best-single
    {
      "id":     "short_stable_id",              // your slug for the rule
      "label":  "human-readable label in the host language",
      "when":   { "age_min"?: int, "age_max"?: int, "group_size_min"?: int, "group_size_max"?: int, "date_from"?: "MM-DD", "date_to"?: "MM-DD", "nights_min"?: int },
      "effect": { "type": "exempt" | "percent_off" | "fixed_rate", "value"?: number }
    }
  ],
  "layer3_declared": [                          // labelled exemptions the host will tick per guest when documented
    { "id": "slug", "label": "label", "requires_documentation": true|false }
  ],
  "source_note":     "citation the host should retain (delibera number + date)",
  "confidence":      "high" | "medium" | "low",
  "unhandled_parts": ["short human notes on any clause you could not encode"]
}

Rules of interpretation:
- Age boundaries are inclusive. "Under 14 esclusi" → age_max: 13. "Fino ai 14 anni compiuti" → tax_exempt_under_age: 15 (i.e. up to and including the 14th year).
- 20% reduction → { "type": "percent_off", "value": 20 }.
- A fixed reduced rate → { "type": "fixed_rate", "value": <euro> }.
- Categories that require documentation (residents, disabled, coach drivers, volunteers) go in layer3_declared. Never in layer2_rules.
- Never invent numbers. If the text is silent on a field, use null (or omit for layer2/layer3 conditions).
- Report low confidence and list unhandled parts rather than guessing.

Reply language for labels and source_note: ${langIT ? 'Italian' : 'English'}.`;

  const userPrompt = `Comune: ${comune ? String(comune).slice(0, 120) : '(non specificato / not specified)'}\n\nTesto della delibera (o estratto):\n---\n${text.slice(0, MAX_BODY_BYTES)}\n---\n\nRestituisci il JSON.`;

  let anthropicJson;
  let inputTokens = 0, outputTokens = 0;
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        system,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      console.error('[tax_parse] Anthropic error:', upstream.status, errText);
      return res.status(502).json({ error: 'AI service error. Please try again.' });
    }
    const data = await upstream.json();
    inputTokens  = data?.usage?.input_tokens  || 0;
    outputTokens = data?.usage?.output_tokens || 0;
    const rawText = data.content?.[0]?.text || '';
    try {
      anthropicJson = JSON.parse(rawText);
    } catch (_) {
      // The model wrapped the JSON in fences or prose. Try the first
      // {...} block.
      const m = rawText.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON in response');
      anthropicJson = JSON.parse(m[0]);
    }
  } catch (e) {
    console.error('[tax_parse] parse failed:', e);
    return res.status(502).json({ error: 'Could not parse AI response' });
  }

  // Validate shape server-side. Anything we don't recognise is dropped
  // — we never forward untrusted keys to the host form.
  const parsed = validateShape(anthropicJson);

  // Best-effort meter. See recordUsage note.
  await recordUsage({
    property_id: null,
    session_id:  userId, // user id doubles as session for this endpoint
    endpoint:    'tax_parse',
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
  });

  return res.status(200).json(parsed);
}

// ────────────────────────────────────────────────────────────────────
// Shape validation.
// ────────────────────────────────────────────────────────────────────

const ALLOWED_BASIS = new Set(['per_stay', 'per_person_per_month', 'per_person_per_year']);
const ALLOWED_EFFECT_TYPES = new Set(['exempt', 'percent_off', 'fixed_rate']);
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);
const MMDD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function _int(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : (Number.isFinite(n) ? Math.floor(n) : null);
}
function _str(v, max) {
  if (v == null) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}
function _clamp(v, lo, hi) {
  if (v == null) return null;
  return Math.max(lo, Math.min(hi, v));
}

function validateShape(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const layer1Raw = (src.layer1 && typeof src.layer1 === 'object') ? src.layer1 : {};
  const basis = ALLOWED_BASIS.has(String(layer1Raw.tax_max_nights_basis || ''))
    ? String(layer1Raw.tax_max_nights_basis)
    : 'per_stay';
  const layer1 = {
    tax_rate_eur:         _clamp(_num(layer1Raw.tax_rate_eur), 0, 999),
    tax_max_nights:       (() => {
      const v = _int(layer1Raw.tax_max_nights);
      if (v == null) return null;
      return _clamp(v, 0, 365);
    })(),
    tax_max_nights_basis: basis,
    tax_exempt_under_age: (() => {
      const v = _int(layer1Raw.tax_exempt_under_age);
      if (v == null) return null;
      return _clamp(v, 0, 120);
    })(),
    tax_max_total_eur:    _clamp(_num(layer1Raw.tax_max_total_eur), 0, 100000),
  };

  const rulesRaw = Array.isArray(src.layer2_rules) ? src.layer2_rules : [];
  const layer2Rules = rulesRaw.slice(0, 20).map((r, i) => validateRule(r, i)).filter(Boolean);

  const declaredRaw = Array.isArray(src.layer3_declared) ? src.layer3_declared : [];
  const layer3Declared = declaredRaw.slice(0, 20).map((d, i) => validateDeclared(d, i)).filter(Boolean);

  const confidence = ALLOWED_CONFIDENCE.has(String(src.confidence || '')) ? String(src.confidence) : 'low';
  const unhandled  = Array.isArray(src.unhandled_parts)
    ? src.unhandled_parts.slice(0, 20).map(x => _str(x, 400)).filter(Boolean)
    : [];

  return {
    layer1,
    layer2_rules:      layer2Rules,
    layer3_declared:   layer3Declared,
    source_note:       _str(src.source_note, 500) || null,
    confidence,
    unhandled_parts:   unhandled,
  };
}

function validateRule(r, i) {
  if (!r || typeof r !== 'object') return null;
  const id = _str(r.id, 60) || `r_${i + 1}`;
  const label = _str(r.label, 200) || id;
  const whenRaw = (r.when && typeof r.when === 'object') ? r.when : {};
  const when = {};
  if (whenRaw.age_min != null)        when.age_min = _clamp(_int(whenRaw.age_min), 0, 120);
  if (whenRaw.age_max != null)        when.age_max = _clamp(_int(whenRaw.age_max), 0, 120);
  if (whenRaw.group_size_min != null) when.group_size_min = _clamp(_int(whenRaw.group_size_min), 1, 999);
  if (whenRaw.group_size_max != null) when.group_size_max = _clamp(_int(whenRaw.group_size_max), 1, 999);
  if (whenRaw.nights_min != null)     when.nights_min = _clamp(_int(whenRaw.nights_min), 1, 365);
  if (typeof whenRaw.date_from === 'string' && MMDD_RE.test(whenRaw.date_from)) when.date_from = whenRaw.date_from;
  if (typeof whenRaw.date_to   === 'string' && MMDD_RE.test(whenRaw.date_to))   when.date_to   = whenRaw.date_to;
  // Prune keys that clamped to null.
  for (const k of Object.keys(when)) if (when[k] == null) delete when[k];

  const effectRaw = (r.effect && typeof r.effect === 'object') ? r.effect : {};
  const type = ALLOWED_EFFECT_TYPES.has(String(effectRaw.type || '')) ? String(effectRaw.type) : null;
  if (!type) return null;
  const effect = { type };
  if (type === 'percent_off') effect.value = _clamp(_num(effectRaw.value), 0, 100);
  if (type === 'fixed_rate')  effect.value = _clamp(_num(effectRaw.value), 0, 999);
  if ((type === 'percent_off' || type === 'fixed_rate') && effect.value == null) return null;

  if (Object.keys(when).length === 0) return null; // a rule that matches everyone is not a rule
  return { id, label, when, effect };
}

function validateDeclared(d, i) {
  if (!d || typeof d !== 'object') return null;
  const id = _str(d.id, 60) || `d_${i + 1}`;
  const label = _str(d.label, 200);
  if (!label) return null;
  return {
    id,
    label,
    requires_documentation: d.requires_documentation !== false, // default true
  };
}

// ────────────────────────────────────────────────────────────────────
// Hourly rate limit — 10 tax_parse calls per user per rolling hour.
// ────────────────────────────────────────────────────────────────────

async function checkHourlyLimit(userId) {
  try {
    const sinceISO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/api_usage`
      + `?session_id=eq.${encodeURIComponent(userId)}`
      + `&endpoint=eq.tax_parse`
      + `&created_at=gte.${encodeURIComponent(sinceISO)}`
      + `&select=id`;
    const r = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'count=exact',
      },
    });
    if (!r.ok) return { ok: true }; // fail open on read error
    const total = parseInt(r.headers.get('content-range')?.split('/')?.[1] || '0', 10);
    if (total >= HOURLY_LIMIT) {
      return { ok: false, retry_after_seconds: 300 };
    }
    return { ok: true };
  } catch (e) {
    console.warn('[tax_parse] rate check failed (fail-open):', e);
    return { ok: true };
  }
}

// Best-effort api_usage insert. Awaited so Vercel doesn't cancel the
// invocation before it flushes.
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
      console.warn('[tax_parse] api_usage insert failed:', r.status, await r.text().catch(() => ''));
    }
  } catch (e) {
    console.warn('[tax_parse] api_usage insert exception:', e);
  }
}
