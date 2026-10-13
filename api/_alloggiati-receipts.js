// Round 52: receipt recovery only. No Test, Send, claims or notifications.
import { assertLiveIntegration, SUPABASE_URL } from './_environment.js';
import { decryptCredentials } from './_alloggiati-crypto.js';
import { generateToken, ricevuta } from './_alloggiati-soap.js';

export function romeDate(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = name => parts.find(p => p.type === name).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function receiptWindow(now) {
  const today = romeDate(now);
  const cutoff = new Date(today + 'T12:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  return { today, oldest: cutoff.toISOString().slice(0, 10) };
}
export function validReceipt(pdf) {
  return Buffer.isBuffer(pdf) && pdf.length >= 100 && pdf.length <= 10 * 1024 * 1024 && pdf.subarray(0, 5).toString() === '%PDF-';
}

// Dependencies are injectable for tests; callers cannot supply them over HTTP.
export async function collectReceipts({ budgetMs = 12000, now = new Date() } = {}, deps = {}) {
  (deps.gate || assertLiveIntegration)('alloggiati');
  const transport = deps.fetch || fetch;
  const url = deps.url || SUPABASE_URL;
  const key = deps.key || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('receipt_service_key_missing');
  const clock = deps.clock || Date.now;
  const deadline = clock() + Math.min(30000, Math.max(0, budgetMs));
  const summary = { dates_pending: 0, dates_attached: 0, rows_attached: 0, downloads: 0, errors: 0, deferred: 0 };
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const timeout = () => {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new Error('receipt_budget');
    return Math.max(1, Math.min(5000, remaining));
  };
  async function request(path, init = {}) {
    return transport(url + path, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(timeout()) });
  }
  async function get(query) {
    const r = await request('/rest/v1/' + query, { headers: { Prefer: 'count=exact' } });
    if (!r.ok) throw new Error('receipt_database_read');
    const rows = await r.json();
    const total = Number(r.headers.get('content-range')?.split('/')[1]);
    return { rows, total: Number.isFinite(total) ? total : rows.length };
  }
  const { today, oldest } = receiptWindow(now);
  // Broad UTC floor includes Rome's first local day across offset/DST changes.
  const floor = new Date(now.getTime() - 31 * 86400000).toISOString();
  const query = 'checkins?is_test=eq.false&deleted_at=is.null&alloggiati_status=eq.filed&receipt_path=is.null' +
    `&filed_at=gte.${encodeURIComponent(floor)}&select=id,property_id,filed_at,is_test,deleted_at,alloggiati_status,receipt_path&order=filed_at.asc,id.asc&limit=100`;
  let page;
  try {
    page = await get(query);
    const pages = Math.ceil(page.total / 100);
    // Rotate missing-row pages every tick, including unproven legacy records.
    const offset = pages > 1 ? (Math.floor(now.getTime() / 600000) % pages) * 100 : 0;
    if (offset) page = await get(query + '&offset=' + offset);
  } catch (_) { summary.errors++; return summary; }
  const candidates = page.rows.filter(r => {
    if (r.is_test !== false || r.deleted_at || r.alloggiati_status !== 'filed' || r.receipt_path || !r.filed_at) return false;
    const date = romeDate(new Date(r.filed_at));
    return date >= oldest && date < today;
  });
  if (!candidates.length) return summary;
  const ids = candidates.map(r => r.id).join(',');
  let logs;
  try {
    const audit = await get('alloggiati_filing_log?trigger=in.(host,autofile)&outcome=in.(filed,filed_stamp_desync,stamp_desync)' +
      `&run_at=gte.${encodeURIComponent(floor)}&checkin_ids=ov.${encodeURIComponent('{' + ids + '}')}` +
      '&select=property_id,checkin_ids,run_at,trigger,outcome&order=run_at.desc&limit=1000');
    if (audit.total > 1000) throw new Error('receipt_audit_limit');
    logs = audit.rows;
  } catch (_) { summary.errors++; return summary; }
  const jobs = new Map();
  for (const row of candidates) {
    // Match the actual filing, including the midnight boundary between stamp
    // and audit insert. A later correction/resubmission timestamp must not
    // inherit proof from a previous submission.
    const filed = Date.parse(row.filed_at);
    const proven = logs.some(l => l.property_id === row.property_id && ['host', 'autofile'].includes(l.trigger) &&
      ['filed', 'filed_stamp_desync', 'stamp_desync'].includes(l.outcome) && l.checkin_ids?.includes(row.id) &&
      Date.parse(l.run_at) >= filed - 5000 && Date.parse(l.run_at) <= filed + 300000);
    if (!proven) continue;
    const date = romeDate(new Date(row.filed_at)), id = row.property_id + '/' + date;
    if (!jobs.has(id)) jobs.set(id, { property: row.property_id, date, rows: [] });
    jobs.get(id).rows.push(row);
  }
  const pending = [...jobs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.property.localeCompare(b.property));
  summary.dates_pending = pending.length;
  // Fair retry order: an unavailable portal date cannot monopolise the budget.
  const rotate = pending.length ? Math.floor(now.getTime() / 600000) % pending.length : 0;
  const ordered = pending.slice(rotate).concat(pending.slice(0, rotate));
  const auth = new Map();
  async function storedPdf(path) {
    const r = await request('/storage/v1/object/receipts/' + path);
    if (r.status === 404) return null;
    if (r.status === 400) {
      const error = await r.json().catch(() => ({}));
      if (String(error.statusCode) === '404') return null;
    }
    if (!r.ok) throw new Error('receipt_storage_read');
    const pdf = Buffer.from(await r.arrayBuffer());
    if (!validReceipt(pdf)) throw new Error('receipt_invalid_pdf');
    return pdf;
  }
  for (let i = 0; i < ordered.length; i++) {
    if (deadline - clock() < 1000) { summary.deferred += ordered.length - i; break; }
    const job = ordered[i], path = `${job.property}/alloggiati-${job.date}.pdf`;
    try {
      // A deleted property or removed/unverified credentials do not authorise
      // new downloads; never depend on the property's current autofile mode.
      const prop = await get('properties?id=eq.' + job.property + '&deleted_at=is.null&select=id&limit=1');
      if (!prop.rows.length) continue;
      if (!auth.has(job.property)) {
        const creds = await get('host_alloggiati_credentials?property_id=eq.' + job.property + '&verified_at=not.is.null&select=credentials_enc,credentials_nonce,enc_key_id&limit=1');
        if (!creds.rows.length) { auth.set(job.property, null); continue; }
        auth.set(job.property, { creds: await (deps.decrypt || decryptCredentials)(creds.rows[0]), token: null });
      }
      const session = auth.get(job.property);
      if (!session) continue;
      if (!await storedPdf(path)) {
        if (!session.token) session.token = (await (deps.token || generateToken)(session.creds, { timeoutMs: timeout() })).token;
        const receipt = await (deps.receipt || ricevuta)({ utente: session.creds.utente, token: session.token, date: job.date }, { timeoutMs: timeout() });
        if (!validReceipt(receipt.pdf)) throw new Error('receipt_invalid_pdf');
        summary.downloads++;
        const upload = await request('/storage/v1/object/receipts/' + path, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: receipt.pdf });
        // Concurrent workers can both fetch, but cannot overwrite the object.
        if (!upload.ok) {
          const error = await upload.json().catch(() => ({}));
          const duplicate = upload.status === 409 || String(error.statusCode) === '409' || error.error === 'Duplicate';
          if (!duplicate || !await storedPdf(path)) throw new Error('receipt_storage_upload');
        }
      }
      let attached = 0;
      // Group identical stamp values to keep a changed/resubmitted row out
      // of the conditional PATCH even when another worker is attaching.
      const stamps = new Map();
      for (const row of job.rows) { if (!stamps.has(row.filed_at)) stamps.set(row.filed_at, []); stamps.get(row.filed_at).push(row.id); }
      for (const [stamp, rowIds] of stamps) {
        const filter = 'checkins?property_id=eq.' + job.property + '&id=in.(' + rowIds.join(',') + ')' +
          '&is_test=eq.false&deleted_at=is.null&alloggiati_status=eq.filed&receipt_path=is.null&filed_at=eq.' + encodeURIComponent(stamp) + '&select=id';
        const patch = await request('/rest/v1/' + filter, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ receipt_path: path }) });
        if (!patch.ok) throw new Error('receipt_attachment');
        attached += (await patch.json()).length;
      }
      if (attached) { summary.dates_attached++; summary.rows_attached += attached; }
    } catch (_) { summary.errors++; } // never log credential/portal payloads
  }
  return summary;
}
