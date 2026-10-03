-- migration_round47_2_residence_fields.sql
--
-- Round 47.2 — optional guest residence capture.
--
-- Two nullable text columns on public.checkins. Needed for ROSS1000
-- accuracy (today we infer residence from citizenship/birth place),
-- tourist-tax resident-exemptions (Venice etc.), and demographic
-- analytics. Alloggiati Web (the 168-char tracciato format) does NOT
-- include residence, so filing continues to work regardless of whether
-- the guest supplies these.

alter table public.checkins
  add column if not exists residence_country text,
  add column if not exists residence_place   text;

comment on column public.checkins.residence_country is
  'Round 47.2 — optional country of residence (Italian name, matches ALLOG_STATI). Used by ROSS1000 export; Alloggiati Web does not require it.';
comment on column public.checkins.residence_place is
  'Round 47.2 — optional comune (for Italian residents) or free-text city (for foreign residents). Used by ROSS1000 export.';
