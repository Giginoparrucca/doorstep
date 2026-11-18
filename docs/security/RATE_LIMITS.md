# Rate limits

Round 67 Phase 6. There are two layers:

- **Application limits (enforced today).** These are counted atomically in the database (`rate_take`, Round 74), keyed on values the server controls, never on anything the client chooses.
- **Vercel Firewall limits (proposed, not active).** These would sit in front of the functions. See §3.

## 1. Application limits (enforced)

Code: `api/_rate-limit.js` (`LIMITS`), plus the per-feature limits listed below.

**Keys.** Every counter is keyed on one of these, never on the session ID a client sends:

- the caller's address, hashed with the service key, so the raw IP is never stored;
- the property;
- the booking;
- the admin.

**When the counter store is down,** each limit reacts in one of three ways:

- **closed:** the request is refused;
- **open:** the request is allowed;
- **bounded:** an in-memory counter per server instance applies the same limit.

| Endpoint / action | Limit | Key | Store down |
|---|---|---|---|
| `/api/guest-token`: guest link (mint) | 60 / hour | address | bounded |
| | 1500 / hour | property | bounded |
| `/api/guest`: booking recovery (lookup) | 10 / hour | address | closed |
| | 30 / hour | property | closed |
| `/api/guest`: check-in writes | 120 / hour | address | bounded |
| | 60 / hour | booking | bounded |
| `/api/guest`: analytics events | 600 / hour | address | bounded |
| `/api/guest`: document upload links | 20 / hour | address | bounded |
| | 150 / hour | property | bounded |
| `/api/chat`: guest assistant | 60 / hour | address | bounded |
| | Monthly AI token cap | property (`ai_month_tokens`) | — |
| `/api/scan-document`: document reading | 30 / hour | address | bounded |
| | Same AI cap | property | — |
| `/api/admin-invite-host?open=`: 24-hour invite link | 10 / hour | invited email | bounded |
| `/api/host-terms`: email code | 3 / 15 min and 10 / day | host | refused |
| `/api/admin-host-health`: privacy requests (`dsar_*`) | 10 / hour | admin | closed |
| `/api/csp-report`: browser reports logged | 60 / minute | server instance | — |
| iReservation client | 5 / second plus daily quota | tenant | paused |

**Host and admin endpoints** need a valid session. Admin endpoints also check `is_admin` with the caller's own session before any read, and every admin action is journalled in `admin_access_events` (Phase 5).

## 2. Attack scenarios (audit cross-reference)

| Scenario | What stops it |
|---|---|
| **Property enumeration** through `/api/guest-token` (guessing property IDs) | The limit runs **before** the property lookup, so a limited caller cannot use the endpoint as an existence oracle. There are 60 calls per hour per address. Property IDs are random UUIDs, so guessing is not feasible. Post-deploy proof: `scripts/round67-rate-limits.test.live.mjs`. |
| **Consent fabrication** (mass fake marketing consents or check-ins) | Writes need a guest token bound to the property and booking (Round 74 R002). They are limited to 120 per hour per address and 60 per hour per booking. |
| **Document-reading abuse** (`/api/scan-document` as a free OCR service) | 30 per hour per address, plus the property's monthly AI token cap. Requires a guest token for an active property. |
| **Booking-recovery guessing** | 10 per hour per address and 30 per hour per property, refused when the counter store is down. A literal match on the booking code is required, plus the last 4 characters of the document (Round 74 R001). |
| **CSP report flooding** | Only 60 reports per minute per instance are logged; the rest get 204 and are dropped. |

## 3. Vercel Firewall rules (active since 18 Nov 2026)

These rules stop floods at Vercel's network edge, before a function starts. The application limits above still apply inside the functions. All three rules are published on project `welcomebnb` (config `waf_VEPAR5tx8JNA`, version 1). Daniele created them in the dashboard, because the agent's connection can read the firewall but is refused when it tries to change it.

| Rule | Condition | Limit | When exceeded |
|---|---|---|---|
| `API ospiti` | path starts with `/api/guest` | 300 requests / 60 s per IP (fixed window) | 429, no persistent block |
| `API host` | path starts with `/api/host` | 300 / 60 s per IP | 429, no persistent block |
| `API admin` | path starts with `/api/admin` | 60 / 60 s per IP | 429, no persistent block |

**Why the guest limit is 300, not the plan's 60.** The guest chat checks for replies every 5 seconds, which is 12 requests a minute per open phone. A family on one wifi, or many customers behind one mobile operator's IP (CGNAT), would have hit 60.

**Why there is no persistent block.** One IP can be shared by many guests (hotel wifi, mobile networks), so a longer block would lock out innocent people too. Without it, the block ends by itself after the minute.

**Cost.** $0.50 per million allowed requests; blocked requests are free. That is a few cents a month at current traffic.

**Production check, 18 Nov 2026:**
- 260 requests to `/api/admin-invite-host?open=…` (an invalid link, so no data was touched) got 120 normal answers (410), then 429 from request 121 onwards: 60 per address on the test network's 2 outgoing addresses.
- The block lifted within a minute.
- `npm run test:live` afterwards: PASS 4 / FAIL 0.

## 4. Logs

Function logs are scrubbed by `lib/log-scrub.mjs`, which every entry file in `api/` loads first:

- **Emails** keep the first 2 characters and the domain.
- **Phone numbers** keep the last 3 digits.
- **Tokens, JWTs and keys** are replaced by a placeholder.
- **Document numbers, fiscal codes, names and birth data** are redacted by field name.
- **Raw request bodies** are reduced to known-safe keys.
