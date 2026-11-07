-- Host setting (7 Nov 2026): require the main guest's invoice details at
-- check-in (street, postcode, invoice email; codice fiscale and province for
-- Italian residents). Default false = today's optional section. Read by the
-- guest gateway (public property field) and enforced server-side in
-- api/guest.js. Owners update it through the existing table grant and owner
-- RLS policy. Re-runnable. Rollback: ALTER TABLE public.properties DROP COLUMN invoice_required;
BEGIN;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS invoice_required boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.properties.invoice_required IS 'When true, the main guest must provide invoice details at check-in (address, postcode, invoice email; codice fiscale and province for Italian residents).';
COMMIT;
