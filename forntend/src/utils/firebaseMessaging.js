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
import { enablePushSession, disablePushSession, getPushSession, notificationScope, pushSessionRevision } from './pushSessionState';

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
  const revision = pushSessionRevision(scope);
  const current = () => isCurrent() && revision === pushSessionRevision(scope) && authToken === getPortalToken(scope);
  if (!authToken || !token || !current()) return;
  try {
    // Validate against this backend before sending a device token. This also
    // catches legacy sessions copied from localhost or another deployment.
    const identityResponse = await boundedFetch(apiUrl('/api/auth/me'), { signal,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!identityResponse.ok) return;
    const identity = await identityResponse.json();
    const expectedRole = scope === 'customer' ? 'buyer' : scope;
    if (!identity.success || identity.userType !== 'user' || identity.sessionRole !== expectedRole || !identity.profile?._id || !current()) return;
    const response = await boundedFetch(apiUrl('/api/notifications/tokens'), {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ token, platform: 'web' }),
    });
    if (!response.ok) throw new Error('Backend rejected the push token');
    if (!current()) {
      await boundedFetch(apiUrl(`/api/notifications/tokens/${encodeURIComponent(token)}`), { method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${authToken}` } }, 5000).catch(() => {});
      return false;
    }
    if (!await enablePushSession(scope, identity.profile._id, token, current)) return false;
    if (!current()) return false;
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
  getSession: () => typeof localStorage === 'undefined' ? null : JSON.stringify([getPortalToken(scope), pushSessionRevision(scope)]),
  perform: async ({ requestPermission = false } = {}, { signal, isCurrent }) => {
    const authToken = getPortalToken(scope);
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
export const initPushNotifications = (options, scope = portalScope()) => {
  const registration = getRegistration(scope);
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') registration.reset();
  return registration.run(options);
};

/** Deactivate this device on logout and invalidate any pending registration. */
export const deregisterPushToken = async (scope = portalScope()) => {
  getRegistration(scope).reset();
  const authToken = getPortalToken(scope);
  const token = localStorage.getItem(pushTokenKey(scope));
  const localCleanup = disablePushSession(scope);
  localStorage.removeItem(pushTokenKey(scope));
  const unsubscribe = async (force = false) => {
    await localCleanup;
    // A shared subscription remains for other active portals. With no active
    // portal, unsubscribe locally too, including when the API is unreachable.
    const active = () => ['customer', 'seller', 'delivery', 'admin'].some(other => getPortalToken(other) && getPushSession(other));
    const changed = () => getPortalToken(scope) && getPortalToken(scope) !== authToken;
    const replaced = () => force && ['customer', 'seller', 'delivery', 'admin'].some(other => {
      const session = getPushSession(other);
      return getPortalToken(other) && session && session.token !== token;
    });
    if ((!force && active()) || changed() || replaced() || typeof navigator === 'undefined' || !navigator.serviceWorker?.getRegistration) return;
    const worker = await navigator.serviceWorker.getRegistration('/firebase-messaging-sw.js');
    const subscription = await worker?.pushManager?.getSubscription();
    if ((force || !active()) && !changed() && !replaced()) await subscription?.unsubscribe();
  };
  const subscriptionCleanup = unsubscribe().catch(() => {});
  if (!authToken || !token) { await subscriptionCleanup; return; }
  try {
    const response = await boundedFetch(apiUrl(`/api/notifications/tokens/${encodeURIComponent(token)}`), {
      method: 'DELETE', keepalive: true, headers: { Authorization: `Bearer ${authToken}` },
    }, 5000);
    if (!response.ok) throw new Error('Backend rejected push-token removal');
  } catch {
    console.error('[PUSH] token removal failed (non-fatal)');
    // A still-shared endpoint could otherwise cause generic browser alerts
    // for this logged-out role. Revoke it locally and restore only the roles
    // still signed in, using fresh subscriptions and server authentication.
    await subscriptionCleanup;
    const activeScopes = () => ['customer', 'seller', 'delivery'].filter(other => other !== scope && getPortalToken(other) && getPushSession(other));
    if (activeScopes().length) {
      await unsubscribe(true).catch(() => {});
      const restore = () => { for (const other of activeScopes()) {
        getRegistration(other).reset();
        void initPushNotifications({ requestPermission: false }, other).catch(() => {});
      } };
      if (typeof window !== 'undefined') window.addEventListener?.('online', restore, { once: true });
      if (typeof navigator !== 'undefined' && navigator.onLine !== false) restore();
    }
  } finally { await subscriptionCleanup; }
};

/** Foreground pushes update UI only; notification persistence is server-side. */
export const onForegroundMessage = async callback => {
  const scope = portalScope(), authToken = getPortalToken(scope);
  if (!authToken) return () => {};
  if (!hasFirebaseWebConfig) return () => {};
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, payload => {
    const session = getPushSession(scope);
    if (authToken !== getPortalToken(scope) || !session
      || notificationScope(payload.data) !== scope || payload.data?.recipientId !== session.recipientId) return;
    callback(payload);
  });
};
