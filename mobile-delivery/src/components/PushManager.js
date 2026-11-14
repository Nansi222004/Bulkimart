import { useEffect, useRef } from 'react';
import messaging from '@react-native-firebase/messaging';
import { navigateTo } from '../navigation/navigationRef';
import { routeForNotification } from '../utils/notificationRouting';
import { onTokenRefresh } from '../services/push';
import { useToast } from './Toast';
import { useDuty } from '../context/DutyContext';

/**
 * Mounted only inside the approved rider stack, so every target screen exists.
 *  - Tap on a notification (app in background or closed) -> open the matching screen.
 *  - Message while the app is open -> a short toast (Android shows no tray notification then),
 *    plus an immediate re-read, because the socket/poll is what shows offers on screen.
 *  - The same message id is handled once, so a repeat delivery does not navigate twice.
 * Nothing from a payload is logged.
 */
export default function PushManager() {
  const toast = useToast();
  const { restoreActive, loadReturnPickups, loadSummary, checkParcelOffers } = useDuty();
  const seen = useRef(new Set());

  useEffect(() => {
    let active = true;
    const once = (message) => {
      const id = message?.messageId || message?.data?.notificationId;
      if (!id) return true;
      if (seen.current.has(id)) return false;
      seen.current.add(id);
      return true;
    };
    const open = (message) => {
      if (!message || !once(message)) return;
      navigateTo(routeForNotification(message.data?.route));
      // A tapped parcel offer opens its pop-up straight away instead of waiting for the next poll.
      if (message.data?.event === 'PARCEL_OFFER') checkParcelOffers();
    };

    const offs = [
      onTokenRefresh(),
      messaging().onNotificationOpenedApp(open),
      messaging().onMessage((message) => {
        if (!once(message)) return;
        const title = message?.notification?.title;
        const body = message?.notification?.body;
        if (title || body) toast.show([title, body].filter(Boolean).join(' — '));
        restoreActive(); loadReturnPickups(); loadSummary(); checkParcelOffers();
      }),
    ];
    messaging().getInitialNotification().then((message) => {
      if (active && message) setTimeout(() => open(message), 400);
    }).catch(() => {});
    return () => { active = false; offs.forEach((off) => { try { off?.(); } catch { /* already removed */ } }); };
  }, [toast, restoreActive, loadReturnPickups, loadSummary, checkParcelOffers]);

  return null;
}
