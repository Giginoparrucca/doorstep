-- Account history accepts the login e-mail change entries (19 Nov 2026).
-- The assisted change (Utenti) failed with «Storico dell'account non
-- disponibile»: billing_events only allowed the billing action names, so the
-- history row was refused and, as designed, the change did not run. The
-- trigger's automatic «login_email_changed» row was refused too (silently:
-- that step is guarded and never blocks a login change).
-- Re-runnable. Rollback: restore the Round 72 list without the two names.
alter table public.billing_events drop constraint if exists billing_events_action_check;
alter table public.billing_events add constraint billing_events_action_check
  check (action in ('trial_started', 'trial_extended', 'trial_end_set', 'trial_shortened',
    'free_forever_on', 'free_forever_off', 'marked_paid', 'expired', 'read_only', 'reminder_sent',
    'login_email_change_admin', 'login_email_changed'));
