# Breach-notification Standard Operating Procedure (SOP)

**Round 67 Phase 1 deliverable.** This document is the operational playbook for the 72 hours after we discover a personal-data breach in `app.welcomebnb.it`. It implements GDPR Art. 33 (notification to the supervisory authority) and Art. 34 (communication to the data subject). It is written for a single operator (Daniele Petrilli) acting as owner, controller contact, and DPO under Art. 24 accountability.

> **Scope.** Covers personal data of hosts and their guests held in Supabase project `jcjwaqqabgwqhhzhfbts`, Vercel deployment `app.welcomebnb.it`, Vercel logs, email transit, and anything a sub-processor holds on our behalf (Supabase, Vercel, Anthropic, Telegram when linked, Google Maps when invoked). Does not cover a host's own independent operations or data they hold outside the product.

> **This document is defensible as a first version.** A real GDPR lawyer should sanity-check it before relying on it for a sale or an actual notification. Lawyer review is not blocking Round 67 Phase 1's acceptance.

---

## 1. Definitions

- **Personal data breach** (GDPR Art. 4(12)): "a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data transmitted, stored or otherwise processed."
- **Controller:** for guest data, the host is the controller; WelcomeBnB is the processor. For host account data (login, billing, support), WelcomeBnB is the controller.
- **Processor:** WelcomeBnB acts as processor for guest data (Alloggiati filing, keybox delivery, chat, DSAR fulfilment).
- **Supervisory authority (Garante):** the Italian data protection authority — Garante per la protezione dei dati personali. Online breach notification portal: <https://servizi.gpdp.it/databreach/s/>.
- **"Becoming aware"** (recital 87, EDPB guideline 9/2022): a controller has become aware when it has "a reasonable degree of certainty that a security incident has occurred that has led to personal data being compromised." A probable alert is not awareness; a confirmed indicator (e.g. a verified anomalous query, a security-researcher report with a working proof-of-concept, a logged exfiltration) is. **The 72-hour clock starts at that moment, not when the incident actually happened.**
- **High risk to rights and freedoms** (Art. 34): assessed against the EDPB severity matrix — type of data (special category under Art. 9 is high by default: health, political, religious; passport/ID numbers are high; names/emails alone are medium), number of subjects, identifiability, severity of possible consequences.

---

## 2. Data Protection Officer (DPO) and controller contact

**Formal declaration.** Under Art. 24 accountability, WelcomeBnB names the following role holder for all GDPR correspondence, including Art. 33 breach notification and Art. 34 affected-individual communication:

| Role | Name | Primary contact | Backup contact |
|---|---|---|---|
| Owner-DPO | Daniele Petrilli | `info@welcomebnb.it` | GitHub Private Vulnerability Reporting (<https://github.com/Giginoparrucca/doorstep/security/advisories>) |

**Art. 37 note.** A formal DPO is required under Art. 37 only when the core activities involve large-scale regular monitoring of data subjects, large-scale processing of special categories, or when the controller is a public authority. WelcomeBnB's current scale (sole operator, Italian B&B hosts, no special-category data) does **not** meet this threshold. The role is nonetheless named for Art. 24 accountability.

**Scaling trigger.** If WelcomeBnB expands to serve either (a) 50+ host accounts, (b) 10 000+ reservations per year, or (c) special-category data (e.g. health conditions for accessibility services), re-assess the Art. 37 trigger and appoint a formal DPO.

**Verified channel pending.** `security@welcomebnb.it` is pending mailbox verification (see `SECURITY.md`). Until that completes, incoming breach reports arrive at `info@welcomebnb.it` or via GitHub PVR; outbound notifications to Garante and affected individuals use `info@welcomebnb.it` as the From address.

---

## 3. The 72-hour decision tree

```
    ┌──────────────────────────────────────────┐
    │ Confirmed breach? (defined §1)           │
    └──────────┬───────────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
      NO               YES
       │                │
       │                ▼
       │        ┌───────────────────────────┐
       │        │ START 72h CLOCK           │
       │        │ Log timestamp in          │
       │        │ admin_access_events       │
       │        └──────────┬────────────────┘
       │                   │
       │                   ▼
       │        ┌───────────────────────────┐
       │        │ Did personal data leave   │
       │        │ WelcomeBnB's control?     │
       │        └──────────┬────────────────┘
       │                   │
       │        ┌──────────┴──────────┐
       │        │                     │
       │       NO                    YES
       │        │                     │
       │        ▼                     ▼
       │  ┌───────────┐      ┌─────────────────────┐
       │  │ Path A    │      │ Was there high risk │
       │  │ internal  │      │ to rights and       │
       │  │ event:    │      │ freedoms?           │
       │  │ log only  │      └──────────┬──────────┘
       │  │ no notif  │                 │
       │  └───────────┘       ┌─────────┴─────────┐
       │                      │                   │
       │                     NO                  YES
       │                      │                   │
       │                      ▼                   ▼
       │                ┌───────────┐    ┌───────────────┐
       │                │ Path B    │    │ Path C        │
       │                │ Garante   │    │ Garante +     │
       │                │ within    │    │ affected      │
       │                │ 72h       │    │ individuals   │
       │                │           │    │ without undue │
       │                │           │    │ delay         │
       │                └───────────┘    └───────────────┘
       │
       ▼
  Log analysis
  only; no SOP
  activation
```

**Path A — no notification.** Example: a scanner probes an endpoint and gets 401; a buggy query returns 0 rows; a host logs in with the wrong password three times. These are not breaches under Art. 4(12). Record the alert in `admin_access_events`, close.

**Path B — Garante notification only.** Example: a logging error exposes 200 host emails in a Vercel build log for 15 minutes; the log is private but we cannot prove no one with log access read it. Risk is low (emails are not special-category, no financial consequence). Notify Garante within 72h. Do not individually email the 200 hosts if the risk is genuinely low — document the risk assessment.

**Path C — Garante AND affected individuals.** Example: an attacker exfiltrates passport numbers and dates of birth for 50 guests. Document numbers are high-sensitivity under EDPB guidelines; identity-theft risk is high; the 50 guests must be contacted. Garante notification within 72h; affected guests "without undue delay" (practically: same day as containment, no later than the next business day).

**Factors escalating from B to C:**
- Special-category data (Art. 9) involved
- Document numbers (passport, carta d'identità) exposed
- Date of birth + full name combination exposed
- Password or token exposure that could enable account takeover
- Volume above ~100 subjects
- Media or external reporter awareness
- Affected individuals include minors or vulnerable adults

---

## 4. Garante notification

**Portal:** <https://servizi.gpdp.it/databreach/s/>. Login with SPID or CIE. Daniele's SPID credentials are stored separately — do not record them in this file.

**Mandatory fields** (prepared below so the first 15 minutes of a notification aren't spent reading the form):

| Field | Source |
|---|---|
| **Nature of the breach** | One sentence: what happened. E.g. "Unauthorised read access to the `checkins` table via a privileged API endpoint." |
| **Categories of personal data affected** | From the ROPA (Phase 2). Common categories: contact (email/phone), identification (name/DOB/document number), stay (dates/property), payment (if any). |
| **Categories of data subjects affected** | "Hosts," "Guests of hosts using WelcomeBnB," or both. |
| **Approximate number of data subjects** | Pulled from an SQL count against affected tables, scoped by timestamp range. |
| **Approximate number of personal-data records** | Row count, usually > subject count because one subject can have multiple records. |
| **Name and contact details of the DPO or other contact** | §2 of this document. |
| **Likely consequences** | Risk assessment: identity theft risk, financial loss risk, reputational harm, discrimination risk. |
| **Measures taken or proposed** | Containment: what was revoked/rotated/patched. Remediation: what change prevents recurrence. Notification plan for affected individuals (Path C only). |
| **Reasons for delay** (if filing after 72h) | Written justification; the Garante may fine for unexcused delay. |

**Who files.** Daniele as owner-DPO. If Daniele is unreachable for > 24 hours during an active incident, the fallback is: (a) email `info@welcomebnb.it` with subject `BREACH-ESCALATION` which goes to the same inbox; (b) escalate to a nominated backup lawyer or trusted technical contact — Daniele to document the backup contact separately (not in this file) to avoid leaking the escalation path.

---

## 5. Affected-individual communication (Path C)

Two templates below. **IT** is the default for guests of Italian B&Bs; **EN** is used when the subject's communication language in the system is English or we have no language preference recorded.

### 5.1 IT template

> **Oggetto:** Comunicazione importante sui tuoi dati personali — WelcomeBnB
>
> Gentile {{nome}},
>
> Il {{data}} abbiamo rilevato un incidente di sicurezza che ha coinvolto alcuni dei tuoi dati personali conservati nel sistema di gestione del tuo soggiorno presso {{nome_struttura}}, operato tramite WelcomeBnB.
>
> **Cosa è successo.** {{sintesi_tecnica_breve}}
>
> **Quali dati sono stati coinvolti.** {{elenco_categorie_dati}}
>
> **Cosa abbiamo fatto.** {{azioni_contenimento_e_rimedio}}
>
> **Cosa puoi fare tu.** {{raccomandazioni_specifiche — es. "cambiare la password se la riusi altrove", "controllare estratti conto se è coinvolto un documento d'identità", "segnalare attività sospette a 112"}}
>
> **Hai dei diritti.** Ai sensi del GDPR puoi chiedere accesso, rettifica, cancellazione o portabilità dei tuoi dati scrivendo a `info@welcomebnb.it`. Puoi anche presentare reclamo al Garante per la protezione dei dati personali — www.garanteprivacy.it.
>
> Abbiamo notificato il Garante il {{data_notifica_garante}}, come previsto dall'articolo 33 del GDPR.
>
> Ci scusiamo per il disagio e per la preoccupazione che questa comunicazione può generare.
>
> **Daniele Petrilli**
> WelcomeBnB — info@welcomebnb.it

### 5.2 EN template

> **Subject:** Important notice about your personal data — WelcomeBnB
>
> Dear {{name}},
>
> On {{date}} we identified a security incident involving some of your personal data held in the management system for your stay at {{property_name}}, operated through WelcomeBnB.
>
> **What happened.** {{short_technical_summary}}
>
> **What data was affected.** {{list_of_data_categories}}
>
> **What we did.** {{containment_and_remediation_actions}}
>
> **What you can do.** {{specific_recommendations — e.g. "change your password if reused elsewhere", "monitor bank statements if a document number was involved", "report suspicious activity to local police"}}
>
> **Your rights.** Under GDPR you may request access, rectification, erasure, or portability of your data by writing to `info@welcomebnb.it`. You may also lodge a complaint with the Italian supervisory authority — <https://www.garanteprivacy.it>.
>
> We notified the Garante on {{garante_notification_date}}, as required by GDPR Art. 33.
>
> We apologise for the inconvenience and concern this notice may cause.
>
> **Daniele Petrilli**
> WelcomeBnB — info@welcomebnb.it

### 5.3 Delivery

- Primary channel: email to the address of record for the subject.
- If no email of record: in-app notification visible on next login + registered mail where legally required (special-category data breach, Italian residents).
- If subject count makes individual notification impossible (Art. 34(3)(c)): public communication via `https://app.welcomebnb.it/security-notice`.

---

## 6. Evidence-collection checklist

**Preserve before touching anything.** Containment can destroy evidence; collect first, remediate second.

```
[ ] Snapshot timestamp of discovery (ISO-8601 with timezone)
[ ] Export relevant Supabase project logs (admin → Logs → export, scoped to incident window)
[ ] Export Vercel deployment runtime logs (Vercel UI → Logs → filter by path/timestamp)
[ ] Export GitHub Actions logs if a workflow is implicated
[ ] admin_access_events journal rows for the incident window (Phase 5; back-fills nothing before Round 67 Phase 5 lands)
[ ] Affected row IDs with a dated SELECT snapshot — do not delete affected rows during evidence collection
[ ] Request-fingerprint hashes (IP+UA+route) from Vercel logs; cross-reference against admin_access_events
[ ] Any communication from the discoverer (security researcher email, GitHub PVR report)
[ ] Timeline reconstruction: when did the attacker gain access, when did they operate, when did we detect, when did we contain
[ ] Store evidence in a dedicated private location (not the public repo); never commit raw logs to git
```

**Preserve for at least 3 years** per general Italian civil evidence requirements, or longer if the incident becomes litigation.

---

## 7. Containment and remediation

Order of operations after evidence is captured:

1. **Revoke affected credentials.**
   - Compromised Supabase service-role key → rotate via Supabase dashboard; update `SUPABASE_PRODUCTION_SERVICE_ROLE_KEY` in GitHub Environment `Production`; redeploy.
   - Compromised host account → force sign-out via `auth.users.last_sign_in_at` manipulation + password reset email.
   - Compromised admin account → remove from `admin_users` table pending identity re-verification.
2. **Patch the vector.** Deploy the code fix on a dedicated branch, run the full regression, merge to `main`, verify deployment on `app.welcomebnb.it`.
3. **Invalidate guest tokens if any guest-URL path is implicated.** The HMAC-signed token signing key rotates via the environment variable; all outstanding tokens become invalid. Each affected guest must receive a new link.
4. **Verify closure.** Reproduce the original exploit against the patched prod — it must fail. Record the proof-of-closure in evidence.
5. **Only then notify.** Notifying before containment and verified closure risks a follow-up attack while the window is still open.

**Do not** mass-truncate logs, delete affected rows "for safety," or rotate every secret as a reflex — each of these destroys evidence or disrupts legitimate operations.

---

## 8. Post-incident review

Within 10 business days of containment, Daniele writes a short review document (not public, filed in incident evidence):

- **What went well:** detection, response time, containment efficacy.
- **What went poorly:** detection delay, communication gaps, missing runbook steps.
- **Root cause:** what change or circumstance introduced the vulnerability; whether existing controls should have caught it.
- **Preventive changes:** code, process, or policy changes to reduce recurrence probability.
- **Preventive-change deadlines:** each change gets an owner and a date.

File the review alongside the evidence; cross-reference from the next CHANGELOG round's "Deferred" or "Lessons learned" subsection where appropriate.

---

## 9. SOP maintenance

Review this document:
- Annually (every 2026-10-26 anniversary) regardless of incidents.
- After any Path B or Path C notification.
- When new sub-processors or data categories are added (requires a parallel ROPA update, Phase 2).
- When the scaling trigger in §2 fires.

Keep the file under `docs/compliance/BREACH_SOP.md` so it is version-controlled with the rest of the compliance paper trail. Changes land via normal PR review.

---

## 10. Related documents

- Round 67 PLAN: `PLAN_round67_gdpr_paper_trail.md`
- Security assessment: `docs/SECURITY_ASSESSMENT_2026-10.md`
- Round 65 verification: `docs/SECURITY_ROUND65_VERIFICATION.md`
- Private vulnerability reporting policy: `SECURITY.md`
- ROPA: `docs/compliance/ROPA.md` (Round 67 Phase 2)
- DPA template: `docs/compliance/DPA_TEMPLATE.md` (Round 67 Phase 3)
- DSAR runbook: `docs/compliance/DSAR_RUNBOOK.md` (Round 67 Phase 4)
