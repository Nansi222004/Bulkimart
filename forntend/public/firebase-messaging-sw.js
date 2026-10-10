// firebase-messaging-sw.js — handles FCM push while the app is backgrounded
// or closed. Must live at the site root (not under /src) so its scope covers
// the whole origin. These config values are the public Firebase Web client
// identifiers (the same ones already shipped in the app's own JS bundle via
// VITE_FIREBASE_*) — not secrets; a service worker cannot read Vite env vars,
// so Firebase's own docs call for hardcoding them here.
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAo1imN-a0bhzmYVj6qw3cXeyqIFHySMdE",
  authDomain: "bulkimart-d865c.firebaseapp.com",
  projectId: "bulkimart-d865c",
  storageBucket: "bulkimart-d865c.firebasestorage.app",
  messagingSenderId: "491974533047",
  appId: "1:491974533047:web:af9867c4451060af359232",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body, image } = payload.notification || {};
  const data = payload.data || {};

  // `image` is only ever present on an Admin broadcast with media attached
  // (backend/services/fcm.service.js) — absent on every event-driven push,
  // so this stays exactly what it was for them. The browser Notification
  // API renders it as a large image in the OS notification where supported;
  // where it isn't, the option is silently ignored, never an error.
  self.registration.showNotification(title || 'Bulkimart', {
    body: body || '',
    icon: '/favicon.svg',
    ...(image ? { image } : {}),
    data,
  });
});

// Clicking the OS notification focuses an existing Bulkimart tab (navigating it
// to the deep link, if one was sent) or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = event.notification.data?.route || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(route);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(route);
    })
  );
});
