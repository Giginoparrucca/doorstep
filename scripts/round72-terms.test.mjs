// Round 72 Phase 5 — economic terms in the v1 draft (still BOZZA), Art. 16
// additions, seed = file (also checked byte-for-byte by round69-host-terms-db),
// receipt email states price and plan, lawyer questions recorded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const terms = read('legal/CONDIZIONI_GENERALI_v1.md');
assert.match(terms, /BOZZA — non pubblicare/, 'still a draft for the lawyer');
const art4 = terms.split('## Art. 4')[1].split('## Art. 5')[0];
for (const n of ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8']) assert.match(art4, new RegExp('^' + n.replace('.', '\\.') + ' ', 'm'), n);
assert.match(art4, /60 euro all'anno, IVA inclusa, per ogni account Host, indipendentemente dal numero di Strutture/);
assert.match(art4, /comunica all'Host via email e nel Servizio la data in cui l'uso gratuito termina/);
assert.ok(!/30 giorni dalla (firma|sottoscrizione|accettazione)/.test(terms), 'never promises 30 days from signing');
assert.match(art4, /l'Host ha 7 giorni per pagare con accesso completo\. Poi l'account passa in sola lettura/);
assert.match(art4, /Il check-in degli Ospiti che hanno già ricevuto il link e l'Invio automatico delle loro schedine continuano a funzionare/);
assert.match(art4, /con un preavviso di almeno 7 giorni via email; il pagamento è dovuto solo dalla data indicata nell'avviso/);
assert.match(art4, /recedere entro 14 giorni dal primo pagamento, senza motivazione, con una richiesta a info@welcomebnb\.it, e riceve il rimborso integrale/);
assert.match(terms, /13\.2 L'Host può recedere in qualsiasi momento con una richiesta a info@welcomebnb\.it\. Il recesso ha effetto alla scadenza dell'anno già pagato; gli importi già pagati non sono rimborsati, salvo l'art\. 4\.8\./);
const art16 = terms.split('## Art. 16')[1].split('## Allegato A')[0];
const refs = art16.split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2).split(' — ')[0]);
assert.deepEqual(refs, ['3.3', '4.4', '4.5', '4.6', '5.2 e 5.3', '6.4', '9.1 e 9.2', '10.2 e 10.3', '11', '13.2', '13.3', '14', '15.2']);
// Seed (Round 69 migration) carries the new hash and list.
const seed = read('supabase/migrations/20261101090000_round69_host_terms.sql');
assert.ok(seed.includes(createHash('sha256').update(fs.readFileSync(new URL('../legal/CONDIZIONI_GENERALI_v1.md', import.meta.url))).digest('hex')), 'seed hash = file');
assert.match(seed, /"ref": "4\.5", "label": "passaggio dell''account in sola lettura in caso di mancato pagamento"/);
// Receipt email states price and plan.
assert.match(read('api/_host-terms.js'), /Condizioni economiche \(art\. 4\): uso gratuito fino alla data che ti comunichiamo via email e nel Servizio; poi 60 € l\\'anno, IVA inclusa, per account host/);
// Lawyer questions recorded.
const brief = read('docs/legal/README.md');
for (const q of ['full refund within 14 days', 'tacit annual renewal', 'read-only mode after non-payment', '"IVA inclusa"']) assert.ok(brief.includes(q), q);
console.log('PASS round72 terms: Art. 4.1–4.8 economic terms (communicated free-use end date, €60/year IVA inclusa per host account, 7-day grace then read-only with guests and filing kept, early end with 7 days notice, 14-day full refund), 13.2 no refund except 4.8, Art. 16 adds 4.4/4.5/4.6/13.2 in order, still BOZZA, seed hash and clauses updated, receipt states price and plan, four lawyer questions recorded');
