// api/ical-sync.js — Round 26 iCal calendar sync.
//
// Hosts paste their Airbnb / Booking.com / Vrbo iCal export URLs into the
// host console. This endpoint fetches each feed server-side (Airbnb blocks
// browser fetches with CORS), hand-parses the ICS, and upserts into
// ota_reservations. Any active future row whose UID wasn't in the feed is
// marked status='cancelled' — never deleted.
//
// IMPORTANT: no iCal feed contains guest count. Airbnb summaries are just
// "Reserved" (no name either). We only store what the feed actually gave us;
// guest name and count in the UI come from the checkins table.
//
// Request:  { property_id: uuid }, Authorization: Bearer <supabase_jwt>
// Response: { synced, created, updated, cancelled, per_feed, errors }
//
// Env vars (with public-key fallbacks so a fresh deploy works out of the box —
// the anon key is already shipped in the client HTML):
//   SUPABASE_URL, SUPABASE_ANON_KEY

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';

const FETCH_TIMEOUT_MS = 10_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const jwt = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: 'Missing bearer token' });

  const { property_id } = req.body || {};
  if (!property_id || typeof property_id !== 'string') {
    return res.status(400).json({ error: 'property_id required' });
  }

  // 1. Verify the JWT and get the user id.
  let userId;
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

  // 2. Verify the caller owns this property and pull its feeds. Uses the
  // caller's own JWT so RLS is the source of truth for ownership.
  let property;
  try {
    const propRes = await pgrestGET(
      `properties?id=eq.${encodeURIComponent(property_id)}&select=id,ical_feeds`,
      jwt,
    );
    if (!propRes.ok) {
      const t = await propRes.text();
      return res.status(500).json({ error: 'Property lookup failed', detail: t });
    }
    const rows = await propRes.json();
    property = rows[0];
    if (!property) return res.status(403).json({ error: 'Property not found or not owned by caller' });
  } catch (e) {
    return res.status(500).json({ error: 'Property lookup exception', detail: String(e) });
  }

  const feeds = Array.isArray(property.ical_feeds) ? property.ical_feeds : [];
  if (feeds.length === 0) {
    return res.status(200).json({
      synced: 0, created: 0, updated: 0, cancelled: 0,
      per_feed: [], errors: [], message: 'No feeds configured',
    });
  }

  // 3. Fetch + parse each feed. One bad feed must not fail the whole sync.
  const perFeed = [];
  const errors = [];
  const seenByPlatform = {}; // platform -> Set(uid) — used later to cancel disappeared rows

  for (const feed of feeds) {
    const platform = normalizePlatform(feed?.platform);
    const url = typeof feed?.url === 'string' ? feed.url.trim() : '';
    if (!url) {
      errors.push({ platform, url, error: 'Empty URL' });
      continue;
    }
    try {
      const text = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      const events = parseICS(text);
      const rows = events.map(e => vEventToRow(e, property_id, platform));
      perFeed.push({ platform, url, parsed: rows.length });
      if (!seenByPlatform[platform]) seenByPlatform[platform] = new Set();
      rows.forEach(r => seenByPlatform[platform].add(r.uid));
      // Upsert this feed's rows.
      if (rows.length > 0) {
        const upsertRes = await pgrestUPSERT('ota_reservations', rows, jwt);
        if (!upsertRes.ok) {
          const t = await upsertRes.text();
          errors.push({ platform, url, error: 'Upsert failed', detail: t });
        }
      }
    } catch (e) {
      errors.push({ platform, url, error: String(e && e.message || e) });
    }
  }

  // 4. Cancel active future rows whose UID vanished from the feed.
  // Only run per-platform where we successfully fetched something.
  const todayISO = new Date().toISOString().slice(0, 10);
  let cancelled = 0;
  for (const [platform, uids] of Object.entries(seenByPlatform)) {
    try {
      // Fetch candidates
      const listRes = await pgrestGET(
        `ota_reservations?property_id=eq.${encodeURIComponent(property_id)}` +
        `&platform=eq.${encodeURIComponent(platform)}` +
        `&status=eq.active&checkin_date=gte.${todayISO}` +
        `&select=id,uid`,
        jwt,
      );
      if (!listRes.ok) continue;
      const candidates = await listRes.json();
      const toCancel = candidates.filter(r => !uids.has(r.uid)).map(r => r.id);
      if (toCancel.length === 0) continue;
      const ids = toCancel.map(id => `"${id}"`).join(',');
      const cancelRes = await pgrestPATCH(
        `ota_reservations?id=in.(${ids})`,
        { status: 'cancelled' },
        jwt,
      );
      if (cancelRes.ok) {
        const updated = await cancelRes.json();
        cancelled += Array.isArray(updated) ? updated.length : toCancel.length;
      }
    } catch (e) {
      errors.push({ platform, error: 'Cancel sweep failed: ' + String(e) });
    }
  }

  // 5. Stamp ical_last_synced_at on the property.
  try {
    await pgrestPATCH(
      `properties?id=eq.${encodeURIComponent(property_id)}`,
      { ical_last_synced_at: new Date().toISOString() },
      jwt,
    );
  } catch (e) { /* non-fatal */ }

  // Count created vs updated: PostgREST upserts with resolution=merge-duplicates
  // don't tell us which was which. Approximate by counting parsed rows; the
  // UI treats "synced" as the useful number.
  const synced = perFeed.reduce((a, f) => a + f.parsed, 0);

  return res.status(200).json({
    synced,
    created: null,   // not distinguishable via PostgREST upsert
    updated: null,
    cancelled,
    per_feed: perFeed,
    errors,
  });
}

// ── Supabase PostgREST helpers ─────────────────────────────────────────
function pgrestGET(path, jwt) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/json',
    },
  });
}
function pgrestPATCH(path, body, jwt) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}
function pgrestUPSERT(table, rows, jwt) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=property_id,platform,uid`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
}

// ── HTTP with timeout ──────────────────────────────────────────────────
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'WelcomeBnB-iCal-Sync/1 (+https://welcomebnb.app)' },
    });
    if (!r.ok) throw new Error(`Feed HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// ── ICS parser (RFC 5545 subset) ───────────────────────────────────────
// Unfolds continuation lines (per RFC 5545 §3.1: any line beginning with a
// space or tab is a continuation of the previous line, and the leading
// whitespace is dropped), then walks VEVENT blocks.
function parseICS(text) {
  // Normalize line endings, then unfold.
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }

  const events = [];
  let current = null;
  for (const raw of unfolded) {
    if (raw === 'BEGIN:VEVENT') { current = {}; continue; }
    if (raw === 'END:VEVENT') {
      if (current && current.UID) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = raw.indexOf(':');
    if (idx < 0) continue;
    const keyPart = raw.slice(0, idx); // may include params, e.g. DTSTART;VALUE=DATE
    const value = raw.slice(idx + 1);
    const semi = keyPart.indexOf(';');
    const key = (semi >= 0 ? keyPart.slice(0, semi) : keyPart).toUpperCase();
    const params = semi >= 0 ? keyPart.slice(semi + 1) : '';
    if (key === 'UID')         current.UID = value;
    else if (key === 'SUMMARY') current.SUMMARY = unescapeICSText(value);
    else if (key === 'DESCRIPTION') current.DESCRIPTION = unescapeICSText(value);
    else if (key === 'DTSTART') current.DTSTART = { value, params };
    else if (key === 'DTEND')   current.DTEND   = { value, params };
    else if (key === 'STATUS')  current.STATUS  = value;
  }
  return events;
}
function unescapeICSText(v) {
  return v.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function icsDateToISO(field) {
  if (!field || !field.value) return null;
  const v = field.value;
  // DATE form: YYYYMMDD (VALUE=DATE)
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
  // DATE-TIME form: YYYYMMDDTHHMMSS[Z] — take the date portion.
  const dt = /^(\d{4})(\d{2})(\d{2})T/.exec(v);
  if (dt) return `${dt[1]}-${dt[2]}-${dt[3]}`;
  return null;
}

// ── VEVENT → ota_reservations row ──────────────────────────────────────
function vEventToRow(ev, propertyId, platform) {
  const summary = ev.SUMMARY || '';
  const description = ev.DESCRIPTION || '';

  const isBlock = /not available|blocked|closed - not available|closed \(/i.test(summary);
  const entry_type = isBlock ? 'block' : 'reservation';
  const status = /^CANCELLED$/i.test(ev.STATUS || '') ? 'cancelled' : 'active';

  // Airbnb / Booking / Vrbo all set DTEND to the actual departure day
  // (checkout), so we use it directly — no -1 day adjustment.
  const checkin_date  = icsDateToISO(ev.DTSTART);
  const checkout_date = icsDateToISO(ev.DTEND);

  // guest_name: null for the bare "Reserved" summary Airbnb ships. Otherwise
  // strip the known-block prefixes ("CLOSED - ", "Reserved - ") and use the
  // remainder. Never fabricate.
  let guest_name = null;
  if (!isBlock && summary && !/^reserved\s*$/i.test(summary.trim())) {
    guest_name = summary
      .replace(/^\s*(CLOSED\s*-\s*|Reserved\s*-\s*)/i, '')
      .trim() || null;
  }

  // Reservation URL + phone last-4 from DESCRIPTION.
  let reservation_url = null;
  const urlMatch = description.match(/https?:\/\/\S+/);
  if (urlMatch) reservation_url = urlMatch[0].replace(/[)\].,;]+$/, '');

  let phone_last4 = null;
  // Common shapes: "Phone Number (Last 4 Digits): 1234" or "...ends in 1234".
  const p1 = description.match(/(?:last\s*4|ultime\s*4).{0,20}?(\d{4})/i);
  if (p1) phone_last4 = p1[1];

  return {
    property_id: propertyId,
    platform,
    uid: ev.UID,
    entry_type,
    status,
    summary,
    guest_name,
    checkin_date,
    checkout_date,
    reservation_url,
    phone_last4,
    raw: { summary, description, dtstart: ev.DTSTART?.value, dtend: ev.DTEND?.value },
  };
}

function normalizePlatform(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'airbnb' || s === 'booking' || s === 'vrbo') return s;
  return 'other';
}

// Named exports for local testing. Vercel serverless functions only use the
// default export; these are inert at runtime and only touched by tests.
export { parseICS, vEventToRow, icsDateToISO, normalizePlatform };
