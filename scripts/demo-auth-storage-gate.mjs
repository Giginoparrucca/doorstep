// Opt-in Phase 2 provisioning/test command, run only inside the dedicated demo build.
// No credential or token is logged or written to the static output.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readEnvironment } from '../lib/environment.mjs';

export async function runGate(env = process.env) {
  const cfg = readEnvironment(env);
  assert.equal(cfg.mode, 'demo', 'Provisioning requires demo mode');
  assert.equal(cfg.projectRef, 'wmegnnlmcrabndyzywmj', 'Provisioning requires the dedicated demo project');
  assert.equal(env.VERCEL_PROJECT_ID, 'prj_MafDkEOAUye8uC9M8Mtb993vFagy', 'Provisioning requires the dedicated Vercel project');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const call = async (path, method = 'GET', body, token = key, publicClient = false, extra = {}) => {
    const response = await fetch(cfg.supabaseUrl + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { apikey: publicClient ? cfg.publicKey : key, Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, ok: response.ok, data };
  };
  const expect = (r, label) => assert.ok(r.ok, `${label}: HTTP ${r.status}`);
  const users = (await call('/auth/v1/admin/users?page=1&per_page=1000'));
  expect(users, 'List demo users');
  const owners = [];
  for (const [index, email] of ['presenter.daniele@example.com', 'presenter.probe@example.com'].entries()) {
    // Stable independent demo-only credentials, retained across reruns; no email sent.
    const password = createHmac('sha256', env.GUEST_TOKEN_SECRET).update('round50-presenter-v1:' + email).digest('base64url') + 'aA1!';
    let user = users.data.users.find(u => u.email === email);
    if (!user) {
      const created = await call('/auth/v1/admin/users', 'POST', { email, password, email_confirm: true,
        user_metadata: { full_name: index ? 'Demo isolation probe' : 'Daniele - Demo presenter' } });
      expect(created, 'Create demo presenter'); user = created.data;
    }
    const login = await call('/auth/v1/token?grant_type=password', 'POST', { email, password }, cfg.publicKey, true);
    expect(login, 'Actual presenter password login');
    assert.equal(login.data.user.id, user.id);
    owners.push({ id: user.id, token: login.data.access_token, property: `50505050-0000-4000-8000-00000000000${index + 2}` });
  }
  console.log('PASS demo presenters: supported Auth admin API and actual password login');
  const [a, b] = owners;
  for (const owner of owners) {
    const insert = await call('/rest/v1/properties?on_conflict=id', 'POST', {
      id: owner.property, owner_id: owner.id, name: 'Disposable Phase 2 ownership probe', is_test: true, alloggiati_autofile_mode: 'off',
    }, key, false, { Prefer: 'resolution=merge-duplicates' });
    expect(insert, 'Prepare fictional owner probe');
    const own = await call(`/rest/v1/properties?id=eq.${owner.property}&select=id,owner_id`, 'GET', undefined, owner.token, true);
    expect(own, 'Owner read'); assert.equal(own.data.length, 1); assert.equal(own.data[0].owner_id, owner.id);
  }
  const crossRead = await call(`/rest/v1/properties?id=eq.${a.property}&select=id`, 'GET', undefined, b.token, true);
  expect(crossRead, 'Other-owner read'); assert.deepEqual(crossRead.data, []);
  const crossWrite = await call(`/rest/v1/properties?id=eq.${a.property}`, 'PATCH', { name: 'UNAUTHORIZED' }, b.token, true, { Prefer: 'return=representation' });
  expect(crossWrite, 'Other-owner update'); assert.deepEqual(crossWrite.data, []);
  const unchanged = await call(`/rest/v1/properties?id=eq.${a.property}&select=name`);
  expect(unchanged, 'Verify denied update'); assert.notEqual(unchanged.data[0].name, 'UNAUTHORIZED');
  const move = await call(`/rest/v1/properties?id=eq.${a.property}`, 'PATCH', { owner_id: b.id }, a.token, true);
  assert.ok(!move.ok, 'Owner must not transfer ownership through RLS');
  console.log('PASS real JWT owner isolation: own read, cross-owner read/update denial, ownership reassignment denial');
  const objectPath = `${a.property}/phase2-${Date.now()}.txt`;
  const documentPath = `id-photos/phase2-${Date.now()}.txt`;
  let checkinId;
  try {
    const upload = await fetch(`${cfg.supabaseUrl}/storage/v1/object/receipts/${objectPath}`, {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
      body: 'FACSIMILE - DEMO - disposable Phase 2 privacy probe',
    });
    assert.ok(upload.ok, `Actual private upload: HTTP ${upload.status}`);
    const ownRead = await call(`/storage/v1/object/authenticated/receipts/${objectPath}`, 'GET', undefined, a.token, true);
    expect(ownRead, 'Owner reads actual private object'); assert.match(ownRead.data, /FACSIMILE/);
    const otherRead = await call(`/storage/v1/object/authenticated/receipts/${objectPath}`, 'GET', undefined, b.token, true);
    assert.ok(!otherRead.ok, 'Other owner must not read the existing object');
    const anonRead = await call(`/storage/v1/object/receipts/${objectPath}`, 'GET', undefined, cfg.publicKey, true);
    assert.ok(!anonRead.ok, 'Anonymous caller must not read the existing object');
    console.log('PASS actual private object: upload, owner read, other-owner and anonymous denial');
    const hosted = async (path, body, token) => {
      const r = await fetch(cfg.appOrigin + path, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Origin: cfg.appOrigin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body) });
      return { ok: r.ok, status: r.status, data: await r.json() };
    };
    const session = 'phase2-doc-' + Date.now();
    const mint = await hosted('/api/guest-token', { property_id: a.property, session_id: session, booking_code: 'DEMO-PHASE2', is_test: true });
    expect(mint, 'Actual guest token mint');
    const scoped = await hosted('/api/guest', { action: 'property', property_id: b.property }, mint.data.token);
    expect(scoped, 'Guest property scope'); assert.equal(scoped.data.property.id, a.property);
    const payload = mint.data.token.split('.')[0];
    const foreignToken = payload + '.' + createHmac('sha256', 'disposable-foreign-environment-secret').update(payload).digest('base64url');
    const foreign = await hosted('/api/guest', { action: 'property' }, foreignToken);
    assert.equal(foreign.status, 401, 'Foreign environment signing key rejected');
    const docUpload = await fetch(`${cfg.supabaseUrl}/storage/v1/object/documents/${documentPath}`, {
      method: 'POST', signal: AbortSignal.timeout(20000), headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
      body: 'FACSIMILE - DEMO - no real personal document',
    });
    assert.ok(docUpload.ok, `Document upload: HTTP ${docUpload.status}`);
    const arrival = new Date().toISOString().slice(0, 10);
    const departure = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const inserted = await hosted('/api/guest', { action: 'checkin_insert', record: {
      guest_type: 'single', surname: 'FACSIMILE', name: 'DEMO', sex: 'M', date_of_birth: '1990-01-01',
      place_of_birth: 'DEMO', citizenship: 'DEMO', document_type: 'passport', document_number: 'DEMO00000',
      arrival_date: arrival, departure_date: departure, nights: 1, id_photo_path: documentPath,
    } }, mint.data.token);
    expect(inserted, 'Actual guest check-in');
    checkinId = inserted.data.checkin?.id || inserted.data.id;
    assert.ok(checkinId, 'Check-in response includes ID');
    const docOwner = await call(`/storage/v1/object/authenticated/documents/${documentPath}`, 'GET', undefined, a.token, true);
    expect(docOwner, 'Owner reads linked private document');
    const docOther = await call(`/storage/v1/object/authenticated/documents/${documentPath}`, 'GET', undefined, b.token, true);
    assert.ok(!docOther.ok, 'Other owner cannot read linked document');
    const docAnon = await call(`/storage/v1/object/documents/${documentPath}`, 'GET', undefined, cfg.publicKey, true);
    assert.ok(!docAnon.ok, 'Anonymous caller cannot read existing document');
    console.log('PASS guest check-in, token property binding, foreign-key denial and linked document privacy');
  } finally {
    const cleanup = await call('/storage/v1/object/receipts', 'DELETE', { prefixes: [objectPath] });
    expect(cleanup, 'Disposable object cleanup');
    const docCleanup = await call('/storage/v1/object/documents', 'DELETE', { prefixes: [documentPath] });
    expect(docCleanup, 'Disposable document cleanup');
    if (checkinId) expect(await call(`/rest/v1/checkins?id=eq.${checkinId}&property_id=eq.${a.property}`, 'DELETE'), 'Disposable check-in cleanup');
    for (const owner of owners) await call('/auth/v1/logout?scope=local', 'POST', {}, owner.token, true);
  }
  console.log('PASS partial Phase 2 Auth/ownership/receipt gate; clean rebuild and recovery remain separate gates');
  return { passed: true, checks: ['presenter-password-login', 'owner-row-read', 'cross-owner-row-read-denied',
    'cross-owner-row-update-denied', 'ownership-reassignment-denied', 'private-object-upload',
    'private-object-owner-read', 'private-object-cross-owner-read-denied', 'private-object-anonymous-read-denied',
    'private-object-cleanup', 'guest-checkin', 'guest-token-property-binding', 'foreign-environment-signature-denied',
    'private-linked-document-owner-read', 'private-linked-document-cross-owner-read-denied', 'private-linked-document-anonymous-read-denied'], partial: true };
}
