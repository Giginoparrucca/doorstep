-- Host contacts: «Pubblicità» (ads) as a contact source (25 Nov 2026,
-- Daniele: «Add Ads as an option»). Same list as api/_admin-contacts.js
-- SOURCES and the «Origine» menu in admin-contacts.js.
-- Re-runnable. Rollback: restore the list without 'ads' (no row may use it).
alter table public.host_contacts drop constraint if exists host_contacts_source_check;
alter table public.host_contacts add constraint host_contacts_source_check
  check (source in ('whatsapp','email','referral','website','event','ads','other'));
