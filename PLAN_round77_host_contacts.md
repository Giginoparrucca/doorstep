# Round 77 — Host contacts (mini-CRM in admin)

Confirmed by Daniele on 24 November 2026 («Go ahead») after the plain-language recap. Brief: «WelcomeBnB — Next round: Host Contacts (mini-CRM in admin.html)».

## Why

Daniele can no longer keep track of his hosts:
- e-mails are in the admin console;
- names and phone numbers are in WhatsApp Business, where he is a linked device and cannot save contacts.

One admin page should give every host and every prospect a name, phone, e-mail, status, notes, a next action, and a one-tap way to open the WhatsApp chat.

**Out of scope:**
- messages or e-mails sent from the app;
- imports from WhatsApp;
- pipelines.

## Decisions taken from the code (24 Nov 2026)

- **Access path: service role.** Admin reads protected data through service-role endpoints with an admin check (`/api/admin-host-health`: Users tab, billing, privacy), so the contacts follow that pattern:
  - **actions** `contacts_*` on the same endpoint, reusing its CORS, admin check and rate limit;
  - **admin log** (`admin_access_events`), with the new action names added to its whitelist;
  - **no new Vercel function.**
- **Tables:** RLS enabled with **no** policies; every privilege revoked from `anon` and `authenticated`.
- **Migration** `supabase/migrations/20261124090000_round77_host_contacts.sql` (repository naming, not `migration_roundNN_…`).
- **Admin translation:** user-entered text is rendered with `textContent` and marked `data-i18n-skip`, so the admin IT/EN translation never rewrites names or notes.
- **«Account»** = a `host_subscriptions` row, which exists from registration. Invitations not yet accepted become prospects with stage `invited`.
- **`pilot_hosts`** (0 rows; Round 35 ledger, still read and written by the Ops editor in `admin.html`): left untouched; can be removed in a later round.

## Phases

1. **Database.**
   - `host_contacts` and `host_contact_notes` (brief schema), with an `updated_at` trigger reusing `tg_touch_updated_at`.
   - RLS on, privileges revoked, and the admin-log whitelist extended.
   - Idempotent backfill: one row per host account (e-mail from auth; name and phone from the first live property, phone normalised), plus one per not-yet-accepted invitation.
2. **Server.**
   - Actions `contacts_list`, `contacts_create`, `contacts_update`, `contacts_delete`, `contacts_note_add` and `contacts_note_delete`.
   - Server-side validation: lengths, enums, E.164.
   - The list carries the derived data: account yes/no, subscription state, properties and last login.
3. **UI.**
   - «Contatti» tab with a due/overdue counter, cards, search (digits-only phone match) and filter chips.
   - Sort: overdue first, then by due date, then by name.
   - One-tap WhatsApp, call, e-mail and copy.
   - Detail view: edit fields, quick due dates, «done», notes timeline, links to properties and to the existing billing box. No native dialogs.
   - Mobile: one column at ≤ 480 px; buttons at least 44 px tall.
4. **Privacy and records.**
   - ROPA activity, and the retention line «until the admin deletes the contact».
   - Noted for a future round: a limit for unanswered prospects.
5. **Tests and close.**
   - New tests: backfill, no duplicates, writes persist, anon and host denied, endpoint gate, XSS, phone cases, filters/badge/sort, 375 px.
   - Full `npm run test:all`, live smoke, schema drift.

## Phone rules (client and server)

1. Strip spaces, dots, dashes and parentheses.
2. A `00` prefix becomes `+`.
3. No country code and starting with `3` or `0` (Italian) → `+39` prefix. Otherwise a leading `+` is required.
4. The result must match `^\+[1-9]\d{6,14}$`.
5. Stored as E.164; displayed grouped (e.g. `+39 333 123 4567`).
