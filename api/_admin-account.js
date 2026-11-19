// Assisted login e-mail change from the admin «Utenti» tab (19 Nov 2026).
// For a host who can no longer use the old mailbox: the admin checks the
// person's identity outside the product (phone/WhatsApp), then changes the
// login e-mail here. Supabase Auth admin API, so no confirmation link: the
// new address is marked confirmed. Both addresses get a notice. The trigger
// public.account_email_changed moves notification/reminder/contact copies of
// the old address. Recorded in the admin log by the caller (admin-host-health)
// before and after, with fingerprints of both addresses and the reason.
//
// action account_email_change { user_id, new_email, reason, dry }
//   dry !== false → preview: current e-mail, nothing changed, no e-mail sent.

import { createHash } from 'node:crypto';

// The admin log refuses e-mail addresses (admin_access_events metadata rule):
// it records a short SHA-256 fingerprint of each address, and any address
// typed in the reason is masked.
export const fingerprint = e => createHash('sha256').update(String(e || '').trim().toLowerCase()).digest('hex').slice(0, 16);
export const maskEmails = t => String(t || '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
export const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export function noticeHtml({ which, oldEmail, newEmail }) {
  const body = which === 'old'
    ? `L'email di accesso del tuo account WelcomeBnB è stata cambiata da <strong>${esc(oldEmail)}</strong> a <strong>${esc(newEmail)}</strong> su tua richiesta, dopo una verifica con il nostro supporto. D'ora in poi accedi con il nuovo indirizzo. Le tue strutture e i tuoi dati non cambiano.`
    : `Da ora accedi a WelcomeBnB con questo indirizzo (<strong>${esc(newEmail)}</strong>), al posto di ${esc(oldEmail)}. Le tue strutture e i tuoi dati non cambiano. Se non ricordi la password, nella pagina di accesso premi «Password dimenticata?».`;
  return `<p>${body}</p><p>Se non hai chiesto tu questo cambio, rispondi subito a questa email o scrivi a info@welcomebnb.it.</p>`;
}

// deps: { getUser(id) → {id,email}|null, recordHistory({userId, actor, oldEmail, newEmail, reason}),
//        updateEmail(id, email) → {ok, status, error}, sendEmail(to, subject, html) → {ok} }
export async function handleAccountAction(action, body = {}, { actor = 'admin', deps } = {}) {
  if (action !== 'account_email_change') return { status: 400, body: { error: 'Unknown action' } };
  const userId = String(body.user_id || '');
  const newEmail = String(body.new_email || '').trim().toLowerCase();
  const reason = String(body.reason || '').trim();
  if (!UUID.test(userId)) return { status: 400, body: { error: 'Utente non valido.' } };
  if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) return { status: 400, body: { error: 'La nuova email non è valida.' } };
  if (reason.length < 5) return { status: 400, body: { error: 'Scrivi il motivo e come hai verificato l’identità (almeno 5 caratteri).' } };
  const user = await deps.getUser(userId);
  if (!user) return { status: 404, body: { error: 'Account non trovato.' } };
  const oldEmail = String(user.email || '').trim().toLowerCase();
  if (oldEmail === newEmail) return { status: 409, body: { error: 'È già l’email di questo account.', unchanged: true } };
  if (body.dry !== false) return { status: 200, body: { dry: true, user_id: userId, old_email: oldEmail, new_email: newEmail } };
  // The identity check (docs/support/EMAIL_CHANGE.md): called back on a number
  // already on file, and the person confirmed details of their property.
  const checks = body.checks || {};
  if (checks.callback !== true || checks.details !== true) return { status: 400, body: { error: 'Prima di cambiare l’email completa i due controlli d’identità.' } };
  // Who and why, in the account's history, before the change (no record, no change).
  try { await deps.recordHistory({ userId, actor, oldEmail, newEmail, reason: ('[verifica: richiamato al numero in archivio; dettagli della struttura confermati] ' + reason).slice(0, 500) }); }
  catch (e) { return { status: 503, body: { error: 'Storico dell’account non disponibile: nessuna modifica fatta. Riprova tra poco.' } }; }
  const r = await deps.updateEmail(userId, newEmail);
  if (!r.ok) {
    if (r.status === 422 || /already|exists|registered/i.test(r.error || '')) return { status: 409, body: { error: 'Questa email è già usata da un altro account.' } };
    return { status: 502, body: { error: 'Cambio non riuscito: nessuna modifica fatta. Riprova tra poco.' } };
  }
  const subject = 'WelcomeBnB: email di accesso cambiata';
  const sent = { old: false, new: false };
  if (oldEmail) sent.old = !!(await deps.sendEmail(oldEmail, subject, noticeHtml({ which: 'old', oldEmail, newEmail })).catch(() => ({ ok: false }))).ok;
  sent.new = !!(await deps.sendEmail(newEmail, subject, noticeHtml({ which: 'new', oldEmail, newEmail })).catch(() => ({ ok: false }))).ok;
  return { status: 200, body: { changed: true, user_id: userId, old_email: oldEmail, new_email: newEmail, notices: sent }, audit: { old_email_sha: fingerprint(oldEmail), new_email_sha: fingerprint(newEmail), reason: maskEmails(reason).slice(0, 500), notices: sent } };
}
