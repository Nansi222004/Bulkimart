import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const sendPushNotification = jest.fn(async () => ({ success: true }));
const sendBulkNotification = jest.fn(async () => ({ success: true }));
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification, sendBulkNotification }));
const { default: User } = await import('../models/User.js');
const { registerPushToken, removePushToken, pushToUser } = await import('../services/notification.service.js');
let database, user;
beforeAll(async () => {
  database = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(database.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await database?.stop(); });
beforeEach(async () => {
  await User.deleteMany({}); jest.clearAllMocks();
  user = await User.create({ phone: '9876500991', roles: ['buyer', 'seller', 'delivery'] });
});
const send = audience => pushToUser(user._id, { title: 'Fixture', message: 'Update', data: { audience } });

test('seller logout stops seller pushes while the same browser customer and other devices remain subscribed', async () => {
  await registerPushToken(user._id, 'browser-fixture', 'web', 'buyer');
  await registerPushToken(user._id, 'browser-fixture', 'web', 'seller');
  await registerPushToken(user._id, 'other-device-fixture', 'web', 'seller');
  await removePushToken(user._id, 'browser-fixture', 'seller');
  const saved = await User.findById(user._id).lean();
  expect(saved.pushTokens.find(token => token.token === 'browser-fixture').sessionRoles).toEqual(['buyer']);
  await send('seller');
  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('other-device-fixture');
  sendPushNotification.mockClear();
  await send('user');
  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('browser-fixture');
});

test.each([['buyer', 'user'], ['seller', 'seller'], ['delivery', 'rider']])('%s logout removes its last device registration and legacy fallback; login restores delivery', async (role, audience) => {
  await registerPushToken(user._id, 'device-fixture', 'web', role);
  await removePushToken(user._id, 'device-fixture', role);
  const saved = await User.findById(user._id).lean();
  expect(saved.pushTokens).toHaveLength(0); expect(saved.fcmToken).toBeUndefined();
  await send(audience);
  expect(sendPushNotification).not.toHaveBeenCalled(); expect(sendBulkNotification).not.toHaveBeenCalled();
  await registerPushToken(user._id, 'new-device-fixture', 'web', role);
  await send(audience); expect(sendPushNotification).toHaveBeenCalledTimes(1);
});

test('logout cleans legacy tokens without changing another account or device', async () => {
  await User.updateOne({ _id: user._id }, { $set: { fcmToken: 'legacy-fixture', pushTokens: [
    { token: 'legacy-fixture', active: true, platform: 'web' },
    { token: 'other-device-fixture', active: true, platform: 'app' },
  ] } });
  const other = await User.create({ phone: '9876500992', pushTokens: [{ token: 'other-account-fixture', active: true }] });
  await removePushToken(user._id, 'legacy-fixture', 'buyer');
  await removePushToken(user._id, 'other-account-fixture', 'buyer');
  const saved = await User.findById(user._id).lean();
  expect(saved.pushTokens.map(token => token.token)).toEqual(['other-device-fixture']);
  expect(saved.fcmToken).toBeUndefined();
  expect((await User.findById(other._id)).pushTokens).toHaveLength(1);
});

test('a registration for one signed role cannot receive another role notifications', async () => {
  await registerPushToken(user._id, 'customer-only-fixture', 'web', 'buyer');
  await send('seller'); await send('rider');
  expect(sendPushNotification).not.toHaveBeenCalled(); expect(sendBulkNotification).not.toHaveBeenCalled();
  await send('user'); expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][1].data.recipientId).toBe(String(user._id));
});
