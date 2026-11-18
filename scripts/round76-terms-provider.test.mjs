// Round 76 Phase 1 — provider identity in the host terms without personal
// data in the public repository. (1) Migration in PGlite: legal_provider is
// one row, service_role only; provider_snapshot joins the append-only
// evidence. (2) /api/host-terms status: provider data for signed-in hosts
// only; with enforcement on and no provider row → 503 (never a blank text);
// accept refused without it. (3) Console fills the placeholders after the
// hash check. (4) Texts: art. 1.4 transfer clause, Annex B retention table,
// Vercel in the EU, Bari court, no real address or tax code. Fictional data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = 'supabase/migrations/20261118090000_round76_terms_provider.sql';

let PGlite; try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { PGlite = null; }
if (PGlite) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create function auth.uid() returns uuid language sql stable as $$select null::uuid$$; create function auth.email() returns text language sql stable as $$select null::text$$;
    create table public.admin_users(email text primary key); create function public.is_admin() returns boolean language sql stable as $$ select false $$;`);
  await db.exec(read('supabase/migrations/20261101090000_round69_host_terms.sql').replace(/select cron\.schedule[\s\S]*?\$\$\);/, ''));
  const sql = read(MIG); await db.exec(sql); await db.exec(sql);
  const as = (role, q, a = []) => db.transaction(async tx => { await tx.exec(`set local role ${role}`); return tx.query(q, a); });
  await as('service_role', `insert into public.legal_provider(name,address,tax_code) values ('Fornitore Fittizio','Via Inventata 1','FCTFNT00A01H501X')`);
  await assert.rejects(as('service_role', `insert into public.legal_provider(id,name,address,tax_code) values (2,'X','Via Y 2','ABCDEFGH')`), /check constraint|duplicate/, 'one row only');
  for (const role of ['anon', 'authenticated']) await assert.rejects(as(role, 'select * from public.legal_provider'), /permission denied/, role + ': no access');
  const doc = (await db.query(`select id from public.legal_documents where version = 1`)).rows[0].id;
  await as('service_role', `insert into public.host_terms_acceptances(host_id, document_id, version, text_sha256, accepted_general_at, approved_specific_at, otp_verified_at, host_kind, account_email, provider_snapshot)
    values (gen_random_uuid(), $1, 1, repeat('a',64), now(), now(), now(), 'private', 'host@example.invalid', '{"name":"Fornitore Fittizio","address":"Via Inventata 1","tax_code":"FCTFNT00A01H501X"}')`, [doc]);
  await assert.rejects(as('service_role', `update public.host_terms_acceptances set provider_snapshot = '{}'`), /append-only|permission denied/, 'snapshot is evidence: no change');
  await assert.rejects(as('service_role', `insert into public.host_terms_acceptances(host_id, document_id, version, text_sha256, accepted_general_at, approved_specific_at, otp_verified_at, host_kind, account_email, provider_snapshot)
    values (gen_random_uuid(), $1, 1, repeat('a',64), now(), now(), now(), 'private', 'h@example.invalid', '"x"')`, [doc]), /check constraint/);
  console.log('  db: legal_provider and provider_snapshot checked in PGlite');
} else console.log('  db: SKIP — @electric-sql/pglite not installed');

// (2) API
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key';
const { handleHostTerms, fillProvider } = await import('../api/_host-terms.js');
const PROVIDER = { name: 'Fornitore Fittizio', address: 'Via Inventata 1', tax_code: 'FCTFNT00A01H501X', vat: null, pec: null };
const doc = { id: 'd1', version: 1, file_path: 'legal/CONDIZIONI_GENERALI_v1.md', text_sha256: 'a'.repeat(64), annex_file_path: null, annex_sha256: null, specific_clauses: [], requires_reacceptance: true, published_at: '2026-11-01T00:00:00Z' };
const deps = (provider, enforce) => ({
  fetch: async url => {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'h1', email: 'host@example.invalid' }));
    if (u.pathname === '/rest/v1/legal_documents') return new Response(JSON.stringify([doc]));
    if (u.pathname === '/rest/v1/legal_provider') return new Response(JSON.stringify(provider ? [{ id: 1, ...provider }] : []));
    if (u.pathname === '/rest/v1/host_terms_acceptances') return new Response('[]');
    if (u.pathname === '/rest/v1/host_terms_codes') return new Response('[]');
    throw new Error('unexpected ' + url);
  }, now: () => Date.parse('2026-11-18T10:00:00Z'), randomCode: () => '123456', supabaseUrl: 'https://db.example.invalid', anonKey: 'anon', serviceKey: 'svc', resendKey: null, from: 'x', pepper: 'p'.repeat(32), enforce, appBaseUrl: 'https://app.example.invalid',
});
const call = async (body, d, auth = 'Bearer host-session-token-fictional') => { const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handleHostTerms({ body: body && !('client' in body) ? { client: 2, ...body } : body, headers: auth ? { authorization: auth } : {} }, res, d); return res; };
let r = await call({ action: 'status' }, deps(PROVIDER, true));
assert.equal(r.code, 200); assert.deepEqual(r.body.provider, PROVIDER, 'signed-in host gets the provider data');
r = await call({ action: 'status' }, deps(PROVIDER, true), null); assert.equal(r.code, 401); assert.equal(r.body.provider, undefined, 'never without a session');
r = await call({ action: 'status' }, deps(null, true)); assert.equal(r.code, 503, 'enforced without provider data: fail closed');
r = await call({ action: 'status' }, deps(null, false)); assert.equal(r.code, 200, 'flag off: unaffected');
r = await call({ action: 'request_code' }, deps(null, true)); assert.equal(r.code, 503, 'no code for a text without provider data');
assert.equal(fillProvider('a {{fornitore_indirizzo}} b {{fornitore_cf}}', PROVIDER), 'a Via Inventata 1 b FCTFNT00A01H501X');

// (3) Console
const html = read('host-console.html');
const i = html.indexOf('function _termsFillProvider('); const fn = html.slice(i, html.indexOf('\n}\n', i) + 2);
const ctx = {}; vm.createContext(ctx); vm.runInContext(fn, ctx);
assert.equal(ctx._termsFillProvider('dom. {{fornitore_indirizzo}}, C.F. {{fornitore_cf}}.', PROVIDER), 'dom. Via Inventata 1, C.F. FCTFNT00A01H501X.');
assert.match(html, /_termsRenderMarkdown\(panel, _termsFillProvider\(termsText, status\.provider\)\)/);
assert.match(html, /_termsRenderMarkdown\(panel, _termsFillProvider\(annexText, status\.provider\)\)/);

// (4) Texts
const terms = read('legal/CONDIZIONI_GENERALI_v1.md'), annex = read('legal/ALLEGATO_A_DPA_v1.md');
assert.match(terms, /1\.4 Il Fornitore intende costituire una società[\s\S]*art\. 1407 c\.c\.[\s\S]*ha effetto dalla comunicazione inviata via email[\s\S]*può recedere senza costi entro 30 giorni/);
assert.match(terms, /Foro di Bari\./); assert.match(terms, /12\.4 I tempi per cui il Fornitore conserva i dati[\s\S]*Allegato B/);
assert.match(annex, /\| Vercel \| Hosting e funzioni server \| UE \(Irlanda, `dub1`\) \|/);
assert.match(read('lib/deployment-config.mjs'), /"regions": \[\s*"dub1"\s*\]/, 'functions pinned to Dublin as the DPA says');
const annexB = annex.split('## 9. Allegato B')[1] || '';
for (const row of ['Ricevuta Alloggiati Web', 'Dati d\'identità comunicati alla Questura', 'Foto del documento e selfie', 'statistiche regionali', 'imposta di soggiorno', 'fatturazione', 'Prenotazioni', 'Email e telefono', 'Consensi marketing', 'Chat con gli ospiti', 'Registro accessi alle porte', 'Account dell\'Host', 'azioni degli amministratori'])
  assert.ok(annexB.includes(row), 'Annex B lists: ' + row);
assert.match(annex, /## 8\. Accettazione \(Acceptance\)[\s\S]*senza firma autografa/);
for (const t of [terms, annex, read('docs/legal/RETENTION_LAWYER_BRIEF_IT.md'), read('PLAN_round76_privacy_retention.md')])
  assert.doesNotMatch(t, /Siglap|Singapore|\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/, 'no real address, country or tax code in public files');
console.log('PASS round76 terms provider: legal_provider one row, service_role only; provider snapshot is append-only evidence; status gives provider data to signed-in hosts only, fails closed when enforced without it, no code without it; console fills the placeholders after the hash check; art. 1.4 transfer clause, Bari court, Annex B retention rows, Vercel in Dublin (config and DPA), online acceptance; no real address or tax code in public files');
