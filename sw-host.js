// sw-host.js — Round 42 host console service worker.
//
// Handles Web Push and notification-click. No fetch listener, no caching,
// no skipWaiting tricks — the guest app must remain unaffected. Scope is
// requested at registration time from host-console.html only.

self.addEventListener('install', () => {
  // Take control after a normal reload, not eagerly. Keeps
  // sw-host separate from anything the guest app might install later.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) {
      const text = event.data.text();
      try { data = JSON.parse(text); } catch (_) { data = { title: 'WelcomeBnB', body: text }; }
    }
  } catch (_) { data = {}; }

  const title = data.title || 'WelcomeBnB';
  const body  = data.body  || '';
  const tag   = data.tag   || 'wbnb-chat';
  const url   = data.url   || '/host-console.html';

  // ALWAYS show a notification — iOS revokes push subscriptions if a push
  // is silent, and browsers may throttle a subscription that never renders.
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    data: { url },
    requireInteraction: false,
  }));
});

self.addEventListener('notificationclick', (event) => {
  const url = (event.notification && event.notification.data && event.notification.data.url) || '/host-console.html';
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer an existing host-console client. Focus and navigate it to the
    // deep link so ?notify_prop / ?open / ?conv are handled by the host
    // console's boot handler.
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.pathname.endsWith('/host-console.html')) {
          await c.focus();
          if ('navigate' in c) { await c.navigate(url); }
          return;
        }
      } catch (_) {}
    }
    // No existing host-console tab — open one.
    if (self.clients.openWindow) {
      await self.clients.openWindow(url);
    }
  })());
});
