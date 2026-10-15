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

test('seller web orders use data-only push with stable topic while native apps retain notification payload', async () => {
  send.mockResolvedValue('message-fixture');
  const payload = { title: 'New Bulkimart Order', body: 'Order fixture', web: true, data: { audience: 'seller', event: 'ORDER_CREATED', orderId: '507f1f77bcf86cd799439011' } };
  await sendPushNotification('web-fixture', payload);
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: payload.title, body: payload.body }), webpush: { headers: { Topic: 'order-507f1f77bcf86cd799439011' } } }));
  expect(send.mock.calls[0][0].notification).toBeUndefined();
  await sendPushNotification('app-fixture', { ...payload, web: false });
  expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ notification: { title: payload.title, body: payload.body } }));
});

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

