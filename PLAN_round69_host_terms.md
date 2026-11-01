# Round 69 — Host terms of service: acceptance at login

**Specification file.** Written 1 November 2026 at Daniele's request. Daniele confirmed the plain-language recap on 1 November 2026 (he sent the terms text in reply to "Do you confirm Round 69? If so, please send the terms text").

## Why

Hosts use WelcomeBnB without any signed terms. The only contract text today is the pilot agreement, whose Art. 5 says WelcomeBnB "generates files and never transmits". Since Round 49 that is no longer true: the automatic Alloggiati filing sends on the host's behalf. We need:

1. Host terms of service (Condizioni Generali) that keep every legal filing obligation with the host, limit WelcomeBnB's liability as far as Italian law allows, and attach the existing DPA (`docs/compliance/DPA_TEMPLATE.md`) as Annex A.
2. Acceptance that holds up in court. Italian law (art. 1341(2) c.c.) needs a **specific written approval** of the onerous clauses (liability limits, indemnity, provider withdrawal, unilateral changes, forum). Recent Cassazione rulings say a plain tick box is not enough. Design: (a) general acceptance, (b) a **separate** approval of the listed clauses, (c) confirmed with a **one-time code sent to the account email** (simple electronic signature on top of the password login), (d) stored as tamper-evident evidence. The lawyer may later require a stronger signature; the design keeps the method in a column so it can change.
3. The prompt shows on a new host's **first login** and on an existing host's **next login** (any console load), until they accept the current version.

Business context (decided 1 November 2026): the terms go live only once Daniele's SRLS exists, and the contract is in the company's name from day one. Until then hosts keep using WelcomeBnB for free with the flag off. Price changes and paid plans need a new acceptance (a new terms version), so versioning is required from day one.

Host type: terms Art. 1.3 asks each host whether they act as a business (with partita IVA) or as a private person. Private hosts are likely consumers under Italian law, so several clauses apply to them only within consumer law limits (Art. 10.5). Store the answer with the acceptance.

## What changes for hosts and guests

- **Hosts:** a full-screen window after sign-in that cannot be dismissed. Read the terms, tick acceptance, tick the separate approval of the listed clauses, enter the code from their email, confirm. They then receive an email with a copy of what they accepted. The only other choice is "Esci" (sign out).
- **Guests:** nothing.
- **Nothing stops in the background.** Automatic filing, reminders, calendar sync and guest check-ins keep running for hosts who have not accepted yet (terms Art. 14.2). Blocking them would cause missed police filings, which is the opposite of safer.

## What it does not touch

Guest app, Alloggiati/SPOT/regional/tax builders and goldens, autofile scheduling, the Round 49 autofile consent and the Round 44 credential consent (they stay as separate, per-property consents), Round 63 iReservation work.

## Inputs

- Legal text: `docs/legal/CONDIZIONI_GENERALI_v1.md` (draft supplied by Daniele as a PDF on 1 November 2026, transcribed verbatim; the lawyer may change it). It ends with Art. 16, the list of clauses needing specific approval. Committed as-is with the "BOZZA" banner.
- Annex A: `docs/compliance/DPA_TEMPLATE.md` (Round 67).

## Constraints (recurring gotchas — read before coding)

- **Vercel function budget is full: 12 of 12** (`api/` has 12 non-underscore files) on the Hobby plan. Daniele plans to move to Vercel Pro, which removes the cap. Check the plan before Phase 2: if Pro is not active, do **not** add an `api/*.js` entry point. Mount the new actions on an existing function, as Round 65 did for `/api/csp-report` (rewrite in `vercel.mjs` → existing handler, logic in an underscore module `api/_host-terms.js`). Keep and extend the existing function-budget test.
- **RLS + GRANT:** tables created by migration need explicit `GRANT`s. A missing grant gives 0-row writes with no error. Write grant probes for every role (`anon`, `authenticated`, `service_role`).
- Vanilla JS, no bundler, no modules. `applyLang` strings are single-line and go through `innerHTML`: the legal text itself is **never** passed through `applyLang` or `innerHTML` from untrusted input. Render it from the committed static file with `textContent`-safe Markdown rendering (headings, paragraphs, lists, bold only).
- Migration naming as in `supabase/migrations/` (timestamped CLI migrations, e.g. `<ts>_round69_host_terms.sql`), re-runnable, loaded by PGlite fixtures where the tests need it; schema-drift live test must find it in production (AGENTS.md rule 8).
- Email goes through Resend, as `_notify-host.js` does. No guest data in the email.
- Feature flag: `HOST_TERMS_ENFORCE` (server env, default **off**). Off = status always returns `accepted: true` and no window shows. Daniele turns it on only after the lawyer has approved the final text. Everything is built, tested and deployed with the flag off; a test covers both states.

## Data model (Phase 1)

`legal_documents` — one row per published version.
- `id uuid pk`, `kind text check (kind in ('host_terms'))`, `version int`, `file_path text`, `text_sha256 text` (SHA-256 of the exact file bytes served), `specific_clauses jsonb` (the Art. 16 list as shown in the approval box: `[{"ref":"10.2 e 10.3","label":"…"}]`), `requires_reacceptance bool default true`, `published_at timestamptz`, unique `(kind, version)`.
- RLS: `authenticated` may SELECT published rows; writes `service_role` only.

`host_terms_acceptances` — append-only evidence.
- `id uuid pk`, `host_id uuid not null references auth.users`, `document_id uuid references legal_documents`, `version int`, `text_sha256 text`, `accepted_general_at timestamptz`, `approved_specific_at timestamptz`, `otp_verified_at timestamptz`, `host_kind text check (host_kind in ('business','private'))`, `method text` (`'password_login+email_otp'`), `account_email text`, `ip inet`, `user_agent text`, `receipt_email_id text` (Resend id), `created_at timestamptz default now()`.
- RLS: host SELECTs own rows; admins SELECT all (existing `is_admin()`); INSERT `service_role` only; **no UPDATE/DELETE for any role** (revoke + a trigger that raises on UPDATE/DELETE). Retention: life of the account + 10 years (ordinary limitation period); record it in the ROPA.

`host_terms_codes` — short-lived one-time codes.
- `host_id`, `code_hash` (SHA-256 of code + server pepper env `HOST_TERMS_PEPPER`), `document_id`, `expires_at` (now + 10 min), `attempts int`, `used_at`, `created_at`. `service_role` only; purge rows older than 1 day in the existing daily purge cron.

Seed: version 1 row with the SHA-256 of `docs/legal/CONDIZIONI_GENERALI_v1.md` and the Art. 16 clause list. A test asserts the seeded hash equals the committed file's hash and the clause list equals the file's Art. 16 bullets, so the text and the database can never drift.

## Server actions (Phase 2) — `/api/host-terms` via rewrite

All require a valid host JWT (`_supabase-auth.js`). Admin impersonation (`?p=`) never calls `accept`.

- `status` → `{ enforce, accepted, current: {version, sha256, clauses, file_path}, accepted_version? }`. `accepted` = a row exists for the current version, or the current version has `requires_reacceptance=false` and an older version was accepted.
- `request_code` → creates a code, emails it to the auth email (subject "Codice di conferma Condizioni WelcomeBnB"). Rate limit: 3 per 15 min, 10 per day per host. Never returns the code.
- `accept` with `{version, sha256, host_kind, general: true, specific: true, code}` → refuses unless `host_kind` is `business` or `private`, the version is current, the sha256 matches the served text, both flags are true, and the code is valid, unexpired, unused and under 5 attempts. Inserts the acceptance row, marks the code used, sends the receipt email (version, date/time Europe/Rome, the clause list, and the full text as an attachment or the text in the body), stores the Resend id. Idempotent on retry after success.
- Errors are plain IT/EN messages, no internal details.

## Host console (Phase 3)

- In `init()` (`host-console.html`), right after the user id is known and **after** the admin check, and before properties load: if not admin view (`?p=`), call `status`. If not accepted, show the window and do not continue `init()` until accepted. The check runs on every console load, so existing hosts with a remembered session see it too, not only at sign-in. It runs after the invite password-set dialog for new hosts.
- Window (mobile 390 px first; desktop 1440):
  1. Title "Condizioni Generali di Servizio", version and date, a link to open/print the text.
  2. The full text in a scrollable panel.
  2b. A required choice (radio, nothing preselected): "Uso WelcomeBnB per un'attività con partita IVA" / "Uso WelcomeBnB come privato, senza partita IVA".
  3. Checkbox A: "Ho letto e accetto le Condizioni Generali di Servizio e l'Accordo sul trattamento dei dati (Allegato A)."
  4. A separate, visibly distinct box listing the Art. 16 clauses (from `status.current.clauses`), each with its reference, and Checkbox B: "Ai sensi degli artt. 1341 e 1342 c.c. approvo specificamente le clausole elencate qui sopra." Unchecked by default. Never one checkbox for both.
  5. "Invia codice" (enabled only when A and B are ticked) → code field → "Conferma e continua". Resend link after 60 s.
  6. "Esci" signs out. No close button, Escape does nothing, no backdrop click.
- After success: short confirmation ("Fatto. Ti abbiamo inviato una copia via email.") and `init()` continues.
- Settings → new "Condizioni" row: accepted version, date, and a link to the text.
- UI strings IT and EN (`h()` keys). The legal text is Italian only; EN UI shows "The Italian text is the binding version."
- If `status` fails (network), show a retry message and do not load the console; do not fail open when the flag is on.

## Admin (Phase 4)

- `admin.html` host list: "Condizioni" column: `v1 · 01/11/2026` or "Non accettate".
- Per host: "Scarica prova" → JSON of the acceptance row(s) plus the document row (sha256, clause list) for a dispute file.
- ROPA (`docs/compliance/ROPA.md`): new activity "Accettazione condizioni host" (purpose: proof of contract; legal basis Art. 6(1)(b) and (c); retention as above). Refresh citation tests.
- `docs/legal/README.md`: how to publish a new version (new file `_vN`, new `legal_documents` row, decide `requires_reacceptance`), and the flag procedure.

## Phases

| Phase | Scope | Test gate (plus full `npm run test:all`) |
|---|---|---|
| 1 — Data model + text | Migration, seed v1, `docs/legal/` files, purge-cron update | PGlite: tables, constraints, append-only trigger rejects UPDATE/DELETE; grant probes per role; seed hash = file hash; clause list = Art. 16 bullets |
| 2 — Server actions | `api/_host-terms.js`, rewrite, Resend code + receipt, rate limits, flag | Actual handler tests: no JWT → 401; wrong/expired/reused code; 6th attempt blocked; stale version or sha → refused; general-only or specific-only → refused; success inserts one row; retry idempotent; flag off → accepted; function budget still 12 |
| 3 — Console gate | Window, init hook, Settings row, IT/EN | Chromium IT/EN × 390/1440: new host after invite sees it; existing host with stored session sees it on reload; cannot dismiss (Escape, backdrop); confirm disabled until A and B; wrong code message; success continues to dashboard; admin `?p=` view never shows it; flag off → no window; status error → retry, no console |
| 4 — Admin + paper trail | Admin column, evidence download, ROPA, legal README | Admin browser test; ROPA test; live schema-drift finds the migration |

## What Daniele needs to do

- Incorporate the SRLS, then fill the bracketed company fields (ragione sociale, sede, P. IVA, REA, PEC, foro) and have a lawyer review `docs/legal/CONDIZIONI_GENERALI_v1.md` (draft and written opinion also in the shared Doc).
- Set `HOST_TERMS_PEPPER` (random 32 bytes) in Vercel, Production + Preview, marked Sensitive.
- When the company exists and the final text is committed, set `HOST_TERMS_ENFORCE=true` and redeploy. From then on every host is asked at their next login.
- Risk worth knowing: hosts who never log in again never accept. Their filings keep running. Consider a one-off email asking them to log in.
