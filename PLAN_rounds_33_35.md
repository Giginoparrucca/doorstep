# WelcomeBnB — Claude Code prompts for Rounds 33, 34, 35

Three self-contained prompts, in dependency order. Run them as separate sessions.
Round 34 depends on the guest token introduced in Round 33. Round 35 depends on the
entitlement hooks placed in Rounds 33–34.

**Tag before each round.** These touch auth and payments; you want a clean rollback point.

```bash
git tag -a v32-pre-hardening -m "Last state before API hardening"
git push origin v32-pre-hardening
```

---

# ROUND 33 — API endpoint hardening + remove the property-claim path

Copy everything between the rules below into Claude Code.

---

## Context

WelcomeBnB is a vanilla HTML/JS + Supabase + Vercel app. Three apps
(`index.html` guest, `host-console.html`, `admin.html`) and four serverless
endpoints in `/api`. No framework, no bundler, no npm dependencies in the API
handlers — keep it that way, use `node:crypto` and `fetch` only.

Supabase project: `jcjwaqqabgwqhhzhfbts`. Read `CHANGELOG.md` before starting —
the "Key learnings & gotchas" section matters, especially the RLS + GRANT trap
(SQL-editor-created tables do not inherit default privileges; symptom is a
silent 0-row result with `error: null`).

## The problem

`api/chat.js` and `api/scan-document.js` both:

- set `Access-Control-Allow-Origin: *`
- accept unauthenticated POSTs
- have no rate limit and no size cap on the request body
- call the Anthropic API with the project's `ANTHROPIC_API_KEY`

Anyone who opens devtools on the guest app can extract the endpoint shape and
loop it. `scan-document.js` in particular accepts an unbounded base64 payload
and sends it to Sonnet as a document block. This is an open, metered, billable
endpoint. It has to close before the product is sold.

Separately, `host-console.html` `init()` contains a legacy migration
convenience that assigns orphaned properties to new signups. That has to go
before self-serve registration opens.

## Goal

1. Introduce a short-lived, HMAC-signed **guest session token** that binds every
   AI request to a real property.
2. Rate-limit and budget-cap both AI endpoints, per session and per property.
3. Record actual token usage so cost per property is observable.
4. Delete the unclaimed-property adoption path.

The guest token is **not** a secret-keeping mechanism — the property UUID is
already in the guest's link and is the de-facto credential. The token exists so
that every AI call is attributable to a property, meterable, and cuttable.

## Work

### 1. Migration — `migration_round33_api_usage.sql`

New table `public.api_usage`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `property_id` | uuid not null references properties(id) | |
| `session_id` | text | guest session id, nullable |
| `endpoint` | text not null | `'chat'` \| `'scan'` |
| `input_tokens` | int default 0 | |
| `output_tokens` | int default 0 | |
| `created_at` | timestamptz not null default now() | |

Indexes:

```sql
CREATE INDEX IF NOT EXISTS api_usage_prop_time_idx
  ON public.api_usage (property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_usage_session_time_idx
  ON public.api_usage (session_id, created_at DESC);
```

RLS: enable. Host SELECT owner-scoped through
`EXISTS (SELECT 1 FROM properties WHERE id = api_usage.property_id AND owner_id = auth.uid())`.
Admin ALL via `is_admin()`. service_role ALL. **No anon policies at all** —
writes come from the server with the service role.

Then the grants, explicitly — do not assume they are inherited:

```sql
GRANT SELECT ON public.api_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage TO service_role;
```

Also add a per-property monthly cap column:

```sql
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS ai_monthly_token_cap bigint NOT NULL DEFAULT 2000000;
```

Add `api_usage` to the retention purge (`purge_old_data`) at 180 days, matching
the analytics tier from Round 12.

### 2. New endpoint — `api/guest-token.js`

`POST { property_id, session_id, booking_code? }` → `{ token, expires_at }`.

- Verify the property exists and `deleted_at IS NULL`, using the service role.
- Build payload `{ p: property_id, s: session_id, b: booking_code || null, exp: now + 12h }`.
- Sign with `createHmac('sha256', process.env.GUEST_TOKEN_SECRET)` over the
  base64url-encoded payload. Token format: `<base64url(payload)>.<base64url(sig)>`.
- Export a shared verifier — put `signGuestToken` / `verifyGuestToken` in
  `api/_guest-token.js` and import it from the three consumers. Verify must use
  `timingSafeEqual` and reject on expiry.
- If `GUEST_TOKEN_SECRET` is unset, fail closed with a 500 and a clear log line.
  Do **not** fall back to an unauthenticated path.

### 3. Harden `api/chat.js` and `api/scan-document.js`

Both endpoints, in this order:

1. **Origin check.** Replace `Access-Control-Allow-Origin: *` with an allowlist:
   `https://welcomebnb.vercel.app`, `http://localhost:*`, and the Vercel preview
   pattern `https://*.vercel.app`. Reflect the origin if it matches, reject
   otherwise. Keep the `OPTIONS` preflight working.
2. **Token check.** Require `Authorization: Bearer <guest_token>`. Verify it.
   `property_id` and `session_id` come from the **token payload**, never from the
   request body — this is the point of the whole exercise.
3. **Size caps.** `chat.js`: reject if `messages` has more than 40 entries or the
   serialized body exceeds 256 KB. `scan-document.js`: reject if
   `image_base64.length > 14_000_000` (~10 MB decoded). Return 413 with a clear
   message the guest UI can display.
4. **Rate limits**, by counting `api_usage` rows:
   - chat: 30 per `session_id` per rolling hour; 300 per `property_id` per rolling day
   - scan: 5 per `session_id` per rolling hour; 60 per `property_id` per rolling day
   Return 429 with `retry_after_seconds`.
5. **Monthly budget.** Sum `input_tokens + output_tokens` for the property in the
   current calendar month. If it exceeds `properties.ai_monthly_token_cap`, do
   not call Anthropic.
6. **Record usage.** After a successful call, insert an `api_usage` row with the
   real `usage` figures from the Anthropic response. In streaming mode, capture
   `input_tokens` from the `message_start` event and `output_tokens` from the
   final `message_delta` event, and write the row after the stream closes.

**Degrade, don't error.** When the chat endpoint is rate-limited or over budget,
return a normal-looking assistant reply telling the guest the concierge is
briefly unavailable and offering to message the host, plus `escalated: true` so
the existing guest UI routes the conversation to host chat. A 500 that renders
as a broken bubble is worse than a graceful handoff. `scan-document.js` can
return a clean error — the guest UI already has a manual-entry fallback.

### 4. Guest app — `index.html`

- After `propertyId` resolves, call `/api/guest-token` once and hold the token in
  a module-level variable plus `sessionStorage` under `wbnb_guest_token`.
- Re-mint when `bookingCode` resolves (so the token carries it — Round 34 needs
  this) and on any 401 from the AI endpoints, once, then give up.
- Send `Authorization: Bearer <token>` on both `fetch('/api/scan-document')`
  (line ~3349) and `fetch('/api/chat')` (line ~3913).
- Stop sending `propertyId`-adjacent identity in the body where the token now
  carries it. `propertyContext` and `stayContext` stay as they are — they are
  content, not identity.
- Handle 413 and 429 with a bilingual EN/IT message. New i18n strings must be
  **single-line** (`applyLang` writes via `innerHTML` and collapses newlines).

### 5. Remove the property-claim path — `host-console.html`

In `init()` (around line 7317), delete the block that selects a property with
`owner_id IS NULL` and assigns it to the current user. Keep the `else` branch
that inserts a fresh `'My Property'` row. A new signup must never inherit
existing data.

### 6. Admin visibility — `admin.html`

Add an "AI usage" card: rows of property name, this month's tokens, monthly cap,
a small progress bar, and estimated cost. This is your early warning for both
abuse and unit-economics problems.

## Do not

- Do not add npm dependencies to `/api`.
- Do not put the guest token in a URL query string; it goes in the header.
- Do not use `localStorage` for the token — `sessionStorage`, so it dies with the tab.
- Do not weaken any existing RLS policy.

## Verify

1. `curl` both endpoints with no `Authorization` header → 401.
2. `curl` with a token minted for property A, body claiming property B → the
   usage row records A. (Proves the token, not the body, is authoritative.)
3. Send 31 chat requests in one session → 31st returns 429.
4. Set `ai_monthly_token_cap` to 100 on the test property, send one chat →
   graceful "concierge unavailable" reply with `escalated: true`, no Anthropic call.
5. Post a 20 MB base64 blob to `scan-document` → 413, no Anthropic call.
6. Full guest happy path on `Trullo Verde Ulivo`
   (`c26b7de2-c0f5-4545-955f-88a778ab36b2`): scan a document, chat, check in.
7. Sign up a brand-new host account → gets an empty `'My Property'`, not someone
   else's data.
8. Confirm `api_usage` rows appear with non-zero token counts for both endpoints.

## New env vars

`GUEST_TOKEN_SECRET` (any long random string) — add in Vercel before deploying.
`SUPABASE_SERVICE_ROLE_KEY` already exists from Round 32.

## Files

`migration_round33_api_usage.sql`, `api/_guest-token.js`, `api/guest-token.js`,
`api/chat.js`, `api/scan-document.js`, `index.html`, `host-console.html`,
`admin.html`, `CHANGELOG.md`

---

# ROUND 34 — Close the cross-property guest chat read leak

Copy everything between the rules below into Claude Code.

---

## Context

Same stack as Round 33, which must be deployed and working first — this round
uses the guest token it introduced.

Read the Round 12.1 entry in `CHANGELOG.md`. It tightened the anon SELECT policy
on `chat_messages` to `property_id IS NOT NULL AND is_test = FALSE AND
deleted_at IS NULL`, and explicitly noted that cross-property reads were **not**
closed. This round closes them.

## The problem

The guest app reads chat with a client-side filter:

```js
sb.from('chat_messages').select('*')
  .eq('property_id', propertyId)
  .eq('is_test', false)
  .is('deleted_at', null)
```

Nothing server-side enforces that filter. Anyone holding the Supabase anon key —
which ships in the client HTML, as it must — can drop the `property_id` clause
and read every guest conversation across every property. Those messages contain
guest names, arrival dates, and lockbox codes.

This is survivable with two test hosts. It is a reportable personal-data breach
the moment a real host's guests are in there, and WelcomeBnB is the processor.

## Goal

Remove all direct anon access to `chat_messages`. Route guest chat through a
server endpoint that derives `property_id` from the signed token rather than
from client input.

## Work

### 1. New endpoint — `api/guest-chat.js`

Single handler, action-dispatched. Requires `Authorization: Bearer <guest_token>`
(Round 33's `verifyGuestToken`). Uses the **service role** for all DB access.

The controlling rule: `property_id` and `booking_code` are read from the **token
payload only**. If the body contains them, ignore them. Log a warning if they
disagree — that is an attack signal worth seeing in the admin panel later.

Actions:

- `history` — messages for the token's property, `is_test = false`,
  `deleted_at IS NULL`, ordered ascending, limit 50. If the token carries a
  `booking_code`, filter to it. If not, filter to
  `booking_code IS NULL OR booking_code = ''` (Round 28: the column had an
  empty-string default and legacy rows exist — match both).
- `send` — insert `{ property_id, booking_code, sender, message }`. Validate
  `sender ∈ {'guest','bot','system'}`; a guest client must never be able to
  insert `sender: 'host'`. Cap message length at 4000 chars.
- `poll` — `{ since: <iso> }` → host/system messages newer than the cursor,
  limit 5, same scoping.

Rate-limit `send` at 60/hour per session using the Round 33 `api_usage` pattern
(endpoint `'chat_write'`), so the endpoint can't be used as a free write channel
into someone's database.

### 2. Migration — `migration_round34_chat_anon_lockdown.sql`

```sql
-- Drop the anon read/write policies from Rounds 12.1 and earlier.
DROP POLICY IF EXISTS "Guests read chat" ON public.chat_messages;
-- (enumerate the real policy names from pg_policies first — do not guess)

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.chat_messages FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO service_role;
```

Start the migration file with a diagnostic block that lists current policies and
grants on `chat_messages`, so the applied names are recorded before anything is
dropped. Host policies (`chat_messages_host_update` and friends) are untouched.

**Include a commented rollback block at the bottom** that re-grants anon SELECT
and re-creates the Round 12.1 policy verbatim. This is the highest-regression
round of the three; make the undo one copy-paste away.

### 3. Guest app — `index.html`

Replace all five `chat_messages` call sites with `api/guest-chat` calls:

- line ~3071 (insert)
- line ~3679 `saveChatMsg`
- line ~4025 `setCursor`
- line ~4037 `pollForReplies`
- line ~4093 `checkExistingChat`

Behaviour must be identical from the guest's point of view: same bubbles, same
escalation banner, same polling cadence, same `scrollChatToBottom` calls. This is
a transport swap, not a UX change.

Keep the existing `sb` client for everything else — `checkins`,
`marketing_consents`, `guest_analytics` and the property read are all
legitimately anon-scoped and are out of scope for this round.

### 4. Host console — unchanged

Hosts read chat through authenticated, owner-scoped RLS. Do not touch those
paths. Verify after the migration that host chat still loads, since the same
table is involved.

## Do not

- Do not accept `property_id` from the request body under any circumstance.
- Do not add a "trust the client if the token is missing" fallback.
- Do not change the host-side policies.

## Verify

1. From the browser console on the guest app, run a raw
   `sb.from('chat_messages').select('*')` → returns zero rows / permission error.
2. Guest A at property A cannot see guest B's messages at property B via any
   crafted request to `/api/guest-chat`.
3. Two guests at the *same* property with different booking codes see only their
   own threads.
4. A pre-check-in guest with no booking code still sees their own no-code thread
   (this is the Round 28 empty-string case — test it explicitly).
5. `sender: 'host'` in a `send` body is rejected.
6. Host console chat panel unaffected: loads, replies, archives.
7. Escalation flow end-to-end: guest escalates → host replies → guest sees it via
   polling within one cycle.

## Files

`migration_round34_chat_anon_lockdown.sql`, `api/guest-chat.js`, `index.html`,
`CHANGELOG.md`

---

# ROUND 35 — Subscriptions and billing (Stripe)

Copy everything between the rules below into Claude Code.

---

## Context

Same stack. Rounds 33 and 34 must be deployed first — this round adds
entitlement checks to the endpoints they hardened.

Business model: **one plan, priced per property per month**, 14-day free trial,
annual option. The seller operates as an Italian *ditta individuale* in *regime
forfettario*, which means invoices carry **no IVA** and the fiscal invoice of
record is a *fattura elettronica* issued through SDI outside Stripe. So: Stripe
Tax stays off / zero-rated, and this round must store enough invoice metadata
for an accountant to reconcile.

## Goal

A working subscription with real enforcement, gated server-side.

## Work

### 1. Migration — `migration_round35_billing.sql`

`public.subscriptions`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_id` | uuid not null **unique** references auth.users(id) | one subscription per host account |
| `stripe_customer_id` | text | |
| `stripe_subscription_id` | text | |
| `status` | text not null default `'trialing'` | `trialing` \| `active` \| `past_due` \| `canceled` \| `incomplete` |
| `plan_code` | text | |
| `quantity` | int default 1 | number of properties billed |
| `trial_ends_at` | timestamptz | |
| `current_period_end` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

`public.billing_events` — append-only: `stripe_event_id text UNIQUE`,
`event_type`, `payload jsonb`, `received_at`. The unique constraint is the
idempotency mechanism; Stripe redelivers.

RLS on `subscriptions`: host SELECT where `owner_id = auth.uid()`. **No host
INSERT/UPDATE/DELETE** — the webhook is the only writer. Admin ALL via
`is_admin()`. service_role ALL. `billing_events`: admin SELECT, service_role ALL,
no update/delete policies.

Then, explicitly (the recurring gotcha):

```sql
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscriptions TO service_role;
GRANT SELECT, INSERT ON public.billing_events TO service_role;
```

Two helper functions, both `SECURITY DEFINER STABLE`:

```sql
-- true for trialing/active, and for past_due within a 7-day grace window
public.has_active_subscription(uid uuid) RETURNS boolean

-- resolves a property to its owner and delegates to the above
public.property_is_active(pid uuid) RETURNS boolean
```

`REVOKE EXECUTE ... FROM anon` on both; grant to `authenticated` and
`service_role`.

### 2. Endpoint — `api/billing.js`

Authenticated host endpoint (verify the Supabase JWT the same way
`api/ical-sync.js` does at lines 44–57 — reuse that pattern exactly). Actions:

- `ensure_trial` — idempotent. If no `subscriptions` row exists for the caller,
  insert one with `status='trialing'`, `trial_ends_at = now() + 14 days`.
- `status` — return the caller's subscription plus a computed
  `days_remaining` and the caller's current property count.
- `checkout` — create a Stripe Checkout Session (mode `subscription`,
  `STRIPE_PRICE_ID`, quantity = property count), return the URL.
- `portal` — create a Stripe Billing Portal session, return the URL.

Call the Stripe REST API with `fetch` and form-encoded bodies. **No `stripe` npm
package** — stay consistent with the zero-dependency convention in `/api`.

### 3. Endpoint — `api/stripe-webhook.js`

```js
export const config = { api: { bodyParser: false } };
```

Read the raw body, verify `Stripe-Signature` manually with `node:crypto`:
construct `${timestamp}.${rawBody}`, HMAC-SHA256 with `STRIPE_WEBHOOK_SECRET`,
compare with `timingSafeEqual`, reject if the timestamp is more than 5 minutes
old. An unverified webhook is an open write endpoint into the entitlement table —
get this right or the whole round is worse than not shipping.

Handle `checkout.session.completed`,
`customer.subscription.created|updated|deleted`, `invoice.payment_failed`,
`invoice.paid`. Insert into `billing_events` first; on unique-constraint
violation, return 200 immediately (already processed). Then upsert
`subscriptions` on `owner_id`.

Carry the Supabase `owner_id` through Stripe via `client_reference_id` on the
Checkout Session and `metadata.owner_id` on the subscription, so the webhook can
always resolve back to a host without a lookup table.

On `invoice.paid`, store `stripe_invoice_id`, amount, and currency in
`billing_events` — that is the accountant's reconciliation trail against the
fatture elettroniche.

### 4. Enforcement

Add a `property_is_active` check to:

- `api/chat.js` — inactive → the same graceful "concierge unavailable, message
  your host" reply with `escalated: true` that Round 33 introduced for budget caps
- `api/scan-document.js` — inactive → clean error, guest falls back to manual entry
- `api/guest-chat.js` — `send` still works (guest↔host messaging is not the
  expensive part); the AI reply path is what's gated
- `api/ical-sync.js` — inactive → 402 with a message pointing at billing
- `api/send-arrival-reminders.js` — skip inactive properties in the loop

**Never gate these, under any circumstance:**

- the guest check-in form and its writes to `checkins`
- the Alloggiati / PayTourist / ROSS1000 / CityTax exports in the host console
- the Check-in Data panel and the guest detail modal

Check-in and filing are the host's legal obligation. Blocking them to force a
payment would put a host in breach of Italian law and is not a lever available to
this product. Cut what costs money and what delights; never cut what the law
requires. Put this rule in a comment at each export function so it survives
future refactors.

### 5. Host console — `host-console.html`

New sidebar section **Account** → **Billing** panel:

- status pill (green active / blue trialing with days left / amber past due /
  red expired)
- plan name, price, next renewal date
- properties owned vs `quantity` billed, with a note if they differ
- **Subscribe** button → `billing?action=checkout` → redirect
- **Manage billing** button → `billing?action=portal` → redirect
- a short line stating invoices are issued separately as *fattura elettronica*,
  since Stripe's receipt is not the fiscal document

Banners at the top of the console:

- trialing: blue, "Trial ends in N days"
- past_due: amber, "Payment failed — AI features pause in N days"
- expired: red, "Subscription expired — concierge and document scan paused.
  Check-in and compliance exports keep working."

Call `billing?action=ensure_trial` once from `init()` when no subscription row is
found. Bilingual EN/IT, **single-line i18n strings** (`applyLang` / `h()`
convention — multi-line values get collapsed).

### 6. Admin — `admin.html`

Add a Subscriptions card: one row per host with status, plan, property count,
current period end, and trial countdown. Plus a headline MRR figure. Use the
existing `is_admin()` RLS; no new access path.

## Do not

- Do not implement client-side-only gating. The console is fully client-side; a
  disabled button is decoration. Every gate lives in an API endpoint or an RLS
  policy.
- Do not let hosts write to `subscriptions` directly.
- Do not add the `stripe` npm package.
- Do not enable Stripe Tax or add VAT lines — forfettario invoices carry none.
- Do not block exports. See §4.

## Verify

1. Webhook signature verification rejects a tampered body and a 10-minute-old
   timestamp.
2. Replaying the same Stripe event twice produces one `billing_events` row and no
   double-write to `subscriptions`.
3. A host with no subscription row gets a `trialing` row exactly once, even
   across repeated `init()` calls.
4. Set `trial_ends_at` to the past on the test host → guest chat degrades
   gracefully, document scan errors cleanly, iCal sync returns 402, the arrival
   reminder cron skips the property.
5. With the same expired host: guest check-in completes end-to-end, and every
   compliance export still generates a valid file.
6. `past_due` inside the grace window keeps everything working;
   outside it, gates apply.
7. Stripe test-mode checkout → webhook → row flips to `active` → gates lift
   without a redeploy.
8. A non-owner cannot read another host's `subscriptions` row.

## New env vars

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
`APP_BASE_URL` (for checkout/portal return URLs).

## Files

`migration_round35_billing.sql`, `api/billing.js`, `api/stripe-webhook.js`,
`api/chat.js`, `api/scan-document.js`, `api/guest-chat.js`, `api/ical-sync.js`,
`api/send-arrival-reminders.js`, `host-console.html`, `admin.html`,
`CHANGELOG.md`

---

## Running order and rough shape

| Round | What it unblocks | Risk | Rollback |
|---|---|---|---|
| 33 | Stops uncapped AI spend; adds the token everything else needs | Low — additive, guest UX unchanged | Vercel promote |
| 34 | Closes the breach that blocks onboarding a paying host | **High** — revokes live grants | Commented block in the migration |
| 35 | Revenue | Medium — payments, but nothing else depends on it | Vercel promote + set all rows `active` |

Round 34 is the one to do on a quiet morning with the rollback SQL already open
in a Supabase tab.

Alongside these, the non-code items on the critical path: the Art. 28 DPA, terms
of service and processor privacy policy; the commercialista consult on the
ATECO / INPS classification; and Supabase Pro for backups, which the changelog
already gates on "first paying host".
