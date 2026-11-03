import { PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getInitialNotification as fcmInitialNotification, getMessaging, getToken, onMessage, onNotificationOpenedApp,
  onTokenRefresh as fcmOnTokenRefresh, registerDeviceForRemoteMessages,
} from '@react-native-firebase/messaging';
import { v4 as uuidv4 } from 'uuid';
import { api } from './apiClient';

const fcm = () => getMessaging();

/**
 * FCM push for the seller app. Backend contract (backend/controllers/notification.controller.js, services/notification.service.js):
 *   POST   /api/notifications/tokens { token, platform, deviceId }  → any platform other than 'web' is stored as an app token,
 *          scoped to the session role ('seller') from the JWT.
 *   DELETE /api/notifications/tokens/:token
 * Messages carry notification { title, body } and data { event, route, notificationId, audience, orderId?, returnId?, ... }.
 * Firebase: project bulkimart-d865c already has the Android app com.Bulkimart.seller registered; google-services.json is
 * copied into android/app on the trusted build machine and never committed.
 */
const KEYS = { enabled: 'bulkimart-seller:push-enabled', deviceId: 'bulkimart-seller:device-id', token: 'bulkimart-seller:push-token' };

export async function getDeviceId() {
  let deviceId = await AsyncStorage.getItem(KEYS.deviceId);
  if (!deviceId) { deviceId = `android-${uuidv4()}`; await AsyncStorage.setItem(KEYS.deviceId, deviceId); }
  return deviceId;
}

// On by default so order alerts work without finding a setting; only an explicit "off" disables it.
export const isPushEnabled = async () => (await AsyncStorage.getItem(KEYS.enabled)) !== 'false';

// Android 13+ needs POST_NOTIFICATIONS at runtime. Asked only when the seller turns push on.
export async function requestPushPermission() {
  if (Platform.OS !== 'android') return true;
  if (Platform.Version >= 33) {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true;
}

async function sendToken(token) {
  const deviceId = await getDeviceId();
  await api.post('/api/notifications/tokens', { token, platform: 'android', deviceId });
  await AsyncStorage.setItem(KEYS.token, token);
}

/** Turn push on for this device and signed-in seller. Returns { ok, reason? }. */
export async function enablePush() {
  if (!(await requestPushPermission())) return { ok: false, reason: 'permission' };
  await registerDeviceForRemoteMessages(fcm());
  const token = await getToken(fcm());
  if (!token) return { ok: false, reason: 'token' };
  await sendToken(token);
  await AsyncStorage.setItem(KEYS.enabled, 'true');
  return { ok: true };
}

/** Register this device after sign-in unless the seller turned push off (asks for permission on Android 13+). */
export async function syncPushIfEnabled() {
  if (!(await isPushEnabled())) return false;
  return (await enablePush()).ok;
}

/** Remove this device's token from the backend. sessionToken is passed explicitly because it runs during sign-out. */
export async function deregisterPush(sessionToken, { disable = false } = {}) {
  const token = await AsyncStorage.getItem(KEYS.token);
  if (token && sessionToken) {
    try {
      await api.delete(`/api/notifications/tokens/${encodeURIComponent(token)}`, {
        skipAuth: true, skipUnauthorizedHandler: true, timeout: 5000, headers: { Authorization: `Bearer ${sessionToken}` },
      });
    } catch { /* Sign-out must not depend on the network. */ }
  }
  await AsyncStorage.removeItem(KEYS.token);
  if (disable) await AsyncStorage.setItem(KEYS.enabled, 'false');
}

export function onTokenRefresh() {
  return fcmOnTokenRefresh(fcm(), async (token) => {
    if (await isPushEnabled()) { try { await sendToken(token); } catch { /* retried on next start */ } }
  });
}

export const onForegroundMessage = (handler) => onMessage(fcm(), handler);
export const onNotificationOpened = (handler) => onNotificationOpenedApp(fcm(), handler);
export const getInitialNotification = () => fcmInitialNotification(fcm());
