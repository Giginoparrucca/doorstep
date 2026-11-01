// Round 69 Phase 2 — host terms of service: status, one-time email code,
// acceptance. Mounted on the existing /api/guest function through the
// /api/host-terms rewrite (the hosting plan allows 12 functions; all used).
// Specification: PLAN_round69_host_terms.md.
//
// Every action needs a valid host session (Supabase JWT). The database
// enforces the rest: evidence rows are append-only and writable only by the
// service role (migration 20261101090000_round69_host_terms.sql).
//
// HOST_TERMS_ENFORCE (server env, default off): off → status always reports
// accepted, so the console never shows the window. HOST_TERMS_PEPPER keys the
// code hashes; without it no code can be issued or checked.
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY, APP_BASE_URL } from './_environment.js';
import { supabaseAuthHeaders } from './_supabase-auth.js';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LIMIT_15_MIN = 3;
const LIMIT_DAY = 10;
const METHOD = 'password_login+email_otp';

const MESSAGES = {
  it: {
    auth: 'Accedi di nuovo per continuare.',
    unavailable: 'Servizio momentaneamente non disponibile. Riprova tra poco.',
    bad_request: 'Richiesta non valida. Ricarica la pagina e riprova.',
    stale: 'Le Condizioni sono state aggiornate. Ricarica la pagina per leggere la versione attuale.',
    host_kind: 'Indica se usi WelcomeBnB con partita IVA o come privato.',
    approvals: "Per continuare devi accettare le Condizioni e approvare specificamente le clausole elencate.",
    already: 'Hai già accettato la versione attuale delle Condizioni.',
    rate: 'Hai richiesto troppi codici. Riprova più tardi.',
    email: "Non siamo riusciti a inviare l'email con il codice. Riprova tra poco.",
    code_invalid: 'Codice non corretto. Controlla l’email e riprova.',
    code_expired: 'Il codice è scaduto. Richiedine uno nuovo.',
    code_missing: 'Richiedi prima un codice.',
    attempts: 'Troppi tentativi con questo codice. Richiedine uno nuovo.',
  },
  en: {
    auth: 'Please sign in again to continue.',
    unavailable: 'Service temporarily unavailable. Please try again shortly.',
    bad_request: 'Invalid request. Reload the page and try again.',
    stale: 'The Terms have been updated. Reload the page to read the current version.',
    host_kind: 'Tell us whether you use WelcomeBnB with a VAT number or as a private person.',
    approvals: 'To continue you must accept the Terms and specifically approve the listed clauses.',
    already: 'You have already accepted the current version of the Terms.',
    rate: 'Too many codes requested. Please try again later.',
    email: 'We could not send the email with the code. Please try again shortly.',
    code_invalid: 'Incorrect code. Check your email and try again.',
    code_expired: 'The code has expired. Request a new one.',
    code_missing: 'Request a code first.',
    attempts: 'Too many attempts with this code. Request a new one.',
  },
};

export function defaultHostTermsDeps() {
  return {
    fetch: globalThis.fetch,
    now: () => Date.now(),
    randomCode: () => String(randomInt(0, 1000000)).padStart(6, '0'),
    supabaseUrl: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey: process.env.RESEND_API_KEY,
    from: process.env.REMINDER_FROM || 'WelcomeBnB <notifiche@welcomebnb.it>',
    pepper: process.env.HOST_TERMS_PEPPER,
    enforce: process.env.HOST_TERMS_ENFORCE === 'true',
    appBaseUrl: APP_BASE_URL || 'https://app.welcomebnb.it',
  };
}

export const hashCode = (code, pepper) => createHmac('sha256', pepper).update(String(code)).digest('hex');

export async function handleHostTerms(req, res, deps = defaultHostTermsDeps()) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization, Origin');
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const lang = body.lang === 'en' ? 'en' : 'it';
  const fail = (status, key) => res.status(status).json({ error: key, message: MESSAGES[lang][key] });
  const action = body.action;
  if (!['status', 'request_code', 'accept'].includes(action)) return fail(400, 'bad_request');
  if (!deps.serviceKey || !deps.supabaseUrl) return fail(503, 'unavailable');

  // 1. Who is calling: Supabase validates the session token.
  const header = req.headers?.authorization || req.headers?.Authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length < 20) return fail(401, 'auth');
  let user;
  try {
    const r = await deps.fetch(`${deps.supabaseUrl}/auth/v1/user`, { headers: { apikey: deps.anonKey, Authorization: header } });
    if (!r.ok) return fail(401, 'auth');
    user = await r.json();
  } catch (_) { return fail(503, 'unavailable'); }
  if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') return fail(401, 'auth');

  const rest = (path, init = {}) => deps.fetch(`${deps.supabaseUrl}/rest/v1/${path}`, {
    ...init, headers: { ...supabaseAuthHeaders(deps.serviceKey), 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const rows = async (path) => {
    const r = await rest(path);
    if (!r.ok) throw Error('read failed');
    const data = await r.json();
    if (!Array.isArray(data)) throw Error('read failed');
    return data;
  };
  const enc = encodeURIComponent;

  try {
    // 2. Current version and this host's evidence.
    const nowIso = new Date(deps.now()).toISOString();
    const [current] = await rows(`legal_documents?kind=eq.host_terms&published_at=lte.${enc(nowIso)}` +
      '&select=id,version,file_path,text_sha256,annex_file_path,annex_sha256,specific_clauses,requires_reacceptance,published_at&order=version.desc&limit=1');
    const mine = await rows(`host_terms_acceptances?host_id=eq.${enc(user.id)}&select=id,version,document_id,created_at&order=version.desc`);
    const acceptedCurrent = !!current && mine.some(a => a.document_id === current.id);
    const accepted = acceptedCurrent || (!!current && current.requires_reacceptance === false && mine.length > 0);
    const publicCurrent = current ? {
      version: current.version, sha256: current.text_sha256, file_path: current.file_path,
      annex_file_path: current.annex_file_path, annex_sha256: current.annex_sha256,
      clauses: current.specific_clauses, published_at: current.published_at,
    } : null;

    if (action === 'status') {
      if (!current && deps.enforce) return fail(503, 'unavailable'); // fail closed when enforced
      const last = mine[0] || null;
      return res.status(200).json({
        enforce: deps.enforce, accepted: deps.enforce ? accepted : true, current: publicCurrent,
        accepted_version: last ? last.version : null, accepted_at: last ? last.created_at : null,
      });
    }
    if (!current) return fail(503, 'unavailable');
    if (!deps.pepper) return fail(503, 'unavailable');

    if (action === 'request_code') {
      if (acceptedCurrent) return fail(409, 'already');
      const since = t => enc(new Date(deps.now() - t).toISOString());
      const recent = await rows(`host_terms_codes?host_id=eq.${enc(user.id)}&created_at=gte.${since(86400000)}&select=created_at`);
      const last15 = recent.filter(c => Date.parse(c.created_at) >= deps.now() - 15 * 60000).length;
      if (recent.length >= LIMIT_DAY || last15 >= LIMIT_15_MIN) return fail(429, 'rate');
      const code = deps.randomCode();
      const ins = await rest('host_terms_codes', { method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ host_id: user.id, document_id: current.id, code_hash: hashCode(code, deps.pepper),
          expires_at: new Date(deps.now() + CODE_TTL_MS).toISOString() }) });
      if (!ins.ok) return fail(503, 'unavailable');
      const [codeRow] = await ins.json();
      const sent = await sendEmail(deps, {
        to: user.email, subject: 'Codice di conferma Condizioni WelcomeBnB',
        text: `Il tuo codice per confermare le Condizioni Generali di Servizio WelcomeBnB (versione ${current.version}) è: ${code}\n\n` +
          'Il codice vale 10 minuti. Se non hai richiesto tu questo codice, ignora questa email.\n\n' +
          `Your code to confirm the WelcomeBnB Terms of Service (version ${current.version}) is: ${code}. It is valid for 10 minutes.`,
      });
      if (!sent.ok) {
        if (codeRow?.id) await rest(`host_terms_codes?id=eq.${enc(codeRow.id)}`, { method: 'DELETE' }).catch(() => {});
        return fail(502, 'email');
      }
      return res.status(200).json({ sent: true, expires_in: CODE_TTL_MS / 1000 });
    }

    // action === 'accept'
    if (acceptedCurrent) return res.status(200).json({ accepted: true, already: true, version: current.version });
    if (body.version !== current.version || body.sha256 !== current.text_sha256) return fail(409, 'stale');
    if (!['business', 'private'].includes(body.host_kind)) return fail(400, 'host_kind');
    if (body.general !== true || body.specific !== true) return fail(400, 'approvals');
    if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return fail(400, 'code_invalid');

    const [codeRow] = await rows(`host_terms_codes?host_id=eq.${enc(user.id)}&document_id=eq.${enc(current.id)}` +
      '&used_at=is.null&select=id,code_hash,expires_at,attempts&order=created_at.desc&limit=1');
    if (!codeRow) return fail(400, 'code_missing');
    if (codeRow.attempts >= MAX_ATTEMPTS) return fail(429, 'attempts');
    if (Date.parse(codeRow.expires_at) <= deps.now()) return fail(400, 'code_expired');
    const given = Buffer.from(hashCode(body.code, deps.pepper), 'hex');
    const stored = Buffer.from(String(codeRow.code_hash), 'hex');
    if (stored.length !== given.length || !timingSafeEqual(stored, given)) {
      // Count the attempt; the filter on the old value makes concurrent wrong guesses each count.
      await rest(`host_terms_codes?id=eq.${enc(codeRow.id)}&attempts=eq.${codeRow.attempts}`, {
        method: 'PATCH', body: JSON.stringify({ attempts: codeRow.attempts + 1 }) });
      return fail(codeRow.attempts + 1 >= MAX_ATTEMPTS ? 429 : 400, codeRow.attempts + 1 >= MAX_ATTEMPTS ? 'attempts' : 'code_invalid');
    }
    const used = await rest(`host_terms_codes?id=eq.${enc(codeRow.id)}&used_at=is.null`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: nowIso }) });
    if (!used.ok || !(await used.json()).length) return fail(400, 'code_invalid');

    const tick = v => { const t = Date.parse(v); return Number.isFinite(t) && t <= deps.now() && t >= deps.now() - 2 * 3600000 ? new Date(t).toISOString() : nowIso; };
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const evidence = {
      host_id: user.id, document_id: current.id, version: current.version,
      text_sha256: current.text_sha256, annex_sha256: current.annex_sha256 || null,
      accepted_general_at: tick(body.general_at), approved_specific_at: tick(body.specific_at), otp_verified_at: nowIso,
      host_kind: body.host_kind, method: METHOD, account_email: user.email,
      ip: /^[0-9a-fA-F:.]{3,45}$/.test(forwarded) ? forwarded : null,
      user_agent: String(req.headers?.['user-agent'] || '').slice(0, 512) || null,
    };
    const ins = await rest('host_terms_acceptances', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(evidence) });
    if (ins.status === 409) return res.status(200).json({ accepted: true, already: true, version: current.version });
    if (!ins.ok) return fail(503, 'unavailable');
    const [row] = await ins.json();

    // 3. Receipt: what was accepted, when, and the text itself.
    const receipt = await sendReceipt(deps, user.email, current, row, body.host_kind).catch(() => ({ ok: false }));
    if (receipt.ok && receipt.id && row?.id) {
      await rest(`host_terms_acceptances?id=eq.${enc(row.id)}&receipt_email_id=is.null`, {
        method: 'PATCH', body: JSON.stringify({ receipt_email_id: String(receipt.id).slice(0, 200) }) }).catch(() => {});
    }
    return res.status(200).json({ accepted: true, version: current.version, accepted_at: row?.created_at || nowIso, receipt_sent: !!receipt.ok });
  } catch (_) {
    return fail(503, 'unavailable');
  }
}

async function sendEmail(deps, { to, subject, text, attachments }) {
  if (!deps.resendKey) return { ok: false };
  try {
    const r = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${deps.resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: deps.from, to: [to], subject, text, ...(attachments ? { attachments } : {}) }),
    });
    if (!r.ok) return { ok: false };
    const data = await r.json().catch(() => ({}));
    return { ok: true, id: data?.id || null };
  } catch (_) { return { ok: false }; }
}

// Attach the exact accepted texts when the served bytes still match the
// recorded hashes; otherwise send the link and the hashes only.
async function sendReceipt(deps, to, doc, row, hostKind) {
  const when = new Date(row?.created_at || deps.now()).toLocaleString('it-IT', { timeZone: 'Europe/Rome',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const base = deps.appBaseUrl.replace(/\/$/, '');
  const attachments = [];
  for (const [path, sha] of [[doc.file_path, doc.text_sha256], [doc.annex_file_path, doc.annex_sha256]]) {
    if (!path || !sha) continue;
    try {
      const r = await deps.fetch(`${base}/${path}`);
      const bytes = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
      if (bytes && createHash('sha256').update(bytes).digest('hex') === sha) {
        attachments.push({ filename: path.split('/').pop(), content: bytes.toString('base64') });
      }
    } catch (_) { /* link and hash below still identify the text */ }
  }
  const clauses = (Array.isArray(doc.specific_clauses) ? doc.specific_clauses : [])
    .map(c => `- art. ${c.ref} — ${c.label}`).join('\n');
  const text = [
    `Hai accettato le Condizioni Generali di Servizio WelcomeBnB, versione ${doc.version}, il ${when} (ora italiana).`,
    '',
    `Dichiarazione: ${hostKind === 'business' ? 'uso con partita IVA (attività imprenditoriale o professionale)' : 'uso come privato, senza partita IVA'}.`,
    '',
    'Hai approvato specificamente, ai sensi degli artt. 1341 e 1342 c.c., queste clausole:',
    clauses,
    '',
    'Conferma con codice monouso inviato a questo indirizzo email.',
    `Testo: ${base}/${doc.file_path} (SHA-256 ${doc.text_sha256})`,
    doc.annex_file_path ? `Allegato A: ${base}/${doc.annex_file_path} (SHA-256 ${doc.annex_sha256})` : '',
    attachments.length ? 'I testi accettati sono allegati a questa email.' : '',
    '',
    'You accepted the WelcomeBnB Terms of Service above; the Italian text is the binding version.',
  ].filter(l => l !== null).join('\n');
  return sendEmail(deps, { to, subject: `Copia delle Condizioni WelcomeBnB accettate (versione ${doc.version})`, text,
    attachments: attachments.length ? attachments : undefined });
}
