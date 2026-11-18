// Round 76 Phase 4 — the retention documents agree with each other and with
// the code: Annex B (signed by hosts) = DPA template; every Annex B row has a
// line in RETENTION_POLICY.md; the ROPA has no open retention decision left
// except the iReservation comparison reports; the guest privacy notice (IT/EN)
// states the Annex B periods and no longer the old ones; every job named in
// the policy exists in a migration.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const annex = read('legal/ALLEGATO_A_DPA_v1.md');
assert.equal(annex, read('docs/compliance/DPA_TEMPLATE.md'), 'Annex A file = DPA template (byte-identical)');
const b = annex.slice(annex.indexOf('## 9. Allegato B'));
const rows = b.split('\n').filter(l => /^\| /.test(l) && !/^\|---/.test(l) && !/^\| Dati \| Conservazione \|/.test(l));
assert.equal(rows.length, 13, 'Annex B has 13 rows');

const policy = read('docs/compliance/RETENTION_POLICY.md');
// Each Annex B row ↔ a policy row with the same period.
const pairs = [
  [/Ricevuta Alloggiati Web e registro degli invii \| 5 anni/, /Alloggiati receipt and filing log \| 5 years from filing/],
  [/Dati d'identità comunicati alla Questura .*alla fine del mese successivo alla partenza/, /Identity data sent to the police .*end of the month after departure/],
  [/Foto del documento e selfie \| Cancellate appena l'invio è registrato/, /Document photos and selfie \| until the filing is recorded/],
  [/sesso, anno di nascita, cittadinanza, residenza\) \| Fino alla fine del 12° mese/, /Statistics fields .* \| end of the 12th month after the stay/],
  [/imposta di soggiorno .* \| 5 anni dopo la fine dell'anno d'imposta/, /Tourist-tax record .* \| 5 years after the end of the tax year/],
  [/fatturazione dell'ospite .* \| 10 anni/, /Guest invoice details .* \| 10 years/],
  [/Prenotazioni \(date, portale, nome dell'ospite\) \| 10 anni dal check-out/, /Reservations \(dates, platform, guest name\) \| 10 years from check-out/],
  [/Email e telefono delle prenotazioni \| 12 mesi dal check-out/, /Reservation e-mail and phone \| 12 months from check-out/],
  [/Consensi marketing degli ospiti \| 24 mesi dal soggiorno; le revoche 24 mesi/, /marketing consents \| 24 months from the stay; withdrawals 24 months/],
  [/Chat con gli ospiti \| 12 mesi dal soggiorno/, /Guest chat \| 12 months from the stay/],
  [/Registro accessi alle porte; notifiche all'Host \| 12 mesi/, /Door-access audit; host notifications \| 12 months/],
  [/Account dell'Host, accettazioni, abbonamento e pagamenti \| 10 anni dalla chiusura/, /Host account, terms acceptances, subscription and payments \| 10 years from account closure/],
  [/Registro delle azioni degli amministratori \| 2 anni/, /Admin action log \| 2 years/],
];
assert.equal(pairs.length, rows.length, 'one check per Annex B row');
for (const [it, en] of pairs) { assert.match(b, it, 'Annex B: ' + it); assert.match(policy, en, 'policy: ' + en); }
// Jobs named in the policy exist.
const migrations = fs.readdirSync(new URL('../supabase/migrations/', import.meta.url)).map(f => read('supabase/migrations/' + f)).join('\n');
for (const fn of ['retention_purge', 'minimise_filed_checkins', 'admin_audit_purge', 'welcomebnb_police_minimise', 'welcomebnb_admin_audit_purge', 'purge_old_data_cron'])
  assert.ok(migrations.includes(fn), 'migration defines ' + fn);

// ROPA: no open retention decision except iReservation comparison reports.
const ropa = read('docs/compliance/ROPA.md');
const open = ropa.split('\n').filter(l => /^\s+- OWNER DECISION/.test(l));
assert.deepEqual(open, ['  - OWNER DECISION - no purge for comparison reports']);
for (const s of ['20261118110000_round76_retention_purges.sql', '20261118100000_round76_police_data_minimisation.sql']) assert.ok(ropa.includes(s), 'ROPA cites ' + s);
assert.doesNotMatch(ropa, /deleted 90 days after resolution/);

// Guest privacy notice, IT and EN.
const index = read('index.html');
const it = index.match(/<p [^>]*data-retention-it>([^<]*)<\/p>/)[1], en = index.match(/<p [^>]*data-retention-en>([^<]*)<\/p>/)[1];
for (const s of ['entro 7 giorni dall\'arrivo', 'Ricevuta dell\'invio alla Questura: 5 anni', 'fino alla fine del 12° mese dopo il soggiorno', '5 anni dopo la fine dell\'anno d\'imposta', 'fattura: 10 anni', '10 anni dal check-out', 'telefono della prenotazione: 12 mesi', 'Messaggi in chat: 12 mesi dal soggiorno', '180 giorni', '24 mesi dal soggiorno'])
  assert.ok(it.includes(s), 'IT notice: ' + s);
for (const s of ['within 7 days of arrival', 'Police filing receipt: 5 years', 'until the end of the 12th month after your stay', '5 years after the end of the tax year', 'invoice: 10 years', '10 years after check-out', 'e-mail and phone: 12 months', 'Chat messages: 12 months after your stay', '180 days', '24 months after your stay'])
  assert.ok(en.includes(s), 'EN notice: ' + s);
for (const old of ['Dati di identificazione e soggiorno: 5 anni', '90 giorni dalla chiusura', 'Identification and stay data: 5 years', '90 days after the conversation', 'We keep the data, not the image'])
  assert.ok(!index.includes(old), 'old period removed: ' + old);
console.log('PASS round76 retention docs: Annex B = DPA template; 13 Annex B rows each match RETENTION_POLICY.md; the enforcing jobs exist; ROPA has no open retention decision except iReservation reports; guest privacy notice IT/EN states the Annex B periods and none of the old ones');
