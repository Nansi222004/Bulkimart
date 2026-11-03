import { useEffect } from 'react';
import { Alert } from 'react-native';
import { navigateTo } from '../navigation/navigationRef';
import { notificationTarget } from '../utils/notificationRouting';
import { getInitialNotification, onForegroundMessage, onNotificationOpened, onTokenRefresh, syncPushIfEnabled } from '../services/push';

/**
 * Mounted only inside the approved seller stack, so every target screen exists.
 * - Registers this device for push on sign-in (unless the seller turned it off); follows token refreshes.
 * - Notification tapped (background / app closed) → open the matching screen.
 * - Foreground message → in-app alert with an Open button (Android doesn't show a tray notification in the foreground).
 */
export default function PushManager() {
  useEffect(() => {
    let active = true;
    syncPushIfEnabled().catch(() => {});
    const unsubscribers = [
      onTokenRefresh(),
      onNotificationOpened((message) => navigateTo(notificationTarget(message?.data))),
      onForegroundMessage((message) => {
        const target = notificationTarget(message?.data);
        Alert.alert(message?.notification?.title || 'Bulkimart Seller', message?.notification?.body || '', [
          { text: 'Dismiss', style: 'cancel' },
          ...(target ? [{ text: 'Open', onPress: () => navigateTo(target) }] : []),
        ]);
      }),
    ];
    getInitialNotification().then((message) => {
      if (active && message) setTimeout(() => navigateTo(notificationTarget(message.data)), 300);
    }).catch(() => {});
    return () => { active = false; unsubscribers.forEach((u) => { try { u?.(); } catch { /* already removed */ } }); };
  }, []);
  return null;
}
