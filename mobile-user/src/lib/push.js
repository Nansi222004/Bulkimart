// Native push — replaces frontend/src/utils/firebaseMessaging.js (Firebase web messaging + service worker).
// Same backend contract: POST /api/notifications/tokens { token, platform } with X-Device-Id, and
// DELETE /api/notifications/tokens/:token on logout. The backend stores non-web tokens as platform "app" and
// sends them a regular notification payload, so no backend change is needed.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { boundedFetch, getToken } from '../api/client';
import { local } from './storage';

const PUSH_TOKEN_KEY = 'nhcone_fcm_token';
const DEVICE_ID_KEY = 'bulkimart_push_device_id';
const CHANNEL_ID = 'default';

export const getPushDeviceId = () => {
  let id = local.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    local.setItem(DEVICE_ID_KEY, id);
  }
  return id;
};

// Foreground pushes show as a normal banner, but only for the signed-in customer they were sent to. After logout
// (or for another role's message) nothing is shown — the web worker enforces the same rule.
let currentRecipient = null;
export const setPushRecipient = id => { currentRecipient = id ? String(id) : null; };
const audienceIsCustomer = data => !data?.audience || ['user', 'buyer', 'customer'].includes(data.audience);

Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const data = notification.request.content.data || {};
    const allowed = Boolean(getToken()) && audienceIsCustomer(data) && (!data.recipientId || String(data.recipientId) === currentRecipient);
    return { shouldShowBanner: allowed, shouldShowList: allowed, shouldPlaySound: allowed, shouldSetBadge: false };
  },
});

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, { name: 'Bulkimart updates', importance: Notifications.AndroidImportance.HIGH });
}

async function registerTokenWithBackend(token, authToken) {
  // Validate the session against this backend before sending a device token (web: registerTokenWithBackend).
  const identity = await boundedFetch('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } });
  if (!identity.ok) return false;
  const body = await identity.json().catch(() => ({}));
  if (!body.success || body.userType !== 'user' || body.sessionRole !== 'buyer' || !body.profile?._id) return false;
  if (authToken !== getToken()) return false;
  const response = await boundedFetch('/api/notifications/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, 'X-Device-Id': getPushDeviceId() },
    body: JSON.stringify({ token, platform: 'android' }),
  });
  if (!response.ok) return false;
  if (authToken !== getToken()) {
    await removeTokenFromBackend(token, authToken);
    return false;
  }
  local.setItem(PUSH_TOKEN_KEY, token);
  setPushRecipient(body.profile._id);
  return true;
}

async function removeTokenFromBackend(token, authToken) {
  try {
    await boundedFetch(`/api/notifications/tokens/${encodeURIComponent(token)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } }, 5000);
  } catch { /* best effort: the backend also replaces a device's token on the next login */ }
}

let pending = null;
/**
 * Register this device for the signed-in customer. Without `requestPermission` it never prompts — the web
 * asks only after an explicit action (placing an order), and so does the app.
 * Returns the token, or `{ status }`.
 */
export function initPushNotifications({ requestPermission = false } = {}) {
  const authToken = getToken();
  if (!authToken) return Promise.resolve({ status: 'unauthenticated' });
  if (pending?.authToken === authToken && !requestPermission) return pending.promise;
  const promise = (async () => {
    try {
      await ensureChannel();
      let { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        if (!requestPermission) return { status: 'prompt_required' };
        ({ status } = await Notifications.requestPermissionsAsync());
        if (status !== 'granted') return { status };
      }
      const device = await Notifications.getDevicePushTokenAsync();
      const token = typeof device?.data === 'string' ? device.data : '';
      if (!token) return { status: 'unavailable' };
      if (authToken !== getToken()) return { status: 'session_changed' };
      return (await registerTokenWithBackend(token, authToken)) ? token : { status: 'registration_failed' };
    } catch {
      return { status: 'unavailable' };
    }
  })();
  pending = { authToken, promise };
  promise.finally(() => { if (pending?.promise === promise) pending = null; });
  return promise;
}

// FCM can rotate the token; send the new one for the current session.
Notifications.addPushTokenListener(device => {
  const authToken = getToken();
  if (authToken && typeof device?.data === 'string' && device.data && device.data !== local.getItem(PUSH_TOKEN_KEY)) {
    registerTokenWithBackend(device.data, authToken).catch(() => {});
  }
});

/** On logout: remove this device's token for the account that is signing out. */
export async function deregisterPushToken(authToken = getToken()) {
  const token = local.getItem(PUSH_TOKEN_KEY);
  local.removeItem(PUSH_TOKEN_KEY);
  setPushRecipient(null);
  if (authToken && token) await removeTokenFromBackend(token, authToken);
}

/** Where a tapped notification should open — same rule as frontend/public/notification-routing.js for customers. */
export function notificationTarget(data = {}) {
  const route = String(data.route || '');
  return route.startsWith('/') && !route.startsWith('//') ? route.split('#')[0] : '/';
}
