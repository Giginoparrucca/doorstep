// Round 74 Phase 4 — audit WBNB-Y001: document uploads only via a
// server-issued signed URL for one fixed path; type and size capped by the
// bucket; real file kind checked on save; anonymous INSERT removed.
// Actual api/guest.js handlers + migrations in PGlite + the guest app's
// uploadFile in a vm. Fictional data only, mocked storage API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
process.env.GUEST_TOKEN_SECRET = 'fictional-round74-secret-long-enough-for-tests';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fictional-service-key-long-enough-for-tests';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const { signGuestToken } = await import('../api/_guest-token.js');
const G = await import('../api/guest.js');
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', SUB = '11111111-2222-4333-8444-555555555555';
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1];
const PDF = [...Buffer.from('%PDF-1.7\n%')], PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d],
  WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')], HEIC = [0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0],
  HTML = [...Buffer.from('<html><script>')], ZIP = [0x50, 0x4b, 0x03, 0x04];

// ── File kind from the first bytes ──
assert.equal(G.sniffDocument(new Uint8Array(JPEG)), 'jpg'); assert.equal(G.sniffDocument(new Uint8Array(PDF)), 'pdf');
assert.equal(G.sniffDocument(new Uint8Array(PNG)), 'png'); assert.equal(G.sniffDocument(new Uint8Array(WEBP)), 'webp');
assert.equal(G.sniffDocument(new Uint8Array(HEIC)), 'heic'); assert.equal(G.sniffDocument(new Uint8Array(HTML)), null); assert.equal(G.sniffDocument(new Uint8Array(ZIP)), null);

// ── Mocked transport ──
const usage = [], deleted = [], signed = []; let objects = {}, limiterDown = false; let limiterFails = false;
const originalFetch = global.fetch; const rateHits = new Map();
global.fetch = async (url, init = {}) => {
  url = String(url);
  // Round 74 Phase 5: atomic counter (rpc rate_take) emulated per scope/key.
  if (url.includes('/rpc/rate_take')) {
    if (limiterFails ?? false) return new Response('down', { status: 503 });
    const a = JSON.parse(init.body); const k = a.p_scope + '|' + a.p_key; rateHits.set(k, (rateHits.get(k) || 0) + 1);
    return Response.json({ allowed: rateHits.get(k) <= a.p_limit, hits: rateHits.get(k), limit: a.p_limit, retry_after: 600 });
  }
  if (url.includes('/storage/v1/object/upload/sign/documents/')) { const path = url.split('/upload/sign/documents/')[1]; signed.push(path); return Response.json({ url: `/object/upload/sign/documents/${path}?token=fictional%2Etoken` }); }
  if (url.includes('/storage/v1/object/documents/')) {
    const path = url.split('/object/documents/')[1];
    if (init.method === 'DELETE') { deleted.push(path); delete objects[path]; return Response.json({}); }
    if (!objects[path]) return new Response('missing', { status: 404 });
    assert.equal(init.headers.Range, 'bytes=0-15', 'reads only the first bytes');
    return new Response(new Uint8Array(objects[path]).slice(0, 16));
  }
  if (url.includes('/rest/v1/api_usage') && init.method === 'POST') { usage.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
  if (url.includes('/rest/v1/api_usage?')) {
    if (limiterDown) return new Response('down', { status: 503 });
    const u = new URL(url); const sid = (u.searchParams.get('session_id') || '').replace(/^eq\./, ''), pid = (u.searchParams.get('property_id') || '').replace(/^eq\./, '');
    const n = usage.filter(r => r.endpoint === 'upload_sign' && (!sid || r.session_id === sid) && (!pid || r.property_id === pid)).length;
    return new Response('[]', { headers: { 'content-range': `0-0/${n}` } });
  }
  if (url.includes('/properties?')) return Response.json([{ region: null, invoice_required: false, owner_id: null }]);
  return Response.json([]);
};
const tok = (b) => signGuestToken({ p: P, s: 'fictional', ...(b ? { b } : {}), exp: Math.floor(Date.now() / 1000) + 3600 }).token;
const call = async (body, { ip = '203.0.113.9', token = tok() } = {}) => { let status = 200, out;
  await G.default({ method: 'POST', headers: { origin: 'https://app.welcomebnb.it', authorization: 'Bearer ' + token, ...(ip ? { 'x-real-ip': ip } : {}) }, body },
    { setHeader() {}, status(n) { status = n; return this; }, json(v) { out = v; return this; }, end() { return this; }, write() {} });
  return { status, body: out }; };
try {
  // Signed URL: fixed path in the token's property and this submission; body cannot pick the folder.
  let r = await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg', property_id: OTHER, path: 'id-photos/evil.html' });
  assert.equal(r.status, 200); assert.match(r.body.path, new RegExp(`^id-photos/${P}/${SUB}/\\d+_[0-9a-f]{16}\\.jpg$`)); assert.equal(r.body.token, 'fictional.token');
  assert.equal(signed.at(-1), r.body.path, 'signed for exactly that path');
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'application/pdf' })).body.path.endsWith('.pdf'), true);
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'text/html' })).status, 415, 'type not allowed');
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/svg+xml' })).status, 415);
  assert.equal((await call({ action: 'upload_url', submission_id: '../x', content_type: 'image/jpeg' })).status, 400);
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg' }, { ip: null })).status, 429, 'no trusted address');
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg' }, { token: 'forged' })).status, 401, 'guest token required');
  // Per-address limit (20/hour), not reset by changing the session.
  usage.length = 0; rateHits.clear();
  for (let i = 0; i < 20; i++) assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg' }, { ip: '198.51.100.77' })).status, 200);
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg' }, { ip: '198.51.100.77', token: signGuestToken({ p: P, s: 'other-session', exp: Math.floor(Date.now() / 1000) + 3600 }).token })).status, 429);
  limiterDown = true; limiterFails = true; usage.length = 0; rateHits.clear();
  assert.equal((await call({ action: 'upload_url', submission_id: SUB, content_type: 'image/jpeg' })).status, 200, 'limiter down: uploads continue (bucket caps still apply)');
  limiterDown = false; limiterFails = false;

  // Saving a check-in: the photo must be in this property's folder and really be what it says.
  const good = `id-photos/${P}/${SUB}/1_a.jpg`; objects[good] = JPEG;
  const ok = await G.verifyIdPhoto(P, good); assert.equal(ok, true);
  objects[`id-photos/${P}/${SUB}/2_b.pdf`] = PDF; assert.equal(await G.verifyIdPhoto(P, `id-photos/${P}/${SUB}/2_b.pdf`), true);
  objects[`id-photos/${P}/${SUB}/3_c.heic`] = HEIC; assert.equal(await G.verifyIdPhoto(P, `id-photos/${P}/${SUB}/3_c.heic`), true);
  objects[`id-photos/${P}/${SUB}/4_d.jpeg`] = JPEG; assert.equal(await G.verifyIdPhoto(P, `id-photos/${P}/${SUB}/4_d.jpeg`), true);
  const fake = `id-photos/${P}/${SUB}/5_e.jpg`; objects[fake] = HTML;
  assert.equal(await G.verifyIdPhoto(P, fake), false, 'signature mismatch'); assert.ok(deleted.includes(fake), 'mismatching file deleted');
  const pngAsJpg = `id-photos/${P}/${SUB}/6_f.jpg`; objects[pngAsJpg] = PNG; assert.equal(await G.verifyIdPhoto(P, pngAsJpg), false, 'extension must match the real kind');
  objects[`id-photos/${OTHER}/${SUB}/1_a.jpg`] = JPEG; assert.equal(await G.verifyIdPhoto(P, `id-photos/${OTHER}/${SUB}/1_a.jpg`), false, 'another property\'s folder');
  assert.equal(await G.verifyIdPhoto(P, `id-photos/${P}/../${OTHER}/x.jpg`), false); assert.equal(await G.verifyIdPhoto(P, 'id-photos/1_a.jpg'), false, 'old flat path');
  assert.equal(await G.verifyIdPhoto(P, `id-photos/${P}/${SUB}/missing.jpg`), false, 'not uploaded');
  // checkin_insert refuses a bad photo before saving anything.
  const record = { guest_type: 'single', surname: 'Synthetic', name: 'Guest', sex: 'F', date_of_birth: '1980-01-01', place_of_birth: 'London', birth_country: 'United Kingdom',
    birth_province: 'EE', citizenship: 'United Kingdom', residence_country: 'United Kingdom', document_type: 'passport', document_number: 'FICTIONAL123', doc_issue_place: 'London',
    arrival_date: '2099-11-01', departure_date: '2099-11-05', nights: 4, id_photo_path: `id-photos/${OTHER}/${SUB}/1_a.jpg` };
  r = await call({ action: 'checkin_insert', record, submission_id: SUB, guest_ordinal: 1 }, { token: tok('HM1') });
  assert.equal(r.status, 400); assert.deepEqual(r.body.fields, ['id_photo_path']);
} finally { global.fetch = originalFetch; }

// ── Migrations (PGlite) ──
const { PGlite } = await import('@electric-sql/pglite');
const db = new PGlite();
await db.exec(`create table public.api_usage(id serial primary key, property_id uuid, session_id text, endpoint text, input_tokens int, output_tokens int,
    constraint api_usage_endpoint_check check (endpoint = any (array['chat','scan','chat_write','token_mint','tax_parse','checkin_lookup','checkin_write'])));
  create schema storage; create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects(id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
  create policy "Allow anonymous uploads" on storage.objects for insert with check (bucket_id = 'documents' and name like 'id-photos/%');
  insert into storage.buckets values ('documents', false, null, null), ('property-images', true, null, null);`);
const m1 = read('supabase/migrations/20261116110000_round74_document_uploads.sql');
// The anonymous-INSERT removal ships after the signed path is verified in production.
const m2path = new URL('../supabase/migrations/20261116120000_round74_drop_anon_document_uploads.sql', import.meta.url);
const m2 = fs.existsSync(m2path) ? fs.readFileSync(m2path, 'utf8') : null;
await db.exec(m1); await db.exec(m1);
await db.query(`insert into public.api_usage(endpoint) values ('upload_sign')`);
await assert.rejects(db.query(`insert into public.api_usage(endpoint) values ('anything')`), /check constraint/, 'other endpoints still refused');
const b = (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id='documents'`)).rows[0];
assert.equal(Number(b.file_size_limit), 10485760); assert.deepEqual(b.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']);
assert.equal((await db.query(`select file_size_limit from storage.buckets where id='property-images'`)).rows[0].file_size_limit, null, 'other buckets untouched');
if (m2) { await db.exec(m2); await db.exec(m2);
  assert.equal((await db.query(`select count(*)::int n from pg_policies where tablename='objects' and policyname='Allow anonymous uploads'`)).rows[0].n, 0, 'anonymous INSERT gone'); }

// ── Guest app uploadFile ──
const index = read('index.html');
const fnSrc = (() => { const i = index.indexOf('async function uploadFile('); return index.slice(i, index.indexOf('\n}\n', i) + 2); })();
assert.ok(!/\.upload\(path|storage\.from\('documents'\)\.upload\(/.test(index), 'no direct anonymous upload left in the guest app');
const calls = [], ups = [];
const ctx = vm.createContext({ console: { warn() {}, log() {} },
  _guestCall: async (a, args) => { calls.push([a, args]); return args.content_type === 'text/html' ? { ok: false, status: 415, data: { error: 'unsupported_type' } } : { ok: true, status: 200, data: { path: `id-photos/${P}/${args.submission_id}/9_z.jpg`, token: 'tkn' } }; },
  sb: { storage: { from: bucket => ({ uploadToSignedUrl: async (path, token, file, opts) => { ups.push({ bucket, path, token, opts }); return { data: { path }, error: null }; } }) } } });
vm.runInContext(fnSrc, ctx);
assert.equal(await ctx.uploadFile({ name: 'id.JPG', type: '' }, 'id-photos', SUB), `id-photos/${P}/${SUB}/9_z.jpg`);
assert.equal(JSON.stringify(calls[0]), JSON.stringify(['upload_url', { submission_id: SUB, content_type: 'image/jpeg' }]), 'type from the extension when the browser gives none');
assert.equal(JSON.stringify(ups[0]), JSON.stringify({ bucket: 'documents', path: `id-photos/${P}/${SUB}/9_z.jpg`, token: 'tkn', opts: { contentType: 'image/jpeg' } }));
assert.equal(await ctx.uploadFile({ name: 'x.html', type: 'text/html' }, 'id-photos', SUB), null, 'refused → continue without photo');
assert.equal(await ctx.uploadFile({ name: 'a.jpg', type: 'image/jpeg' }, 'id-photos', null), null, 'no submission → no upload');
console.log('PASS round74 uploads (WBNB-Y001): signed upload URL only for this token\'s property and submission at a server-chosen path, allowed types only (JPEG/PNG/WebP/HEIC/PDF; HTML/SVG refused), guest token and trusted address required, 20 per address per hour regardless of session, limiter outage never blocks; on save the photo must be in this property\'s folder and its first bytes must match its extension (mismatch deleted; other property, traversal, flat old path, missing → refused; checkin_insert answers 400 before saving); migrations re-runnable: upload_sign counter, documents bucket 10 MB + type allowlist (others untouched), anonymous INSERT policy dropped; guest app uses the signed URL, maps type from the extension, continues without a photo when refused');
