// Round 72 Phase 2 — trial reminder emails.
//
// Milestones (Europe/Rome days, same rule as host_access_state):
//   d7  trial, 4–7 days left        d3  trial, 2–3 days left
//   d1  trial, last day             expired   first time seen in grace
//   read_only  first time seen read-only (also stamps read_only_since)
// Each milestone is sent once per trial end date: the key carries the date
// (e.g. d7_20261231), so an extension or a new date sends again. Claim
// first (conditional PATCH on the key), then send: two overlapping runs
// cannot both send. Never before launch, never to free/active accounts
// (the state comes from rpc billing_access_state). Billing emails carry no
// guest data. Sent once a day from the hourly reminders job, from 09:00
// Rome with a 3-hour catch-up window.
import { supportWhatsappHtml } from './_support-contact.js';

export const SEND_HOUR = 9;
export const CATCH_UP_HOURS = 3;

const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

export function romeHour(now) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(now)) % 24;
}
export function romeYmd(d) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  return p; // YYYY-MM-DD
}
// Last free day (Rome) for an exclusive end instant.
export function lastDay(endIso) { return romeYmd(new Date(new Date(endIso).getTime() - 1)); }

export function milestoneFor(state) {
  if (!state) return null;
  if (state.state === 'trial') {
    const d = Number(state.days_left);
    const kind = d === 1 ? 'd1' : (d >= 2 && d <= 3) ? 'd3' : (d >= 4 && d <= 7) ? 'd7' : null;
    return kind ? { kind, end: state.trial_ends_at } : null;
  }
  if (state.state === 'grace') return { kind: 'expired', end: state.ended_at };
  if (state.state === 'read_only') return { kind: 'read_only', end: state.ended_at };
  return null;
}
export function milestoneKey(m) { return `${m.kind}_${lastDay(m.end).replaceAll('-', '')}`; }

function fmtDate(ymd, lang) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(lang === 'en' ? 'en-GB' : 'it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function renderTrialEmail({ kind, lang, state, consoleUrl, support }) {
  const en = lang === 'en';
  const price = Number(state.price_eur || 60).toLocaleString(en ? 'en-GB' : 'it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const priceText = en ? `€${price} per year, VAT included` : `${price} € l'anno, IVA inclusa`;
  const last = fmtDate(lastDay(kind === 'expired' || kind === 'read_only' ? state.ended_at : state.trial_ends_at), lang);
  const graceLast = state.grace_ends_at ? fmtDate(lastDay(state.grace_ends_at), lang) : '';
  const days = Number(state.days_left);
  let subject, body;
  if (kind === 'd7' || kind === 'd3' || kind === 'd1') {
    subject = en
      ? (days === 1 ? 'Your WelcomeBnB free trial ends today' : `Your WelcomeBnB free trial ends in ${days} days`)
      : (days === 1 ? 'La tua prova gratuita di WelcomeBnB termina oggi' : `La tua prova gratuita di WelcomeBnB termina tra ${days} giorni`);
    body = en
      ? `<p>Your free trial lasts until <strong>${esc(last)}</strong>. After that WelcomeBnB costs <strong>${esc(priceText)}</strong> per host account, whatever the number of properties.</p><p>To subscribe, open the console → Settings → Subscription.</p>`
      : `<p>La tua prova gratuita dura fino al <strong>${esc(last)}</strong>. Dopo, WelcomeBnB costa <strong>${esc(priceText)}</strong> per account host, qualunque sia il numero di strutture.</p><p>Per abbonarti apri la console → Impostazioni → Abbonamento.</p>`;
  } else if (kind === 'expired') {
    subject = en ? 'Your WelcomeBnB free trial has ended' : 'La tua prova gratuita di WelcomeBnB è terminata';
    body = en
      ? `<p>Your free trial ended on ${esc(last)}. You keep full access until <strong>${esc(graceLast)}</strong> to subscribe (${esc(priceText)}). After that the account becomes read-only: you can still see and export all your data.</p><p>Guests who already have their link can still check in, and their Alloggiati filing keeps running.</p>`
      : `<p>La tua prova gratuita è terminata il ${esc(last)}. Hai accesso completo fino al <strong>${esc(graceLast)}</strong> per abbonarti (${esc(priceText)}). Dopo, l'account passa in sola lettura: puoi sempre consultare ed esportare tutti i tuoi dati.</p><p>Gli ospiti che hanno già il link possono fare il check-in e l'invio ad Alloggiati delle loro schedine continua.</p>`;
  } else {
    subject = en ? 'Your WelcomeBnB account is now read-only' : 'Il tuo account WelcomeBnB è ora in sola lettura';
    body = en
      ? `<p>Your account is now read-only: you can see and export all your data, but you cannot create new links or reservations or edit your properties. Subscribe (${esc(priceText)}) to get full access back straight away.</p><p>Guests who already have their link can still check in, and their Alloggiati filing keeps running.</p>`
      : `<p>Il tuo account è ora in sola lettura: puoi consultare ed esportare tutti i tuoi dati, ma non creare nuovi link o prenotazioni né modificare le strutture. Abbonati (${esc(priceText)}) per riavere subito l'accesso completo.</p><p>Gli ospiti che hanno già il link possono fare il check-in e l'invio ad Alloggiati delle loro schedine continua.</p>`;
  }
  const help = support && support.whatsapp ? supportWhatsappHtml(en ? 'en' : 'it', support.whatsapp)
    : `<p style="font-size:14px;">${en ? 'Questions? Write to' : 'Domande? Scrivici a'} <a href="mailto:${esc(support?.email || 'info@welcomebnb.it')}" style="color:#005BFF;">${esc(support?.email || 'info@welcomebnb.it')}</a></p>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;font-size:15px;line-height:1.5;">
  ${body}
  <p style="margin:20px 0 0;"><a href="${esc(consoleUrl)}#abbonamento" style="display:inline-block;background:#005BFF;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${en ? 'Open the console' : 'Apri la console'}</a></p>
  ${help}
</div>`;
  return { subject, html };
}

// deps: get(path) → rows; state(userId, nowIso) → billing_access_state;
// patch(path, body, prefer) → rows|true; post(table, row); userEmail(id); send(to, subject, html)
export async function runTrialReminderPass({ now = new Date(), deps, appOrigin, support, force = false, dry = false }) {
  const hour = romeHour(now);
  if (!force && (hour < SEND_HOUR || hour > SEND_HOUR + CATCH_UP_HOURS)) return { skipped: 'not_send_hour', hour };
  const [settings] = await deps.get('billing_settings?id=eq.1&select=launch_at&limit=1');
  if (!settings || !settings.launch_at || new Date(settings.launch_at) > now) return { skipped: 'prelaunch' };
  const subs = await deps.get('host_subscriptions?status=neq.free_forever&select=user_id,reminders_sent,read_only_since,updated_at&order=user_id.asc&limit=1000');
  const results = [];
  for (const sub of subs) {
    const r = { user_id: sub.user_id };
    try {
      const state = await deps.state(sub.user_id, now.toISOString());
      const m = milestoneFor(state);
      if (!m) { results.push({ ...r, outcome: 'none', state: state?.state }); continue; }
      const key = milestoneKey(m);
      const sent = sub.reminders_sent || {};
      if (sent[key]) { results.push({ ...r, outcome: 'already_sent', key }); continue; }
      if (dry) { results.push({ ...r, outcome: 'would_send', key }); continue; }
      const patchBody = { reminders_sent: { ...sent, [key]: now.toISOString() }, updated_at: now.toISOString() };
      if (m.kind === 'read_only' && !sub.read_only_since) patchBody.read_only_since = state.since;
      if (m.kind === 'expired' || m.kind === 'read_only') patchBody.status = 'expired';
      // Claim: only the run that changes the row (key still absent) sends.
      const claimed = await deps.patch(`host_subscriptions?user_id=eq.${encodeURIComponent(sub.user_id)}&reminders_sent->>${key}=is.null`, patchBody, 'return=representation');
      if (!Array.isArray(claimed) || claimed.length !== 1) { results.push({ ...r, outcome: 'already_claimed', key }); continue; }
      if (m.kind === 'expired' || m.kind === 'read_only') {
        await deps.post('billing_events', { user_id: sub.user_id, actor: 'system', action: m.kind === 'expired' ? 'expired' : 'read_only',
          new_value: { ended_at: state.ended_at, ...(m.kind === 'read_only' ? { since: state.since } : { grace_ends_at: state.grace_ends_at }) } }).catch(() => {});
      }
      const to = await deps.userEmail(sub.user_id);
      if (!to) { results.push({ ...r, outcome: 'no_email', key }); continue; }
      const lang = (await deps.lang?.(sub.user_id)) === 'en' ? 'en' : 'it';
      const email = renderTrialEmail({ kind: m.kind, lang, state, consoleUrl: `${appOrigin}/host-console.html`, support });
      const out = await deps.send(to, email.subject, email.html);
      if (!out.ok) await deps.patch(`host_subscriptions?user_id=eq.${encodeURIComponent(sub.user_id)}`, { reminders_sent: sent }, 'return=minimal').catch(() => {}); // retry next run
      await deps.post('billing_events', { user_id: sub.user_id, actor: 'system', action: 'reminder_sent',
        new_value: { milestone: m.kind, key, ok: !!out.ok, resend_id: out.id || null }, reason: out.ok ? null : String(out.error || 'send failed').slice(0, 300) }).catch(() => {});
      results.push({ ...r, outcome: out.ok ? 'sent' : 'send_failed', key });
    } catch (e) {
      results.push({ ...r, outcome: 'error', error: String(e.message || e).slice(0, 200) });
    }
  }
  return { hour, candidates: subs.length, results };
}
