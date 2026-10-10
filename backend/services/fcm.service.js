// Firebase Cloud Messaging (FCM) push notification service
import { getMessaging } from 'firebase-admin/messaging';
import { getFirebaseApp } from '../config/firebaseAdmin.js';

export const sendPushNotification = async (fcmToken, { title, body, data = {}, image }) => {
  if (!fcmToken) return { success: false, error: 'No token provided' };

  if (process.env.FCM_MODE === 'mock') {
    console.log(`[MOCK FCM] To: ${fcmToken.substring(0, 20)}... | Title: "${title}" | Body: "${body}"`);
    return { success: true };
  }

  try {
    const messaging = getMessaging(getFirebaseApp());
    // `image` is FCM's own supported field on `notification` — omitted
    // entirely (not sent as `undefined`) for every push before broadcast
    // media existed, so this is additive, never a behavior change for them.
    const message = { token: fcmToken, notification: { title, body, ...(image ? { image } : {}) }, data };
    const response = await messaging.send(message);
    return { success: true, response };
  } catch (error) {
    console.error('FCM Push Notification Failed:', error.message);
    return { success: false, error: error.message, errorCode: error.code };
  }
};

export const sendBulkNotification = async (tokens = [], { title, body, data = {}, image }) => {
  if (tokens.length === 0) return { success: false, error: 'No tokens provided' };

  if (process.env.FCM_MODE === 'mock') {
    console.log(`[MOCK FCM BULK] To: ${tokens.length} devices | Title: "${title}" | Body: "${body}"`);
    return { success: true };
  }

  try {
    const messaging = getMessaging(getFirebaseApp());
    const response = await messaging.sendEachForMulticast({ tokens, notification: { title, body, ...(image ? { image } : {}) }, data });
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
    console.error('FCM Bulk Push Failed:', error.message);
    return { success: false, error: error.message, errorCode: error.code };
  }
};
