// 17 Nov 2026 — admin home «Utenti»: who registered, where the free trial
// stands, how active they are. 24 Nov 2026 (Daniele: «combine in one tab
// users and contacts… keep the sortable columns… all details of each contact
// when clicking on a user… no horizontal scrolling… keep the filter by
// status»): one row per PERSON — host accounts, invited and prospects — from
// users_overview + contacts_list (admin-contacts.js). Clicking a person opens
// the contact detail with the account section (subscription and trial, login
// e-mail, terms, deep dive). Wide screens: a table; below 1200 px each row is
// a stacked card with a «Ordina per» menu, so nothing scrolls sideways.
// Uses the admin page's sb, escapeHtml, setActiveTab and #userFilter.
(function (root) {
  'use strict';
  // admin.html declares its Supabase client with a top-level `const sb`,
  // which other scripts reach by name but which is not a window property.
  // eslint-disable-next-line no-undef
  const adminClient = () => (typeof sb !== 'undefined' ? sb : root.sb);
  const DAY = 86400000;
  let data = null, loading = false, error = null;
  let view = { sort: 'registered', dir: 'desc', search: '', showTest: false, filter: 'all' };
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
      data = null; error = null; load(); if (root.ContactsAdmin) root.ContactsAdmin.reload();
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
    if (root.ContactsAdmin) root.ContactsAdmin.refreshModal();
  }

  // ── People: accounts (users_overview) joined with contacts (contacts_list) ──
  const CA = () => root.ContactsAdmin || null;
  function people() {
    const cd = CA() && CA().data(); const contacts = cd ? cd.contacts : [];
    const byUid = new Map(), byMail = new Map();
    for (const c of contacts) { if (c.user_id) byUid.set(c.user_id, c); const m = String(c.login_email || c.email || '').toLowerCase(); if (m) byMail.set(m, c); }
    const used = new Set(), out = [];
    for (const r of data.rows) {
      const c = (r.user_id && byUid.get(r.user_id)) || byMail.get(String(r.email || '').toLowerCase()) || null;
      if (c) used.add(c.id);
      out.push({ key: r.user_id || r.email, user: r, contact: c });
    }
    for (const c of contacts) if (!used.has(c.id)) out.push({ key: c.id, user: null, contact: c });
    return out;
  }
  const isAccount = p => !!(p.user && p.user.user_id && p.user.status !== 'invited');
  // Status family for the filter chips.
  function kind(p, now) {
    if (!isAccount(p)) return 'lead';
    const k = p.contact && p.contact.account && p.contact.status && p.contact.status.kind;
    if (k && k !== 'account') return k === 'read_only' ? 'expired' : k;
    const st = p.user.plan && p.user.plan.state, sub = p.user.billing && p.user.billing.subscription;
    if (st === 'free' || (sub && sub.status === 'free_forever')) return 'free';
    if (st === 'active' || (sub && sub.status === 'active')) return 'paying';
    if (st === 'grace' || st === 'read_only') return 'expired';
    if (st === 'trial') return 'trial';
    if (sub && sub.trial_ends_at) return new Date(sub.trial_ends_at).getTime() > now ? 'trial' : 'expired';
    return 'other';
  }
  const STAGE = { lead: 'Lead', contacted: 'Contattato', demo: 'Demo', invited: 'Invitato', lost: 'Perso' };
  const FILTERS = [['all', 'Tutti'], ['leads', 'Lead'], ['trial', 'Prova'], ['paying', 'Paganti'], ['free', 'Gratis'], ['expired', 'Scaduti'], ['due', 'Da fare']];
  const isDue = p => !!(p.contact && CA() && CA().isDue(p.contact));
  function inFilter(p, f, now) {
    if (f === 'all') return true;
    if (f === 'due') return isDue(p);
    const k = kind(p, now);
    return f === 'leads' ? k === 'lead' : k === f;
  }
  const nameOf = p => (p.contact && p.contact.full_name) || (p.user && p.user.email) || (p.contact && (p.contact.login_email || p.contact.email)) || (p.contact && p.contact.phone && CA() ? CA().fmtPhone(p.contact.phone) : '') || '—';
  const mailOf = p => (p.user && p.user.email) || (p.contact && (p.contact.login_email || p.contact.email)) || '';
  function stateCell(p, now) {
    if (isAccount(p)) return planCell(p.user.plan, now, p.user);
    const stage = (p.contact && p.contact.lead_stage) || (p.user && p.user.status === 'invited' ? 'invited' : 'lead');
    return [STAGE[stage] || 'Lead', stage === 'lost' ? 'grey' : 'blue', 2e6];
  }
  TONE.blue = ['#EFF8FF', '#175CD3'];

  function rowsToShow(now) {
    const q = view.search.trim().toLowerCase(), qd = q.replace(/\D/g, '');
    const list = people().filter(p => {
      const u = p.user;
      if (u && !view.showTest && (u.is_test || u.is_admin)) return false;
      if (!inFilter(p, view.filter, now)) return false;
      if (!q) return true;
      if (qd.length >= 3 && p.contact && String(p.contact.phone || '').replace(/\D/g, '').includes(qd)) return true;
      const props = [...((u && u.properties) || []), ...((p.contact && p.contact.properties) || [])].map(x => x.name);
      return [nameOf(p), mailOf(p), ...props].some(v => String(v || '').toLowerCase().includes(q));
    });
    const NONE = view.dir === 'asc' ? '￿' : '';
    const key = {
      host: p => nameOf(p).toLowerCase(), registered: p => String((p.user && (p.user.registered_at || p.user.invited_at)) || (p.contact && p.contact.created_at) || ''),
      plan: p => stateCell(p, now)[2], last: p => String((p.user && p.user.last_active_at) || ''), days: p => p.user ? p.user.active_days_30 : -1,
      checkins: p => p.user ? p.user.checkins_30 : -1, activity: p => p.user ? ACTIVITY[p.user.activity][2] : 9,
      terms: p => p.user && p.user.terms ? String(p.user.terms.accepted_at) : '',
      next: p => (p.contact && p.contact.next_action_due) || NONE,
    }[view.sort] || (() => '');
    const sign = view.dir === 'asc' ? 1 : -1;
    return list.map((p, i) => ({ p, i })).sort((a, b) => { const x = key(a.p), y = key(b.p); return (x < y ? -1 : x > y ? 1 : a.i - b.i) * sign; }).map(x => x.p);
  }

  const COLS = [['host', 'Contatto'], ['plan', 'Stato'], ['registered', 'Registrato'], ['last', 'Ultima attività'], ['days', 'Giorni attivi'], ['checkins', 'Check-in 30 gg'], ['activity', 'Attività'], ['terms', 'Condizioni'], ['next', 'Prossima azione']];
  const CSS = `.u-tbl{width:100%;border-collapse:collapse;font-size:0.8rem;table-layout:auto}
.u-tbl th,.u-tbl td{padding:8px 6px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
.u-tbl th{font-size:0.74rem}.u-lbl{display:none}.u-sortbar{display:none}
.u-act{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;border:1px solid var(--border);border-radius:8px;text-decoration:none;margin:4px 4px 0 0;font-size:0.9rem;background:var(--white)}
@media (max-width:1199px){.u-tbl thead{display:none}.u-tbl,.u-tbl tbody,.u-tbl tr,.u-tbl td{display:block;width:auto}
.u-tbl tr{border:1px solid var(--border);border-radius:10px;margin:0 0 10px;padding:6px 12px;background:var(--white)}
.u-tbl td{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:5px 0;border:0}
.u-tbl td.u-main{display:block;padding-bottom:8px;border-bottom:1px solid var(--border)}
.u-tbl td:empty,.u-tbl td.u-none{display:none}
.u-lbl{display:inline;color:var(--ink-soft);font-size:0.74rem;flex:0 0 auto}.u-val{text-align:right;min-width:0}
.u-sortbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.u-act{min-width:44px;min-height:44px}}`;

  function cells(p, now) {
    const u = p.user, c = p.contact, CAx = CA();
    const td = (lbl, val, attr = '') => `<td ${attr}><span class="u-lbl">${esc(lbl)}</span><span class="u-val">${val}</span></td>`;
    const none = '<span style="color:var(--ink-soft);">—</span>';
    const [stText, stTone] = stateCell(p, now);
    const props = ((u && u.properties) || []).map(x => esc(x.name) + (x.test ? ' (test)' : '')).join(', ');
    const phone = c && c.phone;
    const acts = phone && CAx ? `<a class="u-act" data-users-wa href="${esc(CAx.waUrl(phone))}" target="_blank" rel="noopener" title="WhatsApp" aria-label="WhatsApp">💬</a><a class="u-act" data-users-call href="tel:${esc(phone)}" title="Chiama" aria-label="Chiama">📞</a>` : '';
    const mail = mailOf(p);
    const main = `<td class="u-main" style="min-width:160px;">
      <button type="button" data-users-open="${esc(p.key)}" onclick="UsersAdmin.openPerson('${esc(p.key)}')" style="border:0;background:none;padding:0;font:inherit;font-weight:700;color:var(--warm, #1849A9);cursor:pointer;text-align:left;overflow-wrap:anywhere;min-height:32px;"><span data-i18n-skip>${esc(nameOf(p))}</span></button>
      ${u && u.is_admin ? chip('Admin', 'grey') : ''}${u && u.is_test ? ' ' + chip('Test', 'grey') : ''}
      ${mail && mail !== nameOf(p) ? `<div data-i18n-skip style="font-size:0.74rem;color:var(--ink-soft);">${esc(mail)}</div>` : ''}
      ${phone && CAx ? `<div data-i18n-skip style="font-size:0.74rem;">${esc(CAx.fmtPhone(phone))}</div>` : ''}
      <div style="font-size:0.72rem;color:var(--ink-soft);">${props ? `<span data-i18n-skip>${props}</span>` : esc(u ? STATUS[u.status] || '' : 'Nessun account')}</div>
      ${acts ? `<div>${acts}</div>` : ''}</td>`;
    const reg = u ? (u.registered_at ? esc(fmt(u.registered_at)) : `<span style="color:var(--ink-soft);">invitato il ${esc(fmt(u.invited_at))}</span><div style="font-size:0.72rem;color:#B54708;">password non creata</div>`) : none;
    let next = '';
    if (c && (c.next_action || c.next_action_due)) {
      const due = c.next_action_due, t = CAx ? CAx.today() : '';
      const col = due && due < t ? '#B42318' : due && due === t ? '#B54708' : 'var(--ink-soft)';
      next = `${due ? `<strong style="color:${col};white-space:nowrap;">${esc(due.slice(8, 10) + '/' + due.slice(5, 7))}</strong> ` : ''}${c.next_action ? `<span data-i18n-skip>${esc(c.next_action)}</span>` : ''}`;
    }
    return main
      + td('Stato', chip(stText, stTone, 'data-plan'))
      + td('Registrato', reg)
      + td('Ultima attività', u ? esc(ago(u.last_active_at, now)) : none, 'data-last' + (u ? '' : ' class="u-none"'))
      + td('Giorni attivi', u ? `${u.active_days_7} / 7 · ${u.active_days_30} / 30` : none, 'data-days' + (u ? '' : ' class="u-none"'))
      + td('Check-in 30 gg', u ? String(u.checkins_30) : none, 'data-checkins' + (u ? '' : ' class="u-none"'))
      + td('Attività', u ? chip(...ACTIVITY[u.activity].slice(0, 2), 'data-activity-chip') : none, u ? '' : 'class="u-none"')
      + td('Condizioni', u ? termsCell(u) : none, 'data-terms' + (u && u.user_id ? '' : ' class="u-none"'))
      + td('Prossima azione', next || none, 'data-next' + (next ? '' : ' class="u-none"'));
  }

  function render() {
    const host = document.getElementById('content');
    if (!host) return;
    if (!data && !loading && !error) { load(); return; }
    if (CA() && !CA().data() && !CA().error()) CA().ensureData();
    const now = data ? new Date(data.generated_at).getTime() : Date.now();
    const s = data ? data.summary : null;
    const tile = (label, value, hint, attr) => `<div ${attr} style="background:var(--white);border:1px solid var(--border);border-radius:10px;padding:10px 12px;min-width:0;"><div style="font-size:0.72rem;color:var(--ink-soft);">${esc(label)}</div><div style="font-size:1.35rem;font-weight:700;">${value}</div>${hint ? `<div style="font-size:0.7rem;color:var(--ink-soft);">${esc(hint)}</div>` : ''}</div>`;
    const th = (k, label) => `<th scope="col"><button type="button" data-users-sort="${k}" onclick="UsersAdmin.sort('${k}')" style="border:0;background:none;padding:0;font:inherit;font-weight:600;cursor:pointer;color:inherit;text-align:left;">${esc(label)}${view.sort === k ? (view.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
    const btn = 'min-height:40px;padding:6px 12px;border:1px solid var(--border);background:var(--white);border-radius:8px;cursor:pointer;font:inherit;font-size:0.8rem;';
    let body = '';
    if (loading && !data) body = '<div class="loading">Caricamento utenti…</div>';
    else if (error && !data) body = `<p role="status" data-users-error style="color:#B42318;">Utenti non disponibili: ${esc(error)} <button type="button" onclick="UsersAdmin.reload()">Riprova</button></p>`;
    else {
      const all = people().filter(p => view.showTest || !(p.user && (p.user.is_test || p.user.is_admin)));
      const rows = rowsToShow(now);
      const ce = CA() && CA().error();
      body = `<style>${CSS}</style><div data-users-summary style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px;">
          ${tile('Host', s.hosts, `${s.registered_30} nuovi negli ultimi 30 gg`, 'data-tile="hosts"')}
          ${tile('Attivi (7 gg)', s.active_7, 'hanno usato la console', 'data-tile="active"')}
          ${tile('Inattivi', s.inactive, 'oltre 30 gg o mai usato', 'data-tile="inactive"')}
          ${tile('Non registrati', s.not_registered, 'invito non completato', 'data-tile="invited"')}
          ${tile('Condizioni accettate', s.terms_accepted, `${s.terms_pending} registrati devono ancora accettare`, 'data-tile="terms"')}
          ${tile('Prova in scadenza', s.trial_ending_7, `entro 7 gg · ${s.in_trial} in prova · ${s.trial_ended || 0} scadute · ${s.paying} paganti`, 'data-tile="trial"')}
        </div>
        ${s.prelaunch ? '<p role="status" data-users-prelaunch style="font-size:0.78rem;color:var(--ink-soft);margin:0 0 8px;">La prova parte dalla registrazione. Prima del lancio le date sono solo indicative: nessun host vede avvisi o blocchi finché non premi «Lancia». Correggi la data di ognuno aprendo la sua scheda.</p>' : ''}
        ${data.plan_error ? '<p role="status" style="font-size:0.78rem;color:#B54708;">Stato della prova non disponibile per alcuni utenti.</p>' : ''}
        ${ce ? `<p role="status" data-users-contacts-error style="font-size:0.78rem;color:#B54708;">Contatti non disponibili: ${esc(ce)}</p>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;">
          <label for="usersSearch" style="position:absolute;left:-9999px;">Cerca</label>
          <input id="usersSearch" type="search" placeholder="Cerca nome, email, telefono o struttura" value="${esc(view.search)}" oninput="UsersAdmin.search(this.value)" style="flex:1 1 220px;min-width:0;min-height:40px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;">
          <button type="button" data-contacts-add onclick="ContactsAdmin.openCreate()" style="${btn}background:#005BFF;border-color:#005BFF;color:#fff;font-weight:600;">＋ Aggiungi contatto</button>
          <button type="button" onclick="UsersAdmin.reload()" style="${btn}">Aggiorna</button>
          <label style="display:flex;gap:4px;align-items:center;font-size:0.8rem;"><input type="checkbox" id="usersShowTest" ${view.showTest ? 'checked' : ''} onchange="UsersAdmin.toggleTest(this.checked)"> Mostra test e admin</label>
        </div>
        <div role="group" aria-label="Filtri" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">${FILTERS.map(([k, t]) => {
          const n = all.filter(p => inFilter(p, k, now)).length, on = view.filter === k, red = k === 'due' && all.some(p => p.contact && CA() && CA().isOverdue(p.contact));
          return `<button type="button" data-users-filter="${k}" aria-pressed="${on}" onclick="UsersAdmin.filter('${k}')" style="${btn}border-radius:999px;${on ? 'background:var(--warm,#005BFF);border-color:var(--warm,#005BFF);color:#fff;' : red ? 'border-color:#F04438;color:#B42318;' : ''}"><span>${esc(t)}</span> <span data-i18n-skip>${n}</span></button>`;
        }).join('')}</div>
        <div class="u-sortbar" style="margin-bottom:8px;font-size:0.8rem;"><label for="usersSortSel">Ordina per</label>
          <select id="usersSortSel" onchange="UsersAdmin.sortTo(this.value)" style="min-height:40px;border:1px solid var(--border);border-radius:8px;font:inherit;padding:4px 8px;">${COLS.map(([k, l]) => `<option value="${k}" ${view.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
          <button type="button" data-users-dir onclick="UsersAdmin.sort('${view.sort}')" style="${btn}" aria-label="Inverti ordine">${view.dir === 'asc' ? '▲' : '▼'}</button></div>
        <table class="u-tbl" data-users-table>
          <thead><tr>${COLS.map(([k, l]) => th(k, l)).join('')}</tr></thead>
          <tbody>${rows.map(p => `<tr data-users-row="${esc(p.key)}" data-kind="${kind(p, now)}"${p.user ? ` data-activity="${p.user.activity}"` : ''}>${cells(p, now)}</tr>`).join('') || '<tr><td>Nessun utente.</td></tr>'}</tbody>
        </table>
        <p style="font-size:0.72rem;color:var(--ink-soft);margin-top:6px;">Tocca un nome per la scheda completa: contatto, note, prossima azione, strutture, abbonamento e prova, email di accesso, condizioni. Attivo = ha usato la console negli ultimi 7 giorni · In calo = 8–30 giorni · Inattivo = oltre 30 giorni. Giorni attivi = giorni distinti con attività in console.</p>
        ${typeof root.renderBillingSettings === 'function' ? root.renderBillingSettings() : ''}
        ${typeof root.renderRecentActivity === 'function' ? root.renderRecentActivity() : ''}`;
    }
    host.innerHTML = `<div class="section-title">Utenti</div>${body}`;
  }

  // Detail of a person: the contact view (admin-contacts.js) with the account
  // section below. A host account without a contact row yet (the list adds it
  // on the next load) opens the deep dive instead.
  function openPerson(key) {
    const p = data && people().find(x => String(x.key) === String(key));
    if (!p) return;
    if (p.contact && CA()) return CA().openDetail(p.contact.id);
    if (p.user && p.user.email) return openHost(p.user.email);
  }
  function accountSection(c) {
    const r = data && (data.rows || []).find(x => (c.user_id && x.user_id === c.user_id) || (!c.user_id && x.email && String(x.email).toLowerCase() === String(c.login_email || c.email || '').toLowerCase()));
    if (!r || !r.user_id) return null;
    const box = document.createElement('div');
    box.setAttribute('data-account-section', r.user_id);
    box.style.cssText = 'margin-top:16px;border-top:1px solid var(--border);padding-top:10px;';
    const terms = r.terms ? `<div style="font-size:0.8rem;margin:6px 0;"><span>Condizioni:</span> ${termsCell(r)}</div>` : `<div style="font-size:0.8rem;margin:6px 0;"><span>Condizioni:</span> ${termsCell(r)}</div>`;
    box.innerHTML = `<div style="font-weight:600;font-size:0.84rem;">Account</div>
      ${terms}
      ${r.email ? `<button type="button" data-users-deepdive onclick="ContactsAdmin.closeModal();UsersAdmin.openHost('${esc(r.email)}')" style="min-height:44px;padding:8px 12px;border:1px solid var(--border);background:var(--white);border-radius:8px;cursor:pointer;font:inherit;font-size:0.82rem;margin:4px 0 8px;">Approfondimento →</button>` : ''}
      ${r.billing && typeof root.renderBillingBox === 'function' ? root.renderBillingBox(r.billing, r.user_id) : '<p style="font-size:0.78rem;color:#B54708;margin:0;">Abbonamento non disponibile: aggiorna la pagina.</p>'}
      ${emailBox(r)}`;
    return box;
  }
  function openHost(email) {
    const sel = document.getElementById('userFilter');
    if (sel && ![...sel.options].some(o => o.value === email)) sel.add(new Option(email.split('@')[0], email));
    if (sel) sel.value = email;
    if (root.setActiveTab) root.setActiveTab('deepdive');
  }
  function sortBy(k) { view = { ...view, dir: view.sort === k && view.dir === 'desc' ? 'asc' : 'desc', sort: k }; render(); }
  function sortTo(k) { view = { ...view, sort: k }; render(); }
  function search(v) {
    view = { ...view, search: v }; render();
    const el = document.getElementById('usersSearch'); if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
  }
  const usersTabOpen = () => (typeof activeTab !== 'undefined' ? activeTab : root.activeTab) === 'users'; // eslint-disable-line no-undef
  function contactsChanged() { if (usersTabOpen() && data) render(); }
  root.UsersAdmin = { render, termsEvidence, changeEmail, openPerson, accountSection, contactsChanged, invalidate: () => { data = null; error = null; }, reload: () => { data = null; error = null; load(); if (CA()) CA().reload(); },
    sort: sortBy, sortTo, search, filter: k => { view = { ...view, filter: k }; render(); }, toggleTest: on => { view = { ...view, showTest: !!on }; render(); }, openHost,
    _view: () => ({ ...view }), _reset: () => { data = null; error = null; loading = false; view = { sort: 'registered', dir: 'desc', search: '', showTest: false, filter: 'all' }; } };
})(typeof window !== 'undefined' ? window : globalThis);
