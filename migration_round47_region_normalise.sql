-- migration_round47_region_normalise.sql
--
-- Round 47 — regions in properties.region were free-text, so values
-- like 'Verona' (a province, not a region) and 'BA' (a province code)
-- silently broke the exact-match region filter in the Export panel —
-- the Verona host couldn't see the ROSS1000 Veneto tile, the Bari host
-- couldn't see the Puglia DMS tile. Live-data audit on 2026-10-02 found:
--   region='Verona' city='Verona' → should be Veneto
--   region='BA'     city='Bari'   → should be Puglia
--   region='Lazio','Puglia','Sicilia','Veneto' → already canonical
--   region=''  (4 rows) → will remain '' (user hasn't set a region yet)
--
-- This migration (a) normalises the two bad rows to their canonical
-- regions, (b) adds a CHECK constraint locking the column to the 21
-- canonical Italian region names (incl. Trentino + Alto Adige as two
-- separate entries since the autonomous provinces run separate
-- statistical systems), (c) leaves NULL and '' allowed so a new
-- property with an un-set region doesn't break on insert.
--
-- The canonical list below MUST match IT_REGIONS in host-console.html.
-- A mismatch between the two would let the UI write a value the DB
-- won't accept.

begin;

update properties set region = 'Veneto' where region = 'Verona';
update properties set region = 'Puglia' where region = 'BA';

-- Safety net: fail loudly before the CHECK if any value is still
-- non-canonical. The DO block raises an exception that aborts the
-- transaction, so no partial state survives.
do $$
declare bad int;
begin
  select count(*) into bad from properties
  where coalesce(region,'') <> '' and region not in (
    'Abruzzo','Alto Adige','Basilicata','Calabria','Campania','Emilia-Romagna',
    'Friuli-Venezia Giulia','Lazio','Liguria','Lombardia','Marche','Molise','Piemonte','Puglia',
    'Sardegna','Sicilia','Toscana','Trentino','Umbria','Valle d''Aosta','Veneto');
  if bad > 0 then
    raise exception 'Round 47: % properties still have a non-canonical region — fix before adding constraint', bad;
  end if;
end $$;

alter table properties
  add constraint properties_region_canonical check (
    region is null or region = '' or region in (
      'Abruzzo','Alto Adige','Basilicata','Calabria','Campania','Emilia-Romagna',
      'Friuli-Venezia Giulia','Lazio','Liguria','Lombardia','Marche','Molise','Piemonte','Puglia',
      'Sardegna','Sicilia','Toscana','Trentino','Umbria','Valle d''Aosta','Veneto'));

commit;
