// Firebase Cloud Messaging (FCM) push notification service
import { getMessaging } from 'firebase-admin/messaging';
import { getFirebaseApp } from '../config/firebaseAdmin.js';
import { isMockIntegrationEnabled } from '../config/runtime.js';

/**
 * Rider offers ring: the delivery app creates the "New order offers" channel (RIDER_OFFER_CHANNEL, high importance,
 * pop-up, its own ringtone — mobile-delivery/.../alert/OrderAlertModule.kt). Offers go there at high priority so a
 * closed app still pops up and rings. The rider's "Send test" push rings too, so riders can check the sound.
 * Older delivery app builds without that channel fall back to Android's default channel (default sound).
 */
export const RIDER_OFFER_CHANNEL = 'rider_offers_v1';
const RIDER_RING_EVENTS = new Set(['RIDER_PING', 'RIDER_REQUESTED', 'PARCEL_OFFER', 'RIDER_ASSIGNED']);
// notifyRider sends audience 'rider'; the rider app's test push sends its session role 'delivery'.
const RIDER_AUDIENCES = new Set(['rider', 'delivery']);
const ringsRider = (data) => RIDER_AUDIENCES.has(data?.audience) && (RIDER_RING_EVENTS.has(data?.event) || data?.test === 'true');

// Web display belongs to the worker so it can enforce logout before showing
// anything. Firebase's automatic notification payload bypasses that check.
export const pushMessage = ({ title, body, data, image, web }) => {
  const getTopic = () => {
    if (data?.audience === 'seller' && data?.event === 'ORDER_CREATED' && data?.orderId) {
      return `order-${data.orderId}`;
    }
    const raw = data?.notificationId ? `notif-${data.notificationId}`
      : (data?.orderId ? `order-${data.event || 'update'}-${data.orderId}`
      : (data?.returnId ? `return-${data.event || 'update'}-${data.returnId}`
      : (data?.ticketId ? `ticket-${data.event || 'update'}-${data.ticketId}`
      : (data?.eventId || data?.event || null))));
    return raw ? String(raw).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) : undefined;
  };
  const topic = getTopic();
  const ring = !web && ringsRider(data);
  const android = {
    ...(topic ? { collapseKey: topic } : {}),
    ...(ring ? {
      priority: 'high',
      ttl: 2 * 60 * 1000, // an offer is only open for about a minute; a late delivery would ring for nothing
      notification: {
        channelId: RIDER_OFFER_CHANNEL,
        sound: 'order_alert', // res/raw/order_alert; Android 8+ takes the sound from the channel
        priority: 'max',
        visibility: 'public',
        defaultVibrateTimings: false,
        vibrateTimingsMillis: [0, 600, 400, 600, 400, 600],
      },
    } : {}),
  };

  return web
    ? {
        data: { ...data, title, body, ...(image ? { image } : {}) },
        ...(topic ? { webpush: { headers: { Topic: topic } } } : {}),
      }
    : {
        notification: { title, body, ...(image ? { image } : {}) },
        data,
        ...(Object.keys(android).length ? { android } : {}),
        ...(topic ? { apns: { headers: { 'apns-collapse-id': topic } } } : {}),
      };
};

export const sendPushNotification = async (fcmToken, { title, body, data = {}, image, web = false }) => {
  if (!fcmToken) return { success: false, error: 'No token provided' };

  if (isMockIntegrationEnabled('FCM_MODE')) {
    console.log(`[MOCK FCM] Notification suppressed | Title: "${title}"`);
    return { success: true };
  }

  try {
    const messaging = getMessaging(getFirebaseApp());
    // `image` is FCM's own supported field on `notification` — omitted
    // entirely (not sent as `undefined`) for every push before broadcast
    // media existed, so this is additive, never a behavior change for them.
    const message = { token: fcmToken, ...pushMessage({ title, body, data, image, web }) };
    const response = await messaging.send(message);
    return { success: true, response };
  } catch (error) {
    console.error('FCM Push Notification Failed:', error.code || 'delivery_failed');
    return { success: false, error: error.message, errorCode: error.code };
  }
};

export const sendBulkNotification = async (tokens = [], { title, body, data = {}, image, web = false }) => {
  if (tokens.length === 0) return { success: false, error: 'No tokens provided' };

  if (isMockIntegrationEnabled('FCM_MODE')) {
    console.log(`[MOCK FCM BULK] ${tokens.length} notifications suppressed | Title: "${title}"`);
    return { success: true };
  }

  try {
    const messaging = getMessaging(getFirebaseApp());
    const response = await messaging.sendEachForMulticast({ tokens, ...pushMessage({ title, body, data, image, web }) });
    return {
      success: true,
      failureCount: response.failureCount,
      successCount: response.successCount,
      // Per-token results, same order as `tokens` — lets a caller identify
      // exactly which token failed and why (e.g. to deactivate a
      // no-longer-registered one) without re-parsing the SDK response shape.
      responses: response.responses.map((r) => ({
        success: r.success,
        errorCode: r.error?.code,
      })),
    };
  } catch (error) {
    console.error('FCM Bulk Push Failed:', error.code || 'delivery_failed');
    return { success: false, error: error.message, errorCode: error.code };
  }
};
