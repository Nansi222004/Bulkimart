import { PermissionsAndroid, Platform } from 'react-native';
import { queuePermission } from './permissionQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';
import messaging from '@react-native-firebase/messaging';
import { v4 as uuidv4 } from 'uuid';
import { api } from './apiClient';

/**
 * FCM push for the rider app. Backend contract (controllers/notification.controller.js):
 *   POST   /api/notifications/tokens { token, platform, deviceId } -> stored for the JWT's session role ('delivery')
 *   DELETE /api/notifications/tokens/:token -> removes this device's token (sign-out)
 * Firebase Android client com.Bulkimart.delivery exists in the project's google-services.json,
 * which is copied into android/app on the build machine and never committed.
 * The web portal registers push for every approved rider, independent of the duty toggle; so does this app.
 */
const KEYS = { deviceId: 'bulkimart-delivery:device-id', token: 'bulkimart-delivery:push-token', declined: 'bulkimart-delivery:push-declined' };

export async function getDeviceId() {
  let deviceId = await AsyncStorage.getItem(KEYS.deviceId);
  if (!deviceId) { deviceId = `android-${uuidv4()}`; await AsyncStorage.setItem(KEYS.deviceId, deviceId); }
  return deviceId;
}

// Android 13+ asks for POST_NOTIFICATIONS at runtime.
export async function requestPushPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true;
  // Queued so it never collides with the location prompt (see permissionQueue.js).
  const result = await queuePermission(() => PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS));
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function hasPushPermission() {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

async function sendToken(token) {
  const deviceId = await getDeviceId();
  await api.post('/api/notifications/tokens', { token, platform: 'android', deviceId });
  await AsyncStorage.setItem(KEYS.token, token);
}

/** Register this device for an approved rider. Returns { ok, reason? }. Never throws. */
export async function registerPush({ askPermission = true } = {}) {
  try {
    const granted = askPermission ? await requestPushPermission() : await hasPushPermission();
    if (!granted) { await AsyncStorage.setItem(KEYS.declined, 'true'); return { ok: false, reason: 'permission' }; }
    await AsyncStorage.removeItem(KEYS.declined);
    await messaging().registerDeviceForRemoteMessages();
    const token = await messaging().getToken();
    if (!token) return { ok: false, reason: 'token' };
    await sendToken(token);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export const pushWasDeclined = async () => (await AsyncStorage.getItem(KEYS.declined)) === 'true';

/** Remove this device's token. The session token is passed explicitly because this runs during sign-out. */
export async function deregisterPush(sessionToken) {
  const token = await AsyncStorage.getItem(KEYS.token);
  if (token && sessionToken) {
    try {
      await api.delete(`/api/notifications/tokens/${encodeURIComponent(token)}`, {
        skipAuth: true, skipUnauthorizedHandler: true, timeout: 5000, headers: { Authorization: `Bearer ${sessionToken}` },
      });
    } catch { /* Sign-out never depends on the network. */ }
  }
  await AsyncStorage.removeItem(KEYS.token);
  try { await messaging().deleteToken(); } catch { /* a fresh token is issued on the next sign-in */ }
}

export function onTokenRefresh() {
  return messaging().onTokenRefresh(async (token) => {
    try { await sendToken(token); } catch { /* retried on next start */ }
  });
}
