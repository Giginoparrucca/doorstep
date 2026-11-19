-- Admin log accepts the login e-mail change actions; account history keeps
-- every login e-mail change (19 Nov 2026).
-- The first assisted change failed with «audit_unavailable»: the action name
-- was not in the admin_access_events whitelist, so the change was refused
-- before anything happened (as designed: no log, no change). The metadata
-- rule (no e-mail addresses in the log) stays: the change is recorded with
-- short SHA-256 fingerprints of the two addresses instead.
--
-- The admin log keeps no free text either, so the reason of an assisted
-- change and the addresses go to the account's own history
-- (billing_events, append-only, shown in the «Abbonamento» box, kept with the
-- account): the admin endpoint adds «login_email_change_admin» with the
-- reason before the change, and the trigger below adds «login_email_changed»
-- for every change (self-service or assisted). Guarded: never blocks.
-- Re-runnable. Rollback: restore the previous check without account_email_change,
--   and account_email_changed from 20261119090000.
alter table public.admin_access_events drop constraint if exists admin_access_events_action_check;
alter table public.admin_access_events add constraint admin_access_events_action_check
  check (action ~ '^(host_health_read|audit_read|dsar_(export|erase_preview|erase)|billing_[a-z_]{2,40}|invite_(send|resend|revoke|link)|alloggiati_admin_[a-z_]{2,40}|alloggiati_support_read|impersonation_view|account_email_change(_preview)?)$');

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
  begin insert into public.billing_events (user_id, actor, action, old_value, new_value, reason)
    values (new.id, 'system', 'login_email_changed', jsonb_build_object('email', old.email), jsonb_build_object('email', new.email), 'login e-mail changed');
  exception when others then raise warning 'account_email_changed billing_events: %', sqlerrm; end;
  return new;
end $$;
revoke all on function public.account_email_changed() from public, anon, authenticated;
