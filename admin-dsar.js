// Round 67 Phase 4 — «Privacy» tab: data-subject requests (GDPR Art. 15,
// 17, 20); Phase 5 adds the admin audit log view. Calls /api/admin-host-health with action dsar_export / dsar_erase
// (server checks admin, rate limit, legal retention). Runbook:
// docs/compliance/DSAR_RUNBOOK.md. Uses the admin page's sb, escapeHtml and
// adminToast.
(function (root) {
  'use strict';
  const ERRORS = {
    one_identifier: 'Inserisci un solo dato: email, telefono oppure numero di documento.',
    invalid_identifier: 'Il dato inserito non è valido (email completa, telefono con almeno 8 cifre, documento di 5–20 lettere/cifre).',
    rate_limited: 'Limite raggiunto: massimo 10 richieste l’ora. Riprova più tardi.',
    confirm_required: 'Per cancellare scrivi CANCELLA nella casella di conferma.',
  };
  let last = null; // { query, export?, preview?, erased? }
  const esc = s => (root.escapeHtml ? root.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])));
  const toast = (m, kind) => { if (root.adminToast) root.adminToast(m, kind); };

  function readQuery() {
    const kind = document.getElementById('dsarKind').value;
    const value = document.getElementById('dsarValue').value.trim();
    return { [kind]: value };
  }
  async function call(action, body) {
    const { data } = await root.sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) { toast('Non hai effettuato l’accesso', 'error'); return null; }
    const r = await root.fetch('/api/admin-host-health', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action, ...body }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setStatus(ERRORS[j.error] || j.error || ('Errore HTTP ' + r.status), true); return null; }
    return j;
  }
  function setStatus(text, isError) {
    const el = document.getElementById('dsarStatus');
    if (el) { el.textContent = text || ''; el.style.color = isError ? 'var(--danger, #B42318)' : 'var(--ink-soft)'; }
  }

  async function dsarExport() {
    const query = readQuery();
    const links = document.getElementById('dsarLinks').checked;
    setStatus('Ricerca in corso…');
    const j = await call('dsar_export', { ...query, document_links: links });
    if (!j) return;
    last = { query, export: j };
    setStatus('');
    render();
  }
  async function dsarPreview() {
    const query = readQuery();
    setStatus('Anteprima in corso…');
    const j = await call('dsar_erase', { ...query, dry_run: true });
    if (!j) return;
    last = { ...(last && JSON.stringify(last.query) === JSON.stringify(query) ? last : {}), query, preview: j, erased: null };
    setStatus('');
    render();
  }
  async function dsarErase() {
    if (!last || !last.preview) return;
    const confirmText = document.getElementById('dsarConfirm').value.trim();
    if (confirmText !== 'CANCELLA') { setStatus(ERRORS.confirm_required, true); return; }
    setStatus('Cancellazione in corso…');
    const j = await call('dsar_erase', { ...last.query, dry_run: false, confirm: 'CANCELLA' });
    if (!j) return;
    last.erased = j;
    setStatus('');
    toast('Cancellazione eseguita');
    render();
  }
  function download() {
    if (!last || !last.export) return;
    const blob = new Blob([JSON.stringify(last.export, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'welcomebnb-dati-personali-' + last.export.generated_at.slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function printSummary() {
    document.body.classList.add('dsar-printing');
    try { root.print(); } finally { setTimeout(() => document.body.classList.remove('dsar-printing'), 500); }
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' }) : '—';
  function summaryHtml(x) {
    const props = Object.fromEntries((x.properties || []).map(p => [p.id, p.name]));
    const row = (label, n, detail) => `<tr><th scope="row" style="text-align:left;">${esc(label)}</th><td data-dsar-count="${esc(label)}">${n}</td><td style="overflow-wrap:anywhere;">${detail || ''}</td></tr>`;
    const stays = x.checkins.map(c => `${esc(props[c.property_id] || 'Struttura')} · ${fmtDate(c.arrival_date)}${c.filed_at ? ' · inviato alla Polizia' : ''}`).join('<br>');
    const res = x.reservations.map(r => `${esc(props[r.property_id] || 'Struttura')} · ${fmtDate(r.checkin_date)} (${esc(r.platform || '')})`).join('<br>');
    const cons = x.marketing_consents.map(m => `${fmtDate(m.consent_given_at)}${m.withdrawn_at ? ' · revocato ' + fmtDate(m.withdrawn_at) : ''}`).join('<br>');
    return `<div id="dsarSummary" data-dsar-summary>
      <h3 style="margin:0 0 6px;font-size:1rem;">Riepilogo dati personali · ${esc(new Date(x.generated_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }))}</h3>
      <div style="overflow-x:auto;" tabindex="0" role="region" aria-label="Riepilogo"><table class="data-table" style="width:100%;font-size:0.78rem;">
        <thead><tr><th scope="col">Categoria</th><th scope="col">Righe</th><th scope="col">Dettaglio</th></tr></thead><tbody>
        ${row('Check-in', x.counts.checkins, stays)}
        ${row('Prenotazioni', x.counts.reservations, res)}
        ${row('Consensi marketing', x.counts.marketing_consents, cons)}
        ${row('Messaggi chat', x.counts.chat_messages, x.counts.bookings ? x.counts.bookings + ' prenotazion' + (x.counts.bookings === 1 ? 'e' : 'i') : '')}
        ${row('Foto documenti', x.counts.documents, x.documents.some(d => d.download_url) ? 'link validi 7 giorni nel file JSON' : (x.counts.documents ? 'non inclusi (spunta l’opzione per i link)' : ''))}
        </tbody></table></div>
      <p style="font-size:0.74rem;color:var(--ink-soft);margin:6px 0 0;">Titolare: la struttura; WelcomeBnB è responsabile del trattamento. Finalità, destinatari e conservazione sono nel file JSON (sezione «information»).</p>
    </div>`;
  }
  function eraseHtml(p, done) {
    const r = done || p;
    const kept = (r.checkins_retained || []).length;
    return `<div data-dsar-erase="${done ? 'done' : 'preview'}" style="margin-top:12px;padding:10px;border:1px solid ${done ? 'var(--border)' : '#F0B429'};border-radius:8px;background:${done ? 'var(--white)' : '#FFFBEA'};font-size:0.8rem;">
      <strong>${done ? 'Cancellazione eseguita' : 'Anteprima cancellazione (non è stato modificato nulla)'}</strong>
      <ul style="margin:6px 0 0 18px;padding:0;">
        <li>Check-in cancellati: <b data-dsar-n="checkins_erased">${r.checkins_erased}</b> (rimossi definitivamente dopo 30 giorni)</li>
        <li>Check-in conservati per legge: <b data-dsar-n="checkins_retained">${kept}</b>${kept ? ' — già inviati ad Alloggiati (TULPS art. 109, GDPR art. 17(3)(b)); restano, ma le foto dei documenti vengono eliminate' : ''}</li>
        <li>Foto documenti eliminate: <b data-dsar-n="photos_queued">${r.photos_queued}</b></li>
        <li>Consensi marketing revocati e anonimizzati: <b data-dsar-n="consents_withdrawn">${r.consents_withdrawn}</b></li>
        <li>Prenotazioni senza più email/telefono: <b data-dsar-n="reservations_redacted">${r.reservations_redacted}</b> (la prenotazione resta nel calendario dell’host)</li>
        <li>Messaggi chat cancellati: <b data-dsar-n="chat_messages_erased">${r.chat_messages_erased}</b></li>
      </ul>
      ${done ? '' : `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:8px;">
        <label for="dsarConfirm">Per confermare scrivi <b>CANCELLA</b></label>
        <input id="dsarConfirm" autocomplete="off" style="padding:5px 8px;border:1px solid var(--border);border-radius:4px;font:inherit;max-width:140px;">
        <button type="button" data-dsar-erase-go onclick="DsarAdmin.erase()" style="padding:6px 12px;background:#B42318;color:#fff;border:0;border-radius:6px;cursor:pointer;font:inherit;">Cancella i dati</button>
      </div>`}
    </div>`;
  }

  function render() {
    const host = document.getElementById('content');
    if (!host) return;
    const prev = last && last.query ? Object.entries(last.query)[0] : ['email', ''];
    const opt = (v, t) => `<option value="${v}"${prev[0] === v ? ' selected' : ''}>${t}</option>`;
    const btn = 'padding:7px 14px;border:1px solid var(--border);background:var(--white);border-radius:6px;cursor:pointer;font:inherit;font-size:0.82rem;';
    host.innerHTML = `<style>@media print{body.dsar-printing *{visibility:hidden!important}body.dsar-printing #dsarSummary,body.dsar-printing #dsarSummary *{visibility:visible!important}body.dsar-printing #dsarSummary{position:absolute;left:0;top:0;width:100%}}</style>
      <div class="section-title">Privacy · richieste degli interessati (GDPR)</div>
      <div data-dsar-panel style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;max-width:820px;">
        <p style="margin:0 0 10px;font-size:0.8rem;color:var(--ink-soft);">Usa questa pagina solo su istruzione dell’host (titolare) o dopo aver verificato l’identità di chi chiede — vedi <code>docs/compliance/DSAR_RUNBOOK.md</code>. Ogni richiesta viene registrata. Massimo 10 richieste l’ora.</p>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          <label for="dsarKind" class="sr-only" style="position:absolute;left:-9999px;">Tipo di dato</label>
          <select id="dsarKind" style="padding:6px;border:1px solid var(--border);border-radius:4px;font:inherit;">${opt('email', 'Email')}${opt('phone', 'Telefono')}${opt('document', 'Numero documento')}</select>
          <label for="dsarValue" style="position:absolute;left:-9999px;">Valore</label>
          <input id="dsarValue" value="${esc(prev[1])}" autocomplete="off" style="flex:1 1 220px;min-width:0;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font:inherit;">
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:0.8rem;"><input type="checkbox" id="dsarLinks"> Includi i link alle foto dei documenti (validi 7 giorni)</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;">
          <button type="button" data-dsar-export onclick="DsarAdmin.exportData()" style="${btn}">Cerca ed esporta</button>
          <button type="button" data-dsar-preview onclick="DsarAdmin.preview()" style="${btn}">Anteprima cancellazione</button>
        </div>
        <div id="dsarStatus" role="status" style="margin-top:8px;font-size:0.8rem;"></div>
        ${last && last.export ? `<div style="margin-top:12px;">${summaryHtml(last.export)}
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"><button type="button" data-dsar-download onclick="DsarAdmin.download()" style="${btn}">Scarica JSON</button><button type="button" data-dsar-print onclick="DsarAdmin.printSummary()" style="${btn}">Stampa / PDF riepilogo</button></div></div>` : ''}
        ${last && last.preview ? eraseHtml(last.preview, last.erased) : ''}
      </div>
      ${auditHtml()}`;
  }

  // Round 67 Phase 5 — admin audit log (admin_access_events), newest first.
  let audit = null; // { events, chain, filter }
  const ACTION_LABELS = { host_health_read: 'Salute host (lettura)', audit_read: 'Registro (lettura)', dsar_export: 'Privacy: esportazione', dsar_erase_preview: 'Privacy: anteprima cancellazione', dsar_erase: 'Privacy: cancellazione',
    invite_send: 'Invito', invite_resend: 'Invito reinviato', invite_revoke: 'Invito revocato', invite_link: 'Link invito', alloggiati_support_read: 'Alloggiati: panoramica', alloggiati_admin_status: 'Alloggiati: stato host', impersonation_view: 'Vista come host' };
  const OUTCOME = { requested: 'richiesto', ok: 'ok', refused: 'rifiutato', error: 'errore' };
  async function loadAudit() {
    const filter = (document.getElementById('auditFilter') || {}).value || '';
    const j = await call('audit_list', { action_prefix: filter, limit: 200 });
    if (!j) return;
    audit = { ...j, filter };
    render();
  }
  function auditHtml() {
    const opt = (v, t) => `<option value="${v}"${audit && audit.filter === v ? ' selected' : ''}>${t}</option>`;
    const btn = 'padding:6px 12px;border:1px solid var(--border);background:var(--white);border-radius:6px;cursor:pointer;font:inherit;font-size:0.8rem;';
    let body = '';
    if (audit) {
      const ch = audit.chain;
      const chain = !ch ? '<span data-audit-chain="unknown">Verifica integrità non disponibile</span>'
        : ch.ok ? `<span data-audit-chain="ok" style="color:#027A48;">Integrità verificata (${ch.checked} voci)</span>`
        : `<span data-audit-chain="broken" style="color:#B42318;font-weight:600;">Registro alterato alla voce ${esc(ch.broken_at)} — avvisa subito (procedura violazioni)</span>`;
      const rows = audit.events.map(e => `<tr data-audit-row="${esc(e.action)}"><td>${esc(new Date(e.occurred_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }))}</td><td style="overflow-wrap:anywhere;">${esc(e.actor_email || '—')}</td><td>${esc(ACTION_LABELS[e.action] || (e.action.startsWith('billing_') ? 'Abbonamento: ' + e.action.slice(8) : e.action))}</td><td>${esc(OUTCOME[e.outcome] || e.outcome)}</td><td style="overflow-wrap:anywhere;">${esc(e.target_table || '')}${e.target_id ? ' · ' + esc(String(e.target_id).slice(0, 12)) : ''}</td></tr>`).join('');
      body = `<div style="margin:8px 0;font-size:0.78rem;">${chain}</div>
        <div style="overflow-x:auto;" tabindex="0" role="region" aria-label="Registro accessi"><table class="data-table" style="width:100%;font-size:0.74rem;"><thead><tr><th scope="col">Quando</th><th scope="col">Admin</th><th scope="col">Azione</th><th scope="col">Esito</th><th scope="col">Oggetto</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Nessuna voce.</td></tr>'}</tbody></table></div>`;
    }
    return `<div data-audit-panel style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px;max-width:820px;margin-top:14px;">
      <div style="font-weight:600;margin-bottom:6px;">Registro accessi admin</div>
      <p style="margin:0 0 8px;font-size:0.78rem;color:var(--ink-soft);">Ogni azione admin (letture, inviti, abbonamenti, richieste privacy, vista come host) con esito. Non modificabile; conservato 2 anni. Nessun dato degli ospiti.</p>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><label for="auditFilter" style="position:absolute;left:-9999px;">Filtro</label>
        <select id="auditFilter" style="padding:6px;border:1px solid var(--border);border-radius:4px;font:inherit;">${opt('', 'Tutte le azioni')}${opt('dsar_', 'Privacy')}${opt('invite_', 'Inviti')}${opt('billing_', 'Abbonamenti')}${opt('impersonation_', 'Vista come host')}${opt('alloggiati_', 'Alloggiati')}</select>
        <button type="button" data-audit-load onclick="DsarAdmin.loadAudit()" style="${btn}">Mostra registro</button></div>
      ${body}</div>`;
  }

  root.DsarAdmin = { render, exportData: dsarExport, preview: dsarPreview, erase: dsarErase, download, printSummary, loadAudit, _reset: () => { last = null; audit = null; } };
})(typeof window !== 'undefined' ? window : globalThis);
