-- Account login e-mail change (19 Nov 2026, Daniele: «if someone wants to
-- transfer their account to a new email address how do we facilitate
-- that?» → self-service in the host console + assisted change in Utenti).
--
-- Everything a host owns is keyed by the account id, so the login change
-- itself keeps all data. A few places keep the address as text; when the
-- login e-mail changes (either flow), this trigger moves the OLD address to
-- the NEW one where it is the same address (case-insensitive):
--   host_notification_settings.notify_email   where notifications go
--   properties.reminder_email                 daily arrivals digest
--   properties.host_email                     contact in the guest privacy notice
--   pilot_invites.email / pilot_hosts.host_email   invitation record (registration date)
--   admin_users.email                         admin check (is_admin uses the login e-mail)
-- A different address the host chose on purpose is left alone. The terms
-- acceptance evidence keeps the e-mail it was given with (append-only).
-- Each step is guarded: a failure only raises a warning and never blocks
-- the login change. Unique e-mail columns are skipped when the new address
-- is already present there.
--
-- Re-runnable. Rollback: drop trigger on_auth_user_email_changed on auth.users;
--   drop function public.account_email_changed();

create or replace function public.account_email_changed()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  o text := lower(btrim(coalesce(old.email, '')));
  n text := btrim(coalesce(new.email, ''));
begin
  if o = '' or n = '' or o = lower(n) then return new; end if;
  begin update public.host_notification_settings set notify_email = n where host_id = new.id and lower(btrim(notify_email)) = o;
  exception when others then raise warning 'account_email_changed notify_email: %', sqlerrm; end;
  begin update public.properties set reminder_email = n where owner_id = new.id and lower(btrim(reminder_email)) = o;
  exception when others then raise warning 'account_email_changed reminder_email: %', sqlerrm; end;
  begin update public.properties set host_email = n where owner_id = new.id and lower(btrim(host_email)) = o;
  exception when others then raise warning 'account_email_changed host_email: %', sqlerrm; end;
  begin update public.pilot_invites set email = n where lower(email) = o and not exists (select 1 from public.pilot_invites x where lower(x.email) = lower(n));
  exception when others then raise warning 'account_email_changed pilot_invites: %', sqlerrm; end;
  begin update public.pilot_hosts set host_email = n where lower(host_email) = o and not exists (select 1 from public.pilot_hosts x where lower(x.host_email) = lower(n));
  exception when others then raise warning 'account_email_changed pilot_hosts: %', sqlerrm; end;
  begin update public.admin_users set email = n where lower(email) = o and not exists (select 1 from public.admin_users x where lower(x.email) = lower(n));
  exception when others then raise warning 'account_email_changed admin_users: %', sqlerrm; end;
  return new;
end $$;
revoke all on function public.account_email_changed() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.account_email_changed();
