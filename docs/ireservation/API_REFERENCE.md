# iReservation API reference — Round 63

Verified 24 October 2026. Nonsecret provider facts below are separated from
WelcomeBnB design in the [plan](../../PLAN_round63_ireservation_native_api.md).
Do not copy the supplied credentials, PDF password examples or private iCal URLs
into this directory, scripts, fixtures, logs or commit messages.

## Source register and reproducibility

| Source | Evidence / official link | Use |
|---|---|---|
| User upload `iReservation.it API.pdf`, 11 pages, API 1.3.0 / OAS 3.0 | SHA-256 `90bd812db88b9e7021e12fbf25f55f02f1ff43be85b2eeae1dda033227ca492c` | pp1–3 auth; pp3–4 distributors; pp5–6 rooms; pp6–8 reservations; pp8–11 save. Code boxes clip some schema fields. |
| User upload `integration_guide_en.pdf`, 3 pages | SHA-256 `9c6631a14f75efdb6662cece1600aa65819cb45ac5f14c7da24a848828b5db08`; [official EN guide](https://www.ireservation.it/docs/integration_guide_en.pdf), [IT guide](https://www.ireservation.it/docs/integration_guide_it.pdf) | JSON, initial/refresh auth, token lifetime, key headers, quota/error concepts. |
| Salvatore's correspondence supplied by Daniele, 23 October conversation | “Fixed Calendar Room Filters”, conversation `6ad97eb4-6704-83ed-845e-b59435fdc255`; restricted original message, deliberately not reproduced | Exact partner quota, property credential setup, test calendar/user, availability-read roadmap. All supplied secrets excluded. |
| [Official documentation](https://www.ireservation.it/docs/) / [root OpenAPI](https://www.ireservation.it/docs/conf/openapi.json) | Retrieved public JSON on 24 October 2026, version 1.3.0 | External endpoint schemas recover clipped fields; see snapshot. Public API root returned 403 in this environment, not proof of credential failure. |

The original PDFs stay in their private upload/source location; do not commit
raw originals without reviewing examples and attachments for secrets. This repo
stores a nonsecret transcription and sanitized schema instead. Future developers
do not need access to the private chat to understand the API contract.

Official endpoint definitions:
[authorization](https://www.ireservation.it/docs/conf/openapi_authorizations.json),
[distributors](https://www.ireservation.it/docs/conf/openapi_distributors.json),
[rooms](https://www.ireservation.it/docs/conf/openapi_rooms.json),
[reservations](https://www.ireservation.it/docs/conf/openapi_reservations.json),
[save](https://www.ireservation.it/docs/conf/openapi_reservations_save.json),
[errors](https://www.ireservation.it/docs/conf/openapi_exceptions.json).
Compare future revisions to [schema.snapshot.json](schema.snapshot.json); it
preserves all non-example schema fields, descriptions, required/nullable markers
and enums. Every source's raw SHA-256 is recorded there. Never fetch or log using
actual credentials during a documentation refresh. Remove example/default values
before storing a future snapshot; review descriptions too.

## Transport and authentication

Base **https://api.ireservation.it**. JSON request/response; set
`Content-Type: application/json` for POST and `Accept: application/json`.
Send **x-api-key** on every request, including authorization. All data endpoints
also require **Authorization: Bearer ACCESS_TOKEN**. No existing Bearer token is
needed to obtain/refresh tokens. Partner credentials are separate from property
credentials. Property requests use the latter inside `parameters`.

`POST /v1/oauth2/authorizations` accepts exactly one auth form:

| Body | Published type / rule |
|---|---|
| `username`, `password` | Both required strings for initial login |
| `refreshToken` | Required string when refreshing; send only this body field |

Success: `code` integer 0, `message` empty string in API examples or null in the
English guide, **singular** `result` object with `expiresIn` integer seconds,
`token` string (JWT), `refreshToken` string, nullable in current schema. Initial
example uses 3600 seconds; always use the returned lifetime, never hard-code it.
Refresh guide returns expiresIn/token without refreshToken. Atomically replace a
newly issued refresh token when present; if omitted/null, retain the previous
one unless provider confirms invalidation semantics. Tokens are secrets.

**Source discrepancy:** guide p2 refresh example uses Host
`public-api.bed-and-breakfast.it`, while its p1, uploaded API and current server
schema use `api.ireservation.it`. Use the current base; do not automatically send
credentials to an alternate host or cross-host redirect. Ask provider if this
changes. The API schema's `security` object is not standard OpenAPI array syntax;
normalize it before generating a client, preserving both required headers.

## Common property request and envelopes

`POST /rooms`, `/reservations`, `/reservations/save` have top-level `lang` and
`parameters`. `lang` string enum: `en`, `it`, `fr`, `de`, `es` (published default
`en`). `parameters.calendarId` integer, `propertyUsername` string and
`propertyPassword` string identify/authenticate the property. Request body is
required. The list schemas do not enumerate all field-level `required` arrays;
absence of an array is not evidence credentials can be omitted. Require them in
our client; verify optional filter behavior in safe probes.

All five endpoints publish HTTP 200, 401, 429, 500. Success `code=0`; errors have
nonzero integer `code`, string `message`, `result=null`. Published examples map
401 to invalid credentials, 429 to exceeded quota, 500 to generic error. Inspect
HTTP status **and** JSON code; 200 alone is insufficient. Do not log raw message
or payload: sanitize to allowlisted classifications. No documented Retry-After,
quota reset time, pagination headers or specialized no-availability error code.

Data success envelopes use **plural `results`**; shapes differ by endpoint below.
Do not flatten these with singular auth/error `result`.

## GET /distributors

No parameters/body. `results` array of objects:

| Field | Type / meaning |
|---|---|
| `idDistributor` | integer, reservation channel identifier |
| `nameDistributor` | string, channel display name |

The published example is 17 / Bed-and-Breakfast; use the live catalog for mappings,
not that one example as a complete fixed channel table. ID 0 is direct for save.

## POST /rooms

Body: common property request. `results` array of:

| Field | Type / meaning |
|---|---|
| `id` | integer provider room/inventory identifier used in reservation `rooms` |
| `type` | string enum `room`, `property` |
| `name` | string label, not a stable mapping key |

Native IDs are not local `property_rooms.id` UUIDs or proven iCal room-category
IDs. Repeated IDs on save can request several units of one type. Confirm actual
inventory scope and capacity before assuming a physical-room mapping.

## POST /reservations

Common property body plus these `parameters` filters:

| Field | Published type / semantics |
|---|---|
| `fromDate` | string date `YYYY-MM-DD` |
| `toDate` | nullable string date `YYYY-MM-DD` |
| `idReservation` | nullable string; with idDistributor retrieves a single reservation, overriding fromDate/toDate |
| `idDistributor` | nullable integer; with ID selects a booking; without ID filters the listing by channel |

Success: `results.reservations` array of the reservation object below. There is
no documented updated-since cursor or date-range overlap rule; do not invent one.
Query by the documented ID/distributor pair for targeted reconciliation.

## Reservation object (list and save response)

| Field | Published type / semantics |
|---|---|
| `idReservation` | string external booking ID; retain as string |
| `status` | string enum `I` inserted, `U` updated, `D` deleted |
| `guestFirstName`, `guestLastName` | strings |
| `guestEmail`, `guestPhoneNumber` | nullable strings |
| `guestCountry` | nullable string, ISO-3166 per description; exact variant not stated |
| `guestLanguage` | nullable string, two letters |
| `dateCheckIn`, `dateCheckOut` | strings, date `YYYY-MM-DD` |
| `dateTimeLastUpdate` | string `YYYY-MM-DD HH:mm:ss`; schema labels format `date` despite including time; timezone unspecified |
| `numberAdults`, `numberChildren` | integers; children described as under 18 |
| `price` | number |
| `priceBreakdown` | object with numeric `onlyRooms`, `touristTax`, `petFee`, `cleaningFee`, `otherFee` |
| `idDistributor`, `nameDistributor` | integer, string |
| `rooms` | array of objects with integer `id`, string `name` |

The response does not publish per-room adult/child/price fields, unit IDs, a
currency, webhook metadata, hostNotes, idempotency receipts or legal guest-ID
fields. Preserve only allowed necessary guest fields in protected storage. Do
not infer absent details or replicate booking-level totals for every room.

## POST /reservations/save — future direct writes

Only direct reservations (`idDistributor=0`), and only properties with an active
channel manager. Common property body plus the following `parameters`:

| Field | Type / rule |
|---|---|
| `action` | required string enum `I`, `U`, `D` |
| `idReservation` | nullable string in schema; **omit for I**, required for U/D; use provider-returned ID |
| `guestFirstName`, `guestLastName` | strings, required for I/U |
| `guestEmail`, `guestPhoneNumber` | nullable strings |
| `dateCheckIn` | date string, required for I/U |
| `dateCheckOut` | date string, required for I/U; later than check-in, **at most 30 nights** |
| `hostNotes` | nullable string, private property notes never shown to guest |
| `rooms` | array required for I/U; objects below |
| `idDistributor` | nullable integer in schema; only accepted value **0**, defaults to 0 when omitted; our writer sends explicit 0 |

Each `rooms[]` entry: `id` required integer from `/rooms`; `numberAdults` integer,
`numberChildren` integer (under 18), `price` number. The room price is the total
for the whole stay; reservation price is the sum of room prices. Sending the same
room ID more than once books more than one unit of that room type.

- **I:** inserts a new reservation, ID omitted. PDF p9 example inconsistently
  includes an ID with I; normative prose + schema explicitly require omission.
- **U:** fully replaces the existing reservation with supplied data, not partial
  update. Omitted guest/room data must not accidentally clear provider data.
- **D:** only reservation ID is needed among reservation data; other reservation
  fields ignored. Keep common property authentication + action; our policy also
  sends explicit distributor 0 and verifies stored direct origin first.

Availability is decreased automatically for each stay night and restored on
update/delete. If **any** requested room has no availability, **the entire request
is rejected and nothing is saved**. No undocumented HTTP/error code is assumed.
Success is `results.reservation`, with the reservation object above. Persist its
returned external identity before considering a local operation confirmed.

## Correspondence: setup, limits and unavailable capability

- Partner quota **5000 requests/day**, sustained **5 requests/second**, **burst 10**.
  Treat this as shared across all properties/workers using the partner key, not a
  quota per host. Budget auth, refresh, retries and reads as well as writes.
- [Channel-manager configuration](https://www.bed-and-breakfast.it/ar/channel_manager.cfm):
  authenticated host area, choose **Configura** on a channel; calendarId is visible
  there, and propertyUsername/propertyPassword can be configured there. These
  credentials must differ from the property's reserved-area login credentials.
  Salvatore said WelcomeBnB would be listed once the integration is live.
- Approved test identifiers: calendarId **330**, propertyUsername **testtesttest**.
  Test property password is secret; obtain it through the restricted handover.
  PDF example credentials differ; never treat PDF examples as working credentials.
- Availability-read endpoint was **planned in weeks**, not available in the
  supplied/current five-endpoint contract. No path, schema or launch date known.

## Open provider questions / activation blockers

Confirm date-filter semantics (arrival/overlap/update), endpoint default range,
maximum range, pagination/limits/completeness guarantees, deletion retention and
whether D appears outside the original arrival window. Confirm ID uniqueness per
calendar/distributor, ID reuse, ordering/revisions, timezone and currency. Resolve
room-type capacity, repeated room representations and physical-unit allocation.
Confirm channel-manager status detection, write no-availability errors and any
idempotency key/client correlation or concurrency support. Confirm refresh-token
rotation/revocation and quota reset timezone/burst algorithm. Obtain an official
availability contract including zero stock vs explicit closure, room/property
scope, partial responses and reopening semantics before Phase 5. No webhooks are
published; do not describe polling as real-time delivery.
