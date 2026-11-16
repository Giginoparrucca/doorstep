// Round 67 Phase 4 — data-subject requests (GDPR Art. 15 access, 17
// erasure, 20 portability). Mounted on /api/admin-host-health (body.action =
// dsar_*), like the billing actions: the caller is checked as admin on the
// server first (verifyAdmin with the caller's JWT). WelcomeBnB is the hosts'
// processor: the admin runs this on the host's instruction or after
// verifying the requester (docs/compliance/DSAR_RUNBOOK.md).
//
//   dsar_export  {email | phone | document, document_links?}
//                → JSON bundle: check-ins, reservations (redacted summary),
//                  marketing consents, chat of the linked bookings, document
//                  photos (metadata; 7-day signed links only when asked), and
//                  the Art. 15 information (purposes, recipients, retention).
//   dsar_erase   {email | phone | document, dry_run (default true), confirm}
//                → rpc dsar_erase on the rows found the same way. Soft
//                  delete + existing sweeps; check-ins filed to Alloggiati
//                  are kept by law (photos removed). A real run needs
//                  confirm = 'CANCELLA'.
//
// Lookups are exact (case-insensitive) after normalising: wildcard
// characters are refused before the database and every candidate row is
// re-checked here, so a pattern can never widen the match. Rate limit: 10
// requests per hour per admin, closed when the counter store is down.
// Every request is recorded through deps.audit (Phase 5 audit log).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
export const DSAR_LIMIT_PER_HOUR = 10;
export const DOCUMENT_LINK_SECONDS = 7 * 24 * 3600;
export const ERASE_CONFIRM = 'CANCELLA';
const PHONE_SCAN_MAX = 50000;

const CHECKIN_FIELDS = 'id,property_id,booking_code,guest_type,surname,name,sex,date_of_birth,place_of_birth,province_of_birth,state_of_birth,birth_province,birth_country,citizenship,document_type,document_number,doc_issue_place,arrival_date,departure_date,nights,residence_country,residence_place,residence_address,residence_postcode,residence_province,fiscal_code,invoice_email,submitted_at,created_at,alloggiati_status,filed_at,filing_method,id_photo_path,selfie_photo_path,is_test';
const RESERVATION_FIELDS = 'id,property_id,platform,booking_code,checkin_date,checkout_date,guest_name,guest_count,contact_email,contact_phone,status,created_at,is_test';
const CONSENT_FIELDS = 'id,property_id,booking_code,guest_name,email,phone,consent_given_at,consent_text_version,withdrawn_at,created_at';
const CHAT_FIELDS = 'id,property_id,booking_code,sender,message,created_at,entry_sensitive';

export const digits = s => String(s || '').replace(/\D/g, '');
// Same phone: one number ends with the other and they share ≥ 8 digits
// (+39 333…, 0039 333…, 333… all match; a short fragment never does).
export function samePhone(a, b) {
  const x = digits(a), y = digits(b);
  if (x.length < 8 || y.length < 8) return false;
  return x.endsWith(y) || y.endsWith(x);
}
export const normDocument = s => String(s || '').toUpperCase().replace(/[\s.\-/]/g, '');

// One identifier per request. Returns { kind, value } or { error }.
export function normalizeQuery(body = {}) {
  const given = ['email', 'phone', 'document'].filter(k => body[k] != null && String(body[k]).trim() !== '');
  if (given.length !== 1) return { error: 'one_identifier' };
  const kind = given[0], raw = String(body[kind]).trim();
  if (raw.length > 120) return { error: 'invalid_identifier' };
  if (kind === 'email') {
    const v = raw.toLowerCase();
    if (!/^[^\s@*%,()"'\\]+@[^\s@*%,()"'\\]+\.[a-z]{2,}$/i.test(v)) return { error: 'invalid_identifier' };
    return { kind, value: v };
  }
  if (kind === 'phone') {
    if (!/^[+\d\s().\-/]+$/.test(raw) || digits(raw).length < 8 || digits(raw).length > 15) return { error: 'invalid_identifier' };
    return { kind, value: digits(raw) };
  }
  const v = normDocument(raw);
  if (!/^[A-Z0-9]{5,20}$/.test(v)) return { error: 'invalid_identifier' };
  return { kind, value: v };
}

// Every row that carries the identifier, re-checked exactly here.
export async function findSubject(q, get) {
  const out = { checkins: [], reservations: [], consents: [] };
  if (q.kind === 'email') {
    // ilike without wildcards (refused above) is a case-insensitive equality,
    // except "_", which the exact re-check below neutralises.
    const v = enc(q.value);
    const [c, r, m] = await Promise.all([
      get(`checkins?invoice_email=ilike.${v}&deleted_at=is.null&select=${CHECKIN_FIELDS}&order=created_at.asc&limit=200`),
      get(`ota_reservations?contact_email=ilike.${v}&deleted_at=is.null&select=${RESERVATION_FIELDS}&order=created_at.asc&limit=200`),
      get(`marketing_consents?email=ilike.${v}&select=${CONSENT_FIELDS}&order=created_at.asc&limit=200`),
    ]);
    const same = s => String(s || '').trim().toLowerCase() === q.value;
    out.checkins = c.filter(x => same(x.invoice_email));
    out.reservations = r.filter(x => same(x.contact_email));
    out.consents = m.filter(x => same(x.email));
  } else if (q.kind === 'phone') {
    // Stored numbers keep their spaces/prefixes ("+39 333 123 4567"), which a
    // text pattern cannot see through: read only id + phone of every row that
    // has one (paged), compare digits here, then load the matching rows.
    const ids = async (table, col, extra) => {
      const hits = [];
      for (let offset = 0; offset < PHONE_SCAN_MAX; offset += 1000) {
        const page = await get(`${table}?${col}=not.is.null${extra}&select=id,${col}&order=id.asc&limit=1000&offset=${offset}`);
        for (const row of page) if (samePhone(row[col], q.value)) hits.push(row.id);
        if (page.length < 1000) return hits;
      }
      throw new Error('phone scan too large');
    };
    const [rid, mid] = await Promise.all([ids('ota_reservations', 'contact_phone', '&deleted_at=is.null'), ids('marketing_consents', 'phone', '')]);
    const byIds = (table, fields, list) => list.length ? get(`${table}?id=in.(${list.slice(0, 200).join(',')})&select=${fields}&order=created_at.asc`) : [];
    [out.reservations, out.consents] = await Promise.all([byIds('ota_reservations', RESERVATION_FIELDS, rid), byIds('marketing_consents', CONSENT_FIELDS, mid)]);
  } else {
    // Stored numbers may keep spaces or dashes ("AB 12345"): let any separator
    // sit between the characters (value is [A-Z0-9] only, so the pattern
    // holds nothing else), then keep only exact matches after normalising.
    const c = await get(`checkins?document_number=ilike.${q.value.split('').join('*')}&deleted_at=is.null&select=${CHECKIN_FIELDS}&order=created_at.asc&limit=500`);
    out.checkins = c.filter(x => normDocument(x.document_number) === q.value);
  }
  return out;
}

// Bookings linked to the subject's rows (for the conversation export/erase).
export function linkedBookings(found) {
  const seen = new Map();
  for (const row of [...found.checkins, ...found.reservations, ...found.consents]) {
    if (!row.booking_code || !UUID.test(String(row.property_id || ''))) continue;
    const k = row.property_id + '|' + row.booking_code;
    if (!seen.has(k)) seen.set(k, { property_id: row.property_id, booking_code: row.booking_code });
  }
  return [...seen.values()];
}

const ART15 = {
  controller: 'The host (struttura) where the stay was booked; WelcomeBnB acts as processor (Art. 28 agreement, Annex A of the host terms).',
  purposes: {
    checkins: 'Guest registration and transmission to the Polizia di Stato (Alloggiati Web, TULPS art. 109); regional tourism statistics; tourist tax.',
    reservations: 'Managing the booking for the host (calendar sync with booking platforms).',
    marketing_consents: 'Host offers, only with the consent given at check-in (withdrawable at any time).',
    chat: 'Answering the guest during the stay (assistant and host).',
    documents: 'Reading the identity document to fill in the registration.',
  },
  legal_basis: { checkins: 'Art. 6(1)(c) legal obligation', reservations: 'Art. 6(1)(b) contract', marketing_consents: 'Art. 6(1)(a) consent', chat: 'Art. 6(1)(b) contract', documents: 'Art. 6(1)(c) legal obligation' },
  recipients: ['Polizia di Stato — Alloggiati Web (registration)', 'Regional statistics office and municipality (anonymous or aggregated data)', 'Sub-processors: Supabase (EU, Ireland), Vercel, Anthropic (assistant), Resend (email) — see docs/compliance/ROPA.md'],
  retention: {
    checkins: 'Kept as required for police registration records once filed; unfiled records deleted on request.',
    documents: 'Photos deleted automatically 7 days after arrival.',
    chat: 'Deleted 90 days after the conversation is resolved.',
    marketing_consents: 'Until withdrawn.',
    analytics: 'Pseudonymous usage events rolled up after 180 days (not linked to name, email or phone).',
  },
  rights: 'Access, rectification, erasure, restriction, portability, objection; complaint to the Garante per la protezione dei dati personali (garanteprivacy.it).',
  source: 'Provided by the guest at check-in or by the booking platform through the host.',
};

export async function buildExport(found, { get, sign, documentLinks = false, now = new Date() }) {
  const bookings = linkedBookings(found);
  const propIds = [...new Set([...found.checkins, ...found.reservations, ...found.consents].map(r => r.property_id).filter(id => UUID.test(String(id))))];
  const [props, chats] = await Promise.all([
    propIds.length ? get(`properties?id=in.(${propIds.map(enc).join(',')})&select=id,name,city`) : [],
    Promise.all(bookings.map(b => get(`chat_messages?property_id=eq.${enc(b.property_id)}&booking_code=eq.${enc(b.booking_code)}&deleted_at=is.null&select=${CHAT_FIELDS}&order=created_at.asc&limit=1000`))),
  ]);
  const documents = [];
  for (const c of found.checkins) {
    for (const [kind, path] of [['id_document', c.id_photo_path], ['selfie', c.selfie_photo_path]]) {
      if (!path) continue;
      const doc = { checkin_id: c.id, kind, stored: true };
      if (documentLinks) {
        try { doc.download_url = await sign(path, DOCUMENT_LINK_SECONDS); doc.link_expires_at = new Date(now.getTime() + DOCUMENT_LINK_SECONDS * 1000).toISOString(); }
        catch (_) { doc.download_url = null; doc.link_error = 'unavailable'; }
      }
      documents.push(doc);
    }
  }
  const strip = ({ id_photo_path, selfie_photo_path, ...rest }) => rest;
  return {
    format: 'welcomebnb-dsar-v1',
    generated_at: now.toISOString(),
    properties: props,
    checkins: found.checkins.map(strip),
    reservations: found.reservations,
    marketing_consents: found.consents,
    chat_messages: chats.flat().map(m => ({ ...m, message: m.entry_sensitive ? '[access code removed]' : m.message })),
    documents,
    information: ART15,
    counts: { checkins: found.checkins.length, reservations: found.reservations.length, marketing_consents: found.consents.length, chat_messages: chats.flat().length, documents: documents.length, bookings: bookings.length },
  };
}

// deps: { get(path), rpc(name,args), sign(path,seconds), take(scope,key,opts), audit(event), now() }
export async function handleDsarAction(action, body, { actor, actorId, deps }) {
  if (action !== 'dsar_export' && action !== 'dsar_erase') return { status: 400, body: { error: 'unknown_action' } };
  const q = normalizeQuery(body || {});
  if (q.error) return { status: 400, body: { error: q.error } };
  const gate = await deps.take('dsar_admin', String(actorId || actor), { windowSeconds: 3600, limit: DSAR_LIMIT_PER_HOUR, onFailure: 'closed' });
  if (!gate.ok) return { status: 429, body: { error: 'rate_limited', retry_after: gate.retry_after } };
  const found = await findSubject(q, deps.get);
  const base = { actor, action, identifier_kind: q.kind };
  if (action === 'dsar_export') {
    const bundle = await buildExport(found, { get: deps.get, sign: deps.sign, documentLinks: body.document_links === true, now: deps.now ? new Date(deps.now()) : new Date() });
    await deps.audit({ ...base, outcome: 'exported', counts: bundle.counts, document_links: body.document_links === true });
    return { status: 200, body: bundle };
  }
  const dry = body.dry_run !== false;
  if (!dry && body.confirm !== ERASE_CONFIRM) return { status: 400, body: { error: 'confirm_required' } };
  const bookings = linkedBookings(found);
  const result = await deps.rpc('dsar_erase', {
    p_checkin_ids: found.checkins.map(c => c.id), p_consent_ids: found.consents.map(c => c.id),
    p_reservation_ids: found.reservations.map(r => r.id), p_chat_bookings: bookings, p_dry_run: dry,
  });
  await deps.audit({ ...base, outcome: dry ? 'erase_preview' : 'erased', counts: { checkins_erased: result.checkins_erased, checkins_retained: (result.checkins_retained || []).length, photos_queued: result.photos_queued, consents_withdrawn: result.consents_withdrawn, reservations_redacted: result.reservations_redacted, chat_messages_erased: result.chat_messages_erased } });
  return { status: 200, body: { ...result, found: { checkins: found.checkins.length, reservations: found.reservations.length, marketing_consents: found.consents.length, bookings: bookings.length } } };
}
