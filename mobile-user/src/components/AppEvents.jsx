// Notification taps (app open, in background, or launched from a notification) and connectivity changes.
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { useRouter } from 'expo-router';
import { notificationTarget } from '../lib/push';
import { appHrefFromWebPath } from '../lib/webPath';
import { emit, EVENTS } from '../lib/events';

export default function AppEvents() {
  const router = useRouter();
  const handled = useRef(new Set());
  useEffect(() => {
    const open = response => {
      const id = response?.notification?.request?.identifier;
      if (!response || (id && handled.current.has(id))) return;
      if (id) handled.current.add(id);
      const href = appHrefFromWebPath(notificationTarget(response.notification.request.content.data || {}));
      // Account screens show sign-in first when the customer is signed out.
      if (href !== '/') router.push(href);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    let wasOnline = true;
    return NetInfo.addEventListener(state => {
      const online = state.isConnected !== false && state.isInternetReachable !== false;
      if (online && !wasOnline) emit(EVENTS.ONLINE);
      wasOnline = online;
    });
  }, []);
  return null;
}
