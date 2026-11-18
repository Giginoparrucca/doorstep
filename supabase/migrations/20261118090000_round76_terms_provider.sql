-- Round 76 Phase 1 — provider identity for the host terms, outside the
-- public repository.
--
-- legal_provider            one row (id = 1): the provider named in the terms
--                           and in Annex A (DPA). The address and tax code are
--                           personal data of the owner, so they are not in the
--                           (public) repository: the texts carry
--                           {{fornitore_indirizzo}} / {{fornitore_cf}} and
--                           /api/host-terms fills them for signed-in hosts.
--                           service_role only. The row is written directly in
--                           the database, never from code.
-- host_terms_acceptances.provider_snapshot
--                           the provider data shown in the text the host
--                           accepted (part of the append-only evidence).
--
-- When the company is incorporated: update this row (name, address, VAT, PEC)
-- and e-mail the hosts under art. 1.4 of the terms (docs/legal/LAUNCH_RUNBOOK.md).
-- Re-runnable. Rollback: alter table public.host_terms_acceptances drop column
-- provider_snapshot (only while it holds no evidence); drop table public.legal_provider.
create table if not exists public.legal_provider (
  id smallint primary key default 1 check (id = 1),
  name text not null check (length(name) between 2 and 200),
  address text not null check (length(address) between 5 and 300),
  tax_code text not null check (length(tax_code) between 8 and 40),
  vat text check (vat is null or length(vat) between 5 and 40),
  pec text check (pec is null or length(pec) between 5 and 200),
  updated_at timestamptz not null default now()
);
alter table public.legal_provider enable row level security;
revoke all on public.legal_provider from public, anon, authenticated;
grant select, insert, update on public.legal_provider to service_role;

alter table public.host_terms_acceptances add column if not exists provider_snapshot jsonb
  check (provider_snapshot is null or jsonb_typeof(provider_snapshot) = 'object');
