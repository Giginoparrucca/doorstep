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

// Round 45 Step 4.5 — outbound iCal export mode. A GET with a valid
// ?t=<uuid> is the property-ical feed: no login required, the token
// IS the auth. Consolidated into this file (rather than a separate
// endpoint) so we stay under the Hobby-plan 12-function cap.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  // OUTBOUND EXPORT mode — GET /api/ical-sync?t=<property_ical_export_token>
  // Public feed guarded by the per-property token; emits ZERO PII.
  const exportToken = String((req.query || {}).t || (req.query || {}).token || '').trim();
  if ((req.method === 'GET' || req.method === 'HEAD') && UUID_RE.test(exportToken)) {
    return await handleOutboundExport(req, res, exportToken);
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
      let rows = events.map(e => vEventToRow(e, propertyId, platform));

      // Round 47.1 — drop oversized Airbnb blocks before the upsert.
      // The sweep below will cancel any already-stored row with that
      // UID because the UID won't be in seenByPlatform for this run.
      //
      // Also drop PAST/TODAY 1-night Airbnb blocks: Airbnb's iCal
      // echoes every unbooked night as a 1-night block, including
      // "today" the moment Airbnb's lead-time cutoff passes. Those
      // day-of blocks aren't actionable — just noise — and
      // accumulate into long trails across gaps between bookings.
      // We DO keep FUTURE 1-night blocks because those are much more
      // likely a host-intentional single-night block set in Airbnb's
      // own calendar (e.g. "my parents visit next Friday"). The
      // host can still override by adding a 1-night direct block
      // via "+ Block dates" (Round 45) if they want it on the
      // WelcomeBnB calendar regardless.
      if (platform === 'airbnb' && rows.length > 0) {
        const todayISO = new Date().toISOString().slice(0, 10);
        let dropLong = 0, drop1night = 0;
        rows = rows.filter(r => {
          if (r.entry_type !== 'block') return true;
          if (!r.checkin_date || !r.checkout_date) return true;
          const days = Math.round((Date.parse(r.checkout_date) - Date.parse(r.checkin_date)) / 86400000);
          if (days > AIRBNB_MAX_BLOCK_NIGHTS) { dropLong++; return false; }
          if (days <= 1 && r.checkin_date <= todayISO) { drop1night++; return false; }
          return true;
        });
        if (dropLong || drop1night) {
          console.log(`[ical-sync] airbnb block filter dropped ${dropLong} oversize + ${drop1night} day-of-1-night for ${propertyId}`);
        }
      }

      // Round 38.3 — Booking.com quirks:
      //
      // (a) Long-safety block. Booking's iCal exports a ~6-month "closed
      //     dates" event starting at today+1. Its summary is the same
      //     opaque "CLOSED - Not available" as a real reservation, so
      //     Round 36.2 classified it as reservation. Cap event length —
      //     a real Booking.com reservation is not 60+ nights.
      //
      // (b) UID rotation. Booking's iCal issues a fresh UID for the
      //     same reservation every day, and moves DTSTART forward as
      //     past nights fall behind "today". Our dedup was (property_id,
      //     platform, uid), so every morning we cancelled the old row
      //     and created a new one — booking_code changed daily, guest
      //     links broke, and the recorded arrival kept rolling forward
      //     with today. Merge by (checkout_date, entry_type) instead:
      //     if the DB already has an active reservation with the same
      //     checkout, treat the incoming event as the same reservation,
      //     update the UID and summary in place, and DO NOT let
      //     checkin_date move forward. That keeps the booking_code, the
      //     guest link, and the real arrival intact.
      if (platform === 'booking' && rows.length > 0) {
        rows = await mergeBookingRollingUIDs(propertyId, rows, apikey, bearer, seenByPlatform);
      }

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
  // Round 45 Step 5 — covered rows (linked to a direct booking) get
  // coverage_lost_at stamped alongside the cancellation so the dashboard
  // can surface a "⚠️ Airbnb block for <guest> is gone" warning on the
  // direct row. Normal rows just flip to cancelled as before.
  const todayISO = new Date().toISOString().slice(0, 10);
  const nowISO = new Date().toISOString();
  let cancelled = 0;
  for (const [platform, uids] of Object.entries(seenByPlatform)) {
    try {
      // Round 47.1 — the sweep now covers:
      //   • reservations with checkin_date >= today  (unchanged)
      //   • blocks of ANY date                        (new)
      // Previously the sweep ignored past-dated rows, which meant
      // Airbnb's "Not available" blocks accumulated forever after
      // their check-in day passed — cluttering the calendar with
      // dozens of stale `Unavailable` bars (see Round 47.1
      // post-ship incident). We never cancel past-dated reservations,
      // because those represent real stays we may have filed with
      // Alloggiati and need the audit trail.
      const listRes = await pgrestGET(
        `ota_reservations?property_id=eq.${encodeURIComponent(propertyId)}` +
        `&platform=eq.${encodeURIComponent(platform)}` +
        `&status=eq.active` +
        `&or=(checkin_date.gte.${todayISO},entry_type.eq.block)` +
        `&select=id,uid,covered_by_reservation_id`,
        apikey, bearer,
      );
      if (!listRes.ok) continue;
      const candidates = await listRes.json();
      const gone = candidates.filter(r => !uids.has(r.uid));
      const coveredIds = gone.filter(r => r.covered_by_reservation_id).map(r => r.id);
      const plainIds   = gone.filter(r => !r.covered_by_reservation_id).map(r => r.id);

      if (plainIds.length > 0) {
        const ids = plainIds.map(id => `"${id}"`).join(',');
        const cancelRes = await pgrestPATCH(
          `ota_reservations?id=in.(${ids})`,
          { status: 'cancelled' },
          apikey, bearer,
        );
        if (cancelRes.ok) {
          const updated = await cancelRes.json();
          cancelled += Array.isArray(updated) ? updated.length : plainIds.length;
        }
      }
      if (coveredIds.length > 0) {
        const ids = coveredIds.map(id => `"${id}"`).join(',');
        const cancelRes = await pgrestPATCH(
          `ota_reservations?id=in.(${ids})`,
          { status: 'cancelled', coverage_lost_at: nowISO },
          apikey, bearer,
        );
        if (cancelRes.ok) {
          const updated = await cancelRes.json();
          cancelled += Array.isArray(updated) ? updated.length : coveredIds.length;
        }
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

// Round 38.3 · Booking.com sync repair.
//   1. Cap long-safety blocks. Anything > BOOKING_MAX_RES_NIGHTS is
//      not a reservation — it's Booking's blanket "closed dates" event.
//   2. Merge rolling UIDs against an existing active reservation with
//      the same checkout_date (+ entry_type), patching the UID/summary
//      in place instead of cancel-and-recreate. Preserves checkin_date
//      (never rolls forward) and preserves the booking_code so the
//      guest link the host already shared keeps working.
const BOOKING_MAX_RES_NIGHTS = 60;
// Round 47.1 — Airbnb's iCal feed also carries a long-safety "closed
// future dates" block (observed: a 96-night block Jun 29 2027 → Oct 3
// 2027). Not a bug on their end — it's how Airbnb communicates far-
// future availability to iCal consumers. For our calendar it just
// paints a huge "Unavailable" bar over a season the host isn't
// actually blocking. Filter blocks longer than this before upsert;
// the sweep will then cancel any already-stored ones because their
// UID won't be in seenByPlatform this run.
const AIRBNB_MAX_BLOCK_NIGHTS = 60;

async function mergeBookingRollingUIDs(propertyId, incoming, apikey, bearer, seenByPlatform) {
  const keptRows = [];
  seenByPlatform.booking = seenByPlatform.booking || new Set();

  // Pass 1 — length cap: turn long events into blocks so downstream
  // panels (Upcoming, Currently Staying) ignore them.
  for (const r of incoming) {
    if (r.entry_type === 'reservation' && r.checkin_date && r.checkout_date) {
      const days = Math.round((Date.parse(r.checkout_date) - Date.parse(r.checkin_date)) / 86400000);
      if (days > BOOKING_MAX_RES_NIGHTS) r.entry_type = 'block';
    }
  }

  // Pass 2 — merge rolling UIDs. For each reservation-shaped event,
  // look for an existing active row (any UID) with the same platform
  // + checkout_date + entry_type. If found, PATCH its uid/summary/raw
  // to the new values, keep checkin_date, tell the cancel sweep the
  // OLD uid is "seen" (via the row's now-updated new uid) and skip
  // the upsert for this row.
  for (const r of incoming) {
    if (r.entry_type !== 'reservation') { keptRows.push(r); continue; }
    let matchList = [];
    try {
      // Round 45 Step 4 — covered_by_reservation_id=is.null. A covered
      // Booking echo (already linked to a direct booking) must not be
      // matched as the "same" reservation for a UID rotation — that
      // would silently move the covered link onto a live incoming
      // booking, breaking both.
      const q = 'ota_reservations?'
        + `property_id=eq.${encodeURIComponent(propertyId)}`
        + `&platform=eq.booking`
        + `&entry_type=eq.reservation`
        + `&status=eq.active`
        + `&deleted_at=is.null`
        + `&covered_by_reservation_id=is.null`
        + `&checkout_date=eq.${encodeURIComponent(r.checkout_date)}`
        + `&uid=neq.${encodeURIComponent(r.uid)}`
        + `&select=id,uid,checkin_date`;
      const res = await pgrestGET(q, apikey, bearer);
      if (res.ok) matchList = await res.json();
    } catch (_) { matchList = []; }
    // No existing match — treat as a genuinely new reservation.
    if (matchList.length === 0) { keptRows.push(r); continue; }
    // Deterministic pick: the earliest-arriving row wins. Booking's
    // trim behaviour only moves DTSTART forward, so the earliest one
    // is the true original arrival.
    matchList.sort((a, b) => String(a.checkin_date || '').localeCompare(String(b.checkin_date || '')));
    const target = matchList[0];
    const patchBody = {
      uid: r.uid,
      summary: r.summary,
      raw: r.raw,
      status: 'active',
      updated_at: new Date().toISOString(),
    };
    try {
      await pgrestPATCH(
        `ota_reservations?id=eq.${encodeURIComponent(target.id)}`,
        patchBody, apikey, bearer,
      );
      // The row now carries r.uid, so the cancel sweep will see it as
      // still present in the feed.
      seenByPlatform.booking.add(r.uid);
      // If there are additional stray duplicates at the same checkout,
      // let the cancel sweep pick them up.
    } catch (e) {
      // Merge failed — fall back to normal upsert so we don't drop the
      // event entirely.
      keptRows.push(r);
    }
  }
  return keptRows;
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

  // Round 36.2 fix: Booking.com's iCal export uses "CLOSED - Not available"
  // as the SUMMARY for every event, including real paid reservations — the
  // platform simply does not expose guest info in iCal. So the generic
  // "closed/not available" → block rule mis-classifies EVERY Booking.com
  // reservation as a block, and the host dashboard (which filters to
  // entry_type='reservation') never shows any of them. For Booking.com,
  // treat every event as a reservation. Airbnb and Vrbo do distinguish
  // ("Reserved" or a guest name for real bookings, "Airbnb (Not available)"
  // or similar for host-set blocks), so keep the regex behaviour there.
  const isBlock = platform === 'booking'
    ? false
    : /not available|blocked|closed - not available|closed \(/i.test(summary);
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

/* ══════════════════════════════════════════════════════════════════════
   Round 45 Step 4.5 — OUTBOUND iCal EXPORT
   ─────────────────────────────────────────────────────────────────────
   URL: GET /api/ical-sync?t=<properties.ical_export_token>
   Host pastes this URL into Airbnb/Booking/Vrbo's "Import calendar".
   Emits RFC-5545 iCal with ZERO PII (no guest names, no contacts, no
   booking codes) — only date ranges + generic "Blocked"/"Reserved".
════════════════════════════════════════════════════════════════════════ */

const OUTBOUND_PAST_WINDOW_DAYS   = 30;
const OUTBOUND_FUTURE_HORIZON_DAYS = 730;

function _outboundISOStamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function _outboundISODate(yyyyMmDd) {
  if (!yyyyMmDd) return null;
  return String(yyyyMmDd).replace(/-/g, '').slice(0, 8);
}
function _outboundIcsEscape(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}
function _outboundFoldLine(line) {
  const OCTET_LIMIT = 74;
  if (line.length <= OCTET_LIMIT) return line;
  const out = [];
  let start = 0;
  while (start < line.length) {
    out.push((start === 0 ? '' : ' ') + line.slice(start, start + OCTET_LIMIT));
    start += OCTET_LIMIT;
  }
  return out.join('\r\n');
}
async function _outboundSbGetJSON(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: 'GET',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}
function _outboundSummaryFor(row, hostLang) {
  const isBlock = row.entry_type === 'block';
  if (hostLang === 'it') return isBlock ? 'Bloccato' : 'Prenotato';
  return isBlock ? 'Blocked' : 'Reserved';
}

async function handleOutboundExport(req, res, token) {
  if (!SERVICE_KEY) {
    console.error('[ical-export] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).send('Server misconfigured');
  }

  let property;
  try {
    const rows = await _outboundSbGetJSON(
      `properties?ical_export_token=eq.${encodeURIComponent(token)}&deleted_at=is.null&select=id,name,host_language,timezone&limit=1`
    );
    property = Array.isArray(rows) && rows[0];
  } catch (e) {
    console.error('[ical-export] property lookup failed:', e.message);
    return res.status(500).send('Server error');
  }
  if (!property) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send('Not Found');
  }

  const now = new Date();
  const pastCutoff = new Date(now.getTime() - OUTBOUND_PAST_WINDOW_DAYS * 86400000);
  const futureCutoff = new Date(now.getTime() + OUTBOUND_FUTURE_HORIZON_DAYS * 86400000);
  const pastISO   = pastCutoff.toISOString().slice(0, 10);
  const futureISO = futureCutoff.toISOString().slice(0, 10);

  let rows;
  try {
    rows = await _outboundSbGetJSON(
      `ota_reservations` +
      `?property_id=eq.${encodeURIComponent(property.id)}` +
      `&status=eq.active` +
      `&deleted_at=is.null` +
      `&covered_by_reservation_id=is.null` +
      `&entry_type=in.(reservation,block)` +
      `&checkout_date=gte.${pastISO}` +
      `&checkin_date=lte.${futureISO}` +
      `&select=id,uid,entry_type,checkin_date,checkout_date,updated_at` +
      `&order=checkin_date.asc`
    );
  } catch (e) {
    console.error('[ical-export] rows lookup failed:', e.message);
    return res.status(500).send('Server error');
  }

  const hostLang = (property.host_language || 'it').toLowerCase() === 'en' ? 'en' : 'it';
  const dtstamp = _outboundISOStamp(now);
  const prodid = '-//WelcomeBnB//Property Calendar//EN';
  const nameForHeader = `WelcomeBnB — ${property.name}`;

  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${_outboundIcsEscape(prodid)}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(_outboundFoldLine(`X-WR-CALNAME:${_outboundIcsEscape(nameForHeader)}`));
  lines.push(_outboundFoldLine(`NAME:${_outboundIcsEscape(nameForHeader)}`));
  lines.push(`X-WR-TIMEZONE:${_outboundIcsEscape(property.timezone || 'Europe/Rome')}`);

  for (const r of (rows || [])) {
    const start = _outboundISODate(r.checkin_date);
    const end   = _outboundISODate(r.checkout_date);
    if (!start || !end) continue;
    // Round 46 — DO NOT change this UID domain. iCal consumers
    // (Airbnb, Booking, Vrbo) use the UID as the event's stable
    // identity. If this string changes, every event becomes "new" at
    // the consumer, and OTAs can create duplicate blocks for stays
    // we're already covering. The @welcomebnb.vercel.app suffix is a
    // UID component, not a URL — nothing dereferences it — so the
    // domain move does not require touching it.
    const uid = `${(r.uid || r.id).replace(/[<>\s]/g, '_')}@welcomebnb.vercel.app`;
    const summary = _outboundSummaryFor(r, hostLang);
    const lastMod = r.updated_at ? _outboundISOStamp(new Date(r.updated_at)) : dtstamp;
    lines.push('BEGIN:VEVENT');
    lines.push(_outboundFoldLine(`UID:${_outboundIcsEscape(uid)}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`LAST-MODIFIED:${lastMod}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(_outboundFoldLine(`SUMMARY:${_outboundIcsEscape(summary)}`));
    lines.push('TRANSP:OPAQUE');
    lines.push('STATUS:CONFIRMED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  const body = lines.join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="welcomebnb-${property.id.slice(0, 8)}.ics"`);
  res.setHeader('Cache-Control', 'public, max-age=1800');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(body);
}
