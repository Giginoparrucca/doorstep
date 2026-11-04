// Round 51 Phase 5 — onboarding nudge emails.
//
// Runs inside the existing ten-minute Alloggiati autofile tick (no new cron,
// no new Vercel function). For each host_onboarding row whose property is not
// ready yet it may send at most two emails:
//   24h — first_seen_at between 24 h and 72 h ago, nudge_24h_sent_at null
//   72h — first_seen_at between 72 h and 7 days ago, nudge_72h_sent_at null
// Older rows get nothing (no backlog burst to hosts who started weeks ago).
// Never for: a ready property, opted-out rows, a dismissed checklist, a
// deleted/test property. Only 09:00–20:00 Europe/Rome.
//
// Readiness is computed with the same pure lib/onboarding-readiness.js and
// the same inputs the console uses, so the email and the checklist agree.
//
// Idempotence: the sent marker is claimed with a conditional PATCH
// (…&nudge_24h_sent_at=is.null) before sending; only the run that claimed it
// sends. A failed send releases the claim. Every outcome is written to
// notification_log (trigger onboarding_nudge_24h / _72h).
//
// Switch: ONBOARDING_NUDGES = 'on' sends; 'dry' computes and logs nothing;
// anything else (default) does nothing.
import { stopToken } from './_onboarding-stop.js';
import { supportWhatsappHtml } from './_support-contact.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Readiness = require('../lib/onboarding-readiness.js');
const RegionalExports = require('../lib/regional-exports.js');
const AllogRecords = require('../lib/alloggiati-records.js');

const H = 3600000;
export const WINDOWS = Object.freeze({ '24h': [24 * H, 72 * H], '72h': [72 * H, 7 * 24 * H] });
export const SEND_HOURS = Object.freeze([9, 20]); // Rome, [from, to)
export const STEP_IDS = Readiness.STEP_IDS;

// Same rule as the console's regionComplianceFor (host-console.html).
export function regionComplianceFor(region, city) {
  const r = RegionalExports.regions[region];
  if (!r) return null;
  if (!r.byProvince) return r;
  const code = AllogRecords.lookupPoliceCode(city);
  const ppp = code && code.length === 9 ? code.slice(3, 6) : null;
  return (ppp && r.byProvince[ppp]) || r.fallback;
}

export function romeHour(now) {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }).format(now);
  return Number(h) % 24;
}

// Pure: which email (if any) this row should get now.
export function selectNudge(row, readiness, now) {
  if (!row || !readiness || readiness.ready) return null;
  if (row.nudges_opted_out || row.checklist_dismissed_at || row.completed_at) return null;
  const age = now.getTime() - Date.parse(row.first_seen_at);
  if (!Number.isFinite(age)) return null;
  for (const kind of ['72h', '24h']) {
    const [from, to] = WINDOWS[kind];
    if (age >= from && age < to && !row[`nudge_${kind}_sent_at`]) return kind;
  }
  return null;
}

const esc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

const STEP_TEXT = {
  it: { property: 'Dati e codici della struttura', calendar: 'Collega il calendario', content: "Prepara l'accoglienza", test: 'Prova come ospite', notifications: 'Attiva le notifiche' },
  en: { property: 'Property data and codes', calendar: 'Connect the calendar', content: 'Prepare the welcome content', test: 'Try as a guest', notifications: 'Turn on notifications' },
};

// Bilingual email. Property name and step are the only variable content; no
// guest data. `support` = { whatsapp: '+39…' | null, email }.
export function renderNudgeEmail({ kind, lang, propertyName, step, doneCount, total, consoleUrl, stopUrl, support }) {
  const it = lang !== 'en';
  const stepName = (it ? STEP_TEXT.it : STEP_TEXT.en)[step] || step;
  const link = `${consoleUrl}#onboarding=${encodeURIComponent(step)}`;
  const subject = it
    ? (kind === '24h' ? `${propertyName}: manca poco per essere pronti` : `${propertyName}: ti aiutiamo a completare la configurazione?`)
    : (kind === '24h' ? `${propertyName}: almost ready` : `${propertyName}: can we help you finish setting up?`);
  const intro = it
    ? (kind === '24h' ? `Hai completato ${doneCount} passaggi su ${total} per <strong>${esc(propertyName)}</strong>. Il prossimo è:` : `<strong>${esc(propertyName)}</strong> non è ancora pronta per i primi ospiti (${doneCount} su ${total}). Il prossimo passaggio è:`)
    : (kind === '24h' ? `You have completed ${doneCount} of ${total} steps for <strong>${esc(propertyName)}</strong>. The next one is:` : `<strong>${esc(propertyName)}</strong> is not ready for its first guests yet (${doneCount} of ${total}). The next step is:`);
  const help = support && support.whatsapp
    ? supportWhatsappHtml(it ? 'it' : 'en', support.whatsapp)
    : `<p style="margin:0 0 24px;font-size:14px;">${it ? 'Preferisci che ti aiutiamo noi? Scrivici a' : 'Prefer that we help? Write to'} <a href="mailto:${esc(support && support.email || 'info@welcomebnb.it')}" style="color:#005BFF;">${esc(support && support.email || 'info@welcomebnb.it')}</a></p>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#061A3D;">
  <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${intro}</p>
  <p style="margin:0 0 20px;font-size:17px;font-weight:600;">${esc(stepName)}</p>
  <p style="margin:0 0 24px;"><a href="${esc(link)}" style="display:inline-block;background:#005BFF;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">${it ? 'Completa ora' : 'Complete it now'}</a></p>
  ${help}
  <p style="margin:24px 0 0;color:#6B7A90;font-size:12px;">${it ? 'Ti scriviamo al massimo due volte per questa configurazione.' : 'We write at most twice about this setup.'} <a href="${esc(stopUrl)}" style="color:#6B7A90;">${it ? 'Non inviarmi più questi promemoria' : 'Stop these reminders'}</a></p>
</div>`;
  return { subject, html, link };
}

// The pass. `deps` keeps network access injectable for tests:
//   get(path) / patch(path, body, prefer) → PostgREST via service role
//   post(path, body) → PostgREST insert
//   userEmail(userId) → account email or null
//   send(to, subject, html) → { ok, id?, error? }
export async function runNudgePass({ mode, now = new Date(), deps, appOrigin, serviceKey, support, force = null }) {
  if (mode !== 'on' && mode !== 'dry' && !force) return { skipped: 'disabled' };
  const hour = romeHour(now);
  if (!force && (hour < SEND_HOURS[0] || hour >= SEND_HOURS[1])) return { skipped: 'quiet_hours', hour };
  const oldest = new Date(now.getTime() - WINDOWS['72h'][1]).toISOString();
  const newest = new Date(now.getTime() - WINDOWS['24h'][0]).toISOString();
  let rows;
  if (force) {
    rows = await deps.get(`host_onboarding?user_id=eq.${encodeURIComponent(force.user_id)}&property_id=eq.${encodeURIComponent(force.property_id)}&select=*&limit=1`);
  } else {
    rows = await deps.get(`host_onboarding?select=*&completed_at=is.null&nudges_opted_out=is.false&checklist_dismissed_at=is.null` +
      `&first_seen_at=gte.${encodeURIComponent(oldest)}&first_seen_at=lte.${encodeURIComponent(newest)}` +
      `&or=(nudge_24h_sent_at.is.null,nudge_72h_sent_at.is.null)&order=first_seen_at.asc&limit=200`);
  }
  const results = [];
  for (const row of rows) {
    const r = { property_id: row.property_id, user_id: row.user_id };
    try {
      const [prop] = await deps.get(`properties?id=eq.${encodeURIComponent(row.property_id)}&select=*&limit=1`);
      if (!prop || prop.deleted_at || prop.is_test || prop.owner_id !== row.user_id) { results.push({ ...r, outcome: 'skipped_property' }); continue; }
      const [creds] = await deps.get(`host_alloggiati_credentials?property_id=eq.${encodeURIComponent(prop.id)}&select=verified_at&limit=1`);
      const [ns] = await deps.get(`host_notification_settings?host_id=eq.${encodeURIComponent(row.user_id)}&select=push_enabled,telegram_enabled,email_mode&limit=1`);
      const readiness = Readiness.computeReadiness({
        property: prop, taxRules: Array.isArray(prop.tax_rules) ? prop.tax_rules : [],
        alloggiatiCreds: creds ? { configured: true, verified_at: creds.verified_at || null } : null,
        notificationSettings: ns || null, hasTestCheckin: !!row.test_checkin_done_at,
        onboardingState: row, regionCompliance: regionComplianceFor(prop.region, prop.city),
      });
      const kind = force ? (force.kind || '24h') : selectNudge(row, readiness, now);
      if (!kind) { results.push({ ...r, outcome: readiness.ready ? 'ready' : 'not_due' }); continue; }
      const step = readiness.firstIncompleteStep || 'property';
      if (mode === 'dry' && !force) { results.push({ ...r, outcome: 'would_send', kind, step }); continue; }
      const to = await deps.userEmail(row.user_id);
      if (!to) { results.push({ ...r, outcome: 'no_email', kind }); continue; }
      const col = `nudge_${kind}_sent_at`;
      const scope = `host_onboarding?user_id=eq.${encodeURIComponent(row.user_id)}&property_id=eq.${encodeURIComponent(row.property_id)}`;
      // Claim first: only the run whose PATCH changes the row sends.
      const claimed = force ? [row] : await deps.patch(`${scope}&${col}=is.null`, { [col]: now.toISOString() }, 'return=representation');
      if (!Array.isArray(claimed) || claimed.length !== 1) { results.push({ ...r, outcome: 'already_claimed', kind }); continue; }
      const consoleUrl = `${appOrigin}/host-console.html`;
      const stopUrl = `${appOrigin}/api/onboarding-stop?u=${encodeURIComponent(row.user_id)}&p=${encodeURIComponent(row.property_id)}&t=${stopToken(row.user_id, row.property_id, serviceKey)}`;
      const email = renderNudgeEmail({ kind, lang: prop.host_language === 'en' ? 'en' : 'it', propertyName: prop.name || 'WelcomeBnB', step,
        doneCount: readiness.doneCount, total: readiness.total, consoleUrl, stopUrl, support });
      const sent = await deps.send(to, email.subject, email.html);
      if (!sent.ok && !force) await deps.patch(scope, { [col]: null }, 'return=minimal').catch(() => {});
      await deps.post('notification_log', { host_id: row.user_id, property_id: row.property_id, trigger: `onboarding_nudge_${kind}`, channel: 'email',
        status: sent.ok ? 'sent' : 'failed', detail: sent.ok ? `step=${step}${sent.id ? ' resend=' + sent.id : ''}${force ? ' forced' : ''}` : String(sent.error || 'send failed').slice(0, 300) }).catch(() => {});
      results.push({ ...r, outcome: sent.ok ? 'sent' : 'send_failed', kind, step, resend_id: sent.id || null });
    } catch (e) {
      results.push({ ...r, outcome: 'error', error: String(e.message || e).slice(0, 200) });
    }
  }
  return { mode: force ? 'forced' : mode, hour, candidates: rows.length, results };
}

