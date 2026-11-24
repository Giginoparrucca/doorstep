-- Round 77 Phase 1 — host contacts (mini-CRM in admin). PLAN_round77_host_contacts.md.
--
-- host_contacts        one row per host account (user_id) or prospect (user_id NULL):
--                      name, e-mail, phone (E.164), source, lead stage (prospects only),
--                      next action and due date. No FK to auth.users: the row
--                      survives account deletion until the admin deletes it.
-- host_contact_notes   notes timeline, cascades with the contact.
--
-- Access: only the service-role admin endpoint (/api/admin-host-health,
-- actions contacts_*, admin check + admin log). RLS on with NO policies and
-- every privilege revoked from anon/authenticated: no browser reaches these
-- tables directly.
--
-- host_contacts_sync() (service_role only) keeps the list complete: links a
-- prospect to the account that registered with the same e-mail, adds a row
-- for every host account (host_subscriptions) and for every pending
-- invitation. Name and phone come from the host's first live property; the
-- phone is normalised by host_contacts_phone() (same rules as the client).
-- Idempotent: the migration runs it once, the list action on every load.
--
-- Retention: kept until the admin deletes the contact (ROPA). Re-runnable.
-- Rollback: drop table public.host_contact_notes, public.host_contacts;
--   drop function public.host_contacts_sync(), public.host_contacts_phone(text);
--   restore the Round 77-less admin_access_events_action_check.

do $outer$ begin
  if to_regprocedure('public.tg_touch_updated_at()') is null then
    execute $f$create function public.tg_touch_updated_at() returns trigger language plpgsql set search_path to 'pg_catalog' as $b$ begin new.updated_at := now(); return new; end $b$$f$;
  end if;
end $outer$;

create table if not exists public.host_contacts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid unique,
  full_name        text check (full_name is null or length(full_name) <= 200),
  email            text check (email is null or (length(email) <= 254 and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  phone            text check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
  source           text check (source in ('whatsapp','email','referral','website','event','other')),
  lead_stage       text not null default 'lead' check (lead_stage in ('lead','contacted','demo','invited','lost')),
  next_action      text check (next_action is null or length(next_action) <= 500),
  next_action_due  date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists host_contacts_email_uq on public.host_contacts (lower(email)) where email is not null;
create index if not exists host_contacts_due_idx on public.host_contacts (next_action_due);

create table if not exists public.host_contact_notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.host_contacts(id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  created_by  text check (created_by is null or length(created_by) <= 320)
);
create index if not exists host_contact_notes_contact_idx on public.host_contact_notes (contact_id, created_at desc);

drop trigger if exists host_contacts_touch_updated_at on public.host_contacts;
create trigger host_contacts_touch_updated_at before update on public.host_contacts
  for each row execute function public.tg_touch_updated_at();

alter table public.host_contacts enable row level security;
alter table public.host_contact_notes enable row level security;
revoke all on public.host_contacts, public.host_contact_notes from public, anon, authenticated;
grant select, insert, update, delete on public.host_contacts, public.host_contact_notes to service_role;

-- Phone rules (client: admin-contacts.js normPhone): strip spaces, dots,
-- dashes, parentheses; 00 → +; Italian 3…/0… without a country code → +39;
-- otherwise a leading + is required; result ^\+[1-9]\d{6,14}$ or NULL.
create or replace function public.host_contacts_phone(p text)
returns text language plpgsql immutable set search_path = pg_catalog as $$
declare s text := regexp_replace(coalesce(p, ''), '[\s.()\-]', '', 'g');
begin
  if s = '' then return null; end if;
  if s like '00%' then s := '+' || substr(s, 3);
  elsif s ~ '^[30]' then s := '+39' || s; end if;
  if s ~ '^\+[1-9][0-9]{6,14}$' then return s; end if;
  return null;
end $$;

create or replace function public.host_contacts_sync()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_catalog as $$
declare v_linked int; v_accounts int; v_invites int;
begin
  -- A prospect who registered: link the row to the account (same e-mail).
  update public.host_contacts c set user_id = u.id
    from auth.users u join public.host_subscriptions s on s.user_id = u.id
   where c.user_id is null and c.email is not null and lower(c.email) = lower(u.email)
     and not exists (select 1 from public.host_contacts x where x.user_id = u.id);
  get diagnostics v_linked = row_count;
  -- Every host account (same set as host_subscriptions).
  insert into public.host_contacts (user_id, email, full_name, phone)
  select s.user_id, u.email,
         (select nullif(btrim(p.host_names), '') from public.properties p
           where p.owner_id = s.user_id and p.deleted_at is null and nullif(btrim(p.host_names), '') is not null
           order by p.created_at limit 1),
         (select public.host_contacts_phone(p.host_phone) from public.properties p
           where p.owner_id = s.user_id and p.deleted_at is null and public.host_contacts_phone(p.host_phone) is not null
           order by p.created_at limit 1)
    from public.host_subscriptions s join auth.users u on u.id = s.user_id
   where not exists (select 1 from public.host_contacts c where c.user_id = s.user_id)
  on conflict do nothing;
  get diagnostics v_accounts = row_count;
  -- Pending invitations without a contact yet.
  insert into public.host_contacts (email, lead_stage)
  select i.email, 'invited' from public.pilot_invites i
   where i.status = 'invited' and i.email is not null
     and not exists (select 1 from public.host_contacts c where lower(c.email) = lower(i.email))
     and not exists (select 1 from public.host_subscriptions s join auth.users u on u.id = s.user_id where lower(u.email) = lower(i.email))
  on conflict do nothing;
  get diagnostics v_invites = row_count;
  return jsonb_build_object('linked', v_linked, 'accounts', v_accounts, 'invites', v_invites);
end $$;
revoke all on function public.host_contacts_sync(), public.host_contacts_phone(text) from public, anon, authenticated;
grant execute on function public.host_contacts_sync(), public.host_contacts_phone(text) to service_role;

-- Admin log: the contacts actions (Round 67 whitelist; no e-mail in metadata).
do $$ begin
  if to_regclass('public.admin_access_events') is not null then
    alter table public.admin_access_events drop constraint if exists admin_access_events_action_check;
    alter table public.admin_access_events add constraint admin_access_events_action_check
      check (action ~ '^(host_health_read|audit_read|dsar_(export|erase_preview|erase)|billing_[a-z_]{2,40}|invite_(send|resend|revoke|link)|alloggiati_admin_[a-z_]{2,40}|alloggiati_support_read|impersonation_view|account_email_change(_preview)?|contacts_(list|create|update|delete|note_add|note_delete))$');
  end if;
end $$;

select public.host_contacts_sync();
