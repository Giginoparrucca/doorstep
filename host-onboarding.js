// Round 51 Phase 3. Adapter supplies the existing console state and routes.
(function(root) {
  'use strict';
  let adapter, epoch = 0, rows = {}, loadedKey = '', error = '', previous = {}, viewed = new Set(), completing = new Set();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const h = key => adapter.h(key);
  function readiness(property, context) {
    const row = rows[property?.id] || {};
    return root.OnboardingReadiness.computeReadiness({ property, taxRules: property?.tax_rules,
      alloggiatiCreds: context.credentials, notificationSettings: context.notifications,
      hasTestCheckin: !!row.test_checkin_done_at, onboardingState: row,
      regionCompliance: adapter.regionCompliance(property?.region, property?.city) });
  }
  function mount() {
    if (document.getElementById('onboardingHelp')) return;
    const button = document.createElement('button');
    button.hidden = true; button.id = 'onboardingHelp'; button.type = 'button'; button.className = 'onboarding-help';
    button.addEventListener('click', () => openSupport()); document.body.append(button);
    const sheet = document.createElement('dialog'); sheet.id = 'onboardingSupportSheet';
    sheet.className = 'onboarding-support'; sheet.setAttribute('aria-labelledby', 'onboardingSupportTitle');
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
    document.body.append(sheet);
  }
  function openSupport(step) {
    const context = adapter.context();
    if (!context.userId) return;
    const section = adapter.section();
    const title = step ? h('ob_step_' + step) : section;
    const message = root.OnboardingSupport.buildSupportPrefill(context.hostName, context.property?.name, title, context.lang);
    const links = root.OnboardingSupport.supportLinks(context.support, message);
    const sheet = document.getElementById('onboardingSupportSheet');
    sheet.innerHTML = `<div class="onboarding-support-head"><h2 id="onboardingSupportTitle">${esc(h('ob_help_title'))}</h2><button type="button" data-close aria-label="${esc(h('ob_close'))}">×</button></div><p>${esc(h('ob_no_documents'))}</p><nav>${['whatsapp','email','calendly'].filter(channel => links[channel]).map(channel => `<a class="btn btn-secondary" data-channel="${channel}" href="${esc(links[channel])}" target="_blank" rel="noopener noreferrer">${esc(h('ob_channel_' + channel))}</a>`).join('')}</nav>${Object.keys(links).length ? '' : `<p>${esc(h('ob_support_unavailable'))}</p>`}`;
    sheet.querySelector('[data-close]').onclick = () => sheet.close();
    sheet.querySelectorAll('[data-channel]').forEach(link => link.onclick = () => adapter.track('support_channel_clicked', { channel: link.dataset.channel, step: step || null }));
    if (!sheet.open) sheet.showModal();
    adapter.track('support_opened', { section: adapter.sectionId(), step: step || null });
  }
  async function refresh() {
    if (!adapter) return;
    mount();
    const context = adapter.context(); const key = context.userId + ':' + context.property?.id;
    const button = document.getElementById('onboardingHelp');
    button.hidden = !context.userId; button.textContent = h('ob_help');
    if (!context.userId) return;
    if (key === loadedKey) { paint(); return; }
    const ownEpoch = ++epoch; loadedKey = key; error = ''; rows = {}; previous = {};
    paint();
    if (context.readOnly) return;
    try {
      const response = await adapter.db.from('host_onboarding').select('*').eq('user_id', context.userId);
      if (response.error) throw response.error;
      if (epoch !== ownEpoch) return;
      rows = Object.fromEntries((response.data || []).map(row => [row.property_id, row]));
      if (context.property && !rows[context.property.id]) {
        const inserted = await adapter.db.from('host_onboarding').upsert({ user_id: context.userId, property_id: context.property.id }, { onConflict: 'user_id,property_id', ignoreDuplicates: true }).select();
        if (inserted.error) throw inserted.error;
        if (epoch !== ownEpoch) return;
        if (inserted.data?.[0]) rows[context.property.id] = inserted.data[0];
        else {
          const existing = await adapter.db.from('host_onboarding').select('*').eq('user_id', context.userId).eq('property_id', context.property.id).single();
          if (existing.error) throw existing.error;
          if (epoch !== ownEpoch) return;
          rows[context.property.id] = existing.data;
        }
      }
      paint(); await persistCompletion();
    } catch (_) { if (epoch === ownEpoch) { error = h('ob_save_error'); paint(); } }
  }
  async function update(patch) {
    const context = adapter.context(), property = context.property;
    const key = context.userId + ':' + property?.id, ownEpoch = epoch;
    if (!property || context.readOnly || !rows[property.id]) throw Error('Onboarding unavailable');
    const response = await adapter.db.from('host_onboarding').update(patch).eq('user_id', context.userId).eq('property_id', property.id).select();
    if (response.error || response.data?.length !== 1) throw Error('Onboarding update denied');
    if (ownEpoch === epoch && key === loadedKey) { rows[property.id] = response.data[0]; paint(); }
  }
  async function persistCompletion() {
    const context = adapter.context(), property = context.property;
    if (!property || context.readOnly || !rows[property.id]) return;
    const result = readiness(property, context);
    if (result.ready && !rows[property.id].completed_at && !completing.has(property.id)) { completing.add(property.id); try { await update({ completed_at: new Date().toISOString() }); } finally { completing.delete(property.id); } }
  }
  async function action(kind, value) {
    try {
      if (kind === 'support') return openSupport(value);
      if (kind === 'add') return adapter.addProperty();
      if (kind === 'go') return adapter.focusStep(value, readiness(adapter.context().property, adapter.context()).steps.find(s => s.id === value)?.missing || []);
      if (kind === 'help') return adapter.guide(value);
      if (kind === 'dismiss') {
        if (!readiness(adapter.context().property, adapter.context()).ready) return;
        await persistCompletion(); await update({ checklist_dismissed_at: new Date().toISOString() });
      }
      if (kind === 'skip') {
        if (!['tax_not_applicable','direct_only','test_checkin','alloggiati_manual'].includes(value)) return;
        const row = rows[adapter.context().property?.id]; if (!row) return;
        const skips = { ...row.skips, [value]: !row.skips?.[value] };
        await update({ skips });
        adapter.track('onboarding_step_skipped', { step: value === 'direct_only' ? 'calendar' : value === 'test_checkin' ? 'test' : 'property', reason: value });
        await persistCompletion();
      }
    } catch (_) { adapter.toast(h('ob_save_error')); }
  }
  function paint() {
    if (!adapter) return;
    const context = adapter.context(), property = context.property;
    const dashboard = document.getElementById('panel-dashboard'); if (!dashboard) return;
    let card = document.getElementById('hostOnboardingChecklist');
    if (!card) { card = document.createElement('section'); card.id = 'hostOnboardingChecklist'; card.className = 'onboarding-card'; dashboard.prepend(card); }
    document.getElementById('onboardingHelp').hidden = !context.userId;
    document.getElementById('onboardingHelp').textContent = h('ob_help');
    if (!context.userId || context.readOnly) { card.hidden = true; return; }
    card.hidden = false;
    if (!property) {
      card.innerHTML = `<h2>${esc(h('ob_add_title'))}</h2><button class="btn btn-primary" type="button" data-action="add">${esc(h('ob_add'))}</button>`;
    } else {
      const result = readiness(property, context), row = rows[property.id] || {};
      card.hidden = result.ready && !!row.checklist_dismissed_at;
      const label = result.ready ? h('ob_ready') : h('ob_title');
      const steps = result.steps.map(step => {
        const skip = step.id === 'calendar' ? 'direct_only' : step.id === 'test' ? 'test_checkin' : '';
        return `<li class="onboarding-step ${step.done ? 'is-done' : ''}"><div><strong>${step.done ? '✓' : '○'} ${esc(h('ob_step_' + step.id))}</strong>${step.skipped ? `<span class="onboarding-note">${esc(h('ob_skipped'))}</span>` : ''}${!step.done ? `<p>${esc(h('ob_missing'))}: ${step.missing.map(field => esc(h('ob_field_' + field))).join(', ')}</p>` : ''}</div><div class="onboarding-step-actions">${!step.done ? `<button class="btn btn-primary btn-sm" type="button" data-action="go" data-value="${step.id}">${esc(h('ob_continue'))}</button><button class="btn btn-secondary btn-sm" type="button" data-action="support" data-value="${step.id}">${esc(h('ob_need_help'))}</button>` : ''}${['property','content'].includes(step.id) ? `<button class="btn btn-secondary btn-sm" type="button" data-action="help" data-value="${step.id}">${esc(h('ob_guide'))}</button>` : ''}${skip ? `<button class="btn btn-secondary btn-sm" type="button" data-action="skip" data-value="${skip}">${esc(h(step.skipped ? 'ob_undo_skip' : 'ob_skip_' + skip))}</button>` : ''}</div></li>`;
      }).join('');
      const choices = ['tax_not_applicable','alloggiati_manual'].map(skip => `<button type="button" class="btn btn-secondary btn-sm" data-action="skip" data-value="${skip}" aria-pressed="${row.skips?.[skip] === true}">${esc(h('ob_skip_' + skip))}${row.skips?.[skip] ? ' ✓' : ''}</button>`).join('');
      card.innerHTML = `<div class="onboarding-card-head"><h2>${esc(label)}</h2><span>${result.doneCount} ${esc(h('ob_of'))} 5</span>${result.ready ? `<button type="button" class="btn btn-secondary btn-sm" data-action="dismiss">${esc(h('ob_hide'))}</button>` : ''}</div><progress max="5" value="${result.doneCount}" aria-label="${esc(h('ob_progress'))}"></progress>${error ? `<p role="status">${esc(error)}</p>` : ''}<details ${result.ready ? '' : 'open'}><summary>${esc(h('ob_details'))}</summary><ol class="onboarding-steps">${steps}</ol><div class="onboarding-choices">${choices}</div></details>`;
      const key = context.userId + ':' + property.id;
      if (rows[property.id] && !viewed.has(key)) { viewed.add(key); adapter.track('onboarding_checklist_viewed', {}); }
      const old = previous[property.id];
      if (old) result.steps.filter(s => s.done && !old.steps.find(o => o.id === s.id)?.done).forEach(s => adapter.track('onboarding_step_completed', { step: s.id }));
      previous[property.id] = result;
      adapter.paintBadges(context.properties.map(p => ({ id: p.id, ...readiness(p, context) })));
    }
    card.querySelectorAll('[data-action]').forEach(button => button.onclick = () => action(button.dataset.action, button.dataset.value));
  }
  root.HostOnboarding = { init(options) { adapter = options; mount(); }, refresh, paint, openSupport,
    async changed() { paint(); try { await persistCompletion(); } catch (_) { adapter.toast(h('ob_save_error')); } } };
})(window);
