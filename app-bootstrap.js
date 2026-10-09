// Loaded before every app initializes Supabase. Never fall back to production.
window.getWelcomeBnbConfig = function () {
  const c = window.WELCOME_BNB_CONFIG;
  const productionRef = 'jcjwaqqabgwqhhzhfbts';
  if (!c || !['demo', 'production'].includes(c.mode) || !c.publicKey ||
      !/^[a-z0-9]{20}$/.test(c.projectRef) ||
      c.supabaseUrl !== `https://${c.projectRef}.supabase.co` ||
      (c.mode === 'demo' && c.projectRef === productionRef)) {
    throw new Error('Application environment configuration is missing or invalid');
  }
  const current = location.origin;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(current);
  if (!Array.isArray(c.allowedOrigins) || (!c.allowedOrigins.includes(current) && !local)) {
    throw new Error('Application configuration belongs to a different deployment');
  }
  if (c.mode === 'demo' && ['https://app.welcomebnb.it', 'https://welcomebnb.vercel.app'].includes(c.appOrigin)) {
    throw new Error('Demo application links cannot point to production');
  }
  if (c.mode === 'demo') {
    // Same-origin storage already separates live and demo. Invalidate demo-only
    // app state when switching its database; retain production migration behavior.
    const marker = `demo:${c.projectRef}`;
    if (localStorage.getItem('wbnb_demo_environment') !== marker) {
      for (const store of [localStorage, sessionStorage]) {
        for (let i = store.length - 1; i >= 0; i--) {
          const key = store.key(i);
          if (/^(wbnb_|doorstep_|sb-)/.test(key)) store.removeItem(key);
        }
      }
      localStorage.setItem('wbnb_demo_environment', marker);
    }
  }
  return c;
};
