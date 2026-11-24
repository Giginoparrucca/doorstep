// 17 Nov 2026 — admin home «Utenti»: one row per host account — who, when
// they registered, where the free trial stands, how active they are.
// Data: /api/admin-host-health action users_overview (admin-only, server).
// Uses the admin page's sb, escapeHtml, setActiveTab and #userFilter.
(function (root) {
  'use strict';
  // admin.html declares its Supabase client with a top-level `const sb`,
  // which other scripts reach by name but which is not a window property.
  // eslint-disable-next-line no-undef
  const adminClient = () => (typeof sb !== 'undefined' ? sb : root.sb);
  const DAY = 86400000;
  let data = null, loading = false, error = null;
  let view = { sort: 'registered', dir: 'desc', search: '', showTest: false };
  const openBilling = new Set(); // user ids whose «Abbonamento» box is open
  const esc = s => (root.escapeHtml ? root.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])));
  const fmt = d => d ? new Date(d).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
  const daysFrom = (d, now) => Math.round((new Date(d).getTime() - now) / DAY);
  function ago(d, now) {
    if (!d) return 'mai';
    const n = Math.floor((now - new Date(d).getTime()) / DAY);
    return n <= 0 ? 'oggi' : n === 1 ? 'ieri' : n + ' gg fa';
  }
  // Plan / trial cell: [text, tone, sort key (days until it matters)].
  // Before the launch the server answers «prelaunch» for everyone; the trial
  // itself is stored from registration (17 Nov 2026), so show that date.
  function planCell(p, now, r) {
    if (!p || !p.state) return r && r.status === 'invited' ? ['Prova dalla registrazione', 'grey', 1e6] : ['—', 'grey', 1e6];
    const sub = r && r.billing && r.billing.subscription;
    if (p.state === 'prelaunch' && sub) {
      if (sub.status === 'free_forever') return ['Gratis a vita', 'grey', 2e5];
      if (sub.status === 'active' && sub.paid_until) return [`Pagato fino al ${fmt(sub.paid_until)}`, 'green', 5e4 + daysFrom(sub.paid_until, now)];
      if (sub.trial_ends_at) {
        const d = daysFrom(sub.trial_ends_at, now);
        return d <= 0 ? [`Prova scaduta il ${fmt(sub.trial_ends_at)}`, 'red', d] : [`Prova · scade il ${fmt(sub.trial_ends_at)} (${d} gg)`, d <= 7 ? 'red' : d <= 14 ? 'amber' : 'green', d];
      }
    }
    switch (p.state) {
      case 'prelaunch': return [r && r.status === 'invited' ? 'Prova dalla registrazione' : 'Prova non ancora creata', 'grey', 1e5];
      case 'trial': { const d = daysFrom(p.trial_ends_at, now); return [`Prova · scade il ${fmt(p.trial_ends_at)} (${d <= 0 ? 'oggi' : d + ' gg'})`, d <= 7 ? 'red' : d <= 14 ? 'amber' : 'green', d]; }
      case 'grace': return [`Prova scaduta · periodo di grazia fino al ${fmt(p.grace_ends_at)}`, 'red', daysFrom(p.grace_ends_at, now)];
      case 'read_only': return [`Sola lettura dal ${fmt(p.since)}`, 'red', -1];
      case 'active': return [`Pagato fino al ${fmt(p.paid_until)}`, 'green', 5e4 + daysFrom(p.paid_until, now)];
      case 'free': return [p.reason === 'admin' ? 'Admin' : 'Gratis a vita', 'grey', 2e5];
      case 'none': return ['Nessun abbonamento', 'grey', 3e5];
      default: return [p.state, 'grey', 1e6];
    }
  }
  const ACTIVITY = { active: ['Attivo', 'green', 0], slowing: ['In calo', 'amber', 1], inactive: ['Inattivo', 'red', 2], never: ['Mai usato', 'grey', 3] };
  const STATUS = { invited: 'Invitato · non ancora registrato', registered: 'Registrato · nessuna struttura', active_account: '' };
  const TONE = { green: ['#ECFDF3', '#027A48'], amber: ['#FFFAEB', '#B54708'], red: ['#FEF3F2', '#B42318'], grey: ['#F2F4F7', '#475467'] };
  const chip = (text, tone, attr = '') => `<span ${attr} style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:600;background:${TONE[tone][0]};color:${TONE[tone][1]};white-space:nowrap;">${esc(text)}</span>`;

  // Terms are accepted per account (Round 69/76): version and date, and the
  // signed evidence (IP, user agent, hashes, provider data shown) as JSON.
  function termsCell(r) {
    if (!r.user_id) return '<span style="color:var(--ink-soft);">—</span>';
    if (data && data.terms_error) return '<span title="Non disponibile">—</span>';
    if (!r.terms) return r.confirmed ? chip('Non accettate', 'amber', 'data-terms-chip') : '<span style="color:var(--ink-soft);">—</span>';
    return `${chip('v' + Number(r.terms.version) + ' · ' + fmt(r.terms.accepted_at), 'green', 'data-terms-chip')} <button type="button" data-terms-evidence="${esc(r.user_id)}" onclick="UsersAdmin.termsEvidence('${esc(r.user_id)}')" style="border:0;background:none;padding:0;font:inherit;font-size:0.72rem;color:var(--warm, #1849A9);cursor:pointer;text-decoration:underline;">Scarica prova</button>`;
  }
  async function termsEvidence(uid) {
    try {
      const { data: rowsEv, error: e } = await adminClient().from('host_terms_acceptances').select('*').eq('host_id', uid).order('created_at', { ascending: true });
      if (e) throw e;
      // The legal text each acceptance refers to (version, hashes, specific clauses).
      const ids = [...new Set((rowsEv || []).map(x => x.document_id).filter(Boolean))];
      let docs = [];
      if (ids.length) { const d = await adminClient().from('legal_documents').select('*').in('id', ids); if (d.error) throw d.error; docs = d.data || []; }
      const blob = new Blob([JSON.stringify({ host_id: uid, exported_at: new Date().toISOString(), acceptances: rowsEv || [], documents: docs }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `welcomebnb-terms-evidence-${uid}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { if (root.adminToast) root.adminToast('Prova non disponibile: ' + String(err && err.message || err), 'error'); }
  }

  // 19 Nov 2026 — assisted login e-mail change, for a host who can no longer
  // use the old mailbox. Check the person first (phone/WhatsApp); recorded in
  // the admin log with both addresses and the reason; both get a notice.
  function emailBox(r) {
    if (!r.user_id || !r.email) return '';
    const id = esc(r.user_id), inp = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font:inherit;font-size:0.8rem;min-width:0;';
    return `<div data-account-email="${id}" style="margin-top:10px;padding:10px 12px;background:var(--white);border:1px solid var(--border);border-radius:8px;">
      <div style="font-weight:600;font-size:0.82rem;">Email di accesso</div>
      <div style="font-size:0.74rem;margin:2px 0 4px;"><span>Attuale:</span> <strong data-i18n-skip>${esc(r.email)}</strong></div>
      <div style="font-size:0.74rem;color:var(--ink-soft);margin:0 0 8px;">Usa questo cambio solo se l’host non può confermarlo da sé in Impostazioni (per esempio non accede più alla vecchia casella). Verifica prima l’identità (telefono o WhatsApp). Le strutture e i dati restano; avvisi e promemoria passano al nuovo indirizzo; entrambi gli indirizzi ricevono un avviso.</div>
      ${phonesOnFile(r)}
      <label style="display:flex;gap:6px;align-items:flex-start;font-size:0.76rem;margin:4px 0;"><input type="checkbox" id="acctCall-${id}" data-account-check="callback"> <span>Ho richiamato l’host a un numero già in archivio (non a un numero indicato nella richiesta).</span></label>
      <label style="display:flex;gap:6px;align-items:flex-start;font-size:0.76rem;margin:4px 0 8px;"><input type="checkbox" id="acctDetails-${id}" data-account-check="details"> <span>L’host ha confermato dettagli della sua struttura o di una prenotazione recente.</span></label>
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <label style="position:absolute;left:-9999px;" for="acctNew-${id}">Nuova email</label>
        <input id="acctNew-${id}" type="email" autocomplete="off" placeholder="nuova@email.it" style="${inp}flex:1 1 180px;">
        <label style="position:absolute;left:-9999px;" for="acctWhy-${id}">Motivo</label>
        <input id="acctWhy-${id}" type="text" maxlength="500" placeholder="Motivo e verifica (es. telefonata del 19/11)" style="${inp}flex:2 1 220px;">
        <button type="button" data-account-email-save onclick="UsersAdmin.changeEmail('${id}')" style="padding:6px 10px;border:1px solid #B54708;background:#FFFAEB;color:#B54708;border-radius:6px;cursor:pointer;font:inherit;font-size:0.78rem;font-weight:600;white-space:nowrap;">Cambia email</button>
      </div>
      <div data-account-email-msg role="status" style="font-size:0.74rem;margin-top:6px;"></div>
    </div>`;
  }
  // Numbers already on file for the host's properties: call back on these,
  // never on a number given in the request (docs/support/EMAIL_CHANGE.md).
  function phonesOnFile(r) {
    const list = (r.properties || []).filter(p => p.phone);
    if (!list.length) return '<div data-account-phones style="font-size:0.76rem;color:#B54708;margin:0 0 6px;">Nessun telefono in archivio per le sue strutture: verifica con un secondo canale già noto (per esempio una chat WhatsApp già esistente) e con dettagli che solo l’host conosce. Nel dubbio, non cambiare.</div>';
    return `<div data-account-phones style="font-size:0.76rem;margin:0 0 6px;"><span>Telefoni in archivio:</span> ${list.map(p => `<span data-i18n-skip>${esc(p.name)}: <a href="tel:${esc(p.phone.replace(/[^+0-9]/g, ''))}">${esc(p.phone)}</a></span>`).join(' · ')}</div>`;
  }
  async function changeEmail(uid) {
    const row = (data && data.rows || []).find(x => x.user_id === uid);
    const box = document.querySelector(`[data-account-email="${uid}"]`);
    if (!row || !box) return;
    const say = (t, bad) => { const m = box.querySelector('[data-account-email-msg]'); if (m) { m.textContent = t; m.style.color = bad ? '#B42318' : '#027A48'; } };
    const newEmail = String(document.getElementById('acctNew-' + uid).value || '').trim().toLowerCase();
    const reason = String(document.getElementById('acctWhy-' + uid).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(newEmail)) return say('Scrivi una nuova email valida.', true);
    if (reason.length < 5) return say('Scrivi il motivo e come hai verificato l’identità.', true);
    const checks = { callback: !!document.getElementById('acctCall-' + uid)?.checked, details: !!document.getElementById('acctDetails-' + uid)?.checked };
    if (!checks.callback || !checks.details) return say('Completa i due controlli d’identità prima di cambiare l’email.', true);
    if (!root.confirm(`Cambiare l’email di accesso da ${row.email} a ${newEmail}?\n\nL’host accederà solo con il nuovo indirizzo. Entrambi gli indirizzi ricevono un avviso.`)) return;
    const btn = box.querySelector('[data-account-email-save]'); if (btn) btn.disabled = true;
    try {
      const { data: s } = await adminClient().auth.getSession();
      const token = s && s.session && s.session.access_token;
      const res = await root.fetch('/api/admin-host-health', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'account_email_change', user_id: uid, new_email: newEmail, reason, checks, dry: false }), signal: AbortSignal.timeout(30000) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { say(j.error === 'audit_unavailable' ? 'Registro amministratore non disponibile: nessuna modifica fatta. Riprova tra poco.' : (j.error || ('Errore ' + res.status)), true); if (btn) btn.disabled = false; return; }
      const n = j.notices || {};
      if (root.adminToast) root.adminToast(`Email cambiata in ${j.new_email}` + (n.old && n.new ? ' · avvisi inviati' : ' · avvisi NON tutti inviati'), n.old && n.new ? 'success' : 'error');
      data = null; error = null; load();
    } catch (e) { say('Cambio non verificato: ricarica la lista prima di riprovare.', true); if (btn) btn.disabled = false; }
  }

  async function load() {
    loading = true; error = null; render();
    try {
      const { data: s } = await adminClient().auth.getSession();
      const token = s && s.session && s.session.access_token;
      if (!token) throw new Error('Non hai effettuato l’accesso');
      const r = await root.fetch('/api/admin-host-health', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'users_overview' }), signal: AbortSignal.timeout(60000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('Errore HTTP ' + r.status));
      if (!Array.isArray(j.rows) || !j.summary) throw new Error('risposta non valida');
      data = j;
    } catch (e) { error = String(e && e.message || e); }
    loading = false; render();
  }

  function rowsToShow(now) {
    const q = view.search.trim().toLowerCase();
    const list = (data.rows || []).filter(r => (view.showTest || (!r.is_test && !r.is_admin))
      && (!q || String(r.email || '').toLowerCase().includes(q) || r.properties.some(p => String(p.name).toLowerCase().includes(q))));
    const key = {
      host: r => String(r.email || ''), registered: r => String(r.registered_at || r.invited_at || ''),
      plan: r => planCell(r.plan, now, r)[2], last: r => String(r.last_active_at || ''), days: r => r.active_days_30,
      checkins: r => r.checkins_30, activity: r => ACTIVITY[r.activity][2],
      terms: r => r.terms ? String(r.terms.accepted_at) : '',
    }[view.sort] || (r => '');
    const sign = view.dir === 'asc' ? 1 : -1;
    return list.map((r, i) => ({ r, i })).sort((a, b) => { const x = key(a.r), y = key(b.r); return (x < y ? -1 : x > y ? 1 : a.i - b.i) * sign; }).map(x => x.r);
  }

  function render() {
    const host = document.getElementById('content');
    if (!host) return;
    if (!data && !loading && !error) { load(); return; }
    const now = data ? new Date(data.generated_at).getTime() : Date.now();
    const s = data ? data.summary : null;
    const tile = (label, value, hint, attr) => `<div ${attr} style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px 12px;min-width:0;"><div style="font-size:0.72rem;color:var(--ink-soft);">${esc(label)}</div><div style="font-size:1.35rem;font-weight:700;">${value}</div>${hint ? `<div style="font-size:0.7rem;color:var(--ink-soft);">${esc(hint)}</div>` : ''}</div>`;
    const th = (k, label) => `<th scope="col"><button type="button" data-users-sort="${k}" onclick="UsersAdmin.sort('${k}')" style="border:0;background:none;padding:0;font:inherit;font-weight:600;cursor:pointer;color:inherit;">${esc(label)}${view.sort === k ? (view.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
    let body = '';
    if (loading && !data) body = '<div class="loading">Caricamento utenti…</div>';
    else if (error && !data) body = `<p role="status" data-users-error style="color:#B42318;">Utenti non disponibili: ${esc(error)} <button type="button" onclick="UsersAdmin.reload()">Riprova</button></p>`;
    else {
      const rows = rowsToShow(now);
      body = `<div data-users-summary style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px;">
          ${tile('Host', s.hosts, `${s.registered_30} nuovi negli ultimi 30 gg`, 'data-tile="hosts"')}
          ${tile('Attivi (7 gg)', s.active_7, 'hanno usato la console', 'data-tile="active"')}
          ${tile('Inattivi', s.inactive, 'oltre 30 gg o mai usato', 'data-tile="inactive"')}
          ${tile('Non registrati', s.not_registered, 'invito non completato', 'data-tile="invited"')}
          ${tile('Condizioni accettate', s.terms_accepted, `${s.terms_pending} registrati devono ancora accettare`, 'data-tile="terms"')}
          ${tile('Prova in scadenza', s.trial_ending_7, `entro 7 gg · ${s.in_trial} in prova · ${s.trial_ended || 0} scadute · ${s.paying} paganti`, 'data-tile="trial"')}
        </div>
        ${s.prelaunch ? '<p role="status" data-users-prelaunch style="font-size:0.78rem;color:var(--ink-soft);margin:0 0 8px;">La prova parte dalla registrazione. Prima del lancio le date sono solo indicative: nessun host vede avvisi o blocchi finché non premi «Lancia». Correggi la data di ognuno con «Gestisci».</p>' : ''}
        ${data.plan_error ? '<p role="status" style="font-size:0.78rem;color:#B54708;">Stato della prova non disponibile per alcuni utenti.</p>' : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
          <label for="usersSearch" style="position:absolute;left:-9999px;">Cerca</label>
          <input id="usersSearch" type="search" placeholder="Cerca email o struttura" value="${esc(view.search)}" oninput="UsersAdmin.search(this.value)" style="flex:1 1 200px;min-width:0;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font:inherit;">
          <label style="display:flex;gap:4px;align-items:center;font-size:0.8rem;"><input type="checkbox" id="usersShowTest" ${view.showTest ? 'checked' : ''} onchange="UsersAdmin.toggleTest(this.checked)"> Mostra test e admin</label>
          <button type="button" onclick="UsersAdmin.reload()" style="padding:6px 10px;border:1px solid var(--border);background:var(--white);border-radius:6px;cursor:pointer;font:inherit;font-size:0.8rem;">Aggiorna</button>
          <span style="font-size:0.72rem;color:var(--ink-soft);">Aggiornato ${esc(new Date(data.generated_at).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }))}</span>
        </div>
        <div style="overflow-x:auto;background:var(--white);border:1px solid var(--border);border-radius:10px;" tabindex="0" role="region" aria-label="Utenti">
          <table class="data-table" data-users-table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
            <thead><tr>${th('host', 'Host')}${th('registered', 'Registrato')}${th('plan', 'Prova / piano')}${th('last', 'Ultima attività')}${th('days', 'Giorni attivi')}${th('checkins', 'Check-in 30 gg')}${th('activity', 'Attività')}${th('terms', 'Condizioni')}<th scope="col">Abbonamento</th></tr></thead>
            <tbody>${rows.map(r => {
              const [planText, planTone] = planCell(r.plan, now, r);
              const [actText, actTone] = ACTIVITY[r.activity];
              const props = r.properties.length ? r.properties.map(p => esc(p.name) + (p.test ? ' (test)' : '')).join(', ') : '';
              const open = r.email && r.user_id ? `<button type="button" data-users-open onclick="UsersAdmin.openHost('${esc(r.email)}')" style="border:0;background:none;padding:0;font:inherit;font-weight:600;color:var(--warm, #1849A9);cursor:pointer;text-align:left;overflow-wrap:anywhere;">${esc(r.email)}</button>` : `<span style="font-weight:600;overflow-wrap:anywhere;">${esc(r.email || '—')}</span>`;
              return `<tr data-users-row="${esc(r.user_id || r.email)}" data-activity="${r.activity}">
                <td style="min-width:180px;">${open}${r.is_admin ? ' ' + chip('Admin', 'grey') : ''}${r.is_test ? ' ' + chip('Test', 'grey') : ''}<div style="font-size:0.72rem;color:var(--ink-soft);">${props || esc(STATUS[r.status] || '')}</div></td>
                <td style="white-space:nowrap;">${r.registered_at ? fmt(r.registered_at) : `<span style="color:var(--ink-soft);">invitato il ${fmt(r.invited_at)}</span><div style="font-size:0.72rem;color:#B54708;">password non creata</div>`}</td>
                <td>${chip(planText, planTone, 'data-plan')}</td>
                <td style="white-space:nowrap;" data-last>${esc(ago(r.last_active_at, now))}</td>
                <td style="white-space:nowrap;" data-days>${r.active_days_7} / 7 · ${r.active_days_30} / 30</td>
                <td data-checkins>${r.checkins_30}</td>
                <td>${chip(actText, actTone, 'data-activity-chip')}</td>
                <td data-terms style="white-space:nowrap;">${termsCell(r)}</td>
                <td>${r.user_id ? `<button type="button" data-users-billing-toggle="${esc(r.user_id)}" aria-expanded="${openBilling.has(r.user_id)}" onclick="UsersAdmin.toggleBilling('${esc(r.user_id)}')" style="padding:4px 10px;border:1px solid var(--border);background:var(--white);border-radius:6px;cursor:pointer;font:inherit;font-size:0.76rem;white-space:nowrap;">${openBilling.has(r.user_id) ? 'Chiudi ▴' : 'Gestisci ▾'}</button>` : ''}</td></tr>
                ${r.user_id && openBilling.has(r.user_id) ? `<tr data-users-billing="${esc(r.user_id)}"><td colspan="9" style="background:#F9FAFB;">${r.billing && typeof root.renderBillingBox === 'function' ? root.renderBillingBox(r.billing, r.user_id) : '<p style="font-size:0.78rem;color:#B54708;margin:0;">Abbonamento non disponibile: aggiorna la pagina.</p>'}${emailBox(r)}</td></tr>` : ''}`;
            }).join('') || '<tr><td colspan="9">Nessun utente.</td></tr>'}</tbody>
          </table></div>
        <p style="font-size:0.72rem;color:var(--ink-soft);margin-top:6px;">Attivo = ha usato la console negli ultimi 7 giorni · In calo = 8–30 giorni · Inattivo = oltre 30 giorni. Giorni attivi = giorni distinti con attività in console. Tocca un host per il dettaglio e per aprire la console di ogni struttura · «Condizioni» = versione accettata dall’account e data, «Scarica prova» scarica le prove dell’accettazione · «Gestisci» per prova, pagamento e gratis a vita.</p>
        ${typeof root.renderBillingSettings === 'function' ? root.renderBillingSettings() : ''}
        ${typeof root.renderRecentActivity === 'function' ? root.renderRecentActivity() : ''}`;
    }
    host.innerHTML = `<div class="section-title">Utenti</div>${body}`;
  }

  function openHost(email) {
    const sel = document.getElementById('userFilter');
    if (sel && ![...sel.options].some(o => o.value === email)) sel.add(new Option(email.split('@')[0], email));
    if (sel) sel.value = email;
    if (root.setActiveTab) root.setActiveTab('deepdive');
  }
  function sortBy(k) { view = { ...view, dir: view.sort === k && view.dir === 'desc' ? 'asc' : 'desc', sort: k }; render(); }
  function search(v) {
    view = { ...view, search: v }; render();
    const el = document.getElementById('usersSearch'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
  }
  function toggleBilling(uid) { if (openBilling.has(uid)) openBilling.delete(uid); else openBilling.add(uid); render(); }
  root.UsersAdmin = { render, toggleBilling, termsEvidence, changeEmail, invalidate: () => { data = null; error = null; }, reload: () => { data = null; error = null; load(); }, sort: sortBy, search, toggleTest: on => { view = { ...view, showTest: !!on }; render(); }, openHost, _reset: () => { data = null; error = null; loading = false; openBilling.clear(); view = { sort: 'registered', dir: 'desc', search: '', showTest: false }; } };
})(typeof window !== 'undefined' ? window : globalThis);
