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
const { default: SellerPayout } = await import('../models/SellerPayout.js');
const { default: DeliveryPayout } = await import('../models/DeliveryPayout.js');
const { registerPushToken, notifyUser, notifySeller, notifyRider, notifyAllAdmins, NOTIFICATION_EVENT } = await import('../services/notification.service.js');

describe('Payout and Push Notification Enhancements', () => {
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
    await SellerPayout.deleteMany({});
    await DeliveryPayout.deleteMany({});
    sendPushNotification.mockClear();
    sendBulkNotification.mockClear();
  });

  test('seller.controller.js exports updateOrderStatus and does not throw', async () => {
    const sellerController = await import('../controllers/seller.controller.js');
    expect(sellerController.updateOrderStatus).toBeDefined();
  });

  test('admin receives push notification when seller requests a payout', async () => {
    const admin = await Admin.create({
      name: 'Super Admin',
      email: 'admin@bulkimart.com',
      password: 'password123',
      isActive: true,
    });
    await registerPushToken(admin._id, 'admin-fcm-token', 'web', 'admin', Admin, 'admin-pc');

    const user = await User.create({ name: 'Vendor Shop', phone: '9988776655', roles: ['seller'] });
    const seller = await Seller.create({
      userId: user._id,
      businessName: 'Vendor Grocery Store',
      status: 'approved',
    });

    await notifyAllAdmins({
      event: NOTIFICATION_EVENT.PAYOUT_REQUESTED,
      title: 'New Seller Payout Request',
      message: `${seller.businessName} requested a payout of ₹500.00.`,
      metadata: { sellerId: seller._id, amount: 500 },
      route: '/admin/finance-payouts',
    });

    await new Promise(resolve => setTimeout(resolve, 80));

    expect(sendPushNotification).toHaveBeenCalled();
    const callArgs = sendPushNotification.mock.calls[0];
    expect(callArgs[0]).toBe('admin-fcm-token');
    expect(callArgs[1].title).toBe('New Seller Payout Request');
    expect(callArgs[1].body).toContain('Vendor Grocery Store');
  });

  test('admin receives push notification when rider requests a payout', async () => {
    const admin = await Admin.create({
      name: 'Super Admin 2',
      email: 'admin2@bulkimart.com',
      password: 'password123',
      isActive: true,
    });
    await registerPushToken(admin._id, 'admin-fcm-token-2', 'web', 'admin', Admin, 'admin-pc-2');

    const riderUser = await User.create({ name: 'Raju Rider', phone: '9988776644', roles: ['delivery'] });
    const partner = await DeliveryPartner.create({
      userId: riderUser._id,
      status: 'approved',
    });

    await notifyAllAdmins({
      event: NOTIFICATION_EVENT.PAYOUT_REQUESTED,
      title: 'New Rider Payout Request',
      message: `${riderUser.name} requested a payout of ₹300.00.`,
      metadata: { partnerId: partner._id, amount: 300 },
      route: '/admin/delivery-payouts',
    });

    await new Promise(resolve => setTimeout(resolve, 80));

    expect(sendPushNotification).toHaveBeenCalled();
    const callArgs = sendPushNotification.mock.calls[0];
    expect(callArgs[0]).toBe('admin-fcm-token-2');
    expect(callArgs[1].title).toBe('New Rider Payout Request');
    expect(callArgs[1].body).toContain('Raju Rider');
  });

  test('seller receives push notification when payout is completed/settled', async () => {
    const sellerUser = await User.create({
      name: 'Seller User',
      phone: '9988776611',
      roles: ['seller'],
    });
    await registerPushToken(sellerUser._id, 'seller-fcm-token', 'web', 'seller', User, 'seller-pc');

    const seller = await Seller.create({
      userId: sellerUser._id,
      businessName: 'Super Seller Store',
      status: 'approved',
    });

    await notifySeller(seller._id, {
      event: NOTIFICATION_EVENT.PAYOUT_COMPLETED,
      title: 'Payout Processed',
      message: 'Your payout of ₹1000.00 has been transferred to your bank account. Ref: TXN12345.',
      metadata: { transactionRef: 'TXN12345' },
      route: '/seller/earnings',
    });

    await new Promise(resolve => setTimeout(resolve, 80));

    expect(sendPushNotification).toHaveBeenCalled();
    const callArgs = sendPushNotification.mock.calls[0];
    expect(callArgs[0]).toBe('seller-fcm-token');
    expect(callArgs[1].title).toBe('Payout Processed');
    expect(callArgs[1].body).toContain('TXN12345');
  });

  test('seller receives push notification when payout is rejected', async () => {
    const sellerUser = await User.create({
      name: 'Seller User 2',
      phone: '9988776622',
      roles: ['seller'],
    });
    await registerPushToken(sellerUser._id, 'seller-fcm-token-2', 'web', 'seller', User, 'seller-pc-2');

    const seller = await Seller.create({
      userId: sellerUser._id,
      businessName: 'Rejectable Seller',
      status: 'approved',
    });

    await notifySeller(seller._id, {
      event: NOTIFICATION_EVENT.PAYOUT_REJECTED,
      title: 'Payout Request Rejected',
      message: 'Your payout request for ₹500.00 was not processed: Invalid IFSC.',
      metadata: { reason: 'Invalid IFSC' },
      route: '/seller/earnings',
    });

    await new Promise(resolve => setTimeout(resolve, 80));

    expect(sendPushNotification).toHaveBeenCalled();
    const callArgs = sendPushNotification.mock.calls[0];
    expect(callArgs[0]).toBe('seller-fcm-token-2');
    expect(callArgs[1].title).toBe('Payout Request Rejected');
  });

  test('user receives exactly 1 push notification on order placed without duplicates', async () => {
    const buyer = await User.create({
      name: 'Customer Buyer',
      phone: '9988776633',
      roles: ['buyer'],
    });
    await registerPushToken(buyer._id, 'buyer-fcm-token', 'web', 'buyer', User, 'dev-buyer');

    const orderId = new mongoose.Types.ObjectId();
    await notifyUser(buyer._id, {
      event: NOTIFICATION_EVENT.ORDER_CREATED,
      dedupeKey: `buyer-order-${orderId}`,
      title: 'Order Placed Successfully!',
      message: 'Order #ORD-1234 has been placed.',
      metadata: { orderId },
      route: '/orders',
    });

    await new Promise(resolve => setTimeout(resolve, 80));

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
    expect(sendPushNotification.mock.calls[0][0]).toBe('buyer-fcm-token');
  });
});
