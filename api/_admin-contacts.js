// Round 77 — host contacts (mini-CRM), admin-only. Actions on
// /api/admin-host-health (admin check, rate limit and admin log there):
//   contacts_list                         → contacts with derived data and notes
//   contacts_create   { full_name, phone, email, source, lead_stage, next_action, next_action_due }
//   contacts_update   { id, ...fields }   (e-mail of an account contact is its login: read-only)
//   contacts_delete   { id }              (prospects only: account rows are re-created by the sync)
//   contacts_note_add { contact_id, body }
//   contacts_note_delete { id }
// Server-side validation mirrors the table checks; a write that touches no
// row is an error (the RLS/GRANT symptom the brief warns about).

export const SOURCES = ['whatsapp', 'email', 'referral', 'website', 'event', 'ads', 'other'];
export const STAGES = ['lead', 'contacted', 'demo', 'invited', 'lost'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const DAY = 86400000;

// Same rules as public.host_contacts_phone() and admin-contacts.js.
export function normPhone(input) {
  let s = String(input == null ? '' : input).replace(/[\s.()\-]/g, '');
  if (!s) return { ok: true, value: null };
  if (s.startsWith('00')) s = '+' + s.slice(2);
  else if (/^[30]/.test(s)) s = '+39' + s;
  if (/^\+[1-9]\d{6,14}$/.test(s)) return { ok: true, value: s };
  return { ok: false, error: 'Numero non valido: usa il formato internazionale, per esempio +39 333 123 4567.' };
}

function romeYmd(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d); }
const validYmd = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

// Validate the editable fields present in body. → { ok, row } | { ok:false, error }
export function cleanFields(body = {}, { creating = false, account = false } = {}) {
  const row = {};
  const has = k => Object.prototype.hasOwnProperty.call(body, k);
  const text = (k, max) => {
    if (!has(k)) return true;
    const v = body[k] == null ? '' : String(body[k]).trim();
    if (v.length > max) return false;
    row[k] = v || null; return true;
  };
  if (!text('full_name', 200)) return { ok: false, error: 'Nome troppo lungo (massimo 200 caratteri).' };
  if (!text('next_action', 500)) return { ok: false, error: 'Prossima azione troppo lunga (massimo 500 caratteri).' };
  if (has('email')) {
    if (account) return { ok: false, error: 'L’email di un account è quella di accesso: si cambia da Utenti → Gestisci.' };
    const v = String(body.email || '').trim().toLowerCase();
    if (v && (!EMAIL.test(v) || v.length > 254)) return { ok: false, error: 'Email non valida.' };
    row.email = v || null;
  }
  if (has('phone')) { const p = normPhone(body.phone); if (!p.ok) return p; row.phone = p.value; }
  if (has('source')) {
    const v = body.source == null || body.source === '' ? null : String(body.source);
    if (v !== null && !SOURCES.includes(v)) return { ok: false, error: 'Origine non valida.' };
    row.source = v;
  }
  if (has('lead_stage')) {
    if (!STAGES.includes(String(body.lead_stage))) return { ok: false, error: 'Fase non valida.' };
    row.lead_stage = String(body.lead_stage);
  }
  if (has('next_action_due')) {
    const v = body.next_action_due == null || body.next_action_due === '' ? null : String(body.next_action_due);
    if (v !== null && !validYmd(v)) return { ok: false, error: 'Data non valida.' };
    row.next_action_due = v;
  }
  if (creating && !row.full_name && !row.phone && !row.email) return { ok: false, error: 'Serve almeno un nome, un telefono o un’email.' };
  if (!creating && !Object.keys(row).length) return { ok: false, error: 'Nessun campo da salvare.' };
  return { ok: true, row };
}

// Derived status badge. Account → from the subscription (as the Utenti tab):
// trial (days left) / paying / free / expired / read_only; no account → lead stage.
export function contactStatus(c, billing, now = Date.now()) {
  if (!c.user_id) return { kind: 'lead', stage: c.lead_stage || 'lead' };
  const st = billing && billing.state, sub = billing && billing.subscription;
  const days = iso => Math.ceil((new Date(iso).getTime() - now) / DAY);
  if (st && st.state === 'free') return { kind: 'free', admin: st.reason === 'admin' };
  if (sub && sub.status === 'free_forever') return { kind: 'free' };
  if (st && st.state === 'read_only') return { kind: 'read_only' };
  if (st && st.state === 'grace') return { kind: 'expired', grace_days: st.grace_days_left ?? null };
  if (st && st.state === 'active') return { kind: 'paying', until: st.paid_until || null };
  if (sub && sub.status === 'active' && sub.paid_until && new Date(sub.paid_until).getTime() > now) return { kind: 'paying', until: sub.paid_until };
  if (st && st.state === 'trial') return { kind: 'trial', days_left: st.days_left ?? (st.trial_ends_at ? days(st.trial_ends_at) : null) };
  if (sub && sub.trial_ends_at) { const d = days(sub.trial_ends_at); return d > 0 ? { kind: 'trial', days_left: d } : { kind: 'expired' }; }
  return { kind: 'account' };
}

// deps: { sync(), contacts(), notes(), properties(), users() → [{id,email,last_sign_in_at}],
//         billing(ids) → {byOwner}, insert(table,row) → rows, update(table,id,row) → rows,
//         remove(table,id) → rows, now() }
export async function handleContactsAction(action, body = {}, { actor = 'admin', deps } = {}) {
  const now = deps.now ? deps.now() : Date.now();
  if (action === 'contacts_list') {
    try { await deps.sync(); } catch (_) { /* list still works; new accounts appear next time */ }
    const [contacts, notes, props, users] = await Promise.all([deps.contacts(), deps.notes(), deps.properties(), deps.users()]);
    const ids = contacts.filter(c => c.user_id).map(c => c.user_id);
    let billing = {}, billingError = null;
    try { billing = ids.length ? ((await deps.billing(ids, new Date(now))).byOwner || {}) : {}; } catch (e) { billingError = 'billing_unavailable'; }
    const userBy = new Map(users.map(u => [u.id, u]));
    const rows = contacts.map(c => {
      const own = c.user_id ? props.filter(p => p.owner_id === c.user_id) : [];
      const mine = notes.filter(n => n.contact_id === c.id);
      const u = c.user_id ? userBy.get(c.user_id) : null;
      return { ...c, account: !!c.user_id, login_email: u ? u.email || null : null, last_login_at: u ? u.last_sign_in_at || null : null,
        properties: own.map(p => ({ id: p.id, name: p.name || '—', test: !!p.is_test })),
        status: contactStatus(c, billing[c.user_id], now), billing: c.user_id ? billing[c.user_id] || null : null,
        notes: mine.slice(0, 100), last_note_at: mine.length ? mine[0].created_at : null };
    });
    return { status: 200, body: { generated_at: new Date(now).toISOString(), today: romeYmd(new Date(now)), contacts: rows, billing_error: billingError }, audit: { rows: rows.length } };
  }
  if (action === 'contacts_create') {
    const f = cleanFields(body, { creating: true });
    if (!f.ok) return { status: 400, body: { error: f.error } };
    if (f.row.lead_stage === undefined) f.row.lead_stage = 'lead';
    const r = await deps.insert('host_contacts', f.row);
    if (r.conflict) return { status: 409, body: { error: 'Esiste già un contatto con questa email.' } };
    if (!r.rows || !r.rows.length) return { status: 500, body: { error: 'Contatto non salvato (nessuna riga scritta).' } };
    return { status: 201, body: { contact: r.rows[0] }, audit: { target: r.rows[0].id, fields: Object.keys(f.row) } };
  }
  if (action === 'contacts_update') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, body: { error: 'Contatto non valido.' } };
    const current = (await deps.contacts(body.id))[0];
    if (!current) return { status: 404, body: { error: 'Contatto non trovato.' } };
    const fields = { ...body }; delete fields.id; delete fields.action;
    const f = cleanFields(fields, { account: !!current.user_id });
    if (!f.ok) return { status: 400, body: { error: f.error } };
    const r = await deps.update('host_contacts', body.id, f.row);
    if (r.conflict) return { status: 409, body: { error: 'Esiste già un contatto con questa email.' } };
    if (!r.rows || !r.rows.length) return { status: 409, body: { error: 'Nessuna riga aggiornata: ricarica e riprova.' } };
    return { status: 200, body: { contact: r.rows[0] }, audit: { target: body.id, fields: Object.keys(f.row) } };
  }
  if (action === 'contacts_delete') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, body: { error: 'Contatto non valido.' } };
    const current = (await deps.contacts(body.id))[0];
    if (!current) return { status: 404, body: { error: 'Contatto non trovato.' } };
    if (current.user_id) return { status: 409, body: { error: 'Il contatto di un account resta finché l’account esiste: puoi modificarlo, non eliminarlo.' } };
    const r = await deps.remove('host_contacts', body.id);
    if (!r.rows || !r.rows.length) return { status: 409, body: { error: 'Nessuna riga eliminata: ricarica e riprova.' } };
    return { status: 200, body: { deleted: body.id }, audit: { target: body.id } };
  }
  if (action === 'contacts_note_add') {
    if (!UUID.test(String(body.contact_id || ''))) return { status: 400, body: { error: 'Contatto non valido.' } };
    const text = String(body.body || '').replace(/\r\n/g, '\n').trim();
    if (!text || text.length > 4000) return { status: 400, body: { error: 'La nota deve avere da 1 a 4000 caratteri.' } };
    if (!(await deps.contacts(body.contact_id))[0]) return { status: 404, body: { error: 'Contatto non trovato.' } };
    const r = await deps.insert('host_contact_notes', { contact_id: body.contact_id, body: text, created_by: String(actor || 'admin').slice(0, 320) });
    if (!r.rows || !r.rows.length) return { status: 500, body: { error: 'Nota non salvata (nessuna riga scritta).' } };
    return { status: 201, body: { note: r.rows[0] }, audit: { target: body.contact_id } };
  }
  if (action === 'contacts_note_delete') {
    if (!UUID.test(String(body.id || ''))) return { status: 400, body: { error: 'Nota non valida.' } };
    const r = await deps.remove('host_contact_notes', body.id);
    if (!r.rows || !r.rows.length) return { status: 404, body: { error: 'Nota non trovata.' } };
    return { status: 200, body: { deleted: body.id }, audit: { target: body.id } };
  }
  return { status: 400, body: { error: 'Unknown action' } };
}
