# Round 60 — B&B rooms inside one property

## Goal and target user

Support the most common Italian B&B: a private owner (no partita IVA,
*non imprenditoriale*) running **one struttura with 2–6 rooms**. One property,
one CIN, one Alloggiati Web account, one regional statistics code, one tourist-tax
setup — with several guests staying in different rooms on the same nights.

Rooms live **inside** the property. Never model a room as a separate property:
that splits the struttura's statistics (ROSS1000/regional files are per
struttura per day) and duplicates the house guide.

**Zero-impact rule:** a property with no rooms (or one room) must behave exactly
as today — same UI, same queries, same exports, byte-identical regional files.
Rooms UI appears only after the host adds a second room.

Out of scope (do not build): B2B/company invoicing, multiple console users,
cross-property dashboard, room types/pricing, channel-manager features.

## Phase 1 — schema (`migration_round60_bnb_rooms.sql`)

- `property_rooms`: `id uuid pk`, `property_id uuid not null → properties on
  delete cascade`, `name text not null`, `beds integer not null check (beds >= 1)`,
  `door_code text null`, `sort_order integer not null default 0`,
  `deleted_at timestamptz null`, `created_at`, `updated_at` (touch trigger).
  Unique `(property_id, lower(name))` where `deleted_at is null`.
- `ota_reservations.room_id uuid null → property_rooms on delete set null`.
- `checkins.room_id uuid null → property_rooms on delete set null` — used only
  for check-in groups with no linked reservation; otherwise the room comes from
  the reservation via `booking_code`.
- `properties.ical_feeds` entries gain an optional `room_id` key (JSONB, no
  migration needed; document the shape in the migration header).
- Index `ota_reservations (property_id, room_id, checkin_date, checkout_date)`
  where `deleted_at is null and status = 'active'`.
- **RLS + explicit GRANTs.** Owner-scoped SELECT/INSERT/UPDATE/DELETE for
  `authenticated` via `properties.owner_id = auth.uid()`; admin as existing
  tables; `service_role` full CRUD. **No `anon` grant** — the guest app reads
  room data only through the service-role path in `api/guest.js`. Remember: RLS
  without GRANT = silent 0-row writes. Include the verification query block and a
  manual ROLLBACK block, as in previous migrations.

## Phase 2 — iCal sync, overlap and echo logic

- `api/ical-sync.js`: stamp each reservation with the `room_id` of the feed it
  came from. Feed with no `room_id` → `room_id` null (unassigned).
- Verify whether `UNIQUE (property_id, platform, uid)` can collide when two
  rooms' feeds come from the same OTA (Booking exports one calendar per room).
  If collisions are possible, include a stable feed key in the uniqueness rule.
  Record the finding in the CHANGELOG either way.
- Round 45 echo/coverage matching: a direct booking may only be covered by a
  block **in the same room's feed**. Never link across rooms.
- Overlap check (`_computeReservationOverlap` and the form hints): per room when
  rooms exist. An unassigned booking warns but does not block.
- `renderUpcomingReservationsPanel` currently correlates check-ins to
  reservations **by date overlap** — wrong once two stays share dates. Match by
  `booking_code` first; fall back to date overlap only within the same room (or
  when the property has no rooms).

## Phase 3 — host console

- Property Details: a "Rooms / Camere" card. Add, rename, reorder, delete
  (soft) rooms; beds per room; optional door code per room. Covered by the
  Round 59 unsaved-form guard.
- Settings → calendar feeds: each feed gets a room selector (hidden when the
  property has fewer than two rooms).
- Calendar: one lane per room plus an "Unassigned" lane when needed. Direct
  booking form gets a room selector; editing a booking can change its room.
- Check-in groups and upcoming reservations show the room name. Host can assign
  a room to an unassigned booking or check-in group.
- All new strings in IT and EN via `applyLang` (single-line strings).

## Phase 4 — guest app

- If the stay has a room, show the room name on the welcome/arrival screen and
  that room's `door_code` (respecting the existing lockbox visibility toggles).
- A guest must only ever receive **their own** room's data. Serve it from
  `api/guest.js`, scoped by the signed guest token / booking code.
- Shared house content (guide, rules, recommendations, Wi-Fi) is unchanged.

## Phase 5 — compliance outputs

- Alloggiati Web, SPOT Easy and tourist tax: **no change** (one struttura; the
  tracciato has no room field). Confirm with existing tests.
- Regional/ROSS1000 review step (Round 58): when rooms exist,
  - prefill `rooms_available` with the active room count and `beds_available`
    with the sum of room beds (host can still edit);
  - prefill each day's `occupied` with the number of distinct rooms with an
    active stay that night, from room assignments — never from guest counts;
  - flag days with unassigned stays for host review before download.
  Properties without rooms keep today's behaviour exactly.

## Gates

- New tests: rooms schema/RLS (owner, other host, anon, service role); iCal
  per-room stamping and echo isolation; per-room overlap; check-in ↔ reservation
  correlation with two concurrent stays; guest endpoint returns only own room;
  occupied-room prefill.
- Browser: IT/EN at 390/1280px — add rooms, assign feeds, calendar lanes, direct
  booking in room B overlapping room A, guest view of room + door code.
- Full regression (standing rule in AGENTS.md): every phase gate runs the
  **entire** test suite and the entire browser suite, not only the suites
  listed here. A failure anywhere — including areas this round did not touch —
  blocks the merge. Regional exports must stay byte-identical for properties
  without rooms. Record pass/fail counts in the CHANGELOG.
- Update CHANGELOG (round table + findings), the host guide, and this plan's
  Delivery section. No live guest records written for testing.


## Phase 2 implementation notes

- Room-enabled imports retain the existing `(property_id, platform, uid)` unique
  constraint. Stored UID = `wbnb-feed:<stable feed hash>:<original UID>`; the hash
  uses platform + an explicit `feed_key` (when supplied), otherwise the room ID,
  not URL credentials. This separates
  equal OTA UIDs in different rooms and survives a feed URL/token change. Multiple
  different feeds in the same room/platform require distinct stable `feed_key`
  values. Existing unassigned UIDs and direct outbound UIDs remain unchanged.
- Feed room IDs are checked against active rooms owned through the requested
  property's normal JWT/RLS context. Cancellation and Booking UID rotation are
  room-scoped. A single legacy feed can adopt its unassigned rows while retaining
  guest codes; ambiguous legacy rows across multiple feeds stop sync for that
  platform rather than guessing provenance. A hashed source fingerprint lets a
  proven feed move between rooms or back to unassigned without changing the row
  ID or losing its issued guest link. Cross-room coverage is cleared on a move.
- The host loads active room IDs once per property selection to distinguish a
  multi-room property with unassigned bookings from a property without rooms.
  This is an explicit clarification to “same queries”: the existing business
  queries remain, with one additional owner-scoped metadata lookup. A failed
  room lookup disables speculative date matching; known booking codes still win.
- Room selectors, room CRUD, calendar lanes and new room assignment remain Phase
  3. Phase 2 preserves existing room/feed metadata through Settings and direct
  booking edits so those operations cannot accidentally erase an assignment.

## Delivery

- Phase 1: shipped by Claude in PR #166/#167, as recorded in CHANGELOG.
- Phase 2: implemented by GPT-6 on `codex/round60-phase2`; full regression
  PASS 40 / FAIL 0 / SKIP 3. GitHub API access blocks PR/CI/merge and deployment
  verification, as recorded in CHANGELOG. Not yet shipped.
- Phases 3–5: pending.
