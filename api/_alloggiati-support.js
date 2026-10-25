// Admin support reads and explicit SOAP Test only. This module has no Send capability.
export function redactSupport(value, secrets = []) {
  let text = String(value ?? '').slice(0, 6000);
  for (const secret of secrets.filter(Boolean)) text = text.split(String(secret)).join('[redacted]');
  return text.replace(/<(token|password|wskey|utente)[^>]*>[\s\S]*?<\/\1>/gi, '[redacted]')
    .replace(/\b(Bearer\s+)[\w.\-]+/gi, '$1[redacted]')
    .replace(/\b(password|wskey|token|authorization|credentials_enc|credentials_nonce)\s*[:=]\s*[^\s,;|]+/gi, '$1=[redacted]')
    .slice(0, 1600);
}
const RECORD_FIELDS = 'id,property_id,booking_code,guest_type,arrival_date,departure_date,submitted_at,alloggiati_status,filed_at,autofile_last_error,autofile_last_attempt_at,autofile_attempts,autofile_excluded,docs_status';
const BUILD_FIELDS = RECORD_FIELDS + ',surname,name,sex,date_of_birth,citizenship,birth_country,birth_province,place_of_birth,document_type,document_number,doc_issue_place,nights';
export async function handleAlloggiatiSupport(req, res, deps) {
  const { url, anonKey, serviceKey, get, allog, decrypt, generateToken, authenticationTest, test } = deps;
  const fetcher = deps.fetch || globalThis.fetch;
  const respond = (code, body) => { res.setHeader?.('Cache-Control', 'no-store'); return res.status(code).json(body); };
  const action = req.query?.action;
  if (!['support_status', 'support_verify', 'support_validate'].includes(action)) return respond(400, { error: 'Unknown support action' });
  const propertyId = req.body?.property_id;
  if (typeof propertyId !== 'string' || !/^[0-9a-f-]{36}$/i.test(propertyId)) return respond(400, { error: 'Valid property_id required' });
  const jwt = /^Bearer (.+)$/.exec(req.headers.authorization || req.headers.Authorization || '')?.[1];
  if (!jwt) return respond(401, { error: 'Admin sign-in required' });
  try {
    const auth = await fetcher(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${jwt}` } });
    if (!auth.ok) return respond(401, { error: 'Admin session expired' });
    const user = await auth.json();
    if (!user?.id) return respond(401, { error: 'Admin session expired' });
    const admin = await fetcher(`${url}/rest/v1/rpc/is_admin`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}' });
    if (!admin.ok || await admin.json() !== true) return respond(403, { error: 'Admin access required' });
    const [property] = await get(`properties?id=eq.${encodeURIComponent(propertyId)}&select=id,name,alloggiati_autofile_mode,checkin_time,is_test,deleted_at&limit=1`);
    if (!property || property.deleted_at || property.is_test) return respond(404, { error: 'Active non-test property not found' });
    // Existing audit table: view records identify the admin, property and time.
    const audit = await fetcher(`${url}/rest/v1/admin_impersonation_log`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ admin_id: user.id, admin_email: user.email || null, property_id: propertyId, action: 'view' }) });
    if (!audit.ok) return respond(503, { error: 'Support audit unavailable. Retry before continuing.' });
    const scope = `property_id=eq.${encodeURIComponent(propertyId)}`;
    if (action === 'support_status') {
      const [credentials, records, history] = await Promise.all([
        get(`host_alloggiati_credentials?${scope}&select=verified_at,wskey_expires_at,last_error,updated_at&limit=1`),
        get(`checkins?${scope}&is_test=eq.false&deleted_at=is.null&select=${RECORD_FIELDS}&order=submitted_at.desc,id.asc&limit=201`),
        get(`alloggiati_filing_log?${scope}&select=id,run_at,trigger,outcome,error_code,error_detail,checkin_ids&order=run_at.desc,id.asc&limit=51`),
      ]);
      const connection = credentials[0];
      return respond(200, { property: { id: property.id, name: property.name, mode: property.alloggiati_autofile_mode || 'off' }, connection: { configured: !!connection, verified_at: connection?.verified_at || null, wskey_expires_at: connection?.wskey_expires_at || null, updated_at: connection?.updated_at || null, last_error: redactSupport(connection?.last_error) }, records: records.slice(0, 200).map(row => ({ ...row, autofile_last_error: redactSupport(row.autofile_last_error), past_automatic_window: allog.autofileDueAt(row, property, new Date()) === null })), history: history.slice(0, 50).map(row => ({ ...row, error_detail: redactSupport(row.error_detail) })), records_truncated: records.length > 200, history_truncated: history.length > 50 });
    }
    let records, batch;
    if (action === 'support_validate') {
      const id = req.body?.checkin_id;
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return respond(400, { error: 'Select a check-in record to validate' });
      const [target] = await get(`checkins?${scope}&id=eq.${encodeURIComponent(id)}&is_test=eq.false&deleted_at=is.null&select=id,booking_code&limit=1`);
      if (!target) return respond(404, { error: 'Check-in is not available in this property' });
      const bookingScope = target.booking_code ? `booking_code=eq.${encodeURIComponent(target.booking_code)}` : `id=eq.${encodeURIComponent(id)}`;
      records = await get(`checkins?${scope}&${bookingScope}&is_test=eq.false&deleted_at=is.null&select=${BUILD_FIELDS}&order=submitted_at.asc,id.asc&limit=201`);
      if (!records.length || records.length > 200) return respond(422, { error: 'Booking must contain 1–200 current guest records' });
      if (records.some(row => row.property_id !== propertyId || row.is_test || row.deleted_at)) return respond(403, { error: 'Check-in scope mismatch' });
      batch = allog.buildBatch(records);
      if (batch.warnings.length) return respond(200, { ok: false, filed: false, stage: 'local_validation', warnings: batch.warnings.map(w => redactSupport(w)), rows: [], message: 'Correct these guest fields in the host console before validating again.' });
    }
    const [encrypted] = await get(`host_alloggiati_credentials?${scope}&select=credentials_enc,credentials_nonce,enc_key_id&limit=1`);
    if (!encrypted) return respond(200, { ok: false, filed: false, stage: 'connection', error_code: 'not_configured', error: 'The host must save their Alloggiati connection in Settings.' });
    let credentials;
    try { credentials = await decrypt(encrypted); }
    catch { return respond(200, { ok: false, filed: false, stage: 'connection', error_code: 'decrypt_failed', error: 'Stored connection cannot be read. The host must re-enter credentials in Settings.' }); }
    const secrets = [credentials.utente, credentials.password, credentials.wskey, ...(records || []).map(row => row.document_number)];
    try {
      const generated = await generateToken(credentials); secrets.push(generated.token);
      if (action === 'support_verify') {
        await authenticationTest({ utente: credentials.utente, token: generated.token });
        return respond(200, { ok: true, filed: false, stage: 'connection', checked_at: new Date().toISOString(), message: 'Connection works now. No guests were filed and no connection settings were changed.' });
      }
      const outcome = await test({ utente: credentials.utente, token: generated.token, rows: batch.lines });
      const responseCountMatches = outcome.perRow?.length === batch.lines.length;
      const rows = batch.rowMeta.map((row, i) => {
        const result = outcome.perRow?.[i];
        return { checkin_id: row.checkin_id, booking_code: row.booking_code, idx: i + 1, ok: responseCountMatches && result?.ok === true, error_code: !responseCountMatches ? 'response_mismatch' : result?.code || 'no_response', message: redactSupport(result?.erroreDes || '', secrets), detail: redactSupport(result?.erroreDet || '', secrets) };
      });
      return respond(200, { ok: outcome.overall?.ok === true && responseCountMatches && rows.every(row => row.ok), filed: false, stage: 'portal_validation', checked_at: new Date().toISOString(), overall: { ok: outcome.overall?.ok === true, error_code: outcome.overall?.code, message: redactSupport(outcome.overall?.erroreDes, secrets), detail: redactSupport(outcome.overall?.erroreDet, secrets) }, rows, past_automatic_window: records.some(row => allog.autofileDueAt(row, property, new Date()) === null), message: 'Validation only. A successful Test is not proof of filing. Correct rejected fields, then review the filing route in the host console.' });
    } catch (error) { return respond(200, { ok: false, filed: false, stage: 'portal', error_code: redactSupport(error.code || 'portal_error', secrets), error: redactSupport(error.message || 'Portal check failed', secrets) }); }
  } catch (_) { return respond(503, { error: 'Support diagnostic data unavailable. Retry; no filing was performed.' }); }
}
