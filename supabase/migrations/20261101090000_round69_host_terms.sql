-- Round 69 Phase 1 — host terms of service: versions, acceptance evidence,
-- one-time confirmation codes. Specification: PLAN_round69_host_terms.md.
--
-- legal_documents         one row per published terms version (text hash +
--                         Art. 16 clause list shown in the approval box).
-- host_terms_acceptances  append-only evidence: no UPDATE/DELETE/TRUNCATE for
--                         any role, except recording the receipt email id once.
--                         No foreign key to auth.users: the evidence must
--                         outlive the account (retention: account life + 10 y).
-- host_terms_codes        short-lived one-time codes (hash only), service_role
--                         only; rows older than 1 day purged daily.
--
-- Seed: version 1 = legal/CONDIZIONI_GENERALI_v1.md (+ Annex A
-- legal/ALLEGATO_A_DPA_v1.md). scripts/round69-host-terms-db.test.mjs checks
-- that the seeded hashes and clause list match the committed files.
-- Re-runnable. While no acceptance refers to a version, re-running updates
-- its hashes/clauses (the draft text will change after the lawyer's review);
-- once accepted, the version is frozen by trigger.
--
-- Rollback (only while no acceptance exists):
--   select cron.unschedule('welcomebnb_host_terms_codes_purge');
--   drop table public.host_terms_codes, public.host_terms_acceptances, public.legal_documents;
--   drop function public.host_terms_acceptances_guard(), public.legal_documents_guard();

create table if not exists public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('host_terms')),
  version integer not null check (version > 0),
  file_path text not null check (file_path ~ '^legal/[A-Za-z0-9_]+\.md$'),
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  annex_file_path text check (annex_file_path ~ '^legal/[A-Za-z0-9_]+\.md$'),
  annex_sha256 text check (annex_sha256 ~ '^[0-9a-f]{64}$'),
  specific_clauses jsonb not null check (jsonb_typeof(specific_clauses) = 'array' and jsonb_array_length(specific_clauses) > 0),
  requires_reacceptance boolean not null default true,
  published_at timestamptz not null default now(),
  unique (kind, version)
);

create table if not exists public.host_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null,
  document_id uuid not null references public.legal_documents(id),
  version integer not null,
  text_sha256 text not null check (text_sha256 ~ '^[0-9a-f]{64}$'),
  annex_sha256 text check (annex_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_general_at timestamptz not null,
  approved_specific_at timestamptz not null,
  otp_verified_at timestamptz not null,
  host_kind text not null check (host_kind in ('business', 'private')),
  method text not null default 'password_login+email_otp' check (length(method) between 1 and 80),
  account_email text not null check (length(account_email) between 3 and 320),
  ip inet,
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  receipt_email_id text check (receipt_email_id is null or length(receipt_email_id) <= 200),
  created_at timestamptz not null default now(),
  unique (host_id, document_id)
);
create index if not exists host_terms_acceptances_host_idx on public.host_terms_acceptances (host_id, created_at desc);

create table if not exists public.host_terms_codes (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid not null references public.legal_documents(id),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 100),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists host_terms_codes_host_idx on public.host_terms_codes (host_id, created_at desc);

-- Evidence is append-only. The only change ever allowed: recording the
-- receipt email id once (NULL -> value), every other column unchanged.
create or replace function public.host_terms_acceptances_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if old.receipt_email_id is null and new.receipt_email_id is not null
       and (to_jsonb(new) - 'receipt_email_id') = (to_jsonb(old) - 'receipt_email_id') then
      return new;
    end if;
  end if;
  raise exception 'host_terms_acceptances is append-only' using errcode = '42501';
end $$;
drop trigger if exists host_terms_acceptances_append_only on public.host_terms_acceptances;
create trigger host_terms_acceptances_append_only before update or delete on public.host_terms_acceptances
  for each row execute function public.host_terms_acceptances_guard();
drop trigger if exists host_terms_acceptances_no_truncate on public.host_terms_acceptances;
create trigger host_terms_acceptances_no_truncate before truncate on public.host_terms_acceptances
  for each statement execute function public.host_terms_acceptances_guard();

-- A version someone has accepted is frozen: its text, hashes, clauses and
-- re-acceptance rule cannot change, and it cannot be deleted.
create or replace function public.legal_documents_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if exists (select 1 from public.host_terms_acceptances a where a.document_id = old.id) then
    raise exception 'legal document version % is accepted and frozen', old.version using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists legal_documents_frozen on public.legal_documents;
create trigger legal_documents_frozen before update or delete on public.legal_documents
  for each row execute function public.legal_documents_guard();

alter table public.legal_documents enable row level security;
alter table public.host_terms_acceptances enable row level security;
alter table public.host_terms_codes enable row level security;

revoke all on public.legal_documents, public.host_terms_acceptances, public.host_terms_codes from public, anon, authenticated, service_role;
grant select on public.legal_documents to authenticated;
grant select, insert, update, delete on public.legal_documents to service_role;
grant select on public.host_terms_acceptances to authenticated;
grant select, insert on public.host_terms_acceptances to service_role;
grant update (receipt_email_id) on public.host_terms_acceptances to service_role;
grant select, insert, update, delete on public.host_terms_codes to service_role;
revoke all on function public.host_terms_acceptances_guard(), public.legal_documents_guard() from public, anon, authenticated;

drop policy if exists legal_documents_read on public.legal_documents;
create policy legal_documents_read on public.legal_documents for select to authenticated
  using (published_at <= now());
drop policy if exists host_terms_acceptances_read on public.host_terms_acceptances;
create policy host_terms_acceptances_read on public.host_terms_acceptances for select to authenticated
  using (host_id = auth.uid() or public.is_admin());

insert into public.legal_documents (kind, version, file_path, text_sha256, annex_file_path, annex_sha256, specific_clauses, requires_reacceptance)
values ('host_terms', 1, 'legal/CONDIZIONI_GENERALI_v1.md', '7ebd39e081bd3468bf378e8cb20dacd14d4941bbb6df13196b704be54fd92de4',
  'legal/ALLEGATO_A_DPA_v1.md', '0bef0a5d37c9f6c60e3f9e8232035ee62fd645338b12418252bde4d44a1e9bea',
  '[{"ref": "3.3", "label": "modifica o rimozione di funzioni del Servizio"}, {"ref": "5.2 e 5.3", "label": "adempimenti di legge che restano a carico dell''Host anche con l''Invio automatico"}, {"ref": "6.4", "label": "nessuna garanzia sull''accettazione degli invii da parte dei Portali pubblici"}, {"ref": "9.1 e 9.2", "label": "nessuna garanzia di continuità del Servizio e dei servizi di terzi"}, {"ref": "10.2 e 10.3", "label": "limitazioni ed esclusioni di responsabilità e massimale"}, {"ref": "11", "label": "manleva a carico dell''Host"}, {"ref": "13.3", "label": "recesso del Fornitore, anche immediato"}, {"ref": "14", "label": "modifiche delle Condizioni da parte del Fornitore"}, {"ref": "15.2", "label": "foro competente"}]'::jsonb, true)
on conflict (kind, version) do update set
  file_path = excluded.file_path, text_sha256 = excluded.text_sha256,
  annex_file_path = excluded.annex_file_path, annex_sha256 = excluded.annex_sha256,
  specific_clauses = excluded.specific_clauses, requires_reacceptance = excluded.requires_reacceptance
where (public.legal_documents.file_path, public.legal_documents.text_sha256, public.legal_documents.annex_file_path,
       public.legal_documents.annex_sha256, public.legal_documents.specific_clauses, public.legal_documents.requires_reacceptance)
  is distinct from (excluded.file_path, excluded.text_sha256, excluded.annex_file_path,
       excluded.annex_sha256, excluded.specific_clauses, excluded.requires_reacceptance);

-- Codes live 10 minutes; keep a day for rate limiting, then purge. Separate
-- job (like welcomebnb_cron_history_purge) so welcomebnb_daily_purge is unchanged.
select cron.schedule('welcomebnb_host_terms_codes_purge', '40 2 * * *',
  $$delete from public.host_terms_codes where created_at < now() - interval '1 day'$$);
