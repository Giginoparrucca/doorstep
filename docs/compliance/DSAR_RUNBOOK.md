# Data-subject requests (GDPR Art. 15, 17, 20) — runbook

Round 67 Phase 4. Tool: admin page → **Privacy** tab (server: `api/_admin-dsar.js`, mounted on `/api/admin-host-health`; erasure: `public.dsar_erase`, migration `20261116160000_round67_dsar_erase.sql`).

## 1. Who decides

For guest data the **host is the controller** and WelcomeBnB is the processor (DPA, Annex A of the host terms, §5.5: WelcomeBnB assists the host with data-subject requests).

- **Request arrives at the host:** the host asks WelcomeBnB in writing (email to `info@welcomebnb.it`). Act on that instruction.
- **Request arrives at WelcomeBnB directly** (`info@welcomebnb.it`): within 2 working days, forward it to the host(s) concerned and ask for instructions. If the host does not answer within 10 days, answer the person: the request has been passed to the host, with the host's contact details. Do not erase without the host's instruction, unless the data is WelcomeBnB's own: host accounts, or marketing consent records the host never used.
- **Host's own data** (host account, terms acceptances, billing): WelcomeBnB is the controller. Handle the request directly, and note that terms acceptances and invoices are kept by law.

Deadline: **one month** from receipt (Art. 12(3)). It can be extended by two further months for complex requests; tell the person within the first month.

## 2. Verify identity

Never send data to an address that is not already in the records.

- **Email request:** reply to the same email address that is stored in the booking or consent. Do not send to a new address.
- **Phone or other channel:** ask for the booking code and arrival date, and check them against the export before sending anything.
- **Document number search:** use it only on the host's written instruction, or after the person has proved they hold that document. Never ask them to send a document photo by email.

If identity cannot be verified, say so and ask for one more detail (Art. 12(6)). Do not refuse silently.

## 3. Access / portability (Art. 15, 20)

1. **Privacy** tab → choose **Email**, **Telefono** or **Numero documento** → enter one value → **Cerca ed esporta**.
2. Check the summary. Companions in the same booking are **not** included unless their own identifier matches. Remove anything about another person before sending: the chat of a shared booking can mention other guests.
3. **Scarica JSON** gives the machine-readable copy (Art. 20). **Stampa / PDF riepilogo** gives the one-page summary.
4. **Document photos:** tick «Includi i link…» only if the person asked for them. The links are valid for 7 days, and the photos themselves are deleted 7 days after arrival anyway.
5. **Deliver** by replying to the verified address:
   - attach the JSON and PDF in a password-protected ZIP;
   - send the password by a different channel (SMS or phone to the number in the booking).

## 4. Erasure (Art. 17)

1. Enter the same identifier, then press **Anteprima cancellazione**. Nothing is changed: the preview only counts.
2. Read the preview:
   - **Check-in cancellati:** records not sent to the Polizia. They are moved to the trash and removed by the nightly purge after 30 days.
   - **Check-in conservati per legge:** records already sent to Alloggiati. They stay (TULPS art. 109 retention; GDPR Art. 17(3)(b) legal obligation). Their document photos are deleted.
   - **Consensi marketing:** the consent is withdrawn now, and the email, phone and name are blanked. The dated row stays as proof that consent existed and was withdrawn.
   - **Prenotazioni:** contact email and phone are blanked. The booking stays in the host's calendar (the host's own record).
   - **Messaggi chat:** the chat of the linked bookings is moved to the trash and removed after 30 days.
3. To proceed, type **CANCELLA** and press **Cancella i dati**.
4. Answer the person: what was erased, and what is kept by law with the reason and the period.

## 5. Not covered by the tool

Handle these by hand, and record the request in the audit log via the admin action:

- **Analytics events.** They are pseudonymous (a booking code, no name, email or phone) and rolled up after 180 days.
- **Backups.** Supabase point-in-time backups expire on their own schedule, and erased rows are not restored.
- **Emails already sent** by Resend, and the **police receipts** (`receipt_path`), which are kept with the filed record.

## 6. Records

Every export, preview and erasure is recorded with:

- the admin;
- the kind of identifier, **never its value**;
- the counts.

From Round 67 Phase 5 these records go to the admin audit log (`admin_access_events`). Keep the person's email thread in the `info@` mailbox for 2 years.

Limit: 10 requests per hour per admin. If the limit counter cannot be reached, the tool refuses rather than running unlimited.
