// Round 69 Phase 1 — host terms data model, against the real migration in
// PGlite: seed = committed files, append-only evidence, frozen accepted
// versions, per-role grants (anon / authenticated / admin / service_role).
// Synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';

let PGlite;
try { ({ PGlite } = await import('@electric-sql/pglite')); } catch (e) {
  console.error(`SKIP round69-host-terms-db: PGlite unavailable (${e.code || e.message})`); process.exit(77);
}
const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root));
const sha = b => createHash('sha256').update(b).digest('hex');
const migration = read('supabase/migrations/20261101090000_round69_host_terms.sql').toString();
const terms = read('legal/CONDIZIONI_GENERALI_v1.md');
const annex = read('legal/ALLEGATO_A_DPA_v1.md');

// The served Annex A is the DPA template, byte for byte.
assert.equal(sha(annex), sha(read('docs/compliance/DPA_TEMPLATE.md')), 'legal/ALLEGATO_A_DPA_v1.md must equal docs/compliance/DPA_TEMPLATE.md');
// The draft text keeps its banner until the lawyer-approved text replaces it.
assert.match(terms.toString(), /BOZZA — non pubblicare/);

// Art. 16 bullets, parsed independently of the migration's generator.
const art16 = terms.toString().split('## Art. 16')[1].split('## Allegato A')[0];
const bullets = art16.split('\n').filter(l => l.startsWith('- ')).map(l => {
  const body = l.slice(2).replace(/[;.]$/, '');
  const cut = body.indexOf(' — ');
  return { ref: body.slice(0, cut), label: body.slice(cut + 3) };
});
assert.equal(bullets.length, 9, 'Art. 16 lists nine clause groups');

const db = new PGlite();
const host = randomUUID(), other = randomUUID(), adminId = randomUUID();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.email() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.email',true),'')$$;
  create table public.admin_users(email text primary key);
  create function public.is_admin() returns boolean language sql stable security definer set search_path = public as
    $$select exists(select 1 from public.admin_users where lower(email)=lower(coalesce(auth.email(),'')))$$;
  grant execute on function public.is_admin() to authenticated;
  create schema cron; create table cron.jobs(name text primary key, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$insert into cron.jobs values(n,s,c) on conflict (name) do update set schedule=excluded.schedule, command=excluded.command returning 1::bigint$$;
  insert into public.admin_users values ('admin@example.invalid');
`);
await db.exec(migration);
await db.exec(migration); // re-runnable

// Seed equals the committed files.
const doc = (await db.query(`select * from public.legal_documents where kind='host_terms' and version=1`)).rows[0];
assert.equal(doc.file_path, 'legal/CONDIZIONI_GENERALI_v1.md');
assert.equal(doc.text_sha256, sha(terms), 'seeded hash = committed terms file');
assert.equal(doc.annex_file_path, 'legal/ALLEGATO_A_DPA_v1.md');
assert.equal(doc.annex_sha256, sha(annex), 'seeded annex hash = committed annex file');
assert.deepEqual(doc.specific_clauses, bullets, 'seeded clause list = Art. 16 bullets');
assert.equal(doc.requires_reacceptance, true);
assert.equal((await db.query(`select count(*)::int n from public.legal_documents`)).rows[0].n, 1);
const job = (await db.query(`select * from cron.jobs where name='welcomebnb_host_terms_codes_purge'`)).rows[0];
assert.ok(job && /delete from public\.host_terms_codes where created_at < now\(\) - interval '1 day'/.test(job.command), 'daily code purge scheduled');

async function as(role, claims, fn) {
  return db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    if (claims.sub) await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [claims.sub]);
    if (claims.email) await tx.query(`select set_config('request.jwt.claim.email',$1,true)`, [claims.email]);
    return fn(tx);
  });
}
const denied = (p, what) => assert.rejects(p, /permission denied|violates row-level security/, what);
const row = (hostId, extra = {}) => ({ host_id: hostId, document_id: doc.id, version: 1, text_sha256: doc.text_sha256,
  annex_sha256: doc.annex_sha256, host_kind: 'business', account_email: 'host@example.invalid', ...extra });
const insertSql = `insert into public.host_terms_acceptances(host_id,document_id,version,text_sha256,annex_sha256,
  accepted_general_at,approved_specific_at,otp_verified_at,host_kind,account_email,ip,user_agent)
  values($1,$2,$3,$4,$5,now(),now(),now(),$6,$7,'203.0.113.7','Fictional agent') returning id`;
const insert = (tx, r) => tx.query(insertSql, [r.host_id, r.document_id, r.version, r.text_sha256, r.annex_sha256, r.host_kind, r.account_email]);

// anon: nothing at all.
for (const t of ['legal_documents', 'host_terms_acceptances', 'host_terms_codes']) {
  await denied(as('anon', {}, tx => tx.query(`select * from public.${t}`)), `anon cannot read ${t}`);
}
await denied(as('anon', {}, tx => insert(tx, row(host))), 'anon cannot insert evidence');

// authenticated host: reads published versions, never writes.
assert.equal((await as('authenticated', { sub: host }, tx => tx.query(`select id from public.legal_documents`))).rows.length, 1);
await denied(as('authenticated', { sub: host }, tx => tx.query(`update public.legal_documents set requires_reacceptance=false`)), 'host cannot change versions');
await denied(as('authenticated', { sub: host }, tx => insert(tx, row(host))), 'host cannot insert its own acceptance');
await denied(as('authenticated', { sub: host }, tx => tx.query(`select * from public.host_terms_codes`)), 'host cannot read codes');
await denied(as('authenticated', { sub: host }, tx => tx.query(`insert into public.host_terms_codes(host_id,code_hash,document_id,expires_at) values($1,$2,$3,now())`, [host, sha('x'), doc.id])), 'host cannot create codes');

// service_role: codes and evidence.
await as('service_role', {}, async tx => {
  await tx.query(`insert into public.host_terms_codes(host_id,code_hash,document_id,expires_at) values($1,$2,$3,now()+interval '10 minutes')`, [host, sha('123456'), doc.id]);
  await tx.query(`update public.host_terms_codes set attempts=attempts+1, used_at=now() where host_id=$1`, [host]);
});
const ids = await as('service_role', {}, async tx => [
  (await insert(tx, row(host))).rows[0].id,
  (await insert(tx, row(other, { host_kind: 'private', account_email: 'other@example.invalid' }))).rows[0].id,
]);
await assert.rejects(as('service_role', {}, tx => insert(tx, row(host))), /duplicate key/, 'one acceptance per host and version');
await assert.rejects(as('service_role', {}, tx => insert(tx, row(randomUUID(), { host_kind: 'company' }))), /check constraint/, 'host_kind is business or private');
await assert.rejects(as('service_role', {}, tx => insert(tx, row(randomUUID(), { text_sha256: 'abc' }))), /check constraint/, 'hash format enforced');

// RLS: a host sees only its own evidence; an admin sees all.
const mine = await as('authenticated', { sub: host }, tx => tx.query(`select host_id from public.host_terms_acceptances`));
assert.deepEqual(mine.rows.map(r => r.host_id), [host]);
const all = await as('authenticated', { sub: adminId, email: 'admin@example.invalid' }, tx => tx.query(`select host_id from public.host_terms_acceptances`));
assert.equal(all.rows.length, 2);

// Append-only: only the receipt id may be recorded, once.
await as('service_role', {}, tx => tx.query(`update public.host_terms_acceptances set receipt_email_id='fictional-receipt' where id=$1`, [ids[0]]));
await assert.rejects(as('service_role', {}, tx => tx.query(`update public.host_terms_acceptances set receipt_email_id='second' where id=$1`, [ids[0]])), /append-only/, 'receipt id recorded once');
await assert.rejects(as('service_role', {}, tx => tx.query(`update public.host_terms_acceptances set host_kind='private' where id=$1`, [ids[0]])), /permission denied|append-only/, 'service_role cannot rewrite evidence');
await assert.rejects(as('service_role', {}, tx => tx.query(`delete from public.host_terms_acceptances where id=$1`, [ids[0]])), /permission denied|append-only/, 'service_role cannot delete evidence');
// Even the owner role (bypassing grants) is stopped by the trigger.
await assert.rejects(db.query(`update public.host_terms_acceptances set host_kind='private' where id=$1`, [ids[1]]), /append-only/, 'trigger blocks UPDATE');
await assert.rejects(db.query(`update public.host_terms_acceptances set receipt_email_id='x', host_kind='business' where id=$1`, [ids[1]]), /append-only/, 'receipt update cannot carry other changes');
await assert.rejects(db.query(`delete from public.host_terms_acceptances where id=$1`, [ids[1]]), /append-only/, 'trigger blocks DELETE');
await assert.rejects(db.query(`truncate public.host_terms_acceptances`), /append-only/, 'trigger blocks TRUNCATE');
assert.equal((await db.query(`select count(*)::int n from public.host_terms_acceptances`)).rows[0].n, 2);

// An accepted version is frozen; re-running the unchanged migration is still fine.
await assert.rejects(db.query(`update public.legal_documents set text_sha256=$1 where id=$2`, [sha('changed'), doc.id]), /accepted and frozen/);
await assert.rejects(db.query(`delete from public.legal_documents where id=$1`, [doc.id]), /accepted and frozen/);
await db.exec(migration);
assert.equal((await db.query(`select text_sha256 from public.legal_documents where id=$1`, [doc.id])).rows[0].text_sha256, sha(terms));

console.log('PASS round69-host-terms-db: migration re-runnable; seed hashes = committed terms and Annex A (= DPA template); clause list = Art. 16 bullets; anon denied everywhere; hosts read versions and only their own evidence, never write; admins read all; service_role writes codes/evidence; evidence append-only (UPDATE/DELETE/TRUNCATE blocked even for the owner, receipt id once); accepted versions frozen; daily code purge scheduled');
