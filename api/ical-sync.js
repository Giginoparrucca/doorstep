// api/ical-sync.js — Round 26 iCal calendar sync (with Round 32.5 cron mode).
//
// Two modes:
//
//   1. USER: existing "Sync now" button from the host console.
//      POST { property_id }, Authorization: Bearer <supabase_jwt>
//      Response: { synced, cancelled, per_feed, errors }
//
//   2. CRON: daily automatic sync via Vercel cron (see vercel.json).
//      GET or POST, Authorization: Bearer <CRON_SECRET>, no body.
//      Iterates every property with at least one ical_feed and syncs it
//      using SUPABASE_SERVICE_ROLE_KEY so RLS is bypassed.
//      Response: { total_properties, per_property: [...], synced, cancelled }
//
// Airbnb blocks browser fetches with CORS, so both modes go through this
// server-side handler. IMPORTANT: no iCal feed contains guest count.
// Airbnb summaries are just "Reserved" (no name either). We only store
// what the feed actually gave us; guest name and count in the UI come
// from the checkins table.
//
// Env vars:
//   SUPABASE_URL, SUPABASE_ANON_KEY   — public defaults below
//   SUPABASE_SERVICE_ROLE_KEY         — required for CRON mode
//   CRON_SECRET                       — matches Vercel cron's Bearer header

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://jcjwaqqabgwqhhzhfbts.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpjandhcXFhYmd3cWhoemhmYnRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4OTM0MjMsImV4cCI6MjA4OTQ2OTQyM30.BCskfjawOLqayI7xXV8ebIBEcXf12WygH52w204NzWk';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const FETCH_TIMEOUT_MS = 10_000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const auth = req.headers['authorization'] || req.headers['Authorization'];
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });

  // CRON mode — Vercel cron sends the CRON_SECRET as the Bearer token.
  if (CRON_SECRET && token === CRON_SECRET) {
    if (!SERVICE_KEY) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
    return await handleCronSync(res);
  }

  // USER mode — treat the token as a Supabase user JWT.
  return await handleUserSync(req, res, token);
}

// ── USER mode: sync one owned property, RLS-scoped ─────────────────────
async function handleUserSync(req, res, jwt) {
  const { property_id } = req.body || {};
  if (!property_id || typeof property_id !== 'string') {
    return res.status(400).json({ error: 'property_id required' });
  }

  // 1. Verify the JWT and get the user id.
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Invalid token' });
  } catch (e) {
    return res.status(401).json({ error: 'Auth check failed' });
  }

  // 2. Verify the caller owns this property and pull its feeds. Uses the
  // caller's own JWT so RLS is the source of truth for ownership.
  let property;
  try {
    const propRes = await pgrestGET(
      `properties?id=eq.${encodeURIComponent(property_id)}&select=id,ical_feeds`,
      SUPABASE_ANON_KEY, jwt,
    );
    if (!propRes.ok) {
      return res.status(500).json({ error: 'Property lookup failed', detail: await propRes.text() });
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
      synced: 0, cancelled: 0, per_feed: [], errors: [], message: 'No feeds configured',
    });
  }

  const result = await syncOnePropertyFeeds(property_id, feeds, SUPABASE_ANON_KEY, jwt);
  return res.status(200).json(result);
}

// ── CRON mode: iterate every property with feeds, service_role auth ────
async function handleCronSync(res) {
  const auth = [SERVICE_KEY, SERVICE_KEY]; // apikey + bearer
  let props;
  try {
    const r = await pgrestGET(
      'properties?select=id,name,ical_feeds&deleted_at=is.null',
      auth[0], auth[1],
    );
    if (!r.ok) {
      return res.status(500).json({ error: 'Load properties failed', detail: await r.text() });
    }
    props = await r.json();
  } catch (e) {
    return res.status(500).json({ error: 'Load properties exception', detail: String(e) });
  }

  const withFeeds = (props || []).filter(p =>
    Array.isArray(p.ical_feeds) && p.ical_feeds.length > 0
  );

  const perProperty = [];
  let totalSynced = 0, totalCancelled = 0;
  for (const p of withFeeds) {
    try {
      const r = await syncOnePropertyFeeds(p.id, p.ical_feeds, auth[0], auth[1]);
      totalSynced    += r.synced || 0;
      totalCancelled += r.cancelled || 0;
      perProperty.push({
        property_id: p.id, name: p.name,
        synced: r.synced, cancelled: r.cancelled,
        errors: r.errors,
      });
    } catch (e) {
      perProperty.push({ property_id: p.id, name: p.name, error: String(e) });
    }
  }

  return res.status(200).json({
    ok: true,
    total_properties: withFeeds.length,
    synced: totalSynced,
    cancelled: totalCancelled,
    per_property: perProperty,
  });
}

// ── Sync one property's feeds, given whichever auth pair to use ────────
// Shared by USER (anon key + user JWT) and CRON (service_role for both).
async function syncOnePropertyFeeds(propertyId, feeds, apikey, bearer) {
  const perFeed = [];
  const errors = [];
  const seenByPlatform = {}; // platform -> Set(uid)

  for (const feed of feeds) {
    const platform = normalizePlatform(feed?.platform);
    const url = typeof feed?.url === 'string' ? feed.url.trim() : '';
    if (!url) { errors.push({ platform, url, error: 'Empty URL' }); continue; }
    try {
      const text = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      const events = parseICS(text);
      const rows = events.map(e => vEventToRow(e, propertyId, platform));
      perFeed.push({ platform, url, parsed: rows.length });
      if (!seenByPlatform[platform]) seenByPlatform[platform] = new Set();
      rows.forEach(r => seenByPlatform[platform].add(r.uid));
      if (rows.length > 0) {
        const upsertRes = await pgrestUPSERT('ota_reservations', rows, apikey, bearer);
        if (!upsertRes.ok) {
          errors.push({ platform, url, error: 'Upsert failed', detail: await upsertRes.text() });
        }
      }
    } catch (e) {
      errors.push({ platform, url, error: String(e && e.message || e) });
    }
  }

  // Cancel active future rows whose UID vanished from the feed. Only run
  // per-platform where we successfully fetched something.
  const todayISO = new Date().toISOString().slice(0, 10);
  let cancelled = 0;
  for (const [platform, uids] of Object.entries(seenByPlatform)) {
    try {
      const listRes = await pgrestGET(
        `ota_reservations?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&platform=eq.${encodeURIComponent(platform)}` +
        `&status=eq.active&checkin_date=gte.${todayISO}` +
        `&select=id,uid`,
        apikey, bearer,
      );
      if (!listRes.ok) continue;
      const candidates = await listRes.json();
      const toCancel = candidates.filter(r => !uids.has(r.uid)).map(r => r.id);
      if (toCancel.length === 0) continue;
      const ids = toCancel.map(id => `"${id}"`).join(',');
      const cancelRes = await pgrestPATCH(
        `ota_reservations?id=in.(${ids})`,
        { status: 'cancelled' },
        apikey, bearer,
      );
      if (cancelRes.ok) {
        const updated = await cancelRes.json();
        cancelled += Array.isArray(updated) ? updated.length : toCancel.length;
      }
    } catch (e) {
      errors.push({ platform, error: 'Cancel sweep failed: ' + String(e) });
    }
  }

  // Stamp ical_last_synced_at on the property.
  try {
    await pgrestPATCH(
      `properties?id=eq.${encodeURIComponent(propertyId)}`,
      { ical_last_synced_at: new Date().toISOString() },
      apikey, bearer,
    );
  } catch (e) { /* non-fatal */ }

  const synced = perFeed.reduce((a, f) => a + f.parsed, 0);
  return { synced, cancelled, per_feed: perFeed, errors };
}

// ── Supabase PostgREST helpers ─────────────────────────────────────────
// apikey is always sent; bearer defaults to apikey (service_role case),
// otherwise the caller passes the user JWT alongside the anon apikey.
function pgrestGET(path, apikey, bearer = apikey) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    },
  });
}
function pgrestPATCH(path, body, apikey, bearer = apikey) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
}
function pgrestUPSERT(table, rows, apikey, bearer = apikey) {
  return fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=property_id,platform,uid`, {
    method: 'POST',
    headers: {
      apikey,
      Authorization: `Bearer ${bearer}`,
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
    const keyPart = raw.slice(0, idx);
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
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
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

  let guest_name = null;
  if (!isBlock && summary && !/^reserved\s*$/i.test(summary.trim())) {
    guest_name = summary
      .replace(/^\s*(CLOSED\s*-\s*|Reserved\s*-\s*)/i, '')
      .trim() || null;
  }

  let reservation_url = null;
  const urlMatch = description.match(/https?:\/\/\S+/);
  if (urlMatch) reservation_url = urlMatch[0].replace(/[)\].,;]+$/, '');

  let phone_last4 = null;
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
