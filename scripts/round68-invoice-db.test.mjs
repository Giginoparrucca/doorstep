// Round 68 — the real atomic submission function (PGlite, migrations from
// supabase/migrations) stores the invoice fields and enforces their formats.
// Synthetic data only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { submitEntryCheckin } from '../api/_entry-submission-save.js';

let createEntryFixture;
try { ({ createEntryFixture } = await import('./helpers/entry-fixture.mjs')); } catch (e) {
  console.error(`SKIP round68-invoice-db: PGlite fixture unavailable (${e.code || e.message})`); process.exit(77);
}
const { db, pid, code, row, callRPC } = await createEntryFixture();

const invoice = { fiscal_code: 'TSTFNC90C41Z404Q', residence_address: 'Via Prova 1',
  residence_postcode: '70121', residence_province: 'BA', residence_country: 'Italia', residence_place: 'Bari' };
const submissionId = randomUUID();
const out = await submitEntryCheckin({ callRPC, propertyId: pid, bookingCode: code, isTest: false,
  ordinal: 1, submissionId, record: { ...row(1), ...invoice } });
assert.equal(out.enabled, true, JSON.stringify(out));
const saved = (await db.query('select fiscal_code,residence_address,residence_postcode,residence_province,residence_country,residence_place from public.checkins where id=$1', [submissionId])).rows[0];
assert.deepEqual({ ...saved }, invoice, 'atomic insert stores every invoice and residence field');

// Members without invoice details still save, with the new columns NULL.
const memberId = randomUUID();
const member = await submitEntryCheckin({ callRPC, propertyId: pid, bookingCode: code, isTest: false,
  ordinal: 2, submissionId: memberId, record: row(2) });
assert.equal(member.enabled, true, JSON.stringify(member));
const m = (await db.query('select fiscal_code,residence_province from public.checkins where id=$1', [memberId])).rows[0];
assert.equal(m.fiscal_code, null); assert.equal(m.residence_province, null);

// Format constraints reject malformed values even if the gateway were bypassed.
for (const [col, bad] of [['fiscal_code', 'tstfnc90c41z404q'], ['fiscal_code', 'SHORT'],
  ['residence_province', 'Bari'], ['residence_address', 'x'.repeat(121)], ['residence_postcode', '1'.repeat(13)]]) {
  await assert.rejects(db.query(`update public.checkins set ${col}=$1 where id=$2`, [bad, submissionId]), /violates check constraint/, `${col}=${bad.slice(0, 20)} rejected`);
}

console.log('PASS round68-invoice-db: real atomic submission stores codice fiscale, address, postcode, provincia and residence; members save with NULLs; CHECK constraints reject malformed values');
