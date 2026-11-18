# Register of Processing Activities (GDPR Art. 30)

**Status:** first version, 29 October 2026 (Round 67 Phase 2); retention lines updated 18 November 2026 (Round 76, Annex B of the host agreement). Written against the code on `main` at that date; every fact cites the file it comes from. Retention periods marked `OWNER DECISION` and the controller/processor framing need Daniele's confirmation before this register is relied on externally. A GDPR lawyer should review before any sale or audit (see `PLAN_round67_gdpr_paper_trail.md`, "Risks and limits").

## Who is who

- **WelcomeBnB (operator: Daniele Petrilli, owner-DPO; see `docs/compliance/BREACH_SOP.md` §2)** is **processor** for everything a host does about their own guests (Art. 28), and **controller** for its own host accounts, product analytics and admin access.
- **Each host** (B&B, affittacamere, apartment owner) is **controller** for their guests' data and their own legal obligations (Alloggiati, tourist tax, regional statistics).
- **Public authorities** (Polizia di Stato, regional statistics offices, municipalities) are **recipients**, not processors.

Register maintenance: update this file in the same PR as any change that adds a table, an external call, a storage bucket or a retention job. `scripts/round67-ropa.test.mjs` fails if an activity block loses a required field.

## Sub-processors and external services

| Service | Used for | Location / transfer | Evidence |
|---|---|---|---|
| Supabase | Database, auth, file storage, scheduled jobs | EU — `eu-west-1` (Ireland) | Supabase project `jcjwaqqabgwqhhzhfbts` |
| Vercel | Hosting, serverless API | EU — functions pinned to `dub1` (Dublin) in the Vercel project settings (Round 76 Phase 1; no `vercel.json`) | `vercel.mjs` |
| Anthropic | Guest AI chat; ID document reading | USA — transfer under Anthropic's Data Processing Addendum / SCCs (**OWNER: confirm the DPA is accepted on the account**) | `api/chat.js`, `api/scan-document.js` |
| Resend | Host notification and arrival-reminder emails | USA — transfer under Resend's DPA / SCCs (**OWNER: confirm**) | `api/_notify-host.js`, `api/send-arrival-reminders.js` |
| Telegram | Optional host notifications (host opts in) | Outside the EU | `api/_notify-host.js`, `api/telegram-webhook.js` |
| iReservation | Native channel-manager API (disabled until cutover) | Italy | `api/_ireservation-core.js` |
| Open-Meteo | Weather for the AI chat (property coordinates only, no personal data) | — | `api/chat.js` |

Not sub-processors: Polizia di Stato Alloggiati Web (public-authority recipient, `api/_alloggiati-soap.js`); OTA calendar feeds (Airbnb, Booking.com, Vrbo, bed-and-breakfast.it) which the host points us to and we only read (`api/ical-sync.js`). Regional statistics portals (SPOT, ROSS1000, PayTourist) are never called by the server: the host downloads files and uploads them (`lib/regional-exports.js`, `host-console.html` `downloadFile`).

## Processing activities

Each activity is one fenced `yaml` block. Required fields (Art. 30(1)–(2)): `purpose`, `data_subjects`, `personal_data`, `recipients`, `international_transfers`, `retention`, `security_measures`, `legal_basis`.

### 1. Guest check-in and Alloggiati Web filing

```yaml
id: guest-checkin-alloggiati
role: processor for the host (host is controller)
purpose:
  - Collect the identity data every guest must give the accommodation provider
  - File guest registrations with Polizia di Stato through Alloggiati Web (art. 109 TULPS), manually or by automatic filing when the host enables it
  - Give the host the residence data every regional statistics system collects for ISTAT
  - Let the host issue the guest's invoice when the guest provides optional invoice details
data_subjects:
  - Guests, including minors and group or family members
personal_data:
  - Identity - surname, name, sex, date and place of birth, citizenship
  - Residence - country, plus comune for Italian residents (required for regional statistics, ISTAT IST-00139); postcode required in Alto Adige
  - Invoice details, optional, main guest only - codice fiscale, street address, postcode, province (Round 68), email address to send the invoice to (2 Nov 2026)
  - Identity document - type, number, place of issue
  - Stay - arrival and departure dates, booking code
  - Document photo and optional selfie (storage bucket documents)
  - Filing state and police receipts (alloggiati_filing_log, bucket receipts)
  - Late filing via the Questura (Round 70) - filing method, the date the host declares the PEC was sent, and the optional PEC delivery receipt (bucket receipts); the file for the Questura is generated on the host's device only and never sent by WelcomeBnB
recipients:
  - The host
  - Polizia di Stato, Alloggiati Web (alloggiatiweb.poliziadistato.it)
  - The competent Questura, only when the host sends a late filing by PEC themselves
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None for storage (Supabase EU). Vercel function region to be confirmed (see sub-processor table)
retention:
  - Document and selfie photos - deleted as soon as the filing is recorded (minimise_filed_checkins, hourly job welcomebnb_police_minimise, migration 20261118100000_round76_police_data_minimisation.sql), and in any case 7 days after arrival (purge_old_id_photos, migration 20261019140000_round60c_photo_retention_7days.sql)
  - Identity fields sent to the police (document type, number and issuing place; place, province and state of birth; full date of birth) - erased 24 h after filing, or at the end of the month after departure where regional statistics need the same record; birth year and age at arrival kept (DM 7/1/2013 art. 4-bis; Garante 29/4/2026)
  - Police receipts and alloggiati_filing_log - 5 years from filing (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
  - Statistics fields (sex, birth year, citizenship, residence) and any identity left - end of the 12th month after the stay (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
  - Check-in row (tourist-tax record) - deleted 5 years after the end of the tax year; rows with invoice details 10 years from the stay (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
  - Late filing method, PEC date and PEC delivery receipt - same as the check-in row and its police receipt
  - Soft-deleted check-ins are purged after 30 days; test rows after 30 days (daily job welcomebnb_daily_purge)
security_measures:
  - Independently verified after Round 65 (guest gateway, file access and filed-row locks): docs/SECURITY_ROUND65_VERIFICATION.md
  - Row-level security on every table; guests reach data only through the signed guest gateway (api/guest.js)
  - Private storage buckets; signed URLs for host viewing
  - Host Alloggiati credentials encrypted with AES-256-GCM, key outside the database (api/_alloggiati-crypto.js)
  - Fields editable by guests restricted by allowlist; filed rows locked against edits
legal_basis:
  - Art. 6(1)(c) legal obligation of the host (art. 109 TULPS)
  - Art. 6(1)(c) for residence (art. 7 D.Lgs. 322/1989, ISTAT survey IST-00139) and for invoice details the host must put on the invoice
evidence:
  - api/guest.js
  - api/_alloggiati-soap.js
  - api/_alloggiati-crypto.js
  - supabase/migrations/20261019140000_round60c_photo_retention_7days.sql
```

### 2. Tourist tax and regional statistics

```yaml
id: tourist-tax-regional
role: processor for the host (host is controller)
purpose:
  - Calculate municipal tourist tax and produce the host's declaration files
  - Produce regional statistics files (SPOT, ROSS1000, other regional formats) and tourist-tax portal exports (PayTourist)
data_subjects:
  - Guests
personal_data:
  - Stay dates, ages or dates of birth (for exemptions), citizenship and residence (statistics), tax exemption declarations (tax_declared_flags)
recipients:
  - The host only. Files are generated in the host's browser and uploaded by the host to the municipality or region; the server sends nothing
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None
retention:
  - Same rows as activity 1; no separate copy is kept (exports are downloaded files)
  - Statistics fields - end of the 12th month after the stay; tourist-tax fields - 5 years after the end of the tax year (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
security_measures:
  - Generated client-side from data the host is already authorised to read (row-level security)
  - Byte-exact golden-file tests for every export format
legal_basis:
  - Art. 6(1)(c) legal obligation of the host (municipal tourist-tax regulation; regional statistics law)
evidence:
  - lib/regional-exports.js
  - lib/tax-date-rates.js
  - host-console.html
```

### 3. Keybox and door-code delivery

```yaml
id: entry-codes
role: processor for the host (host is controller)
purpose:
  - Deliver keybox, rotating and room door codes to the right guest at the right time, optionally only after check-in is complete
data_subjects:
  - Guests
  - Hosts (actor of manual release)
personal_data:
  - Booking code, expected guest count, check-in completion state
  - Entry codes linked to a booking (not personal data on their own, but security-sensitive)
  - Audit of host manual release - host user id, time, request and result (entry_access.audit)
recipients:
  - The guest of that booking, only when the release policy allows
  - The host
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None for storage; codes may appear in AI chat answers to the guest (see activity 5)
retention:
  - Entry bookings with their append-only audit - 12 months after the stay (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql); removed earlier with the property (cascade)
security_measures:
  - Independently verified after Round 65 (keybox owner check (CRIT-2 closed)): docs/SECURITY_ROUND65_VERIFICATION.md
  - Single server-side release policy, fail-closed (api/_entry-release-policy.js)
  - entry_access schema not exposed through the public API; append-only audit
  - Codes cleared from the guest screen when hidden, offline or out of scope
legal_basis:
  - Art. 6(1)(b) performance of the accommodation contract
evidence:
  - api/_entry-release-policy.js
  - api/_entry-release-loader.js
  - supabase/migrations/20261027041500_round66_entry_roster_audit.sql
```

### 4. Marketing consent

```yaml
id: marketing-consent
role: processor for the host (host is controller)
purpose:
  - Let the host contact past guests with offers, only with the guest's explicit opt-in
data_subjects:
  - Guests who opt in
personal_data:
  - Name, email, phone, booking code, time and text version of consent, withdrawal time
recipients:
  - The host
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None
retention:
  - Withdrawal records withdrawn_at and keeps the row as proof of the withdrawal (api/guest.js doConsentWithdraw)
  - Consents - 24 months from the stay; withdrawals 24 months from the withdrawal (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
security_measures:
  - Independently verified after Round 65 (marketing_consents lock-down (HIGH-DB-3; double opt-in residual)): docs/SECURITY_ROUND65_VERIFICATION.md
  - Optional, unticked, separate from check-in; versioned consent text
  - Row-level security; host sees only their own property's contacts
legal_basis:
  - Art. 6(1)(a) consent; Art. 7 records of consent
evidence:
  - api/guest.js
  - index.html
```

#### HIGH-GDPR-3 (consent from a child under 14, Art. 8): residual risk, not closed by design

The Round 67 plan proposed recording this finding as "structurally unreachable". Checking the current code does not support that wording:

- `index.html:1440` says the card is "Only shown to the main guest (see showConsentCard())".
- `showConsentCard()` is defined at `index.html:4494` and has exactly one call site, `index.html:4325`, on the success screen after the check-in party is saved on that device.
- `showConsentCard()` itself checks neither who is the lead guest nor anyone's age. "Main guest" is a consequence of the usual flow (one adult completes the group's check-in), not an enforced rule.

What does hold: Art. 8 applies to information-society services offered **directly** to a child, and in Italy only below 14 (d.lgs. 196/2003 art. 2-quinquies). Check-in is normally completed by an adult who registers the whole party, and the form is per booking. So the risk is **low but not zero**: a teenager completing their own check-in on their own device would see the form.

**OWNER DECISION.** Either accept the residual risk and record it here, or close it with a small change (for example an "I am 18 or older" confirmation on the consent card, or showing the card only when the person completing check-in is the registered lead and is adult by date of birth). The audit finding should stay open until one is chosen.

### 5. Guest chat and AI assistant

```yaml
id: guest-chat-ai
role: processor for the host (host is controller)
purpose:
  - Answer guests' questions about the property and the area; escalate to the host
  - Improve answers by reusing anonymised question-and-answer pairs
data_subjects:
  - Guests
  - Hosts (replies)
personal_data:
  - Chat messages and any personal data a guest chooses to write; optional attached images
  - Booking code, stay dates and party size sent as context
  - Usage counters per session (api_usage)
  - Question-and-answer pairs with coarse buckets - region, season, stay length, group size (chat_qa_pairs; quarantine table in entry_access)
recipients:
  - The host
  - Anthropic (model claude-sonnet-4-5, with web search)
  - Sub-processors - Supabase, Vercel
international_transfers:
  - USA - Anthropic, under its DPA / SCCs (OWNER - confirm accepted)
retention:
  - Chat messages - 12 months from the stay, unless the conversation is still active (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql); soft-deleted messages after 30 days (welcomebnb_daily_purge, resolved-thread rule now 365 days)
  - Anonymised Q&A pairs and the quarantine archive - no limit (no personal data after anonymisation; Annex B)
security_measures:
  - Independently verified after Round 65 (chat escaping (CRIT-1 closed)): docs/SECURITY_ROUND65_VERIFICATION.md
  - Server builds the property and stay context; entry codes follow the release policy
  - Entry-sensitive history protected and excluded from reusable Q&A
  - Per-session and monthly token caps
legal_basis:
  - Art. 6(1)(b) contract (guest service)
  - Art. 6(1)(f) legitimate interest for the anonymised Q&A reuse (balancing test - OWNER to confirm)
evidence:
  - api/chat.js
  - api/_chat-context.js
  - docs/entry-release/CHAT_HISTORY.md
```

### 6. Calendar sync with booking portals (iCal)

```yaml
id: ical-sync
role: processor for the host (host is controller)
purpose:
  - Import reservations from the host's portal calendars so check-in links, reminders and occupancy work
data_subjects:
  - Guests who booked through a portal
personal_data:
  - Guest name as published in the calendar, last 4 phone digits, reservation link, raw calendar entry, optional contact phone and email, notes, guest count, stay dates
recipients:
  - The host
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None for storage
retention:
  - Reservations (dates, platform, guest name) - 10 years from check-out; contact e-mail, phone and iCal description - 12 months from check-out (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql); removed earlier with the property
security_measures:
  - Only allowlisted portal hosts fetched; private and internal addresses refused (SSRF protection)
  - Row-level security
legal_basis:
  - Art. 6(1)(b) contract between host and guest, carried out by the host
evidence:
  - api/ical-sync.js
```

### 7. iReservation native channel-manager API

```yaml
id: ireservation
role: processor for the host (host is controller)
purpose:
  - Read reservations and rooms directly from the iReservation channel manager (pilot; disabled until cutover)
data_subjects:
  - Guests of hosts using iReservation
personal_data:
  - Reservation data equivalent to activity 6; comparison reports
recipients:
  - The host
  - iReservation (api.ireservation.it)
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None
retention:
  - OWNER DECISION - no purge for comparison reports
security_measures:
  - Disabled unless IRESERVATION_ENABLED=true in production
  - Partner credentials in a private schema, never published (docs/ireservation/OPERATIONS.md)
legal_basis:
  - Art. 6(1)(b) contract between host and guest, carried out by the host
evidence:
  - api/_ireservation-core.js
  - docs/ireservation/OPERATIONS.md
```

### 8. Admin access and impersonation

```yaml
id: admin-access
role: controller (WelcomeBnB)
purpose:
  - Support hosts by viewing their console, and operate the service
data_subjects:
  - Hosts
  - Guests whose data is visible during support
personal_data:
  - Admin id and email, property accessed, action, time (admin_impersonation_log)
  - Whatever the host console shows during support
recipients:
  - WelcomeBnB admins only
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None for storage
retention:
  - Admin access log - 2 years, append-only (admin_audit_purge, daily job welcomebnb_admin_audit_purge, migration 20261116170000_round67_admin_audit_log.sql)
security_measures:
  - Admins listed in admin_users; every impersonation is logged
  - Gap - the current log is written partly from the browser and is not append-only (closed by Round 67 Phase 5)
legal_basis:
  - Art. 6(1)(f) legitimate interest (support, security)
  - For guest data, Art. 28 processor instructions from the host
evidence:
  - admin.html
  - host-console.html
  - api/_alloggiati-support.js
```

### 9. Host accounts and notifications

```yaml
id: host-accounts
role: controller (WelcomeBnB)
purpose:
  - Give hosts an account, send arrival reminders and new-check-in notifications, run the pilot programme
data_subjects:
  - Hosts and their staff
personal_data:
  - Login email, password hash (Supabase Auth)
  - Notification settings - email, Telegram chat id, push subscription endpoints
  - Notification log, Telegram link tokens
  - Pilot invites and payments (email, amount paid)
recipients:
  - Resend (email)
  - Telegram (only if the host links it)
  - Sub-processors - Supabase, Vercel
international_transfers:
  - USA - Resend (OWNER - confirm DPA)
  - Outside EU - Telegram (host's choice)
retention:
  - Host notification log - 12 months (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
  - Closed host accounts (subscription, billing events, terms acceptances) - 10 years after the last record of an account that no longer exists (Annex B; retention_purge, migration 20261118110000_round76_retention_purges.sql)
security_measures:
  - Supabase Auth; row-level security; invite-only sign-up
legal_basis:
  - Art. 6(1)(b) contract with the host
  - Art. 6(1)(c) accounting obligations for payments
evidence:
  - api/_notify-host.js
  - api/send-arrival-reminders.js
  - api/telegram-webhook.js
```

### 10. Product analytics

```yaml
id: analytics
role: controller (WelcomeBnB)
purpose:
  - Understand how hosts and guests use the product, to improve it
data_subjects:
  - Hosts
  - Guests
personal_data:
  - Host user id and email, event type and event data, session id, booking code (analytics_events)
  - No IP address or browser fingerprint is collected
recipients:
  - WelcomeBnB
  - Sub-processors - Supabase, Vercel
international_transfers:
  - None
retention:
  - Events older than 180 days are rolled into monthly aggregates (analytics_monthly) and deleted (welcomebnb_daily_purge)
security_measures:
  - Event payload size-limited; row-level security
legal_basis:
  - Art. 6(1)(f) legitimate interest (product improvement)
evidence:
  - api/guest.js
```

### 11. ID document reading

```yaml
id: document-scan
role: processor for the host (host is controller)
purpose:
  - Read the guest's identity document so the check-in form fills itself
data_subjects:
  - Guests
personal_data:
  - Image or PDF of the identity document and the fields read from it
recipients:
  - Anthropic (model claude-sonnet-4-5)
  - Sub-processors - Vercel
international_transfers:
  - USA - Anthropic, under its DPA / SCCs (OWNER - confirm accepted)
retention:
  - The scan endpoint stores no image; only token usage is logged. The photo saved with the check-in follows activity 1 (deleted at filing, at the latest 7 days after arrival)
security_measures:
  - Size limit about 10 MB; signed guest session required
legal_basis:
  - Art. 6(1)(c) legal obligation of the host (data required for art. 109 TULPS), with the guest choosing scanning over typing
evidence:
  - api/scan-document.js
```

### 12. Host terms acceptance (Accettazione condizioni host)

Round 69. Proof that each host accepted the Terms of Service (Condizioni Generali) and the DPA (Annex A), with the separate approval of the art. 16 clauses required by arts. 1341-1342 c.c., confirmed with a one-time code sent to the account email. Active only when `HOST_TERMS_ENFORCE` is on.

```yaml
id: host-terms-acceptance
role: controller (WelcomeBnB)
purpose:
  - Prove the contract with the host, its version and the specific approval of the onerous clauses
  - Send the one-time confirmation code and a copy of the accepted texts
data_subjects:
  - Hosts
personal_data:
  - Account id and email, business or private declaration, accepted version and SHA-256 of the texts
  - Times of acceptance, specific approval and code verification
  - IP address and browser user agent at acceptance, receipt email id
  - One-time codes, stored only as a keyed hash
recipients:
  - Resend (code and receipt emails)
  - Sub-processors - Supabase, Vercel
international_transfers:
  - USA - Resend (OWNER - confirm DPA)
retention:
  - Acceptance evidence - life of the account plus 10 years (ordinary limitation period); append-only, kept after account deletion
  - One-time codes - deleted after 1 day by the daily job welcomebnb_host_terms_codes_purge
security_measures:
  - Evidence rows cannot be changed or deleted by any role (database trigger); hosts read only their own, admins all
  - Codes valid 10 minutes, 5 attempts, rate-limited, never shown or stored in clear
legal_basis:
  - Art. 6(1)(b) conclusion and performance of the contract with the host
  - Art. 6(1)(c) evidence required by arts. 1341-1342 c.c. and limitation-period obligations
evidence:
  - supabase/migrations/20261101090000_round69_host_terms.sql
  - api/_host-terms.js
  - legal/CONDIZIONI_GENERALI_v1.md
```

### 13. Host subscriptions and billing (Gestione abbonamenti e fatturazione host)

Round 72. Free trial, grace period, read-only mode, manual bank-transfer payments, free-for-life grants and the reminder emails about them. Nothing is active until the launch switch (`billing_settings.launch_at`) is set on SRLS day. Card/SEPA payments and e-invoicing are Round 73 (Stripe, Fatture in Cloud) and will be added here then.

```yaml
id: host-subscriptions-billing
role: controller (WelcomeBnB)
purpose:
  - Run the host's free trial, grace period and read-only mode, and record payments received by bank transfer
  - Send trial reminders, the launch email and the switch-to-paid notice to the host's account email
  - Keep the accounting and contract record of each host's plan, payments and admin decisions (extensions, free for life)
data_subjects:
  - Hosts
personal_data:
  - Account id and email, host language
  - Trial start and end, paid-until date, payment method (bank transfer), free-for-life reason, reminder send times
  - Billing events - admin email (actor), old and new values, reason or note
recipients:
  - Resend (reminder, launch and switch-to-paid emails; no guest data)
  - Sub-processors - Supabase, Vercel
international_transfers:
  - USA - Resend (OWNER - confirm DPA)
retention:
  - Subscription rows and billing events - 10 years from the end of the financial year (art. 2220 c.c. accounting records); append-only events, no foreign key to the account so they outlive it
security_measures:
  - Hosts read only their own subscription and events, admins all; only the server (service role) writes; nobody deletes; events cannot be changed or deleted by any role (database trigger)
  - Admin actions checked on the server (caller JWT, is_admin) before any read; every change writes one event with the admin email and reason
  - Billing never blocks guests who already have a link, Alloggiati filing or exports; checks fail open
legal_basis:
  - Art. 6(1)(b) performance of the contract with the host (Terms Art. 4)
  - Art. 6(1)(c) legal obligation to keep accounting records (art. 2220 c.c., DPR 600/1973)
evidence:
  - supabase/migrations/20261115090000_round72_trial_billing.sql
  - supabase/migrations/20261115100000_round72_read_only_rls.sql
  - supabase/migrations/20261115110000_round72_launch.sql
  - api/_trial-reminders.js
  - api/_admin-billing.js
  - legal/CONDIZIONI_GENERALI_v1.md
```

## Owner decisions collected from this register

1. ~~**Retention periods**~~ — decided 18 Nov 2026 (Round 76): Annex B of the host agreement, `docs/compliance/RETENTION_POLICY.md`, enforced by the jobs cited above. Only the iReservation comparison reports (activity 7) remain without a limit while that integration is owner-only.
2. ~~**Vercel region**~~ — pinned to `dub1` (Dublin), Round 76 Phase 1.
3. **DPAs accepted** with Anthropic and Resend.
4. **HIGH-GDPR-3:** accept the residual risk or add an 18+ confirmation to the consent card.
5. **Controller/processor framing** above, and the legitimate-interest balancing for Q&A reuse and analytics.

Round 66 completion update: entry exceptions now check current authenticated owner/admin identity in the database. Admin exceptions write the existing impersonation log and immutable booking audit atomically; failed auditing blocks the mutation. Host status is projected by `api/_entry-host-state.js` without guest records or codes in the response. Existing retention decisions above remain owner decisions.
