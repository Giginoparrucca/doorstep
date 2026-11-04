// Round 51 Phase 5 — signed opt-out link for onboarding nudge emails.
// No lib/ imports: served by api/send-arrival-reminders.js, whose bundle
// does not include lib/**.
import crypto from 'node:crypto';

const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

// Signed opt-out link token (no new secret: derived from the service key,
// which only the server holds).
export function stopToken(userId, propertyId, serviceKey) {
  const key = crypto.createHash('sha256').update('onboarding-stop:' + serviceKey).digest();
  return crypto.createHmac('sha256', key).update(`${userId}|${propertyId}`).digest('base64url');
}
export function verifyStopToken(userId, propertyId, token, serviceKey) {
  if (!/^[0-9a-f-]{36}$/i.test(userId || '') || !/^[0-9a-f-]{36}$/i.test(propertyId || '') || typeof token !== 'string') return false;
  const want = Buffer.from(stopToken(userId, propertyId, serviceKey));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// GET shows a confirmation page (mail scanners that open links must not opt
// the host out); POST with the same signed parameters sets nudges_opted_out.
export async function handleOnboardingStop(req, res, { serviceKey, patch }) {
  const url = new URL(req.url, 'http://x');
  const u = url.searchParams.get('u'), p = url.searchParams.get('p'), t = url.searchParams.get('t');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const page = (title, body) => `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;color:#061A3D;">${body}</body></html>`;
  if (!verifyStopToken(u, p, t, serviceKey)) return res.status(400).send(page('Link non valido', '<h1 style="font-size:20px;">Link non valido</h1><p>Questo link non è valido o è incompleto. / This link is not valid.</p>'));
  if (req.method === 'POST') {
    const rows = await patch(`host_onboarding?user_id=eq.${encodeURIComponent(u)}&property_id=eq.${encodeURIComponent(p)}`, { nudges_opted_out: true }, 'return=representation');
    if (!Array.isArray(rows) || rows.length !== 1) return res.status(404).send(page('Non trovato', '<p>Configurazione non trovata. / Setup not found.</p>'));
    return res.status(200).send(page('Promemoria disattivati', '<h1 style="font-size:20px;">Promemoria disattivati</h1><p>Non ti invieremo più promemoria sulla configurazione di questa struttura.</p><p style="color:#6B7A90;">Reminders turned off: we will not email you again about setting up this property.</p>'));
  }
  const action = `/api/onboarding-stop?u=${encodeURIComponent(u)}&p=${encodeURIComponent(p)}&t=${encodeURIComponent(t)}`;
  return res.status(200).send(page('Disattiva promemoria', `<h1 style="font-size:20px;">Disattivare i promemoria?</h1><p>Non riceverai più email sulla configurazione di questa struttura. / You will no longer receive setup emails for this property.</p><form method="post" action="${esc(action)}"><button type="submit" style="font:inherit;padding:10px 18px;border:0;border-radius:8px;background:#005BFF;color:#fff;cursor:pointer;">Disattiva / Turn off</button></form>`));
}
