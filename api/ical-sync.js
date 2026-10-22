import { rejectInvalidEnvironment, SUPABASE_URL, SUPABASE_ANON_KEY, rejectDemoIntegration } from './_environment.js';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const CalendarRoundtrip = createRequire(import.meta.url)('../lib/calendar-roundtrip.js');
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


const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

const FETCH_TIMEOUT_MS = 10_000;

// Round 45 Step 4.5 — outbound iCal export mode. A GET with a valid
// ?t=<uuid> is the property-ical feed: no login required, the token
// IS the auth. Consolidated into this file (rather than a separate
// endpoint) so we stay under the Hobby-plan 12-function cap.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Round 60 Phase 2 — accept a feed's optional room_id only if it looks
// like a UUID. Anything malformed (empty, "undefined" string, random
// text from a bad JSONB edit) falls back to null (unassigned) rather
// than hitting the DB and raising a FK/syntax error.
function _validUuidOrNull(value) {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
}

// Round 60 Phase 3a — stable per-feed identity.
//
// Design (ported from GPT-6.1's codex/round60-phase2 branch with the
// same semantics; see CHANGELOG Round 60 Phase 3a entry):
//
//   feedIdentity(feed)       — 32-char hex, used as the per-row
//                              welcomebnb_feed_key marker. Derived from
//                              platform + (explicit feed_key || room_id
//                              || url). Changes when a host assigns a
//                              room to an existing feed, which is what
//                              drives the one-time legacy adoption pass.
//   sourceFeedIdentity(feed) — hex, used only to detect "same URL used
//                              in two rooms" (one source cannot belong
//                              to two different rooms). Not persisted.
//   roomFeedUid(feedKey,uid) — the room-prefixed UID stored in the DB
//                              when a feed is assigned to a room. Legacy
//                              unassigned feeds keep their raw UID so
//                              outbound guest links stay stable.
//
// Hashes contain no feed URL / credentials. Only persisted via the
// `raw.welcomebnb_feed_key` / `raw.welcomebnb_feed_source` jsonb markers.
const FEED_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
function _validFeedKeyOrNull(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return undefined; // signal invalid
  return FEED_KEY_RE.test(value) ? value : undefined;
}
function feedIdentity(feed) {
  const base = feed?.feed_key
    ? 'feed:' + feed.feed_key
    : feed?.room_id
      ? 'room:' + feed.room_id
      : String(feed?.url || '').trim();
  return createHash('sha256').update(normalizePlatform(feed?.platform) + '\n' + base).digest('hex').slice(0, 32);
}
function sourceFeedIdentity(feed) {
  return createHash('sha256').update(normalizePlatform(feed?.platform) + '\n' + String(feed?.url || '').trim()).digest('hex');
}
function roomFeedUid(feedKey, uid) { return 'wbnb-feed:' + feedKey + ':' + uid; }

export default async function handler(req, res) {
  if (rejectInvalidEnvironment(res)) return;
  if (rejectDemoIntegration(res, 'ota')) return;
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

  try {
    const result = await syncOnePropertyFeeds(property_id, feeds, SUPABASE_ANON_KEY, jwt);
    return res.status(200).json(result);
  } catch (_) {
    return res.status(503).json({ error: 'Calendar sync unavailable; existing entries preserved' });
  }
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
  const failedPlatforms = new Set();
  // Round 60 Phase 3a — scopes[platform] carries { roomId, feedKey } for
  // each feed, so the cancellation sweep later can refuse to touch rows
  // belonging to another room (or another feed_key) in the same platform.
  const scopes = new Map();

  // Round 60 Phase 3a — pre-flight validation (ported from GPT-6.1's
  // codex/round60-phase2 branch). Fails loudly and refuses the whole
  // sync if anything is off, so a malformed JSONB edit never silently
  // mis-assigns rows.
  //
  //   (1) Every assigned room_id must be a well-formed UUID AND must
  //       reference an active (not soft-deleted) property_rooms row in
  //       THIS property. Lookup gated behind "any assigned" so legacy
  //       no-room setups don't pay an extra round-trip.
  const assigned = feeds.filter(f => _validUuidOrNull(f?.room_id));
  if (assigned.length) {
    for (const f of assigned) {
      if (!_validUuidOrNull(f.room_id)) throw new Error('Invalid feed room UUID');
    }
    const roomsRes = await pgrestGET(
      `property_rooms?property_id=eq.${encodeURIComponent(propertyId)}&deleted_at=is.null&select=id`,
      apikey, bearer,
    );
    if (!roomsRes.ok) throw new Error('Feed room validation unavailable');
    const activeRooms = await roomsRes.json();
    if (!Array.isArray(activeRooms)) throw new Error('Feed room validation returned no rows');
    const activeRoomIds = new Set(activeRooms.map(r => r.id));
    for (const f of assigned) {
      if (!activeRoomIds.has(_validUuidOrNull(f.room_id))) {
        throw new Error('Feed room not active in this property: ' + f.room_id);
      }
    }
  }
  //   (2) feed_key, when present, must match [A-Za-z0-9_-]{1,80}.
  //   (3) The same source URL cannot be assigned to two different rooms
  //       in the same sync — that would duplicate every event under two
  //       different (room, uid) keys and double-count the stay.
  const sourceToRoom = new Map();
  for (const f of feeds) {
    const fk = _validFeedKeyOrNull(f?.feed_key);
    if (fk === undefined) throw new Error('Invalid feed_key (expected [A-Za-z0-9_-]{1,80})');
    const src = sourceFeedIdentity(f);
    const room = _validUuidOrNull(f?.room_id);
    if (sourceToRoom.has(src) && sourceToRoom.get(src) !== room) {
      throw new Error('One source feed URL cannot belong to two different rooms');
    }
    sourceToRoom.set(src, room);
  }

  // Load all local sources and previous imported rows in bounded pages. A
  // failed lookup must not guess provenance or run a cancellation sweep.
  const existing = await loadCalendarRows(propertyId, apikey, bearer);

  for (const feed of feeds) {
    const platform = normalizePlatform(feed?.platform);
    const url = typeof feed?.url === 'string' ? feed.url.trim() : '';
    // Round 60 Phase 2 — feeds may carry an optional `room_id` key so the
    // host can tell WelcomeBnB which room each OTA calendar represents.
    // Absent or null = unassigned; the UI/dashboard surfaces that so a
    // host with rooms can set it later.
    const feedRoomId = _validUuidOrNull(feed?.room_id);
    if (!url) { failedPlatforms.add(platform); errors.push({ platform, url, error: 'Empty URL' }); continue; }
    // Round 60 Phase 3a — stable per-feed identity. feedKey drives the
    // UID prefix for room-enabled feeds; sourceKey marks the row's
    // origin URL (used to adopt legacy unassigned rows when the host
    // first assigns a room to a feed that was already syncing).
    const feedKey = feedIdentity(feed);
    const sourceKey = sourceFeedIdentity(feed);
    if (!scopes.has(platform)) scopes.set(platform, []);
    scopes.get(platform).push({ roomId: feedRoomId, feedKey });
    try {
      const text = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (!/^BEGIN:VCALENDAR\r?$/m.test(text) || !/^END:VCALENDAR\r?$/m.test(text)) {
        throw new Error('Invalid or incomplete iCal feed');
      }
      const events = parseICS(text);
      const eventCount = (text.match(/^BEGIN:VEVENT\r?$/gm) || []).length;
      if (events.length !== eventCount || events.some(e => !CalendarRoundtrip.validRange({
        checkin_date: icsDateToISO(e.DTSTART), checkout_date: icsDateToISO(e.DTEND),
      }))) throw new Error('Invalid or incomplete calendar event');
      // Stamp room_id + feed_key + feed_source on every event this feed
      // produced. Rooms-enabled feeds prefix their UIDs so two rooms'
      // feeds from the same OTA stay distinct even if they share raw UIDs.
      let rows = events.map(e => {
        const row = { ...vEventToRow(e, propertyId, platform), room_id: feedRoomId };
        // Preserve the raw UID in `raw.welcomebnb_feed_uid` so the
        // legacy-adoption pass below can find the pre-prefixed row.
        if (feedRoomId || existing.some(r => r.raw?.welcomebnb_feed_source === sourceKey)) {
          row.raw = { ...(row.raw || {}),
            welcomebnb_feed_source: sourceKey,
            welcomebnb_feed_uid: row.uid,
            welcomebnb_feed_key: feedKey,
          };
          if (feedRoomId) row.uid = roomFeedUid(feedKey, row.uid);
        }
        return row;
      });

      // Round 60 Phase 3a — legacy adoption. When a host assigns a room
      // to a feed that was already syncing (unassigned → roomA), the
      // incoming UID changes to `wbnb-feed:<key>:<raw-uid>`. Without
      // adoption, the pre-existing row would hang around with the raw
      // UID and look like a "gone" booking in the cancellation sweep,
      // and the host's issued guest link would detach.
      //
      // Rule: adopt only when there is EXACTLY ONE legacy candidate
      // (prior row with the matching source + raw-uid, OR prior
      // unassigned row with the raw uid when the platform has only one
      // feed in this sync). More than one candidate ⇒ ambiguous origin,
      // refuse rather than steal the booking for the first-syncing room.
      for (const row of rows) {
        if (existing.some(r => r.platform === platform && r.uid === row.uid)) continue;
        const originalUid = row.raw?.welcomebnb_feed_uid || row.uid;
        const legacy = existing.filter(r => r.platform === platform &&
          ((r.raw?.welcomebnb_feed_source === sourceKey && r.raw?.welcomebnb_feed_uid === originalUid) ||
            (feedRoomId && !r.room_id && r.uid === originalUid)));
        if (!legacy.length) continue;
        const samePlatformFeeds = feeds.filter(f => normalizePlatform(f.platform) === platform).length;
        if (legacy.length !== 1 || (!legacy[0].raw?.welcomebnb_feed_source && samePlatformFeeds !== 1)) {
          throw new Error('Existing unassigned reservation has ambiguous feed ownership');
        }
        const update = { uid: row.uid, room_id: feedRoomId, raw: { ...(legacy[0].raw || {}), ...row.raw } };
        // If the legacy row had an auto-echo link to a direct booking in
        // another room, break it: a room A reservation can never cover
        // a room B direct booking.
        if (legacy[0].covered_by_reservation_id && !existing.some(src =>
            src.id === legacy[0].covered_by_reservation_id && CalendarRoundtrip.sameRoom(src, row))) {
          update.covered_by_reservation_id = null;
          update.coverage_lost_at = null;
        }
        const adopted = await pgrestPATCH(
          `ota_reservations?id=eq.${encodeURIComponent(legacy[0].id)}&property_id=eq.${encodeURIComponent(propertyId)}`,
          update, apikey, bearer,
        );
        if (!adopted.ok) throw new Error('Could not preserve existing booking during room assignment');
        Object.assign(legacy[0], update);
      }

      rows = rows.map(row => {
        const previous = existing.find(r => r.platform === platform && r.uid === row.uid);
        if (previous?.raw?.welcomebnb_echo_ignored) {
          return { ...row, raw: { ...row.raw, welcomebnb_echo_ignored: true } };
        }
        // Never overwrite a host-confirmed link — unless the host-confirmed
        // link is to a direct booking in a DIFFERENT room (Round 60: a stay
        // in Camera Blu cannot cover a stay in Camera Rossa).
        if (previous?.covered_by_reservation_id && !previous.raw?.welcomebnb_auto_echo &&
            existing.some(src => src.id === previous.covered_by_reservation_id && CalendarRoundtrip.sameRoom(src, row))) {
          return { ...row, coverage_lost_at: null };
        }
        const origin = CalendarRoundtrip.identifyOrigin(row, existing);
        const originId = origin?.id || (previous && CalendarRoundtrip.sameRoom(previous, row)
          ? previous.raw?.welcomebnb_origin_source
          : null);
        if (originId) row = { ...row, raw: { ...row.raw, welcomebnb_origin_source: originId } };
        const source = CalendarRoundtrip.matchOrigin(row, existing);
        if (source && !previous?.booking_code) {
          return { ...row, entry_type: 'block', covered_by_reservation_id: source.id, booking_code: null,
            coverage_lost_at: null, raw: { ...row.raw, welcomebnb_auto_echo: true } };
        }
        // Round 60: if an incoming OTA row's room no longer matches the
        // direct source it used to cover (host reassigned the direct to
        // another room), drop the covered link.
        if (previous?.covered_by_reservation_id && !CalendarRoundtrip.sameRoom(previous, row)) {
          return { ...row,
            entry_type: previous.raw?.welcomebnb_auto_echo ? 'block' : row.entry_type,
            covered_by_reservation_id: null, coverage_lost_at: null };
        }
        if (previous?.raw?.welcomebnb_auto_echo) {
          return { ...row, entry_type: 'block', covered_by_reservation_id: null, coverage_lost_at: null };
        }
        if (originId && !previous?.booking_code) return { ...row, entry_type: 'block' };
        return row;
      });

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
          if (r.entry_type !== 'block' || r.covered_by_reservation_id || r.coverage_lost_at === null) return true;
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
      // PostgREST bulk rows need identical keys. Preserve omitted host-owned
      // fields on ordinary rows rather than nulling them to match echo rows.
      const groups = new Map();
      for (const row of rows) {
        const key = Object.keys(row).sort().join(',');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
      }
      for (const group of groups.values()) {
        const upsertRes = await pgrestUPSERT('ota_reservations', group, apikey, bearer);
        if (!upsertRes.ok) {
          failedPlatforms.add(platform);
          errors.push({ platform, url, error: 'Upsert failed', detail: await upsertRes.text() });
        }
      }
    } catch (e) {
      failedPlatforms.add(platform);
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
    if (failedPlatforms.has(platform)) continue;
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
        `&status=eq.active&is_test=eq.false` +
        `&deleted_at=is.null` +
        `&or=(checkin_date.gte.${todayISO},entry_type.eq.block)` +
        // Round 60 Phase 3a — pull room_id + raw so the sweep below can
        // scope cancellations to feeds we actually fetched in this run.
        `&select=id,uid,room_id,raw,covered_by_reservation_id`,
        apikey, bearer,
      );
      if (!listRes.ok) continue;
      const candidates = await listRes.json();
      // Round 60 Phase 3a — a row is "gone" only when (a) its UID is not
      // in this run's seen set AND (b) at least one feed we synced in
      // this run owns the row's (room, feed_key) scope. Without this
      // scoping, a sync of feedA (room 1) would cancel feedB (room 2)'s
      // reservations because B's UIDs weren't in A's seen set.
      const platformScopes = scopes.get(platform) || [];
      const gone = candidates.filter(r => {
        if (uids.has(r.uid)) return false;
        return platformScopes.some(scope =>
          (r.room_id || null) === scope.roomId &&
          (!r.raw?.welcomebnb_feed_key || r.raw.welcomebnb_feed_key === scope.feedKey));
      });
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

async function loadCalendarRows(propertyId, apikey, bearer) {
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const res = await pgrestGET(`ota_reservations?property_id=eq.${encodeURIComponent(propertyId)}` +
      '&is_test=eq.false' +
      // Round 60 Phase 2 — pull room_id into the existing set so echo and
      // overlap matching below can scope to the same room.
      '&select=id,property_id,platform,uid,entry_type,status,checkin_date,checkout_date,covered_by_reservation_id,booking_code,room_id,raw,is_test,deleted_at,updated_at' +
      `&order=id.asc&limit=${pageSize}&offset=${offset}`, apikey, bearer);
    if (!res.ok) throw new Error('Calendar provenance lookup failed');
    const page = await res.json();
    if (!Array.isArray(page)) throw new Error('Invalid calendar provenance response');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
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
      // Round 60 Phase 3a — scope the rolling-UID merge to the same
      // (room_id, feed_key) bucket. Without this, a Booking feed in
      // room A would merge its rolling UID onto a Booking reservation
      // in room B that happens to share the same checkout date (and
      // move its booking_code / covered_by onto A).
      const feedKeyFilter = r.raw?.welcomebnb_feed_key
        ? `&raw->>welcomebnb_feed_key=eq.${encodeURIComponent(r.raw.welcomebnb_feed_key)}`
        : '';
      const roomFilter = r.room_id
        ? `&room_id=eq.${encodeURIComponent(r.room_id)}`
        : '&room_id=is.null';
      const q = 'ota_reservations?'
        + `property_id=eq.${encodeURIComponent(propertyId)}`
        + `&platform=eq.booking`
        + roomFilter + feedKeyFilter
        + `&entry_type=eq.reservation`
        + `&status=eq.active&is_test=eq.false`
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
    // Round 60 Phase 3a — ambiguous same-room candidates aren't evidence
    // of UID rotation. Rather than guess which row to merge onto (and
    // risk transferring an issued guest link), bail out and let the
    // normal upsert path create a fresh row the host can resolve.
    if (matchList.length > 1) { keptRows.push(r); continue; }
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
      const merged = await pgrestPATCH(
        `ota_reservations?id=eq.${encodeURIComponent(target.id)}`,
        patchBody, apikey, bearer,
      );
      if (!merged.ok) throw new Error('Booking UID merge failed');
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
    else if (key === 'X-WELCOMEBNB-UID') current.ORIGIN_UID = unescapeICSText(value);
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
    : /not available|unavailable|blocked|block(?:ed|ed dates)?|closed - not available|closed \\(|non disponibile|non disponibili|indisponibil[ei]|bloccato|bloccata|bloccati|bloccate|date bloccate|chiuso|chiusa|chiusura/i.test(summary);
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
    raw: { summary, description, dtstart: ev.DTSTART?.value, dtend: ev.DTEND?.value,
      origin_uid: ev.ORIGIN_UID || /^WelcomeBnB calendar event: ([^\r\n]+)$/m.exec(description)?.[1] || null },
  };
}

function normalizePlatform(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s === 'airbnb' || s === 'booking' || s === 'vrbo') return s;
  return 'other';
}

// Named exports for local testing. Vercel serverless functions only use the
// default export; these are inert at runtime and only touched by tests.
export { parseICS, vEventToRow, icsDateToISO, normalizePlatform, syncOnePropertyFeeds,
  _validUuidOrNull, _validFeedKeyOrNull, feedIdentity, sourceFeedIdentity, roomFeedUid };

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
    // Include historical local sources for identity only. Otherwise a return
    // from a cancelled/deleted source could be mistaken for a new reservation
    // and pin its old dates forever. Paging also avoids PostgREST's row cap.
    rows = await loadCalendarRows(property.id, SERVICE_KEY, SERVICE_KEY);
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

  const published = CalendarRoundtrip.exportRows(rows || [])
    .filter(r => r.checkout_date >= pastISO && r.checkin_date <= futureISO)
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
  for (const r of published) {
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
    const uid = CalendarRoundtrip.outboundUid(r);
    const summary = _outboundSummaryFor(r, hostLang);
    const lastMod = r.updated_at ? _outboundISOStamp(new Date(r.updated_at)) : dtstamp;
    lines.push('BEGIN:VEVENT');
    lines.push(_outboundFoldLine(`UID:${_outboundIcsEscape(uid)}`));
    lines.push(_outboundFoldLine(`X-WELCOMEBNB-UID:${_outboundIcsEscape(uid)}`));
    lines.push(_outboundFoldLine(`DESCRIPTION:WelcomeBnB calendar event: ${_outboundIcsEscape(uid)}`));
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
