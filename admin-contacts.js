// Round 77 — «Contatti»: host and prospect contacts (mini-CRM), admin only.
// Data: /api/admin-host-health actions contacts_* (service role, admin check,
// admin log). Vanilla JS. Every user-entered value (names, phones, e-mails,
// notes, next actions) is set with textContent and marked data-i18n-skip, so
// it is never parsed as HTML and the admin IT/EN translation never rewrites
// it. No native alert/confirm/prompt: confirmations are built in the page.
(function (root) {
  'use strict';
  // eslint-disable-next-line no-undef
  const adminClient = () => (typeof sb !== 'undefined' ? sb : root.sb);
  let data = null, loading = false, error = null, badgeTried = false;
  let view = { q: '', filter: 'all' };
  let openId = null, creating = false, pendingDelete = null, msg = null;

  // ── Phone rules (same as api/_admin-contacts.js and host_contacts_phone()) ──
  function normPhone(input) {
    let s = String(input == null ? '' : input).replace(/[\s.()\-]/g, '');
    if (!s) return { ok: true, value: null };
    if (s.startsWith('00')) s = '+' + s.slice(2);
    else if (/^[30]/.test(s)) s = '+39' + s;
    if (/^\+[1-9]\d{6,14}$/.test(s)) return { ok: true, value: s };
    return { ok: false, error: 'Numero non valido: usa il formato internazionale, per esempio +39 333 123 4567.' };
  }
  function fmtPhone(e164) {
    if (!e164) return '';
    const m = /^\+39(\d{3})(\d{3})(\d+)$/.exec(e164);
    if (m) return `+39 ${m[1]} ${m[2]} ${m[3]}`;
    // Other countries: shown as stored (country-code lengths vary; no guessing).
    return e164;
  }
  const waUrl = e164 => 'https://wa.me/' + String(e164 || '').replace(/[^0-9]/g, '');
  const digits = s => String(s || '').replace(/\D/g, '');

  // ── Dates (Europe/Rome) ──
  const romeYmd = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(d);
  const today = () => (data && data.today) || romeYmd(new Date());
  const addDays = (ymd, n) => { const t = new Date(ymd + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const fmtDay = ymd => ymd ? ymd.slice(8, 10) + '/' + ymd.slice(5, 7) + '/' + ymd.slice(0, 4) : '';
  const fmtWhen = iso => iso ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  // ── Status badge (derived on the server; text here) ──
  const STAGE = { lead: 'Lead', contacted: 'Contattato', demo: 'Demo', invited: 'Invitato', lost: 'Perso' };
  const TONE = { green: ['#ECFDF3', '#027A48'], amber: ['#FFFAEB', '#B54708'], red: ['#FEF3F2', '#B42318'], grey: ['#F2F4F7', '#475467'], blue: ['#EFF8FF', '#175CD3'] };
  function badge(c) {
    const s = c.status || {};
    switch (s.kind) {
      case 'trial': return [s.days_left != null ? `Prova · ${s.days_left} gg` : 'Prova', s.days_left != null && s.days_left <= 7 ? 'amber' : 'green'];
      case 'paying': return ['Pagante', 'green'];
      case 'free': return [s.admin ? 'Admin' : 'Gratis a vita', 'grey'];
      case 'expired': return ['Scaduto', 'red'];
      case 'read_only': return ['Sola lettura', 'red'];
      case 'account': return ['Account', 'grey'];
      default: return [STAGE[s.stage || c.lead_stage] || 'Lead', s.stage === 'lost' ? 'grey' : 'blue'];
    }
  }
  const isDue = c => !!c.next_action_due && c.next_action_due <= today();
  const isOverdue = c => !!c.next_action_due && c.next_action_due < today();
  const label = c => c.full_name || c.login_email || c.email || c.phone && fmtPhone(c.phone) || '—';

  // ── Filters, search, sort ──
  const FILTERS = [['all', 'Tutti'], ['leads', 'Lead'], ['trial', 'Prova'], ['paying', 'Paganti'], ['free', 'Gratis'], ['due', 'Da fare']];
  const inFilter = (c, f) => f === 'all' ? true : f === 'leads' ? !c.account : f === 'trial' ? c.status.kind === 'trial'
    : f === 'paying' ? c.status.kind === 'paying' : f === 'free' ? c.status.kind === 'free' : f === 'due' ? isDue(c) : true;
  function matches(c, q) {
    q = q.trim().toLowerCase();
    if (!q) return true;
    const qd = digits(q);
    if (qd.length >= 3 && digits(c.phone).includes(qd)) return true;
    return [c.full_name, c.email, c.login_email, ...(c.properties || []).map(p => p.name)].some(v => String(v || '').toLowerCase().includes(q));
  }
  function sorted(list) {
    const key = c => [isOverdue(c) ? 0 : 1, c.next_action_due || '9999-99-99', label(c).toLowerCase()];
    return list.slice().sort((a, b) => { const x = key(a), y = key(b); for (let i = 0; i < 3; i++) { if (x[i] < y[i]) return -1; if (x[i] > y[i]) return 1; } return 0; });
  }

  // ── Server ──
  async function call(action, payload = {}) {
    const { data: s } = await adminClient().auth.getSession();
    const token = s && s.session && s.session.access_token;
    if (!token) throw new Error('Non hai effettuato l’accesso');
    const r = await root.fetch('/api/admin-host-health', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action, ...payload }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error === 'audit_unavailable' ? 'Registro amministratore non disponibile: nessuna modifica fatta. Riprova tra poco.' : (j.error || ('Errore HTTP ' + r.status))); e.status = r.status; throw e; }
    return j;
  }
  async function load(silent) {
    loading = true; error = null; if (!silent) render();
    try { const j = await call('contacts_list'); if (!Array.isArray(j.contacts)) throw new Error('risposta non valida'); data = j; }
    catch (e) { error = String(e && e.message || e); }
    loading = false; updateBadge(); if (!silent || root.activeTab === 'contacts' || isOpen()) render();
  }
  const isOpen = () => (typeof activeTab !== 'undefined' ? activeTab : root.activeTab) === 'contacts'; // eslint-disable-line no-undef

  // ── Tab badge: due/overdue count ──
  function updateBadge() {
    const el = document.querySelector('[data-contacts-badge]');
    if (!el) return;
    const n = data ? data.contacts.filter(isDue).length : 0;
    el.textContent = n ? String(n) : '';
    el.style.display = n ? 'inline-block' : 'none';
    el.style.background = data && data.contacts.some(isOverdue) ? '#B42318' : '#B54708';
  }
  function ensureBadge() { if (badgeTried || data || loading) return; badgeTried = true; load(true); }

  // ── DOM helpers (user text only through textContent) ──
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') n.style.cssText = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n[k] = v; else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return n;
  }
  const userText = (tag, text, style, attrs) => el(tag, { 'data-i18n-skip': true, style, ...(attrs || {}), text: text == null ? '' : String(text) });
  const chip = (text, tone, attrs) => el('span', { ...(attrs || {}), style: `display:inline-block;padding:2px 8px;border-radius:999px;font-size:0.72rem;font-weight:600;background:${TONE[tone][0]};color:${TONE[tone][1]};white-space:nowrap;`, text });
  const BTN = 'min-height:44px;padding:8px 12px;border:1px solid var(--border);background:var(--white);border-radius:8px;cursor:pointer;font:inherit;font-size:0.82rem;display:inline-flex;align-items:center;justify-content:center;gap:4px;text-decoration:none;color:inherit;';
  const BTN_PRIMARY = BTN + 'background:#005BFF;border-color:#005BFF;color:#fff;font-weight:600;';
  const INPUT = 'min-height:44px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font:inherit;font-size:0.9rem;width:100%;box-sizing:border-box;';

  function actions(c) {
    const row = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;' });
    if (c.phone) {
      row.append(el('a', { href: waUrl(c.phone), target: '_blank', rel: 'noopener', 'data-contact-wa': true, style: BTN + 'border-color:#25D366;color:#128C4A;font-weight:600;' }, '💬 WhatsApp'));
      row.append(el('a', { href: 'tel:' + c.phone, 'data-contact-call': true, style: BTN }, '📞 Chiama'));
    }
    const mail = c.login_email || c.email;
    if (mail) row.append(el('a', { href: 'mailto:' + mail, 'data-contact-mail': true, style: BTN }, '✉️ Email'));
    if (c.phone) row.append(el('button', { type: 'button', 'data-contact-copy': true, style: BTN, onclick: ev => copyPhone(c.phone, ev.currentTarget) }, '📋 Copia numero'));
    return row;
  }
  async function copyPhone(phone, btn) {
    try { await navigator.clipboard.writeText(phone); flash(btn, '✓ Copiato'); }
    catch (_) {
      const i = el('input', { value: phone, 'data-i18n-skip': true, readonly: true, style: 'position:fixed;left:-9999px;' }); document.body.appendChild(i); i.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} i.remove(); flash(btn, ok ? '✓ Copiato' : phone);
    }
  }
  function flash(btn, text) { if (!btn) return; const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 1600); }

  function card(c) {
    const [bt, tone] = badge(c);
    const due = c.next_action_due;
    const dueTone = due && due < today() ? '#B42318' : due && due === today() ? '#B54708' : 'var(--ink-soft)';
    const box = el('div', { 'data-contact-card': c.id, 'data-overdue': isOverdue(c) ? '1' : null, style: 'background:var(--white);border:1px solid ' + (isOverdue(c) ? '#F04438' : 'var(--border)') + ';border-radius:12px;padding:12px 14px;min-width:0;' });
    const head = el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:flex-start;' },
      el('button', { type: 'button', 'data-contact-open': c.id, onclick: () => openDetail(c.id), style: 'border:0;background:none;padding:0;text-align:left;cursor:pointer;font:inherit;min-width:0;min-height:44px;' },
        userText('div', label(c), 'font-weight:700;font-size:0.98rem;overflow-wrap:anywhere;'),
        c.full_name && (c.login_email || c.email) ? userText('div', c.login_email || c.email, 'font-size:0.76rem;color:var(--ink-soft);overflow-wrap:anywhere;') : null),
      chip(bt, tone, { 'data-contact-status': true }));
    box.append(head);
    const meta = el('div', { style: 'font-size:0.8rem;margin-top:4px;display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--ink-soft);' });
    if (c.phone) meta.append(userText('span', fmtPhone(c.phone), 'color:var(--ink);', { 'data-contact-phone': true }));
    meta.append(el('span', { 'data-contact-props': true, text: c.account ? `${c.properties.length} ${c.properties.length === 1 ? 'struttura' : 'strutture'}` : 'Nessun account' }));
    if (c.last_note_at) meta.append(el('span', {}, 'Ultima nota ', userText('span', fmtDay(romeYmd(new Date(c.last_note_at))), '')));
    box.append(meta);
    if (c.next_action || due) {
      const na = el('div', { 'data-contact-next': true, style: 'margin-top:6px;font-size:0.84rem;' });
      if (due) na.append(el('strong', { style: 'color:' + dueTone + ';', text: (due < today() ? 'Scaduto ' : due === today() ? 'Oggi ' : '') }), userText('span', fmtDay(due) + (c.next_action ? ' · ' : ''), 'color:' + dueTone + ';font-weight:600;'));
      if (c.next_action) na.append(userText('span', c.next_action, ''));
      box.append(na);
    }
    box.append(actions(c));
    return box;
  }

  function render() {
    const host = document.getElementById('content');
    if (!host || !isOpen()) return;
    if (!data && !loading && !error) { load(); return; }
    host.textContent = '';
    host.append(el('style', { text: '@media (max-width:480px){[data-contacts-list]{grid-template-columns:1fr !important}}' }));
    host.append(el('div', { class: 'section-title', text: 'Contatti' }));
    if (loading && !data) { host.append(el('div', { class: 'loading', text: 'Caricamento contatti…' })); return; }
    if (error && !data) { host.append(el('p', { role: 'status', 'data-contacts-error': true, style: 'color:#B42318;' }, 'Contatti non disponibili: ', userText('span', error, ''), ' ', el('button', { type: 'button', style: BTN, onclick: () => load() }, 'Riprova'))); return; }
    const bar = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;' });
    const search = el('input', { id: 'contactsSearch', type: 'search', placeholder: 'Cerca nome, email, telefono o struttura', value: view.q, 'data-i18n-skip': null, style: INPUT + 'flex:1 1 220px;width:auto;',
      oninput: ev => { view.q = ev.target.value; renderList(); } });
    bar.append(el('label', { for: 'contactsSearch', style: 'position:absolute;left:-9999px;', text: 'Cerca' }), search,
      el('button', { type: 'button', 'data-contacts-add': true, style: BTN_PRIMARY, onclick: () => { creating = true; openId = null; msg = null; renderModal(); } }, '＋ Aggiungi contatto'),
      el('button', { type: 'button', style: BTN, onclick: () => load() }, 'Aggiorna'));
    host.append(bar);
    const chips = el('div', { role: 'group', 'aria-label': 'Filtri', style: 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;' });
    for (const [k, t] of FILTERS) {
      const n = data.contacts.filter(c => inFilter(c, k)).length;
      const on = view.filter === k;
      chips.append(el('button', { type: 'button', 'data-contacts-filter': k, 'aria-pressed': on ? 'true' : 'false', onclick: () => { view.filter = k; render(); },
        style: BTN + 'min-height:40px;border-radius:999px;' + (on ? 'background:var(--warm,#005BFF);border-color:var(--warm,#005BFF);color:#fff;' : '') + (k === 'due' && data.contacts.some(isOverdue) && !on ? 'border-color:#F04438;color:#B42318;' : '') },
        el('span', { text: t }), el('span', { 'data-i18n-skip': true, text: ' ' + n })));
    }
    host.append(chips);
    if (data.billing_error) host.append(el('p', { role: 'status', style: 'font-size:0.78rem;color:#B54708;', text: 'Stato dell’abbonamento non disponibile per alcuni contatti.' }));
    host.append(el('div', { 'data-contacts-list': true, style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px;' }));
    renderList();
    if (openId || creating) renderModal();
  }
  function renderList() {
    const list = document.querySelector('[data-contacts-list]');
    if (!list || !data) return;
    list.textContent = '';
    const rows = sorted(data.contacts.filter(c => inFilter(c, view.filter) && matches(c, view.q)));
    if (!rows.length) list.append(el('p', { style: 'color:var(--ink-soft);', text: 'Nessun contatto.' }));
    for (const c of rows) list.append(card(c));
  }

  // ── Detail / create modal ──
  function openDetail(id) { openId = id; creating = false; msg = null; pendingDelete = null; renderModal(); }
  function closeModal() { openId = null; creating = false; pendingDelete = null; msg = null; document.getElementById('contactModal')?.remove(); }
  function renderModal() {
    document.getElementById('contactModal')?.remove();
    const c = creating ? { lead_stage: 'lead', account: false, notes: [], properties: [] } : data && data.contacts.find(x => x.id === openId);
    if (!c) return;
    const wrap = el('div', { id: 'contactModal', role: 'dialog', 'aria-modal': 'true', 'aria-label': creating ? 'Nuovo contatto' : 'Contatto',
      style: 'position:fixed;inset:0;z-index:9000;background:rgba(6,26,61,0.45);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;padding:16px 8px;',
      onclick: ev => { if (ev.target === wrap) closeModal(); } });
    const panel = el('div', { style: 'background:var(--white,#fff);border-radius:14px;max-width:620px;width:100%;padding:16px;box-sizing:border-box;box-shadow:0 10px 40px rgba(0,0,0,0.2);' });
    wrap.append(panel);
    const top = el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:8px;' },
      creating ? el('strong', { style: 'font-size:1.05rem;', text: 'Nuovo contatto' }) : userText('strong', label(c), 'font-size:1.05rem;overflow-wrap:anywhere;'),
      el('button', { type: 'button', 'aria-label': 'Chiudi', 'data-contact-close': true, style: BTN + 'min-width:44px;', onclick: closeModal }, '×'));
    panel.append(top);
    if (!creating) { const [bt, tone] = badge(c); panel.append(chip(bt, tone)); panel.append(actions(c)); }
    const field = (lbl, input, hint) => el('label', { style: 'display:block;margin-top:10px;font-size:0.8rem;font-weight:600;' }, el('span', { text: lbl }), input, hint ? el('div', { style: 'font-weight:400;color:var(--ink-soft);font-size:0.74rem;margin-top:2px;', text: hint }) : null);
    const inp = (name, value, type) => el('input', { name, type: type || 'text', value: value == null ? '' : value, 'data-i18n-skip': true, style: INPUT + 'margin-top:4px;' });
    const f = {
      full_name: inp('full_name', c.full_name),
      phone: inp('phone', c.phone ? fmtPhone(c.phone) : '', 'tel'),
      email: inp('email', c.account ? (c.login_email || c.email) : c.email, 'email'),
      next_action: inp('next_action', c.next_action),
      next_action_due: inp('next_action_due', c.next_action_due, 'date'),
    };
    if (c.account) { f.email.readOnly = true; f.email.style.background = '#F2F4F7'; }
    const sel = (name, opts, value, empty) => { const s = el('select', { name, style: INPUT + 'margin-top:4px;' }); if (empty) s.append(el('option', { value: '', text: empty })); for (const [v, t] of opts) s.append(el('option', { value: v, text: t, selected: v === value })); return s; };
    f.source = sel('source', [['whatsapp', 'WhatsApp'], ['email', 'Email'], ['referral', 'Passaparola'], ['website', 'Sito web'], ['event', 'Evento'], ['other', 'Altro']], c.source, '—');
    if (!c.account) f.lead_stage = sel('lead_stage', Object.entries(STAGE), c.lead_stage || 'lead');
    const form = el('div', { 'data-contact-form': true });
    form.append(field('Nome', f.full_name), field('Telefono', f.phone, 'Es. 333 123 4567 o +44 7700 900123'), field('Email', f.email, c.account ? 'È l’email di accesso: si cambia da Utenti → Gestisci.' : null), field('Origine', f.source));
    if (f.lead_stage) form.append(field('Fase', f.lead_stage));
    form.append(field('Prossima azione', f.next_action), field('Scadenza', f.next_action_due));
    const quick = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;' });
    for (const [t, n] of [['Oggi', 0], ['+3 giorni', 3], ['+1 settimana', 7], ['Nessuna', null]]) quick.append(el('button', { type: 'button', 'data-contact-due': n === null ? 'clear' : String(n), style: BTN, onclick: () => { f.next_action_due.value = n === null ? '' : addDays(today(), n); } }, t));
    form.append(quick);
    panel.append(form);
    const status = el('div', { role: 'status', 'data-contact-msg': true, style: 'min-height:1.2em;margin-top:8px;font-size:0.84rem;' });
    if (msg) { status.textContent = msg.text; status.style.color = msg.bad ? '#B42318' : '#027A48'; }
    const buttons = el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;' });
    buttons.append(el('button', { type: 'button', 'data-contact-save': true, style: BTN_PRIMARY, onclick: () => save(c, f) }, creating ? 'Crea contatto' : 'Salva'));
    if (!creating && c.next_action) {
      const addNote = el('input', { type: 'checkbox', checked: true, 'data-contact-done-note': true });
      buttons.append(el('button', { type: 'button', 'data-contact-done': true, style: BTN, onclick: () => markDone(c, addNote.checked) }, '✓ Fatto'),
        el('label', { style: 'display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;' }, addNote, el('span', { text: 'aggiungi una nota' })));
    }
    panel.append(buttons, status);
    if (creating) { wrap.querySelector('input')?.focus?.(); document.body.appendChild(wrap); return; }
    // Properties (read-only) and billing (stays in Utenti).
    if (c.account) {
      const props = el('div', { style: 'margin-top:14px;' }, el('div', { style: 'font-weight:600;font-size:0.84rem;', text: 'Strutture' }));
      if (!c.properties.length) props.append(el('div', { style: 'font-size:0.8rem;color:var(--ink-soft);', text: 'Nessuna struttura.' }));
      for (const p of c.properties) props.append(el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;' }, userText('span', p.name + (p.test ? ' (test)' : ''), 'font-size:0.86rem;'),
        typeof root.viewAsHost === 'function' ? el('button', { type: 'button', 'data-contact-console': p.id, style: BTN, onclick: () => root.viewAsHost(p.id) }, '👁 Apri console') : null));
      props.append(el('button', { type: 'button', 'data-contact-billing': true, style: BTN + 'margin-top:8px;', onclick: () => openBilling(c) }, 'Abbonamento e prova in Utenti →'));
      if (c.last_login_at) props.append(el('div', { style: 'font-size:0.76rem;color:var(--ink-soft);margin-top:6px;' }, 'Ultimo accesso ', userText('span', fmtWhen(c.last_login_at), '')));
      panel.append(props);
    }
    // Notes timeline.
    const notes = el('div', { style: 'margin-top:16px;' }, el('div', { style: 'font-weight:600;font-size:0.84rem;', text: 'Note' }));
    const ta = el('textarea', { 'data-contact-note-input': true, rows: '3', maxlength: '4000', 'data-i18n-skip': true, style: INPUT + 'margin-top:6px;min-height:80px;resize:vertical;' });
    notes.append(ta, el('button', { type: 'button', 'data-contact-note-add': true, style: BTN_PRIMARY + 'margin-top:6px;', onclick: () => addNote(c, ta.value) }, 'Aggiungi nota'));
    const list = el('div', { 'data-contact-notes': true, style: 'margin-top:8px;display:flex;flex-direction:column;gap:8px;' });
    for (const n of c.notes || []) {
      const item = el('div', { 'data-contact-note': n.id, style: 'border:1px solid var(--border);border-radius:8px;padding:8px 10px;' },
        el('div', { style: 'font-size:0.72rem;color:var(--ink-soft);' }, userText('span', fmtWhen(n.created_at) + (n.created_by ? ' · ' + n.created_by : ''), '')),
        userText('div', n.body, 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:0.86rem;margin-top:2px;', { 'data-contact-note-body': true }));
      if (pendingDelete === 'note:' + n.id) item.append(el('div', { style: 'display:flex;gap:6px;margin-top:6px;' }, el('button', { type: 'button', 'data-contact-note-confirm': n.id, style: BTN + 'border-color:#B42318;color:#B42318;', onclick: () => deleteNote(n.id) }, 'Conferma eliminazione'), el('button', { type: 'button', style: BTN, onclick: () => { pendingDelete = null; renderModal(); } }, 'Annulla')));
      else item.append(el('button', { type: 'button', 'data-contact-note-delete': n.id, style: BTN + 'min-height:36px;margin-top:6px;font-size:0.74rem;', onclick: () => { pendingDelete = 'note:' + n.id; renderModal(); } }, 'Elimina'));
      list.append(item);
    }
    if (!(c.notes || []).length) list.append(el('div', { style: 'font-size:0.8rem;color:var(--ink-soft);', text: 'Nessuna nota.' }));
    notes.append(list);
    panel.append(notes);
    // Delete: prospects only (account rows stay while the account exists).
    if (!c.account) {
      const del = el('div', { style: 'margin-top:16px;border-top:1px solid var(--border);padding-top:10px;' });
      if (pendingDelete === 'contact') del.append(el('span', { style: 'font-size:0.82rem;', text: 'Eliminare il contatto e le sue note? Non si può annullare.' }), el('div', { style: 'display:flex;gap:6px;margin-top:6px;' }, el('button', { type: 'button', 'data-contact-delete-confirm': true, style: BTN + 'border-color:#B42318;color:#B42318;', onclick: () => deleteContact(c.id) }, 'Elimina definitivamente'), el('button', { type: 'button', style: BTN, onclick: () => { pendingDelete = null; renderModal(); } }, 'Annulla')));
      else del.append(el('button', { type: 'button', 'data-contact-delete': true, style: BTN + 'color:#B42318;', onclick: () => { pendingDelete = 'contact'; renderModal(); } }, 'Elimina contatto'));
      panel.append(del);
    }
    document.body.appendChild(wrap);
  }

  function readForm(c, f) {
    const p = normPhone(f.phone.value);
    if (!p.ok) return { error: p.error };
    const out = { full_name: f.full_name.value.trim(), phone: p.value, source: f.source.value || null, next_action: f.next_action.value.trim(), next_action_due: f.next_action_due.value || null };
    if (!c.account) out.email = f.email.value.trim();
    if (f.lead_stage) out.lead_stage = f.lead_stage.value;
    return { fields: out };
  }
  async function save(c, f) {
    const r = readForm(c, f);
    if (r.error) { msg = { text: r.error, bad: true }; return renderModalKeep(f); }
    try {
      const j = creating ? await call('contacts_create', r.fields) : await call('contacts_update', { id: c.id, ...r.fields });
      const saved = j && j.contact;
      if (!saved || !saved.id) throw new Error('Nessuna riga salvata: ricarica e riprova.');
      creating = false; openId = saved.id; msg = { text: 'Salvato.', bad: false };
      await load(true); renderModal(); render();
    } catch (e) { msg = { text: String(e.message || e), bad: true }; renderModalKeep(f); }
  }
  // Re-render the modal keeping what was typed.
  function renderModalKeep(f) {
    const vals = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value]));
    renderModal();
    const form = document.querySelector('#contactModal [data-contact-form]');
    if (form) for (const [k, v] of Object.entries(vals)) { const i = form.querySelector(`[name="${k}"]`); if (i && !i.readOnly) i.value = v; }
  }
  async function markDone(c, withNote) {
    try {
      if (withNote && c.next_action) await call('contacts_note_add', { contact_id: c.id, body: 'Fatto: ' + c.next_action });
      await call('contacts_update', { id: c.id, next_action: '', next_action_due: null });
      msg = { text: 'Fatto.', bad: false }; await load(true); renderModal(); render();
    } catch (e) { msg = { text: String(e.message || e), bad: true }; renderModal(); }
  }
  async function addNote(c, body) {
    if (!String(body || '').trim()) { msg = { text: 'Scrivi una nota.', bad: true }; return renderModal(); }
    try { await call('contacts_note_add', { contact_id: c.id, body }); msg = { text: 'Nota aggiunta.', bad: false }; await load(true); renderModal(); render(); }
    catch (e) { msg = { text: String(e.message || e), bad: true }; renderModal(); const ta = document.querySelector('[data-contact-note-input]'); if (ta) ta.value = body; }
  }
  async function deleteNote(id) {
    try { await call('contacts_note_delete', { id }); pendingDelete = null; msg = { text: 'Nota eliminata.', bad: false }; await load(true); renderModal(); render(); }
    catch (e) { pendingDelete = null; msg = { text: String(e.message || e), bad: true }; renderModal(); }
  }
  async function deleteContact(id) {
    try { await call('contacts_delete', { id }); closeModal(); await load(true); render(); }
    catch (e) { pendingDelete = null; msg = { text: String(e.message || e), bad: true }; renderModal(); }
  }
  function openBilling(c) {
    closeModal();
    if (typeof root.setActiveTab === 'function') root.setActiveTab('users');
    const email = c.login_email || c.email;
    if (email && root.UsersAdmin) setTimeout(() => { try { root.UsersAdmin.search(email); if (c.user_id) root.UsersAdmin.toggleBilling(c.user_id); } catch (_) {} }, 50);
  }

  root.ContactsAdmin = { render, ensureBadge, reload: () => load(), _normPhone: normPhone, _fmtPhone: fmtPhone, _sorted: sorted, _matches: matches, _reset: () => { data = null; error = null; loading = false; badgeTried = false; view = { q: '', filter: 'all' }; closeModal(); } };
})(typeof window !== 'undefined' ? window : globalThis);
