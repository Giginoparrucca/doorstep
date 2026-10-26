# Round 67 — GDPR paper trail + defence-in-depth

**Specification file.** Living document. Confirmed by Daniele on 2026-10-26 after the plain-language recap.

Round 65 made the system technically secure and `docs/SECURITY_ROUND65_VERIFICATION.md` cross-checked it adversarially. Round 67 is the "we have the papers to prove it" step: the documents and audit trails Italian privacy law (GDPR + Garante) and any serious buyer will ask for, plus a few remaining defence-in-depth items the audit flagged. Scope corresponds to the audit's three deferred GDPR HIGHs and the top items of the 90-day roadmap in `docs/SECURITY_ASSESSMENT_2026-10.md` section 7.

Runs in parallel with the preserved Round 63 iReservation pilot/provider gate, the ongoing Round 65 Phase 5b CSP watch + Phase 7 owner-coordination tail, and Round 66 check-in-gated entry (GPT). Does not touch runtime paths those rounds own.

## Why this Round, in short

1. **72-hour breach-notification obligation.** If something leaks in prod, Italian law gives us 72 hours to notify the Garante. Today there is no SOP; a real incident blows the deadline on confusion alone.
2. **Buyer due diligence and Garante audits** ask for ROPA (Art. 30), DPA templates for hosts (Art. 28), and a DSAR process (Art. 15–20). None exist today.
3. **Impersonation audit log and PII log scrubbing** are MEDIUM-severity audit findings whose closure is cheap and whose absence raises a flag during any serious review.

## Scope

**In.** Documentation (BREACH_SOP, ROPA, DPA template), host-facing DSAR tooling, admin audit log table + wrapper, log-scrub middleware, Vercel firewall rate limits for anon endpoints. All work publishes to the public repo and `app.welcomebnb.it`.

**Out.** Third-party pentest (6+-month item, actual money ≈ €3–10k). PITR restore drill with real customer data (deferred to a separate operational round). Formal ISO/SOC-type accreditation. Minor-consent gate (**structurally unreachable** — see Phase 2 rationale: Alloggiati capogruppo is 18+, consent form is per-booking only shown to the booking lead per `index.html:1397` comment and `showConsentCard()` call site).

## Phases

Each phase runs its mandatory test gate (whole suite via `npm run test:all`), updates CHANGELOG at the start (`in-progress — <model>`) and after merge (`shipped — PR #N — <model>`), and preserves other rounds' ownership.

### Phase 1 — Breach-notification SOP + DPO contact

**Goal.** A 1–2 page runbook that answers "if guest or host data leaks, what do we do in the next 72 hours."

**Deliverable.** `docs/compliance/BREACH_SOP.md`, in English with Italian translations of guest-facing templates. Contents:

- When the 72h clock starts (Art. 33: "when controller becomes aware of a personal-data breach").
- DPO identity and contact: Daniele Petrilli as owner-DPO for a sole-operator Italian B&B operation (Art. 37 does not require a formal DPO at this scale, but Art. 24 accountability requires naming someone). Document the formal declaration.
- Decision tree:
  - Contained, no personal data affected → log in `admin_access_events` (Phase 5), no notification.
  - Personal data affected, low risk to rights and freedoms → notify Garante within 72h.
  - High risk to rights and freedoms → notify Garante AND affected individuals "without undue delay."
- Garante online portal link: https://servizi.gpdp.it/databreach/s/. Required fields pre-mapped so the first 15 minutes aren't spent reading the form.
- Communication templates (IT + EN) for affected hosts and guests.
- Evidence collection checklist: Vercel logs, Supabase logs, `admin_access_events` (Phase 5), affected row IDs, timeline. What to preserve before any remediation.
- Post-incident review template (lessons learned, process changes).

**Test gate.** New static check `scripts/round67-breach-sop.test.mjs` asserts the file exists at the expected path, has every required section heading (regex-matched), and references the Garante portal URL. Full `npm run test:all` stays green. No runtime code touched.

**Owner-only actions.** Daniele reviews and confirms the DPO declaration text; chooses the escalation name/email (likely himself); optionally has a GDPR lawyer sanity-check (not blocking).

### Phase 2 — ROPA (Register of Processing Activities, Art. 30)

**Goal.** The GDPR Art. 30 register: every processing activity, legal basis, retention, sub-processors.

**Deliverable.** `docs/compliance/ROPA.md`, machine-readable sections marked as fenced YAML blocks so a static test can validate the eight Art. 30 required fields for each activity. One activity per section:

- Guest check-in and Alloggiati filing (controller: host; processor: WelcomeBnB)
- Tourist tax and SPOT/regional filings
- Keybox and door-code delivery
- Marketing consent (opt-in, per-booking, capogruppo-only)
- Guest chat / AI assistant
- iCal sync with OTAs
- iReservation native API (Round 63 pilot, disabled until cutover)
- Admin access / impersonation (Phase 5 scope)
- Sub-processors: Supabase (DE/EU), Vercel (DE/EU), Anthropic (US — SCCs), Telegram (optional), Google Maps (optional).

Each activity records: purpose, categories of data subjects, categories of personal data, recipients, international transfers, retention schedule, security measures, legal basis.

**Signed design argument on HIGH-GDPR-3 (minor-consent gate):** a dedicated subsection of the "Marketing consent" ROPA entry explains why Art. 8 under-14 protection is structurally unreachable in this product — Alloggiati law requires capogruppo 18+, consent form is per-booking, only shown to the booking lead (code evidence: `index.html:1397` comment, `index.html:3832 showConsentCard` + `index.html:3699` single call site after all guests are checked in). The audit's HIGH is closed by design, with cited source lines.

**Test gate.** New `scripts/round67-ropa.test.mjs` parses the YAML blocks and asserts every activity has all eight Art. 30 fields and a non-empty legal basis. Full regression stays green.

**Owner-only actions.** Daniele confirms the retention periods for each activity (defaults proposed from current code; owner may tighten/extend); confirms the controller/processor framing with host-side activities (hosts are controllers, WelcomeBnB is processor).

### Phase 3 — DPA template for hosts (Art. 28)

**Goal.** A standard-form Data Processing Agreement the host signs with WelcomeBnB, making the controller/processor relationship explicit. Required by Art. 28 whenever a controller uses a processor.

**Deliverable.** `docs/compliance/DPA_TEMPLATE.md` with Art. 28 required clauses:
- Subject-matter and duration
- Nature and purpose of processing
- Type of personal data and categories of data subjects
- Obligations and rights of the controller
- Processor obligations (confidentiality, security measures, sub-processor approval, assistance with DSAR fulfilment, breach notification to controller, deletion on contract end, audit rights, SCCs for extra-EU transfers)
- List of approved sub-processors (cross-referenced to ROPA)

Plus a signed-copy flow stub: host console gains a "Sign DPA" screen (lightweight — click-through signature with timestamp and IP recorded in `host_dpa_signatures` table). Full e-signature integration deferred.

**Test gate.** `scripts/round67-dpa.test.mjs` asserts the template has every Art. 28 required clause by section heading. Static only; no runtime code until Phase 7.

**Owner-only actions.** Legal review recommended before using the signed-copy flow with real hosts (≈€500–1500). Not blocking the phase gate.

### Phase 4 — DSAR tooling and runbook (Art. 15, 17, 20)

**Goal.** Give the admin a self-service tool to produce a GDPR Subject Access Request export when a guest or host emails requesting their data.

**Deliverable.**
- `api/admin-dsar.js` admin-gated endpoint. Query by email, phone, or document number. Returns a JSON bundle covering: `checkins`, `ota_reservations` (as redacted summary), `marketing_consents`, `chat_messages`, `scanned_documents` (metadata only, with signed URLs valid for 7 days to the originals). Right-to-erasure (Art. 17) action is a separate call that soft-deletes with a cascading sweep.
- Admin console button that calls the endpoint, downloads JSON, previews a one-page PDF summary.
- `docs/compliance/DSAR_RUNBOOK.md`: when a DSAR request lands at `info@welcomebnb.it`, how to verify the requester's identity, run the export, deliver securely (encrypted email or signed URL), log the fulfilment in `admin_access_events`.
- Rate limit: 10 exports / hour / admin. Export logged with timestamp + requester identifier in Phase 5's audit log.

**Test gate.** `scripts/round67-dsar.test.mjs` (unit) + `scripts/round67-dsar-browser.test.mjs` (admin UI). Asserts: anon 401, authenticated non-admin 403, admin returns well-formed JSON including every expected table, erasure is soft-delete not hard-delete, rate-limit blocks the 11th call in an hour. Full `npm run test:all` stays green.

**Owner-only actions.** None required beyond approving the runbook flow.

### Phase 5 — Admin audit log

**Goal.** A tamper-evident journal of every privileged access, so a buyer or auditor can see who did what, and so Phase 1's breach-SOP evidence-collection step has something to collect.

**Deliverable.**
- Migration `supabase/migrations/<ts>_round67_admin_audit_log.sql`: new `public.admin_access_events` table — `id`, `occurred_at`, `actor_email`, `actor_id`, `action` (enum), `target_table`, `target_id`, `request_fingerprint` (hash of IP+UA+route), `metadata` JSONB. Append-only via function + REVOKE UPDATE/DELETE from everyone except `postgres`. SECURITY INVOKER insert RPC; EXECUTE to service_role only. 2-year retention via a daily purge RPC.
- Writer wrapper: every `api/_admin*.js` and the Phase 4 DSAR endpoint logs an event before and after sensitive reads/writes. No raw PII in `metadata`; use IDs + action enums.
- Admin console read page: filterable timeline of recent events (owner-only).

**Test gate.** `scripts/round67-audit-log.test.mjs` + `scripts/round67-audit-log-browser.test.mjs` + live schema-drift pass. Asserts: insert works for service_role, 42501 for everyone else; UPDATE/DELETE from any application role is denied; the log retains structured metadata only. Full regression stays green.

**Owner-only actions.** None required.

### Phase 6 — Log scrubbing + Vercel firewall rate limits

**Goal.** Stop PII and tokens from leaking into Vercel log retention; stop the small anon surface being abused by volumetric probing.

**Deliverable.**
- `lib/log-scrub.mjs`: structured logger with field-aware redaction. Any log call anywhere in `api/` routes through it. Redacts: email (keeps local-part first 2 chars + `@domain`), phone (keeps last 3 digits), passport/ID numbers (full redact), guest tokens (full redact), service-role or admin JWTs (full redact), raw request bodies (strip to known-safe keys).
- Vercel firewall rate limits (configured in `vercel.json` or `lib/deployment-config.mjs`):
  - `/api/guest*`: 60 req/min/IP, 500 req/day/IP.
  - `/api/host*`: 300 req/min/authenticated-session.
  - `/api/admin*`: 60 req/min/admin-session; alerting on burst.
  - `/api/csp-report`: 60/min/instance (already in place from Round 65 Phase 5a — verify).
- Documentation of the thresholds in `docs/security/RATE_LIMITS.md` with the audit's attack scenarios (property enumeration via `/api/guest-token`, consent fabrication, scan-document abuse) cross-referenced.

**Test gate.** `scripts/round67-log-scrub.test.mjs` (unit, 20+ redaction cases including worst-case email/phone/token shapes); `scripts/round67-rate-limits.test.live.mjs` (post-deploy, hits the limited endpoints and expects 429 past the threshold); full regression stays green.

**Owner-only actions.** Approve the exact rate thresholds (defaults proposed above). Confirm the Vercel firewall feature is on the current plan (should be — it's standard on Pro).

### Phase 7 — Round close

**Goal.** Verified green release across all six implementation phases, with the security assessment updated to reflect the three deferred GDPR HIGHs now closed.

**Deliverable.**
- Full `npm run test:all` green on `main`, totals pasted into CHANGELOG.
- `npm run test:live` green against production.
- `docs/SECURITY_ASSESSMENT_2026-10.md` section 7 updated with closures and remaining items.
- `docs/SECURITY_ROUND65_VERIFICATION.md` cross-linked from Phase 2's ROPA entry under "security measures" for the relevant activities.
- Final CHANGELOG entry with PR list, prod deployment SHA, and the `curl -I` headers evidence showing CSP + HSTS + XFO + rate-limit response headers.

**Test gate.** Full regression + live smoke. Documentation phase only; no runtime code.

**Owner-only actions.** None required beyond standing publication authorization.

## Multi-model handoff

Any phase can be picked up by any model following AGENTS.md conventions. Change `pending` → `in-progress — <model>` and commit before implementation. Prefix commits with `Round 67 Phase N · `.

## Risks and limits

- **Document rounds look invisible.** Progress shows as `.md` files landing on main. User-visible benefit is "we survive buyer DD," not UI shine. This is deliberate.
- **Legal defensibility is lawyer-grade, not auditor-grade.** The DPA template and BREACH_SOP are defensible first versions written against the regulation text; a real GDPR lawyer should review before relying on them in a sale.
- **No real customer data touched** in any phase. DSAR tests use synthetic rows. Admin audit log back-fills no history (only logs forward from merge).
- **The three deferred GDPR HIGHs are closed by Round 67, not 65.** `docs/SECURITY_ASSESSMENT_2026-10.md` section 6 and 7 and `docs/SECURITY_ROUND65_VERIFICATION.md` section 1 all currently reflect this split; Phase 7 updates them.
