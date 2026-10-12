(function(root) {
  'use strict';
  function buildSupportPrefill(hostName, propertyName, step, lang) {
    // Explicit arguments only: guest/booking/account fields cannot enter the message.
    const clean = value => typeof value === 'string' ? value.replace(/[\r\n]/g, ' ').trim().slice(0, 120) : '';
    const host = clean(hostName), property = clean(propertyName), context = clean(step);
    return lang === 'en'
      ? `Hi, I'm ${host || 'a host'}, property ${property || 'not added yet'}. I need help with: ${context || 'setup'}.`
      : `Ciao, sono ${host || 'un host'}, struttura ${property || 'non ancora aggiunta'}. Ho bisogno di aiuto con: ${context || 'configurazione'}.`;
  }
  function supportLinks(support, message) {
    support = support || {};
    const links = {};
    if (/^\+[1-9]\d{6,14}$/.test(support.whatsapp || '')) links.whatsapp = 'https://wa.me/' + support.whatsapp.slice(1) + '?text=' + encodeURIComponent(message);
    if (/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(support.email || '')) links.email = 'mailto:' + support.email + '?subject=' + encodeURIComponent('WelcomeBnB — supporto') + '&body=' + encodeURIComponent(message);
    try { const url = new URL(support.calendly); if (url.protocol === 'https:' && url.hostname === 'calendly.com' && !url.username && !url.password) links.calendly = url.href; } catch (_) {}
    return links;
  }
  const api = { buildSupportPrefill, supportLinks };
  root.OnboardingSupport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
