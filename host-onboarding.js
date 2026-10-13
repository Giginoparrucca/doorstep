// host-onboarding.js — Round 51 Phase 3.
//
// Checklist card on Oggi + floating "Aiuto" widget on the host console.
// Vanilla JS, no bundler. Attaches to window as `HostOnboarding`.
// Depends on:
//   - window.WELCOME_BNB_CONFIG         (public config, carries .support.*)
//   - window.OnboardingReadiness        (lib/onboarding-readiness.js)
//   - window.sb                         (supabase-js client bound to the host)
//   - window.hostLang, propertyData, propertyId, h(key), showSection(id)
//   - optional: window.regionComplianceFor(region, city)
// Never reads guest data; never logs secrets.

(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : {};
  var testBooking = null;
  var renderVersion = 0;
  var latestReadiness = null;
  var readinessPropertyId = null;
  var SEL_HOST = 'onboardingHostContainer';
  var SEL_WIDGET = 'onboardingSupportWidget';
  var SEL_SHEET = 'onboardingSupportSheet';
  var SEL_SIDEBAR_DOT = 'onboardingSidebarDot';

  // ── i18n helpers ────────────────────────────────────────────────────
  function it() { return (W.hostLang || 'it') === 'it'; }
  function hk(k, fallback) {
    try { if (typeof W.h === 'function') { var v = W.h(k); if (v) return v; } } catch (_) {}
    return fallback;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Step UI labels, keyed by step id. Pure data; strings are single-line
  // (applyLang uses innerHTML) and must appear in the host-console i18n
  // dictionaries under `obx_step_<id>_title` / `_cta` / `_help`.
  var STEP_UI = {
    property:      { icon: '🏠', ctaSection: 'prop' },
    calendar:      { icon: '📆', ctaSection: 'prop' },
    content:       { icon: '✍️', ctaSection: 'prop' },
    test:          { icon: '🧪', ctaSection: 'oggi' },
    notifications: { icon: '🔔', ctaSection: 'prop' },
  };

  // ── readiness-input builder ─────────────────────────────────────────
  // Pulls everything `computeReadiness` needs for the current property.
  // All reads use RLS-scoped host JWT; nothing is cached across properties.
  function _resolveRegion(property) {
    try {
      if (typeof W.regionComplianceFor === 'function') {
        return W.regionComplianceFor(property && property.region, property && property.city) || null;
      }
    } catch (_) {}
    return null;
  }
  async function _loadReadinessInputs(property) {
    if (!property || !property.id) return null;
    var sb = W.sb;
    var userId = null;
    try { var u = await sb.auth.getUser(); userId = u && u.data && u.data.user && u.data.user.id || null; } catch (_) {}
    if (!userId) return null;

    // Alloggiati creds (indirect via existing endpoint OR direct table
    // read — we go direct because host_alloggiati_credentials is
    // service-role-only; the host can't read it. Fall back to the
    // property's own `alloggiati_autofile_mode` which is readable.)
    var alloggiatiCreds = null;
    try {
      var resp = await fetch('/api/alloggiati?action=status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + ((await sb.auth.getSession()).data.session.access_token || ''),
        },
        body: JSON.stringify({ property_id: property.id }),
      });
      if (resp.ok) {
        var row = await resp.json();
        alloggiatiCreds = { configured: !!(row && row.configured), verified_at: row && row.verified_at || null };
      }
    } catch (_) { /* non-fatal */ }

    var notificationSettings = null;
    try {
      var ns = await sb.from('host_notification_settings').select('push_enabled,telegram_enabled,email_mode').eq('host_id', userId).maybeSingle();
      if (ns && ns.data) notificationSettings = ns.data;
    } catch (_) {}

    var ob = null;
    try {
      var obq = await sb.from('host_onboarding').select('*').eq('user_id', userId).eq('property_id', property.id).maybeSingle();
      if (obq && obq.data) ob = obq.data;
    } catch (_) {}

    testBooking = null;
    var tq = await sb.from('ota_reservations').select('booking_code').eq('property_id', property.id).eq('is_test', true).contains('raw', { onboarding_test: true }).is('deleted_at', null).gte('created_at', new Date(Date.now()-86400000).toISOString()).limit(1);
    if (tq.error) throw tq.error;
    testBooking = tq.data && tq.data[0] || null;
    var hasTestCheckin = !!(ob && ob.test_checkin_done_at);

    return {
      userId: userId,
      property: property,
      taxRules: Array.isArray(property.tax_rules) ? property.tax_rules : [],
      alloggiatiCreds: alloggiatiCreds,
      notificationSettings: notificationSettings,
      hasTestCheckin: hasTestCheckin,
      onboardingState: ob || { skips: {} },
      regionCompliance: _resolveRegion(property),
    };
  }

  // ── checklist card renderer ─────────────────────────────────────────
  function _renderMissing(step) {
    if (!step.missing || !step.missing.length) return '';
    var labels = step.missing.map(function (k) {
      var map = {
        name: it() ? 'Nome' : 'Name',
        city: it() ? 'Città' : 'City',
        region: it() ? 'Regione' : 'Region',
        cir_code: 'CIN',
        cir_code_format: it() ? 'formato CIN' : 'CIN format',
        ross1000_codice: 'ROSS1000',
        tax_rules: it() ? 'imposta di soggiorno' : 'tourist tax',
        alloggiati: 'Alloggiati',
        ical_feeds: 'iCal',
        welcome_message: it() ? 'messaggio di benvenuto' : 'welcome message',
        wifi_name: 'Wi-Fi',
        checkin_instructions: it() ? 'istruzioni di arrivo' : 'check-in instructions',
        notification_channel: it() ? 'canale notifiche' : 'notification channel',
        test_checkin: it() ? 'check-in di prova' : 'test check-in',
      };
      return esc(map[k] || k);
    });
    return '<div class="obx-missing">' + (it() ? 'Manca: ' : 'Missing: ') + labels.join(', ') + '</div>';
  }
  function _stepTitle(id) {
    return hk('obx_step_' + id + '_title',
      ({ property: it() ? 'Dati e codici della struttura' : 'Property data and codes',
         calendar: it() ? 'Collega il calendario' : 'Connect the calendar',
         content: it() ? "Prepara l'accoglienza" : 'Prepare the welcome content',
         test: it() ? 'Prova come ospite' : 'Try as a guest',
         notifications: it() ? 'Attiva le notifiche' : 'Turn on notifications' })[id] || id);
  }
  function _stepCta(id) {
    return hk('obx_step_' + id + '_cta', it() ? 'Completa' : 'Complete');
  }
  function _renderStep(step) {
    var ui = STEP_UI[step.id] || { icon: '•', ctaSection: 'oggi' };
    var state = step.done ? (step.skipped ? 'skipped' : 'done') : 'todo';
    var title = _stepTitle(step.id);
    var cta = step.done ? '' :
      '<button class="obx-cta" type="button" data-section="' + esc(ui.ctaSection) + '" data-focus="' + esc(step.missing[0] || '') + '">' +
      esc(_stepCta(step.id)) + '</button>';
    if (step.id === 'test') {
      cta = '<button class="obx-test-start obx-cta" type="button">' + esc(testBooking ? hk('obx_test_open') : _stepCta('test')) + '</button>';
      if (testBooking) cta += '<button class="obx-test-delete obx-help" type="button">' + esc(hk('obx_test_delete')) + '</button>';
      cta += '<div class="obx-test-hint">' + esc(hk('obx_test_hint')) + '</div>';
    }
    var help = step.done ? '' :
      '<button class="obx-help" type="button" data-step="' + esc(step.id) + '">' +
      esc(hk('obx_help_link', it() ? 'Serve aiuto?' : 'Need help?')) + '</button>';
    var skippedBadge = step.skipped ? '<span class="obx-badge-skip">' +
      esc(hk('obx_skipped', it() ? 'saltato' : 'skipped')) + '</span>' : '';
    return '' +
      '<li class="obx-step obx-' + state + '" data-step="' + esc(step.id) + '">' +
      '  <span class="obx-icon" aria-hidden="true">' + ui.icon + '</span>' +
      '  <div class="obx-body">' +
      '    <div class="obx-title">' + esc(title) + ' ' + skippedBadge + '</div>' +
      _renderMissing(step) +
      '  </div>' +
      '  <div class="obx-actions">' + cta + help + '</div>' +
      '</li>';
  }
  function _renderCard(readiness, dismissed) {
    var n = readiness.doneCount, total = readiness.total;
    var ready = readiness.ready;
    if (ready && dismissed && !testBooking) {
      // Collapsed badge version
      return '' +
        '<div class="obx-ready-badge">' +
        '  <span>✓ ' + esc(hk('obx_ready_badge', it() ? 'Proprietà pronta' : 'Property ready')) + '</span>' +
        '  <button type="button" class="obx-expand obx-help">' + esc(hk('obx_show')) + '</button>' +
        '</div>';
    }
    var pct = Math.round((n / total) * 100);
    var stepsHtml = readiness.steps.map(_renderStep).join('');
    var dismissBtn = ready ?
      '<button class="obx-dismiss" type="button">' + esc(hk('obx_hide', it() ? 'Nascondi' : 'Hide')) + '</button>' : '';
    var intro = ready
      ? hk('obx_intro_ready', it() ? 'Pronta per i tuoi primi ospiti.' : 'Ready for your first guests.')
      : hk('obx_intro_todo', it()
          ? 'Pochi passaggi e sei pronto per i tuoi ospiti.'
          : 'A few steps and you are ready for your guests.');
    return '' +
      '<div class="obx-card">' +
      '  <div class="obx-head">' +
      '    <div class="obx-head-title">' + esc(hk('obx_title', it() ? 'Avvio struttura' : 'Property setup')) + '</div>' +
      '    <div class="obx-progress-text">' + n + ' ' + (it() ? 'di' : 'of') + ' ' + total + '</div>' +
      '    ' + dismissBtn +
      '  </div>' +
      '  <div class="obx-progress"><span style="width:' + pct + '%"></span></div>' +
      '  <div class="obx-intro">' + esc(intro) + '</div>' +
      '  <ul class="obx-steps">' + stepsHtml + '</ul>' +
      '</div>';
  }

  // The same readiness data drives the dot and its explanation on Property.
  function renderPropertyAttention(section) {
    var holder = document.getElementById('onboardingPropertyAttention');
    if (!holder) return;
    var visible = (section || _currentSection()) === 'prop' &&
      readinessPropertyId === W.propertyId && latestReadiness && !latestReadiness.ready;
    holder.style.display = visible ? '' : 'none';
    if (!visible) { holder.innerHTML = ''; return; }
    var steps = latestReadiness.steps.filter(function (s) { return !s.done && s.id !== 'test'; });
    holder.innerHTML = '<div class="obx-card obx-attention" role="region" aria-label="' + esc(hk('obx_attention_title')) + '">' +
      '<div class="obx-head-title">' + esc(hk('obx_attention_title')) + '</div>' +
      '<p class="obx-intro">' + esc(hk('obx_attention_intro')) + '</p>' +
      '<ul class="obx-steps">' + steps.map(_renderStep).join('') + '</ul></div>';
    _wireNavigation(holder);
    _wireHelp(holder);
  }
  function _wireHelp(holder) {
    Array.prototype.forEach.call(holder.querySelectorAll('.obx-help[data-step]'), function (b) {
      b.onclick = function () { openSupportSheet({ step: b.getAttribute('data-step') }); };
    });
  }
  function _wireNavigation(holder) {
    Array.prototype.forEach.call(holder.querySelectorAll('.obx-cta[data-section]'), function (b) {
      b.onclick = function () {
        var key = b.getAttribute('data-focus') || '';
        var targets = {
          name: ['property', 'propName'], city: ['property', 'propCity'], region: ['property', 'propRegion'],
          cir_code: ['property', 'cirCode'], cir_code_format: ['property', 'cirCode'], ross1000_codice: ['property', 'propRossCodice'],
          wifi_name: ['property', 'propWifiName'], welcome_message: ['property', 'propWelcome'], checkin_instructions: ['property', 'propCheckinInstructions'],
          tax_rules: ['settings', 'propTaxRate'], ical_feeds: ['settings', 'icalFeedsList'], alloggiati: ['settings', 'alloggiatiCard'],
          notification_channel: ['chat', 'notifCard']
        };
        var target = targets[key];
        if (!target) { if (W.showSection) W.showSection(b.getAttribute('data-section')); return; }
        W.showPanel(target[0]);
        if (target[0] === 'property' && W.startPropertyEdit) W.startPropertyEdit();
        if (target[0] === 'settings' && W.startSettingsEdit) W.startSettingsEdit();
        var el = document.getElementById(target[1]);
        if (!el) return;
        if (el.tagName === 'DETAILS') el.open = true;
        if (!el.hasAttribute('tabindex') && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) el.setAttribute('tabindex', '-1');
        el.classList.add('obx-focus-target');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus({ preventScroll: true });
        setTimeout(function () { el.classList.remove('obx-focus-target'); }, 2500);
      };
    });
  }

  // ── sidebar readiness dot ───────────────────────────────────────────
  function _ensureSidebarDot() {
    var sidebar = document.querySelector('[data-section="prop"]');
    if (!sidebar) return;
    if (!document.getElementById(SEL_SIDEBAR_DOT)) {
      var dot = document.createElement('span');
      dot.id = SEL_SIDEBAR_DOT;
      dot.setAttribute('aria-hidden', 'true');
      dot.style.cssText = 'position:absolute;right:12px;top:50%;transform:translateY(-50%);width:8px;height:8px;border-radius:50%;background:#f59e0b;display:none;';
      sidebar.style.position = 'relative';
      sidebar.appendChild(dot);
    }
  }
  function _showSidebarDot(show) {
    var dot = document.getElementById(SEL_SIDEBAR_DOT);
    if (dot) dot.style.display = show ? '' : 'none';
  }

  // ── analytics (host-side; is_test=false for real hosts) ─────────────
  function _trackEvent(eventType, eventData) {
    try {
      if (!W.sb || !W.propertyId) return;
      W.sb.from('analytics_events').insert({
        property_id: W.propertyId,
        event_type: eventType,
        event_data: eventData || {},
        is_test: false,
      }).then(function () {}, function () {});
    } catch (_) {}
  }

  // ── support widget ──────────────────────────────────────────────────
  function _supportCfg() {
    var cfg = (W.WELCOME_BNB_CONFIG && W.WELCOME_BNB_CONFIG.support) || {};
    return {
      whatsapp: cfg.whatsapp || null,
      email: cfg.email || null,
      calendly: cfg.calendly || null,
    };
  }
  // Build the exact prefill text. ONLY host name, property name and step.
  // No guest data, booking codes, email, phone or any other field.
  function buildSupportPrefill(hostName, propertyName, stepTitle, lang) {
    var it_ = lang === 'it';
    var who = it_
      ? ('Ciao, sono ' + (hostName || '—') + ', struttura ' + (propertyName || '—') + '.')
      : ("Hi, I'm " + (hostName || '—') + ", property " + (propertyName || '—') + '.');
    var ask = it_
      ? ('Ho bisogno di aiuto con: ' + (stepTitle || 'onboarding') + '.')
      : ('I need help with: ' + (stepTitle || 'onboarding') + '.');
    return who + ' ' + ask;
  }
  function _currentHostName() {
    try {
      var el = document.getElementById('sidebarUserName');
      if (el && el.textContent) return el.textContent.trim();
    } catch (_) {}
    return '';
  }
  function _currentPropertyName() {
    try { return (W.propertyData && W.propertyData.name) || ''; } catch (_) { return ''; }
  }
  function _currentSection() {
    try { return (document.querySelector('.sidebar-item.active') || {}).getAttribute('data-section') || 'oggi'; } catch (_) { return 'oggi'; }
  }
  function _ensureSupportWidget() {
    if (document.getElementById(SEL_WIDGET)) return;
    if (!document.body) return;
    var style = document.createElement('style');
    style.textContent = _css();
    document.head.appendChild(style);
    var btn = document.createElement('button');
    btn.id = SEL_WIDGET;
    btn.type = 'button';
    btn.setAttribute('aria-label', hk('obx_help_open', it() ? 'Apri assistenza' : 'Open help'));
    btn.className = 'obx-support-fab';
    btn.innerHTML = '<span aria-hidden="true">?</span><span class="obx-support-fab-label">' +
      esc(hk('obx_help_fab', it() ? 'Aiuto' : 'Help')) + '</span>';
    btn.onclick = function () { openSupportSheet({ step: null }); };
    document.body.appendChild(btn);
  }
  function openSupportSheet(opts) {
    opts = opts || {};
    var cfg = _supportCfg();
    var stepTitle = opts.step ? _stepTitle(opts.step) : null;
    var hostName = _currentHostName();
    var propName = _currentPropertyName();
    var prefill = buildSupportPrefill(hostName, propName, stepTitle, it() ? 'it' : 'en');
    var waUrl  = cfg.whatsapp ? ('https://wa.me/' + cfg.whatsapp.replace(/^\+/, '') + '?text=' + encodeURIComponent(prefill)) : null;
    var mailto = cfg.email    ? ('mailto:' + cfg.email + '?subject=' + encodeURIComponent(it() ? 'WelcomeBnB — aiuto' : 'WelcomeBnB — help') + '&body=' + encodeURIComponent(prefill)) : null;
    var cal    = cfg.calendly || null;
    var items = [];
    if (waUrl)  items.push('<a class="obx-channel" data-channel="whatsapp" href="' + esc(waUrl) + '" target="_blank" rel="noopener">💬 ' + esc(hk('obx_help_whatsapp', it() ? 'Scrivici su WhatsApp' : 'Message us on WhatsApp')) + '</a>');
    if (mailto) items.push('<a class="obx-channel" data-channel="email" href="' + esc(mailto) + '">✉️ ' + esc(hk('obx_help_email', it() ? 'Scrivici una email' : 'Send us an email')) + '</a>');
    if (cal)    items.push('<a class="obx-channel" data-channel="calendly" href="' + esc(cal) + '" target="_blank" rel="noopener">📅 ' + esc(hk('obx_help_calendly', it() ? 'Prenota una chiamata di 20 minuti' : 'Book a 20-minute call')) + '</a>');
    if (items.length === 0) items.push('<p class="obx-nochannels">' + esc(hk('obx_help_none', it() ? 'Nessun canale configurato.' : 'No contact channels configured.')) + '</p>');
    var pii = hk('obx_help_pii', it()
      ? "Non inviarci documenti o foto degli ospiti: li gestiamo solo dentro WelcomeBnB."
      : "Do not send us guest documents or photos — we handle those only inside WelcomeBnB.");
    var sheet = document.getElementById(SEL_SHEET);
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = SEL_SHEET;
      sheet.className = 'obx-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = '' +
      '<div class="obx-sheet-backdrop"></div>' +
      '<div class="obx-sheet-panel">' +
      '  <button type="button" class="obx-sheet-close" aria-label="' + esc(hk('obx_close', it() ? 'Chiudi' : 'Close')) + '">✕</button>' +
      '  <div class="obx-sheet-title">' + esc(hk('obx_help_title', it() ? 'Come possiamo aiutarti?' : 'How can we help?')) + '</div>' +
      (stepTitle ? '<div class="obx-sheet-ctx">' + esc(it() ? 'Contesto: ' : 'Context: ') + esc(stepTitle) + '</div>' : '') +
      '  <div class="obx-channels">' + items.join('') + '</div>' +
      '  <div class="obx-pii">' + esc(pii) + '</div>' +
      '</div>';
    sheet.style.display = 'block';
    sheet.querySelector('.obx-sheet-backdrop').onclick = closeSupportSheet;
    sheet.querySelector('.obx-sheet-close').onclick = closeSupportSheet;
    Array.prototype.forEach.call(sheet.querySelectorAll('.obx-channel'), function (a) {
      a.addEventListener('click', function () {
        _trackEvent('support_channel_clicked', { channel: a.getAttribute('data-channel'), step: opts.step || null, section: _currentSection() });
      });
    });
    _trackEvent('support_opened', { section: _currentSection(), step: opts.step || null });
  }
  function closeSupportSheet() {
    var sheet = document.getElementById(SEL_SHEET);
    if (sheet) sheet.style.display = 'none';
  }

  // ── mount into the dashboard panel ──────────────────────────────────
  async function _upsertFirstSeen(userId, propId) {
    try {
      await W.sb.from('host_onboarding').upsert(
        { user_id: userId, property_id: propId, first_seen_at: new Date().toISOString() },
        { onConflict: 'user_id,property_id', ignoreDuplicates: true }
      );
    } catch (_) {}
  }
  async function _markCompleted(userId, propId) {
    try {
      await W.sb.from('host_onboarding').update({ completed_at: new Date().toISOString() })
        .eq('user_id', userId).eq('property_id', propId).is('completed_at', null);
    } catch (_) {}
  }
  async function renderChecklist() {
    var version = ++renderVersion;
    var panel = document.getElementById('panel-dashboard');
    if (!panel) return;
    var holder = document.getElementById(SEL_HOST);
    if (!holder) {
      holder = document.createElement('div');
      holder.id = SEL_HOST;
      panel.insertBefore(holder, panel.firstChild);
    }
    if (!W.propertyData) { holder.innerHTML = ''; latestReadiness = null; _showSidebarDot(false); renderPropertyAttention(); return; }

    var inputs;
    try { inputs = await _loadReadinessInputs(W.propertyData); } catch (_) { inputs = null; }
    if (version !== renderVersion || (inputs && (!W.propertyData || W.propertyData.id !== inputs.property.id))) return;
    var bookingForRender = testBooking;
    if (!inputs) { latestReadiness = null; _showSidebarDot(false); renderPropertyAttention(); holder.innerHTML = '<div class="obx-card" role="status">' + esc(hk('obx_load_error')) + ' <button type="button" class="obx-retry obx-cta">' + esc(hk('obx_retry')) + '</button></div>'; holder.querySelector('.obx-retry').onclick = renderChecklist; return; }
    var R = (W.OnboardingReadiness && W.OnboardingReadiness.computeReadiness);
    if (typeof R !== 'function') return;
    var readiness = R(inputs);

    latestReadiness = readiness;
    readinessPropertyId = inputs.property.id;
    _showSidebarDot(!readiness.ready);
    renderPropertyAttention();
    var dismissed = !!(inputs.onboardingState && inputs.onboardingState.checklist_dismissed_at);
    holder.innerHTML = _renderCard(readiness, dismissed);

    // Wire buttons. Open the new tab in the click gesture (mobile-safe).
    var start = holder.querySelector('.obx-test-start');
    if (start) start.addEventListener('click', async function () {
      var propId = inputs.property.id;
      var tab = W.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      start.disabled = true;
      try {
        var session = (await W.sb.auth.getSession()).data.session;
        var r = await fetch('/api/guest-token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ action: 'test_booking', property_id: propId }) });
        if (!r.ok) throw new Error('test booking failed');
        var booking = (await r.json()).booking;
        var url = W.WELCOME_BNB_CONFIG.appOrigin + '/?p=' + encodeURIComponent(propId) + '&b=' + encodeURIComponent(booking.booking_code) + '&test=1';
        if (tab) tab.location = url; else W.location.href = url;
        _trackEvent('onboarding_test_started', {});
        renderChecklist();
      } catch (_) { if (tab) tab.close(); W.alert(hk('obx_test_error')); }
      finally { start.disabled = false; }
    });
    var del = holder.querySelector('.obx-test-delete');
    if (del) del.addEventListener('click', async function () {
      if (!W.confirm(hk('obx_test_confirm'))) return;
      del.disabled = true;
      try {
        var session = (await W.sb.auth.getSession()).data.session;
        var out = await fetch('/api/guest-token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ action: 'test_booking_delete', property_id: inputs.property.id, booking_code: bookingForRender.booking_code }) });
        if (!out.ok) throw new Error('delete failed');
        renderChecklist();
      } catch (_) { W.alert(hk('obx_test_error')); }
      finally { del.disabled = false; }
    });
    _wireNavigation(holder);
    _wireHelp(holder);
    var expandBtn = holder.querySelector('.obx-expand');
    if (expandBtn) expandBtn.onclick = async function () {
      await W.sb.from('host_onboarding').update({ checklist_dismissed_at: null })
        .eq('user_id', inputs.userId).eq('property_id', inputs.property.id);
      renderChecklist();
    };
    var dismissBtn = holder.querySelector('.obx-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', async function () {
      try {
        await W.sb.from('host_onboarding').update({ checklist_dismissed_at: new Date().toISOString() })
          .eq('user_id', inputs.userId).eq('property_id', W.propertyData.id);
      } catch (_) {}
      renderChecklist();
    });

    // Side effects: upsert first_seen_at the first time we see this
    // (host, property), and set completed_at the first time ready flips.
    await _upsertFirstSeen(inputs.userId, inputs.property.id);
    if (readiness.ready && inputs.onboardingState && !inputs.onboardingState.completed_at) {
      _markCompleted(inputs.userId, inputs.property.id);
    }
    _trackEvent('onboarding_checklist_viewed',
      { done: readiness.doneCount, total: readiness.total, ready: readiness.ready, first_incomplete: readiness.firstIncompleteStep });
  }

  function _css() {
    return [
      '#onboardingHostContainer{margin:0 0 18px}',
      '.obx-attention{border-color:#f59e0b}',
      '.obx-focus-target{outline:3px solid #f59e0b;outline-offset:4px}',
      '.obx-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px 18px;margin:0 0 12px;box-shadow:0 1px 2px rgba(0,0,0,0.04)}',
      '.obx-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}',
      '.obx-head-title{font-weight:600;font-size:0.98rem;flex:1}',
      '.obx-progress-text{font-size:0.78rem;color:#4b5563}',
      '.obx-dismiss{border:0;background:transparent;color:#6b7280;font-size:0.78rem;cursor:pointer;padding:4px 8px}',
      '.obx-dismiss:hover{color:#111827}',
      '.obx-progress{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:10px}',
      '.obx-progress span{display:block;height:100%;background:#10b981;transition:width 220ms ease}',
      '.obx-intro{font-size:0.86rem;color:#4b5563;margin-bottom:10px}',
      '.obx-steps{list-style:none;margin:0;padding:0}',
      '.obx-step{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-top:1px solid #f3f4f6}',
      '.obx-step:first-child{border-top:0}',
      '.obx-icon{width:28px;height:28px;flex:0 0 28px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#f3f4f6;font-size:0.95rem}',
      '.obx-done .obx-icon{background:#d1fae5}',
      '.obx-skipped .obx-icon{background:#fef3c7}',
      '.obx-todo .obx-icon{background:#fee2e2}',
      '.obx-body{flex:1;min-width:0}',
      '.obx-title{font-size:0.9rem;font-weight:600;color:#111827}',
      '.obx-missing{font-size:0.78rem;color:#991b1b;margin-top:2px}',
      '.obx-badge-skip{display:inline-block;background:#fef3c7;color:#78350f;padding:1px 6px;border-radius:4px;font-size:0.7rem;margin-left:6px}',
      '.obx-actions{display:flex;flex-direction:column;gap:4px;align-items:flex-end}',
      '.obx-cta{background:#111827;color:#fff;border:0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-family:inherit}',
      '.obx-cta:hover{background:#1f2937}',
      '.obx-test-hint{max-width:210px;font-size:0.72rem;color:#4b5563;text-align:right}',
      '.obx-help{background:transparent;border:0;color:#4b5563;text-decoration:underline;font-size:0.74rem;cursor:pointer}',
      '.obx-help:hover{color:#111827}',
      '.obx-ready-badge{display:inline-flex;align-items:center;gap:6px;background:#d1fae5;color:#065f46;padding:6px 12px;border-radius:999px;font-size:0.82rem;font-weight:600}',
      // Support FAB
      '.obx-support-fab{position:fixed;bottom:18px;right:18px;z-index:2147483646;background:#111827;color:#fff;border:0;border-radius:999px;padding:10px 16px;font:600 0.86rem/1 inherit;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.14);display:flex;align-items:center;gap:8px}',
      '.obx-support-fab:hover{background:#1f2937}',
      '.obx-support-fab-label{font-weight:600}',
      // Sheet
      '.obx-sheet{position:fixed;inset:0;z-index:2147483646;display:none}',
      '.obx-sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.4)}',
      '.obx-sheet-panel{position:absolute;right:16px;bottom:76px;max-width:360px;width:calc(100vw - 32px);background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.2);padding:16px 18px}',
      '.obx-sheet-close{position:absolute;top:8px;right:8px;background:transparent;border:0;cursor:pointer;color:#6b7280;font-size:1rem}',
      '.obx-sheet-title{font-weight:600;font-size:1rem;margin:0 24px 6px 0}',
      '.obx-sheet-ctx{font-size:0.78rem;color:#4b5563;margin-bottom:10px}',
      '.obx-channels{display:flex;flex-direction:column;gap:6px;margin:8px 0 12px}',
      '.obx-channel{display:block;padding:10px 12px;border-radius:8px;background:#f3f4f6;color:#111827;text-decoration:none;font-size:0.9rem}',
      '.obx-channel:hover{background:#e5e7eb}',
      '.obx-nochannels{color:#991b1b;font-size:0.86rem;margin:4px 0 0}',
      '.obx-pii{font-size:0.74rem;color:#4b5563;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px}',
      '@media (max-width: 560px){.obx-support-fab{bottom:14px;right:14px;padding:9px 14px;font-size:0.82rem} .obx-sheet-panel{right:8px;left:8px;bottom:70px;max-width:none;width:auto}}',
    ].join('\n');
  }

  if (typeof document !== 'undefined') W.addEventListener('focus', function () { renderChecklist(); });

  // ── public API ──────────────────────────────────────────────────────
  W.HostOnboarding = {
    renderChecklist: renderChecklist,
    renderPropertyAttention: renderPropertyAttention,
    openSupportSheet: openSupportSheet,
    closeSupportSheet: closeSupportSheet,
    buildSupportPrefill: buildSupportPrefill,
    _init: function () { _ensureSupportWidget(); _ensureSidebarDot(); },
  };
  // Initialize once the DOM is ready. renderChecklist() has to be
  // called from `renderDashboard()` which already knows when the
  // property changed; we only attach the chrome here.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', W.HostOnboarding._init);
    } else {
      W.HostOnboarding._init();
    }
  }
})();
