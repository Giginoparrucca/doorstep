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

## 3. Vercel Firewall rules (proposed, not active)

The plan's edge limits are below. They would stop volumetric traffic before it starts a function, which saves cost; the limits above already stop abuse inside the functions.

| Rule | Proposal |
|---|---|
| `/api/guest*` | 60 requests/minute/IP and 500/day/IP → 429 |
| `/api/host*` | 300 requests/minute per session (IP as fallback) → 429 |
| `/api/admin*` | 60 requests/minute/IP → 429, with an alert on bursts |
| `/api/csp-report` | Unchanged: already limited in code |

**Status:** not applied. Three things block it:

1. The agent's Vercel connection has no firewall access: reading the configuration returned «Vercel denied access to this project's firewall configuration».
2. Vercel's rate-limit rules may be billed per request on the Pro plan, which needs the owner's approval.
3. The owner should confirm the thresholds above.

**Owner steps.** Either reconnect the Vercel integration with firewall access so the agent can apply and test the rules, or apply them yourself:

1. In the Vercel dashboard, open the project, then **Firewall**, then **Add rule**.
2. Set the condition to Request path starts with `/api/guest`.
3. Set the action to **Rate limit**, Fixed window, 60 requests per 60 seconds, key IP, response 429.
4. Repeat for the other rows of the table.
5. Afterwards, run `RATE_LIMIT_LIVE_PROBE=1 npm run test:live`.

## 4. Logs

Function logs are scrubbed by `lib/log-scrub.mjs`, which every entry file in `api/` loads first:

- **Emails** keep the first 2 characters and the domain.
- **Phone numbers** keep the last 3 digits.
- **Tokens, JWTs and keys** are replaced by a placeholder.
- **Document numbers, fiscal codes, names and birth data** are redacted by field name.
- **Raw request bodies** are reduced to known-safe keys.
