import { getPortalToken, portalScope, pushTokenKey } from './portalSession';
// firebaseMessaging.js — the frontend half of push notifications.
//
// Push is an enhancement, never a dependency: every function here is
// wrapped so a failure (unsupported browser, denied permission, missing
// config, offline) never throws back into a login/checkout/order flow that
// merely happens to call initPushNotifications() after success.
import { initializeApp, getApps } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { apiUrl } from './api';
import { createPushRegistration } from './pushRegistration';
import { boundedFetch } from './portalRequests';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const hasFirebaseWebConfig = Object.values(firebaseConfig).every(Boolean);


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

export const registerTokenWithBackend = async (token, authToken = getPortalToken(), { signal, isCurrent = () => true, scope = portalScope() } = {}) => {
  if (!authToken || !token || !isCurrent() || authToken !== getPortalToken(scope)) return;
  try {
    // Validate against this backend before sending a device token. This also
    // catches legacy sessions copied from localhost or another deployment.
    const identityResponse = await boundedFetch(apiUrl('/api/auth/me'), { signal,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!identityResponse.ok) return;
    const identity = await identityResponse.json();
    const expectedRole = scope === 'customer' ? 'buyer' : scope;
    if (!identity.success || identity.userType !== 'user' || identity.sessionRole !== expectedRole || !identity.profile?._id || !isCurrent() || authToken !== getPortalToken(scope)) return;
    const response = await boundedFetch(apiUrl('/api/notifications/tokens'), {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, platform: 'web' }),
    });
    if (!response.ok) throw new Error('Backend rejected the push token');
    if (!isCurrent() || authToken !== getPortalToken(scope)) {
      await fetch(apiUrl(`/api/notifications/tokens/${encodeURIComponent(token)}`), { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {});
      return false;
    }
    localStorage.setItem(pushTokenKey(scope), token);
    return true;
  } catch {
    console.error('[PUSH] token registration failed (non-fatal)');
  }
};

/**
 * Restore a granted push subscription without prompting. Only an explicit
 * user action may pass requestPermission=true. Registrations are scoped to
 * the current authenticated session, including account switches.
 */
const registrations = new Map();
const getRegistration = (scope) => {
if (!registrations.has(scope)) registrations.set(scope, createPushRegistration({
  getSession: () => typeof localStorage === 'undefined' ? null : getPortalToken(scope),
  perform: async ({ requestPermission = false } = {}, { session: authToken, signal, isCurrent }) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return { status: 'unsupported' };
    if (Notification.permission === 'denied') return { status: 'denied' };
    if (!VAPID_KEY || !hasFirebaseWebConfig) return { status: 'unconfigured' };
    if (!authToken) return { status: 'unauthenticated' };
    if (Notification.permission === 'default' && !requestPermission) return { status: 'prompt_required' };

    try {
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') return { status: permission };
      if (!isCurrent()) return { status: 'session_changed' };
      let worker;
      try {
        worker = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${new URLSearchParams(firebaseConfig)}`);
      } catch (error) { return { status: 'worker_registration_failed', code: error.name }; }
      if (!isCurrent()) return { status: 'session_changed' };
      const messaging = await getMessagingInstance();
      if (!messaging) return { status: 'unsupported' };
      if (!isCurrent()) return { status: 'session_changed' };
      const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: worker });
      if (!isCurrent()) return { status: 'session_changed' };
      if (!token) return { status: 'unavailable' };
      if (!await registerTokenWithBackend(token, authToken, { signal, isCurrent, scope })) return { status: 'registration_failed' };
      return isCurrent() ? token : { status: 'session_changed' };
    } catch (error) {
      return { status: 'unavailable', code: typeof error.code === 'string' && /^[a-z\d/_-]{1,100}$/i.test(error.code) ? error.code : error.name };
    }
  },
}));
return registrations.get(scope);
};
export const initPushNotifications = options => {
  const registration = getRegistration(portalScope());
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') registration.reset();
  return registration.run(options);
};

/** Deactivate this device on logout and invalidate any pending registration. */
export const deregisterPushToken = async () => {
  const scope = portalScope();
  getRegistration(scope).reset();
  const authToken = getPortalToken(scope);
  const token = localStorage.getItem(pushTokenKey(scope));
  if (!authToken || !token) return;
  try {
    const response = await fetch(apiUrl(`/api/notifications/tokens/${encodeURIComponent(token)}`), {
      method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!response.ok) throw new Error('Backend rejected push-token removal');
  } catch {
    console.error('[PUSH] token removal failed (non-fatal)');
  } finally { localStorage.removeItem(pushTokenKey(scope)); }
};

/** Foreground pushes update UI only; notification persistence is server-side. */
export const onForegroundMessage = async callback => {
  if (!hasFirebaseWebConfig) return () => {};
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, payload => callback(payload));
};
