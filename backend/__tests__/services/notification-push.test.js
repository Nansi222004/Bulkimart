import { jest } from '@jest/globals';

const sendPushNotification = jest.fn();
const sendBulkNotification = jest.fn();
const updateMany = jest.fn(async () => ({ acknowledged: true }));
const updateOne = jest.fn(async () => ({ acknowledged: true }));
let selectedUser;

const queryResult = (value) => ({
  select() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const User = {
  updateMany,
  updateOne,
  findById: jest.fn(() => queryResult(selectedUser)),
};

jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/Notification.js', () => ({ default: { create: jest.fn() } }));
jest.unstable_mockModule('../../models/Admin.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: {} }));
jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({ default: {} }));
jest.unstable_mockModule('../../services/fcm.service.js', () => ({ sendPushNotification, sendBulkNotification }));

const { pushToUser, registerPushToken, removePushToken } = await import('../../services/notification.service.js');

beforeEach(() => {
  jest.clearAllMocks();
  selectedUser = null;
});

test('token registration removes the same device from other accounts before saving', async () => {
  selectedUser = {
    pushTokens: [],
    save: jest.fn(async () => {}),
  };
  await registerPushToken('current-user', 'device-token', 'web');
  expect(updateMany).toHaveBeenCalledTimes(2);
  expect(selectedUser.pushTokens).toEqual([expect.objectContaining({ token: 'device-token', active: true })]);
  expect(selectedUser.save).toHaveBeenCalled();
});

test('logout removes only the current device token', async () => {
  selectedUser = {
    fcmToken: 'device-a',
    pushTokens: [{ token: 'device-a' }, { token: 'device-b' }],
    save: jest.fn(async () => {}),
  };
  await removePushToken('current-user', 'device-a');
  expect(selectedUser.pushTokens).toEqual([{ token: 'device-b' }]);
  expect(selectedUser.fcmToken).toBeUndefined();
});

test('an invalid Firebase token is deactivated without logging or retrying fake success', async () => {
  selectedUser = { pushTokens: [{ token: 'bad-token', active: true }] };
  sendPushNotification.mockResolvedValue({
    success: false,
    error: 'not registered',
    errorCode: 'messaging/registration-token-not-registered',
  });
  await pushToUser('current-user', { title: 'Order', message: 'Updated' });
  expect(updateOne).toHaveBeenCalledWith(
    { _id: 'current-user', 'pushTokens.token': 'bad-token' },
    { $set: { 'pushTokens.$.active': false } },
  );
});

test('seller-order pushes deduplicate device tokens and keep web/app transport payloads separate', async () => {
  selectedUser = { pushTokens: [
    { token: 'browser-token', platform: 'web', active: true },
    { token: 'browser-token', platform: 'web', active: true },
    { token: 'app-token', platform: 'app', active: true },
  ] };
  sendPushNotification.mockResolvedValue({ success: true });
  await pushToUser('current-user', { title: 'New Bulkimart Order', message: 'Order fixture', data: { audience: 'seller', event: 'ORDER_CREATED', orderId: '507f1f77bcf86cd799439011' } });
  expect(sendPushNotification).toHaveBeenCalledTimes(2);
  expect(sendPushNotification).toHaveBeenCalledWith('browser-token', expect.objectContaining({ web: true }));
  expect(sendPushNotification).toHaveBeenCalledWith('app-token', expect.objectContaining({ web: false }));
});

