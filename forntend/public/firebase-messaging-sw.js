// firebase-messaging-sw.js — handles FCM push while the app is backgrounded
// or closed. Must live at the site root (not under /src) so its scope covers
// the whole origin. These config values are the public Firebase Web client
// identifiers (the same ones already shipped in the app's own JS bundle via
// VITE_FIREBASE_*) — not secrets. The registration URL supplies them as query
// parameters so staging and production cannot silently target different
// Firebase projects because of a hardcoded service-worker configuration.
// Install click handling before Firebase installs its default listener.
importScripts('/notification-routing.js');
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const route = self.notificationTarget(event.notification.data?.FCM_MSG?.data || event.notification.data);
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOrigin = list.filter(client => { try { return new URL(client.url).origin === self.location.origin; } catch { return false; } });
    const client = sameOrigin.find(client => new URL(client.url).pathname.startsWith('/seller')) || sameOrigin[0];
    if (client) { await client.navigate(route); return client.focus(); }
    return self.clients.openWindow?.(route);
  })());
});
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

const params = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, image } = payload.notification || {};
  const data = payload.data || {};
  // Firebase displays notification payloads itself. Only data-only messages
  // need manual display, avoiding duplicate background notifications.
  if (payload.notification) return;

  // `image` is only ever present on an Admin broadcast with media attached
  // (backend/services/fcm.service.js) — absent on every event-driven push,
  // so this stays exactly what it was for them. The browser Notification
  // API renders it as a large image in the OS notification where supported;
  // where it isn't, the option is silently ignored, never an error.
  return self.registration.showNotification(data.title || title || 'Bulkimart', {
    body: data.body || body || '',
    icon: '/favicon.svg',
    ...(image ? { image } : {}),
    data,
    ...(data.event === 'ORDER_CREATED' && /^[a-f\d]{24}$/i.test(data.orderId || '') ? { tag: `seller-order-${data.orderId}`, renotify: false } : {}),
  });
});

// Clicking the OS notification focuses an existing Bulkimart tab (navigating it
// to the deep link, if one was sent) or opens a new one.
