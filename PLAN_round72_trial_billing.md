# Round 72 — 30-day trial, admin extensions, soft lock and economic terms

**Specification file.** Written 14 November 2026 at Daniele's request; **confirmed by Daniele on 15 November 2026** («go ahead») after the plain-language recap.

## Why

WelcomeBnB is free today. Once Daniele's SRLS exists, hosts pay **€60 per year, IVA inclusa, per host account** (not per property) after a **30-day free trial**. This round builds everything that does not need money to flow: trial tracking, a soft paywall with a 7-day grace period then read-only (exports and data download always work), admin extensions / manual paid / free for life / switch to paid, the economic terms text, and the SRLS-day launch runbook. Card/SEPA payments (Stripe) and e-invoicing (Fatture in Cloud) are **Round 73**, blocked on the SRLS and the commercialista.

## Decisions already taken (14–15 November 2026)

- Soft lock: paywall at login → 7-day grace → read-only. Never a hard lock.
- Price: **annual only, €60 IVA inclusa** (€49,18 + IVA 22%), per host account.
- Payments: Stripe + an e-invoicing tool (Round 73).
- Existing hosts: **no automatic 30 days from signing**. Daniele sets each existing host's trial end date at launch (default launch + 30 days, earliest launch + 7 days). New hosts after launch: 30 days from invite acceptance. The terms never promise "30 days from signing".
- Admin can set any host to **free for life** (with a reason), and **switch anybody to paid at any time** (≥ 7 days' notice unless the host asked).
- No money and no paywall before the SRLS exists. Nothing in this round charges anyone.

## What changes

- **Before launch:** nothing visible. `billing_settings.launch_at` null → every host `prelaunch`.
- **After launch, hosts:** banner from 7 days left ("Prova gratuita: mancano N giorni"); reminder emails 7/3/1 days before, on expiry, and at end of grace; at trial end a login window "La prova è terminata" (Abbonati = bank transfer details for now; Contattaci; Scarica i miei dati; Continua only during grace); after grace **read-only**: view/export/download only; no new links, reservations, manual check-ins or property edits; guests with existing links still check in and autofile keeps filing them; iCal sync paused.
- **Guests:** nothing, except no new links for a read-only host.
- **Admin:** trial/billing status on each host card plus actions.

## Does not touch

Guest check-in form, Alloggiati/SPOT/regional/tax builders and goldens, autofile scheduling logic, Round 63 iReservation, Round 69 OTP mechanics (reused).

## Constraints

- RLS + explicit GRANTs with per-role probes (anon, authenticated, service_role, admin).
- Vanilla JS; `h()` strings single-line; no user/legal text through `innerHTML`.
- Migration `supabase/migrations/<ts>_round72_trial_billing.sql`, re-runnable, PGlite-loadable; `schema-drift.test.live.mjs` must find it in production.
- Server admin gate: caller JWT → `/auth/v1/user` → `rpc/is_admin` with the caller's JWT.
- Vercel Pro; prefer mounting on existing functions; a new entry point updates the exact function-list test.
- Day counts in `Europe/Rome`; "days left" rounds **up**.
- Email via Resend as `_notify-host.js`; no guest data in billing emails.

## Data model (Phase 1)

- `billing_settings` single row (`id = 1`): `launch_at` (the switch), `trial_days 30`, `grace_days 7`, `annual_price_cents 6000`, `vat_rate 22`, `bank_transfer_iban`, `bank_transfer_holder`, `updated_at`. `authenticated` SELECT; writes service_role only.
- `host_subscriptions` (`user_id` pk, no FK to auth.users): `trial_started_at`, `trial_ends_at`, `status` (trialing, active, past_due, expired, free_forever, canceled), `free_forever_reason`, `paid_until`, `payment_method` (bank_transfer, stripe), `stripe_customer_id`, `stripe_subscription_id`, `reminders_sent jsonb`, `read_only_since`, `created_at`, `updated_at`. Host SELECTs own; admins SELECT all; writes service_role only; no DELETE.
- `billing_events` append-only (UPDATE/DELETE/TRUNCATE blocked): `user_id`, `actor`, `action` (trial_started, trial_extended, trial_end_set, trial_shortened, free_forever_on, free_forever_off, marked_paid, expired, read_only, reminder_sent), `old_value`, `new_value`, `reason`, `created_at`. Admins SELECT all, host own; INSERT service_role only.
- `host_access_state(p_user default auth.uid())` SECURITY DEFINER → jsonb state: prelaunch | free | active | trial (days_left, trial_ends_at) | grace (grace_days_left) | read_only (since), plus price, VAT, bank details. A host may ask only for themselves unless admin.
- `host_can_write(p_user)` → false only in read_only.
- Rows: at launch for every existing host (date chosen by Daniele, ≥ launch + 7 days); after launch `accept_invite` inserts with `trial_started_at = greatest(now(), launch_at)`; hosts without invite created lazily from `greatest(auth.users.created_at, launch_at)`; Daniele's and test accounts free_forever at launch.

## Phases

| Phase | Scope | Test gate (plus full `npm run test:all`) |
|---|---|---|
| 1 — Data model | Migration (3 tables, 2 functions, grants, append-only trigger), `accept_invite` update, seed `billing_settings` with `launch_at = null` | PGlite: prelaunch while launch_at null; exact boundaries (trial last day, grace last day, read-only), Rome DST, days_left rounds up; extension moves trial_ends_at; free_forever and paid_until override; host can't read another's state, admin can; grant probes; billing_events append-only incl. owner; accept_invite after launch creates the row; migration re-run changes nothing |
| 2 — Server enforcement + reminders | `{error:'read_only'}` on guest-link minting, reservation/manual check-in creation; iCal sync skips read-only; `host_can_write(auth.uid())` in INSERT/UPDATE RLS of host-owned tables (inventory listed in CHANGELOG); exports, data download, autofile, guest check-ins on existing links untouched; reminder emails 7/3/1/expiry/end of grace at 09:00 Rome from the hourly cron, idempotent, logged | read_only refused on each choke point, others allowed; existing-link guest check-in and autofile still work; exports work; RLS probes; prelaunch never blocks; reminders once per milestone, never before launch, never to free/active |
| 3 — Host console | Banner (≤ 7 days left), paywall (dismissible in grace, not in read-only except export/download/sign out), read-only mode (disabled controls + tooltip), Settings → «Abbonamento» card; after `ensureHostTerms()`; never in admin `?p=`; bank-transfer details (IBAN, holder, €60, causale "WelcomeBnB <email>"); IT/EN | Chromium IT/EN × 390/1440: prelaunch nothing; banner at 7 not 8; paywall at expiry, Continua in grace; read-only controls disabled, exports/download/sign out work; admin `?p=` never; terms first; no horizontal scroll |
| 4 — Admin | Status chips; Estendi prova (+7/+14/+30/date, reason, reactivates expired), Passa a pagamento (from trialing or free_forever; date ≥ today + 7 unless "host asked" + note; email to host; idempotent; logs), Gratis a vita on/off (reason), Segna pagato (date, until +1 year, bank_transfer, note); last 5 events on card; billing_settings panel | Handler: anon/forged/non-admin refused before any read; exact field changes + one event each; reason required; extension restores access; Passa a pagamento rules and single email; paywall from that date; admin browser 390/1440 |
| 5 — Terms text | `legal/CONDIZIONI_GENERALI_v1.md` Art. 4, 13.2, 16 per the draft below; seed hash + Art. 16 list; in place only while v1 has 0 acceptances (else `_v2`, requires re-acceptance); keep BOZZA; receipt email states price and plan; lawyer questions added to the brief | Round 69 tests: seed hash = file hash; clause list; production v1 updated with 0 acceptances verified |
| 6 — Launch runbook | `docs/legal/LAUNCH_RUNBOOK.md`; admin **Lancia** with per-host end dates (default +30, ≥ +7, free for life), single transaction, Daniele/test free_forever, dry-run; runbook steps 1–6 (owner-blocked until SRLS) | Each host gets exactly its date; < +7 refused; launch email per host date; Lancia twice idempotent; free_forever untouched; admins excluded; dry-run writes nothing; rehearsal recorded |
| 7 — Regression + close | Full regression, `npm run test:live`, CHANGELOG close, ROPA «Gestione abbonamenti e fatturazione host» (6(1)(b), 6(1)(c), 10 years) | test:all green; live smoke; ROPA citations |

## Terms changes (Phase 5) — draft for the lawyer

**Art. 4 — Corrispettivi**
- 4.1 Il Fornitore può offrire un periodo di uso gratuito. Il Fornitore comunica all'Host via email e nel Servizio la data in cui l'uso gratuito termina. Durante l'uso gratuito non è dovuto alcun importo e non è richiesto alcun metodo di pagamento.
- 4.2 Al termine della prova, il Servizio costa **60 euro all'anno, IVA inclusa, per ogni account Host**, indipendentemente dal numero di Strutture. Il prezzo è pagato in anticipo per un anno.
- 4.3 Il pagamento avviene con carta o addebito SEPA tramite il fornitore di pagamenti indicato nel Servizio, oppure con bonifico. Il Fornitore emette fattura elettronica.
- 4.4 L'abbonamento si rinnova automaticamente ogni anno, salvo disdetta. Almeno 30 giorni prima del rinnovo il Fornitore invia un promemoria via email con la data, l'importo e il modo per disdire. La disdetta si fa dal Servizio o scrivendo a info@welcomebnb.it e ha effetto alla scadenza dell'anno pagato.
- 4.5 Se al termine della prova o alla scadenza l'importo non è pagato, l'Host ha 7 giorni per pagare con accesso completo. Poi l'account passa in sola lettura: l'Host può consultare ed esportare tutti i propri Dati, ma non creare nuovi link, prenotazioni o check-in, né modificare le Strutture. Il check-in degli Ospiti che hanno già ricevuto il link e l'Invio automatico delle loro schedine continuano a funzionare.
- 4.6 Il Fornitore può concedere a singoli Host una prova più lunga o l'uso gratuito del Servizio. Questo non modifica le condizioni degli altri Host. Il Fornitore può terminare in anticipo la prova, o l'uso gratuito concesso, con un preavviso di almeno 7 giorni via email; il pagamento è dovuto solo dalla data indicata nell'avviso.
- 4.7 Il Fornitore può modificare i prezzi con almeno 30 giorni di preavviso; il nuovo prezzo vale dal rinnovo successivo. Chi non accetta può disdire ai sensi dell'art. 4.4.
- 4.8 **Diritto di recesso del consumatore.** Se l'Host è un consumatore può recedere entro 14 giorni dal primo pagamento, senza motivazione, con una richiesta a info@welcomebnb.it, e riceve il rimborso integrale.

**Art. 13.2:** "L'Host può recedere in qualsiasi momento con una richiesta a info@welcomebnb.it. Il recesso ha effetto alla scadenza dell'anno già pagato; gli importi già pagati non sono rimborsati, salvo l'art. 4.8."

**Art. 16 adds:** 4.4 rinnovo automatico annuale; 4.5 sola lettura per mancato pagamento; 4.6 fine anticipata della prova o dell'uso gratuito con preavviso di 7 giorni; 13.2 nessun rimborso salvo art. 4.8.

**Questions for the lawyer:** (1) full refund within 14 days as the consumer withdrawal right? (2) tacit annual renewal: anything beyond the 30-day reminder and art. 1341 approval? (3) read-only after non-payment acceptable given exports are kept? (4) "IVA inclusa" correct for private and business hosts?

## What Daniele needs to do

Nothing until SRLS day. On SRLS day: company fields (ragione sociale, sede, P. IVA, REA, PEC, foro), the lawyer's final text, a company IBAN, then press **Lancia** when the agent says the terms are live. Risk: many hosts with the same end date hit the paywall together — stagger them.

## Follow-up: Round 73 — Stripe payments and e-invoicing (planned, blocked)

Blocked on: SRLS; Stripe account in the company's name; Fatture in Cloud plan with e-invoicing and API; commercialista on IVA and payout matching. Scope: Stripe product €60/year 22% inclusive, cards + SEPA, Checkout with codice fiscale (and P. IVA), Customer Portal; one informational notice 30 days before renewal (art. 65-bis Codice del Consumo), contact again only on failed charge; `/api/billing` (checkout, portal, signed webhook); on `invoice.paid` create the e-invoice via SdI; paywall "Abbonati" → Stripe Checkout, bank transfer as admin fallback. Cost reference: card ≈ €1.57, SEPA ≈ €0.77 per host-year; Fatture in Cloud Standard €144/year + IVA.
