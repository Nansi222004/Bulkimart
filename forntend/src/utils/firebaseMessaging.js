// firebaseMessaging.js — the frontend half of push notifications.
//
// Push is an enhancement, never a dependency: every function here is
// wrapped so a failure (unsupported browser, denied permission, missing
// config, offline) never throws back into a login/checkout/order flow that
// merely happens to call initPushNotifications() after success.
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { apiUrl } from './api';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const PUSH_TOKEN_KEY = 'nhcone_fcm_token';

let appInstance = null;
const getFirebaseApp = () => {
  if (appInstance) return appInstance;
  appInstance = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return appInstance;
};

let messagingInstance = null;
const getMessagingInstance = async () => {
  if (messagingInstance) return messagingInstance;
  if (typeof window === 'undefined') return null;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  messagingInstance = getMessaging(getFirebaseApp());
  return messagingInstance;
};

export const registerTokenWithBackend = async (token) => {
  const authToken = localStorage.getItem('userToken');
  if (!authToken || !token) return;
  try {
    await fetch(apiUrl('/api/notifications/tokens'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, platform: 'web' }),
    });
    localStorage.setItem(PUSH_TOKEN_KEY, token);
  } catch (err) {
    console.error('[PUSH] token registration failed (non-fatal):', err.message);
  }
};

/**
 * Registers the FCM service worker, requests permission if not already
 * decided, obtains a device token and saves it to the backend. Call once
 * per authenticated session (e.g. right after login) — it no-ops on repeat
 * calls within the same page load via `initialized`, so mounting effects
 * that re-run don't re-prompt or re-register.
 */
let initialized = false;
export const initPushNotifications = async () => {
  if (initialized) return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return;
  if (!VAPID_KEY || !firebaseConfig.apiKey) return; // not configured — silently skip
  initialized = true;

  try {
    if (Notification.permission === 'denied') return; // never re-prompt

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const messaging = await getMessagingInstance();
    if (!messaging) return;

    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return;

    await registerTokenWithBackend(token);
    return token;
  } catch (err) {
    console.error('[PUSH] initialization failed (non-fatal):', err.message);
  }
};

/** Call on logout — deactivates this device's token server-side, clears the local record. */
export const deregisterPushToken = async () => {
  const authToken = localStorage.getItem('userToken');
  const token = localStorage.getItem(PUSH_TOKEN_KEY);
  if (!authToken || !token) return;
  try {
    await fetch(apiUrl(`/api/notifications/tokens/${encodeURIComponent(token)}`), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
  } catch (err) {
    console.error('[PUSH] token removal failed (non-fatal):', err.message);
  } finally {
    localStorage.removeItem(PUSH_TOKEN_KEY);
  }
};

/**
 * Foreground messages only — the DB notification already exists by the time
 * this fires (the backend persists before it pushes), so the callback must
 * only update UI (toast / unread count), never create another record.
 */
export const onForegroundMessage = async (callback) => {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, (payload) => callback(payload));
};
