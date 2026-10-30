import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const sendPushNotification = jest.fn(async () => ({ success: true }));
const sendBulkNotification = jest.fn(async () => ({ success: true }));
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification, sendBulkNotification }));

const { default: User } = await import('../models/User.js');
const { default: Admin } = await import('../models/Admin.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: DeliveryPartner } = await import('../models/DeliveryPartner.js');
const { registerPushToken, pushToUser, notifyUser, notifySeller, notifyRider, notifyAllAdmins, NOTIFICATION_EVENT } = await import('../services/notification.service.js');

let database;
beforeAll(async () => {
  database = await MongoMemoryServer.create({ binary: { version: '7.0.14' } });
  await mongoose.connect(database.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await database?.stop();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Admin.deleteMany({});
  await Seller.deleteMany({});
  await DeliveryPartner.deleteMany({});
  sendPushNotification.mockClear();
  sendBulkNotification.mockClear();
});

test('registering a new FCM token on the same device deactivates the previous token for that device', async () => {
  const user = await User.create({ phone: '9876543210', roles: ['buyer'] });

  // First session registration
  await registerPushToken(user._id, 'token-device-A-old', 'web', 'buyer', User, 'device-A');
  let saved = await User.findById(user._id).lean();
  expect(saved.pushTokens.filter(t => t.active)).toHaveLength(1);
  expect(saved.pushTokens.find(t => t.token === 'token-device-A-old').active).toBe(true);

  // Reconnect/refresh generates a new FCM token on the same device
  await registerPushToken(user._id, 'token-device-A-new', 'web', 'buyer', User, 'device-A');
  saved = await User.findById(user._id).lean();

  const activeTokens = saved.pushTokens.filter(t => t.active);
  expect(activeTokens).toHaveLength(1);
  expect(activeTokens[0].token).toBe('token-device-A-new');

  // Sending push to user should now only send 1 push to token-device-A-new
  await pushToUser(user._id, { title: 'Test', message: 'Hello', data: { audience: 'user' } });
  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-device-A-new');
});

test('pushToUser deduplicates tokens by deviceId even if multiple active tokens existed', async () => {
  const user = await User.create({
    phone: '9876543211',
    roles: ['buyer'],
    pushTokens: [
      { token: 'token-dev1-old', deviceId: 'device-1', active: true, platform: 'web', sessionRoles: ['buyer'], lastUsedAt: new Date(Date.now() - 60000) },
      { token: 'token-dev1-new', deviceId: 'device-1', active: true, platform: 'web', sessionRoles: ['buyer'], lastUsedAt: new Date() },
    ]
  });

  await pushToUser(user._id, { title: 'Test', message: 'Hello', data: { audience: 'user' } });
  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-dev1-new');
});

test('rapid duplicate notifications for the same event/order are debounced to exactly 1 push notification', async () => {
  const user = await User.create({
    phone: '9876543212',
    roles: ['buyer'],
    pushTokens: [
      { token: 'token-buyer-1', deviceId: 'device-buyer-1', active: true, platform: 'web', sessionRoles: ['buyer'] }
    ]
  });

  const orderId = new mongoose.Types.ObjectId();

  // Simulate concurrent calls (e.g. checkout response + payment webhook verification)
  await Promise.all([
    notifyUser(user._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'Order Placed',
      message: 'Your order was placed successfully',
      data: { orderId: String(orderId), audience: 'user' },
      metadata: { orderId }
    }),
    notifyUser(user._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'Order Placed',
      message: 'Your order was placed successfully',
      data: { orderId: String(orderId), audience: 'user' },
      metadata: { orderId }
    }),
    notifyUser(user._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'Order Placed',
      message: 'Your order was placed successfully',
      data: { orderId: String(orderId), audience: 'user' },
      metadata: { orderId }
    })
  ]);

  // Allow background pushToUser to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  // Even though notifyUser was invoked 3 times concurrently, only 1 push notification is delivered
  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-buyer-1');
});

test('rapid duplicate admin notifications are debounced to exactly 1 push per admin', async () => {
  const admin = await Admin.create({
    name: 'Admin Test',
    email: 'admin1@bulkimart.com',
    password: 'password123',
    role: 'admin',
    isActive: true,
  });

  await registerPushToken(admin._id, 'token-admin-1', 'web', 'admin', Admin, 'admin-pc');

  const orderId = new mongoose.Types.ObjectId();

  await Promise.all([
    notifyAllAdmins({
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'New Order Received',
      message: 'Order placed by customer',
      data: { orderId: String(orderId) },
      metadata: { orderId }
    }),
    notifyAllAdmins({
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'New Order Received',
      message: 'Order placed by customer',
      data: { orderId: String(orderId) },
      metadata: { orderId }
    })
  ]);

  // Allow background pushToUser to complete
  await new Promise(resolve => setTimeout(resolve, 50));

  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-admin-1');
});

test('rapid duplicate seller notifications are debounced to exactly 1 push notification', async () => {
  const sellerUser = await User.create({ phone: '9876543220', roles: ['seller'] });
  const seller = await Seller.create({ userId: sellerUser._id, storeDetails: { name: 'Super Store' } });
  await registerPushToken(sellerUser._id, 'token-seller-1', 'web', 'seller', User, 'seller-laptop');

  const orderId = new mongoose.Types.ObjectId();

  await Promise.all([
    notifySeller(seller._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'New Order Received',
      message: 'New order #123 waiting for fulfillment',
      metadata: { orderId: String(orderId) }
    }),
    notifySeller(seller._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'New Order Received',
      message: 'New order #123 waiting for fulfillment',
      metadata: { orderId: String(orderId) }
    }),
    notifySeller(seller._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      title: 'New Order Received',
      message: 'New order #123 waiting for fulfillment',
      metadata: { orderId: String(orderId) }
    })
  ]);

  await new Promise(resolve => setTimeout(resolve, 50));

  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-seller-1');
});

test('rapid duplicate rider notifications are debounced to exactly 1 push notification', async () => {
  const riderUser = await User.create({ phone: '9876543230', roles: ['delivery'] });
  const rider = await DeliveryPartner.create({ userId: riderUser._id });
  await registerPushToken(riderUser._id, 'token-rider-1', 'web', 'delivery', User, 'rider-phone');

  const orderId = new mongoose.Types.ObjectId();

  await Promise.all([
    notifyRider(rider._id, {
      event: NOTIFICATION_EVENT.RIDER_ASSIGNED,
      title: 'New Delivery Assigned',
      message: 'Pickup from Super Store',
      metadata: { orderId }
    }),
    notifyRider(rider._id, {
      event: NOTIFICATION_EVENT.RIDER_ASSIGNED,
      title: 'New Delivery Assigned',
      message: 'Pickup from Super Store',
      metadata: { orderId }
    })
  ]);

  await new Promise(resolve => setTimeout(resolve, 50));

  expect(sendPushNotification).toHaveBeenCalledTimes(1);
  expect(sendPushNotification.mock.calls[0][0]).toBe('token-rider-1');
});

