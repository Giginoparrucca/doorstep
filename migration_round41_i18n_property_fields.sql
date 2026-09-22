-- Round 41 · Split property free-text fields into per-language columns.
--
-- Guest app was rendering both languages simultaneously on Home
-- (check-in time, getting around, check-out time) because the host had
-- entered EN and IT into a single free-text column and the language
-- toggle can't filter what's stored together.
--
-- Adds 8 new text columns — 4 fields × 2 languages — all nullable.
-- The ORIGINAL columns are kept in place as a backup and continue to
-- serve as the fallback in the guest app until every property has
-- migrated. Nothing is written to, moved out of, or dropped from the
-- originals in this migration.
--
--   welcome_message         → welcome_message_it,         welcome_message_en
--   checkin_instructions    → checkin_instructions_it,    checkin_instructions_en
--   checkout_instructions   → checkout_instructions_it,   checkout_instructions_en
--   transport_info          → transport_info_it,          transport_info_en
--
-- The host console renders an IT/EN pill above each field and writes
-- to the language-specific column on save. See host-console.html
-- (Round 41 Task 2). The guest app reads d.<field>_<lang> first,
-- falls back to the other language, then to the legacy column
-- (index.html · _propTextLang).
--
-- Grants: none new — RLS already covers `properties`. Column additions
-- inherit the table's existing policies.

BEGIN;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS welcome_message_it        text,
  ADD COLUMN IF NOT EXISTS welcome_message_en        text,
  ADD COLUMN IF NOT EXISTS checkin_instructions_it   text,
  ADD COLUMN IF NOT EXISTS checkin_instructions_en   text,
  ADD COLUMN IF NOT EXISTS checkout_instructions_it  text,
  ADD COLUMN IF NOT EXISTS checkout_instructions_en  text,
  ADD COLUMN IF NOT EXISTS transport_info_it         text,
  ADD COLUMN IF NOT EXISTS transport_info_en         text;

COMMENT ON COLUMN public.properties.welcome_message_it       IS 'Round 41: Italian version of the host welcome message. Legacy welcome_message stays as a fallback until this is populated.';
COMMENT ON COLUMN public.properties.welcome_message_en       IS 'Round 41: English version of the host welcome message.';
COMMENT ON COLUMN public.properties.checkin_instructions_it  IS 'Round 41: Italian version of the check-in instructions.';
COMMENT ON COLUMN public.properties.checkin_instructions_en  IS 'Round 41: English version of the check-in instructions.';
COMMENT ON COLUMN public.properties.checkout_instructions_it IS 'Round 41: Italian version of the check-out instructions.';
COMMENT ON COLUMN public.properties.checkout_instructions_en IS 'Round 41: English version of the check-out instructions.';
COMMENT ON COLUMN public.properties.transport_info_it        IS 'Round 41: Italian version of the "getting around" text.';
COMMENT ON COLUMN public.properties.transport_info_en        IS 'Round 41: English version of the "getting around" text.';

COMMIT;

-- Rollback:
-- BEGIN;
-- ALTER TABLE public.properties
--   DROP COLUMN IF EXISTS welcome_message_it,
--   DROP COLUMN IF EXISTS welcome_message_en,
--   DROP COLUMN IF EXISTS checkin_instructions_it,
--   DROP COLUMN IF EXISTS checkin_instructions_en,
--   DROP COLUMN IF EXISTS checkout_instructions_it,
--   DROP COLUMN IF EXISTS checkout_instructions_en,
--   DROP COLUMN IF EXISTS transport_info_it,
--   DROP COLUMN IF EXISTS transport_info_en;
-- COMMIT;
