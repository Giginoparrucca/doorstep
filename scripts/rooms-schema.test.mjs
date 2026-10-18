// Round 60 Phase 1 — property_rooms schema invariants.
//
// Static check on the committed migration + tracked copy. Both files
// must stay byte-identical and must preserve the critical security
// invariants that gate RLS correctness:
//
//   - Table + 2 indexes + 1 touch function + 1 touch trigger
//   - RLS enabled on property_rooms
//   - Four owner policies (SELECT / INSERT / UPDATE / DELETE)
//   - One admin SELECT policy
//   - Explicit REVOKE for anon (otherwise RLS without GRANT = silent
//     0-row writes OR an anon can read every row — Round 44 lesson)
//   - Explicit GRANT for authenticated and service_role only
//   - Nullable room_id FK (ON DELETE SET NULL) on ota_reservations and
//     checkins
//   - Partial unique index on (property_id, lower(name)) WHERE
//     deleted_at IS NULL so case-insensitive names collide inside a
//     property but a soft-delete frees the slot
//   - Partial perf index on (property_id, room_id, checkin_date,
//     checkout_date) WHERE deleted_at IS NULL AND status='active'
//
// The behavioural RLS probe (owner A / owner B / anon / soft-delete)
// ran against the hosted demo AND production databases at migration
// time; the output is recorded in CHANGELOG and this test keeps the
// shape of the migration from drifting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rootMig = resolve(here, '..', 'migration_round60_bnb_rooms.sql');
const trackedMig = resolve(here, '..', 'supabase/migrations/20261018100000_round60_bnb_rooms.sql');

const root = fs.readFileSync(rootMig, 'utf8');
const tracked = fs.readFileSync(trackedMig, 'utf8');

// Keep the two copies byte-identical so there is no drift between the
// root-level migration (the one deploying humans read) and the tracked
// supabase/migrations/ copy (the one `supabase db push` ships).
assert.equal(
  crypto.createHash('sha256').update(root).digest('hex'),
  crypto.createHash('sha256').update(tracked).digest('hex'),
  'root and supabase/migrations/ copies must stay byte-identical',
);

// ── Table + column shape ───────────────────────────────────────────
assert.match(root, /CREATE TABLE IF NOT EXISTS public\.property_rooms/);
assert.match(root, /property_id uuid\s+NOT NULL REFERENCES public\.properties\(id\) ON DELETE CASCADE/);
assert.match(root, /name\s+text\s+NOT NULL CHECK \(length\(btrim\(name\)\) BETWEEN 1 AND 120\)/);
assert.match(root, /beds\s+integer\s+NOT NULL DEFAULT 1 CHECK \(beds BETWEEN 1 AND 20\)/);
assert.match(root, /door_code\s+text\s+NULL CHECK/);
assert.match(root, /deleted_at\s+timestamptz NULL/);

// ── Indexes: unique active + sort + perf index on reservations ───
assert.match(root, /CREATE UNIQUE INDEX IF NOT EXISTS property_rooms_name_unique_active\s+ON public\.property_rooms \(property_id, lower\(name\)\)\s+WHERE deleted_at IS NULL/);
assert.match(root, /CREATE INDEX IF NOT EXISTS property_rooms_property_sort_idx/);
assert.match(root, /CREATE INDEX IF NOT EXISTS ota_reservations_property_room_dates_idx\s+ON public\.ota_reservations \(property_id, room_id, checkin_date, checkout_date\)\s+WHERE deleted_at IS NULL AND status = 'active'/);

// ── Trigger function + trigger (search_path pinned so it stays safe
//    under the function_search_path_mutable advisor)
assert.match(root, /CREATE OR REPLACE FUNCTION public\.property_rooms_touch_updated_at\(\)/);
assert.match(root, /SET search_path = public, pg_catalog/);
assert.match(root, /CREATE TRIGGER property_rooms_set_updated_at\s+BEFORE UPDATE ON public\.property_rooms/);

// ── RLS enabled + the five policies ───────────────────────────────
assert.match(root, /ALTER TABLE public\.property_rooms ENABLE ROW LEVEL SECURITY/);
for (const policy of [
  'property_rooms_owner_select',
  'property_rooms_owner_insert',
  'property_rooms_owner_update',
  'property_rooms_owner_delete',
  'property_rooms_admin_select',
]) {
  assert.match(root, new RegExp(`CREATE POLICY ${policy}`),
    `policy ${policy} must be in the migration`);
}

// Owner policies all gate on properties.owner_id = auth.uid() —
// without this, any authenticated user could operate on any room.
const ownerPolicyBodies = root.match(/CREATE POLICY property_rooms_owner_[a-z]+[\s\S]*?;/g) || [];
assert.equal(ownerPolicyBodies.length, 4, 'four owner policies total');
for (const body of ownerPolicyBodies) {
  assert.match(body, /EXISTS \(\s*SELECT 1 FROM public\.properties p\s+WHERE p\.id = property_rooms\.property_id AND p\.owner_id = auth\.uid\(\)\s*\)/,
    `owner policy body must gate on auth.uid()\n--- body ---\n${body}`);
}

// Admin policy uses the shared is_admin() helper (STABLE SECURITY
// DEFINER) — the same pattern Rounds 48/51 established.
assert.match(root, /CREATE POLICY property_rooms_admin_select[\s\S]*?public\.is_admin\(\)/);

// ── Explicit GRANT / REVOKE — "missing GRANT = silent 0-row writes" ─
assert.match(root, /REVOKE ALL ON public\.property_rooms FROM PUBLIC/);
assert.match(root, /REVOKE ALL ON public\.property_rooms FROM anon/);
assert.match(root, /GRANT\s+SELECT, INSERT, UPDATE, DELETE ON public\.property_rooms TO authenticated/);
assert.match(root, /GRANT\s+SELECT, INSERT, UPDATE, DELETE ON public\.property_rooms TO service_role/);

// anon must NOT be granted anything on this table — the guest app
// reads room data only through the service-role path in api/guest.js.
const grantLines = root.match(/^GRANT [^\n]+$/gm) || [];
for (const line of grantLines) {
  assert.ok(!/\bTO anon\b/.test(line),
    `anon must not appear on the right side of any GRANT: ${line}`);
}

// ── Nullable room_id FKs on existing stay tables ──────────────────
for (const table of ['ota_reservations', 'checkins']) {
  const re = new RegExp(
    `ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS room_id uuid NULL\\s+REFERENCES public\\.property_rooms\\(id\\) ON DELETE SET NULL`
  );
  assert.match(root, re, `${table}.room_id must be nullable with ON DELETE SET NULL`);
}

// ── Rollback block committed (safety) ─────────────────────────────
assert.match(root, /--\s*BEGIN;\s*\n(?:--.*\n)*--\s*DROP TABLE IF EXISTS public\.property_rooms;/,
  'commented ROLLBACK block must drop the table');

// ── Post-apply verification block committed ───────────────────────
assert.match(root, /information_schema\.role_table_grants/,
  'migration must document the grant verification query');

console.log('PASS rooms-schema: migration shape ok, root/tracked identical, RLS + 5 policies + explicit REVOKE anon + GRANTs + nullable room_id FKs + rollback + verification blocks.');
