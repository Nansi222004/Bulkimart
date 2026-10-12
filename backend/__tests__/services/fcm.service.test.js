import { jest } from '@jest/globals';

const send = jest.fn();
const sendEachForMulticast = jest.fn();

jest.unstable_mockModule('firebase-admin/messaging', () => ({
  getMessaging: () => ({ send, sendEachForMulticast }),
}));
jest.unstable_mockModule('../../config/firebaseAdmin.js', () => ({
  getFirebaseApp: () => ({ name: 'test-app' }),
}));
jest.unstable_mockModule('../../config/runtime.js', () => ({
  isMockIntegrationEnabled: () => false,
}));

const { sendPushNotification, sendBulkNotification } = await import('../../services/fcm.service.js');

beforeEach(() => jest.clearAllMocks());

test('reports real Firebase send success only after the SDK resolves', async () => {
  send.mockResolvedValue('firebase-message-id');
  await expect(sendPushNotification('device-token', { title: 'Order', body: 'Confirmed' }))
    .resolves.toEqual({ success: true, response: 'firebase-message-id' });
});

test('does not report fake success when Firebase rejects a send', async () => {
  send.mockRejectedValue(Object.assign(new Error('token rejected'), {
    code: 'messaging/registration-token-not-registered',
  }));
  await expect(sendPushNotification('invalid-token', { title: 'Order', body: 'Confirmed' }))
    .resolves.toEqual(expect.objectContaining({
      success: false,
      errorCode: 'messaging/registration-token-not-registered',
    }));
});

test('preserves per-token Firebase results for invalid-token cleanup', async () => {
  sendEachForMulticast.mockResolvedValue({
    successCount: 1,
    failureCount: 1,
    responses: [
      { success: true },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
    ],
  });
  await expect(sendBulkNotification(['good', 'bad'], { title: 'Update', body: 'Ready' }))
    .resolves.toEqual(expect.objectContaining({ success: true, successCount: 1, failureCount: 1 }));
});

