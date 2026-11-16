// Round 67 Phase 6 — log scrubbing (lib/log-scrub.mjs): 20+ redaction
// cases incl. worst-case e-mail/phone/token shapes, field-aware redaction,
// raw bodies, errors, circular objects; console wrapped once; every API
// entry file loads the scrubber first; no log path bypasses console.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const S = await import('../lib/log-scrub.mjs');
const s = S.scrubString;
const cases = [
  // e-mail: 2 characters of the local part + domain
  ['mario.rossi@example.com', 'ma***@example.com'],
  ['Contatto: <Guest+tag@sub.example.co.uk>', 'Contatto: <Gu***@sub.example.co.uk>'],
  ['a@b.it', 'a***@b.it'],
  ['two: x1@ex.it, yy2@ex.org', 'two: x1***@ex.it, yy***@ex.org'],
  ['invite failed host@example.invalid 422', 'invite failed ho***@example.invalid 422'],
  // phones: last 3 digits
  ['+39 333 123 4567', '***567'],
  ['call 0039-333-1234567 now', 'call ***567 now'],
  ['+44 (20) 7946 0958', '***958'],
  ['cell 333 1234567', 'cell ***567'],
  ['3331234567', '***567'],
  ['+1-202-555-0143', '***143'],
  // tokens and keys
  ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLWZpY3Rpb24 end', 'jwt [token] end'],
  ['Authorization: Bearer abc.def-ghi_jkl/mno=', 'Authorization: Bearer [token]'],
  ['guest token eyJwIjoiYWFhYWFhYWFhYWFhIn0.Zmljdmlvbm5hbF9zaWduYXR1cmVfMTIz', 'guest token [token]'],
  ['tok ' + 'A'.repeat(24) + '.' + 'b'.repeat(43), 'tok [token]'],
  ['key sb_secret_AbCdEfGh123456789 leaked', 'key [secret] leaked'],
  ['resend re_FicTioNal123456 failed', 'resend [secret] failed'],
  // left alone
  ['booking HMFICTION1 at 2026-11-16T10:00:00Z', 'booking HMFICTION1 at 2026-11-16T10:00:00Z'],
  ['property aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 status 503', 'property aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1 status 503'],
  ['took 1731772800123 ms', 'took 1731772800123 ms'],
  ['GET /api/guest?x=1 200 in 45ms', 'GET /api/guest?x=1 200 in 45ms'],
];
for (const [input, want] of cases) assert.equal(s(input), want, input);
assert.ok(cases.length >= 20);
// Field-aware.
const obj = S.scrub({ email: 'guest@example.com', contact_phone: '+39 333 123 4567', phone_last4: 4567, document_number: 'CA12345AB', fiscal_code: 'RSSMRA80A01H501U',
  surname: 'ROSSI', name: 'Mario', date_of_birth: '1980-01-01', password: 'p', wskey: 'w', keybox_code: '1234', guest_token: 'x', refresh_token: 'y', apikey: 'z',
  invoice_email: 'm@example.com', notify_email: 'no-at-sign', status: 409, property_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', booking_code: 'B1', ok: true,
  nested: { list: [{ email: 'n@example.com' }, 'free text with +39 333 765 4321'] } });
assert.deepEqual(obj, { email: 'gu***@example.com', contact_phone: '***567', phone_last4: '***567', document_number: '[redacted]', fiscal_code: '[redacted]',
  surname: '[redacted]', name: '[redacted]', date_of_birth: '[redacted]', password: '[redacted]', wskey: '[redacted]', keybox_code: '[redacted]', guest_token: '[redacted]', refresh_token: '[redacted]', apikey: '[redacted]',
  invoice_email: '[redacted]', notify_email: '[redacted]', status: 409, property_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', booking_code: 'B1', ok: true,
  nested: { list: [{ email: 'n***@example.com' }, 'free text with ***321'] } });
// Raw bodies keep only known-safe keys.
assert.deepEqual(S.scrub({ body: { action: 'checkin_submit', property_id: 'p1', surname: 'X', document_number: 'Y', note: 'free text' } }),
  { body: { action: 'checkin_submit', property_id: 'p1', surname: '[omitted]', document_number: '[omitted]', note: '[omitted]' } });
// Errors, buffers, circular.
const err = new Error('lookup failed for guest@example.com with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'); err.code = 'E1';
const se = S.scrub(err);
assert.ok(se instanceof Error); assert.equal(se.message, 'lookup failed for gu***@example.com with [token]'); assert.ok(!se.stack.includes('guest@')); assert.equal(se.code, 'E1');
assert.equal(S.scrub(Buffer.from('secret')), '[6 bytes]');
const circ = { a: 1 }; circ.self = circ; assert.deepEqual(S.scrub(circ), { a: 1, self: '[circular]' });
// Console wrapped once; output scrubbed.
const lines = []; const fake = { log: (...a) => lines.push(a), warn: (...a) => lines.push(a), error: (...a) => lines.push(a), info: (...a) => lines.push(a), debug: (...a) => lines.push(a) };
assert.equal(S.installConsoleScrub(fake), true); assert.equal(S.installConsoleScrub(fake), false, 'idempotent');
fake.warn('[guest] failed', 'guest@example.com', { contact_phone: '3331234567' }, new Error('Bearer abcdefgh12345'));
assert.equal(lines[0][1], 'gu***@example.com'); assert.deepEqual(lines[0][2], { contact_phone: '***567' }); assert.equal(lines[0][3].message, 'Bearer [token]');
assert.equal(typeof console.warn, 'function'); assert.equal(console.warn.name, 'scrubbedLog', 'importing the module wraps the process console');
// Every function entry loads it first; nothing writes logs around console.
const api = new URL('../api/', import.meta.url);
const entries = fs.readdirSync(api).filter(f => /^[a-z].*\.js$/.test(f));
assert.ok(entries.length >= 13);
for (const f of entries) {
  const src = fs.readFileSync(new URL(f, api), 'utf8');
  assert.ok(src.startsWith("import '../lib/log-scrub.mjs';"), f + ' loads the scrubber first');
}
for (const f of fs.readdirSync(api).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(new URL(f, api), 'utf8');
  assert.ok(!/process\.std(out|err)\.write/.test(src), f + ': no direct stdout/stderr writes');
}
console.log(`PASS round67 log scrubbing (Phase 6): ${cases.length} string cases (e-mails keep 2 characters + domain, phones last 3 digits incl. +39/0039/+44/+1/Italian mobile, JWTs, bearer and guest tokens, provider keys; booking codes, UUIDs, timestamps and URLs untouched), field-aware redaction of documents/fiscal codes/names/birth data/secrets, raw bodies reduced to safe keys, errors/buffers/circular objects, console wrapped once, all ${entries.length} API entry files load it first, no direct stdout writes`);
