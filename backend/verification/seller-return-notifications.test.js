import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const sendPushNotification = jest.fn(async () => ({ success: true }));
const sendBulkNotification = jest.fn(async () => ({ success: true }));
const emitToSeller = jest.fn();
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification, sendBulkNotification }));
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToSeller, emitToUser: jest.fn(), emitToRider: jest.fn(), emitToAdmins: jest.fn() }));
const { createReturnRequest, transitionReturnStatus } = await import('../services/return.service.js');
const { listSellerReturns, getSellerReturn, sellerDecideReturnCtrl } = await import('../controllers/return.controller.js');
const { default: User } = await import('../models/User.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: Order } = await import('../models/Order.js');
const { default: Return } = await import('../models/Return.js');
const { default: Notification } = await import('../models/Notification.js');
const id = () => new mongoose.Types.ObjectId();
let db, buyer, sellerUser, seller, otherSeller, order;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri()); await Promise.all([Return.init(), Notification.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  const otherUserId = id();
  [buyer, sellerUser] = await User.create([
    { name: 'Fixture buyer', phone: '9876500711', roles: ['buyer'] },
    { name: 'Fixture seller', phone: '9876500712', roles: ['seller'], pushTokens: [
      { token: 'fixture-web-token', platform: 'web', active: true }, { token: 'fixture-app-token', platform: 'app', active: true },
    ] },
  ]);
  seller = await Seller.create({ userId: sellerUser._id, businessName: 'Fixture seller', status: 'approved' });
  otherSeller = await Seller.create({ userId: otherUserId, businessName: 'Other fixture seller', status: 'approved' });
  order = await Order.create({ userId: buyer._id, status: 'delivered', type: 'grocery', paymentMethod: 'cod',
    pricing: { subtotal: 150, totalAmount: 150 }, items: [seller._id, otherSeller._id].map((sellerId, index) => ({
      productId: id(), sellerId, name: `Fixture item ${index}`, price: 50, qty: 2, deliveredAt: new Date(),
      returnPolicy: { returnEligible: true, returnWindowDays: 7 }, returnEligibleUntil: new Date(Date.now() + 86400000),
    })),
  });
});
const input = () => ({ orderId: order._id, orderItemId: order.items[0]._id, customerId: buyer._id, quantity: 1, reason: 'DAMAGED', requestKey: 'fixture-request' });
const flush = () => new Promise(resolve => setImmediate(resolve));

test('a committed return persists a seller alert and sends the same return reference over socket and web/app push', async () => {
  const ret = await createReturnRequest(input()); await flush();
  const notice = await Notification.findOne({ userId: sellerUser._id, event: 'RETURN_REQUESTED' }).lean();
  expect(notice).toMatchObject({ title: 'New return request', route: `/seller/item-returns?return=${ret._id}`, isRead: false });
  expect(String(notice.metadata.returnId)).toBe(String(ret._id));
  expect(notice.metadata.returnNumber).toBe(ret.returnNumber);
  expect(String(notice.metadata.orderId)).toBe(String(order._id));
  expect(emitToSeller).toHaveBeenCalledWith(String(seller._id), 'notification_new', expect.objectContaining({ _id: notice._id, event: 'RETURN_REQUESTED' }));
  expect(emitToSeller.mock.calls.every(([recipient]) => recipient === String(seller._id))).toBe(true);
  expect(sendPushNotification).toHaveBeenCalledTimes(2);
  for (const [device, payload] of sendPushNotification.mock.calls) {
    expect(device).toMatch(/^fixture-(web|app)-token$/);
    expect(payload.data).toMatchObject({ audience: 'seller', event: 'RETURN_REQUESTED', returnId: String(ret._id),
      returnNumber: ret.returnNumber, orderId: String(order._id), notificationId: String(notice._id), route: notice.route });
  }
  expect(await Notification.countDocuments({ userId: buyer._id, event: 'RETURN_REQUESTED' })).toBe(1);
  expect(await Notification.countDocuments({ userId: otherSeller.userId })).toBe(0);
});

test('replaying the same request does not duplicate seller notifications or pushes', async () => {
  const first = await createReturnRequest(input()); await flush();
  expect((await createReturnRequest(input()))._id).toEqual(first._id); await flush();
  expect(await Return.countDocuments()).toBe(1);
  expect(await Notification.countDocuments({ userId: sellerUser._id, event: 'RETURN_REQUESTED' })).toBe(1);
  expect(sendPushNotification).toHaveBeenCalledTimes(2);
});

test('a rejected request does not emit or push a seller return alert', async () => {
  await Order.updateOne({ _id: order._id }, { $set: { status: 'placed' } });
  await expect(createReturnRequest(input())).rejects.toThrow(/not been delivered/); await flush();
  expect(await Notification.countDocuments()).toBe(0); expect(emitToSeller).not.toHaveBeenCalled(); expect(sendPushNotification).not.toHaveBeenCalled();
});

const call = (handler, req) => new Promise(resolve => {
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; resolve(this); return this; } };
  handler(req, res, error => { res.statusCode = error.statusCode || error.status || 500; res.body = { message: error.message }; resolve(res); });
});

test('a seller can open the full return behind an alert, but never another seller\'s return', async () => {
  const ret = await createReturnRequest({ ...input(), customerDescription: 'Pack arrived torn' }); await flush();
  const mine = await call(getSellerReturn, { seller, user: sellerUser, params: { returnId: String(ret._id) } });
  expect(mine.statusCode).toBe(200);
  expect(mine.body.data).toMatchObject({ returnNumber: ret.returnNumber, customerDescription: 'Pack arrived torn', customerName: 'Fixture buyer', status: 'RETURN_REQUESTED' });
  expect(mine.body.data.order).toMatchObject({ orderNo: order.orderNo, item: { name: 'Fixture item 0', qty: 2, price: 50, lineTotal: 100 } });
  expect(mine.body.data.requestKey).toBeUndefined();
  const foreign = await call(getSellerReturn, { seller: otherSeller, user: { _id: otherSeller.userId }, params: { returnId: String(ret._id) } });
  expect(foreign.statusCode).toBe(404);
});

test('seller KPI totals are unfiltered while the list honours a status group', async () => {
  const first = await createReturnRequest(input());
  await createReturnRequest({ ...input(), requestKey: 'fixture-second' });
  await transitionReturnStatus({ returnId: first._id, toStatus: 'UNDER_REVIEW', adminId: id() });
  const res = await call(listSellerReturns, { seller, user: sellerUser, query: { status: 'UNDER_REVIEW,APPROVED' } });
  expect(res.body.data).toHaveLength(1);
  expect(res.body.meta.statusCounts).toEqual({ RETURN_REQUESTED: 1, UNDER_REVIEW: 1 });
});

test('approval and rejection reach the seller with seller wording and a link to that return', async () => {
  const approved = await createReturnRequest(input());
  await transitionReturnStatus({ returnId: approved._id, toStatus: 'UNDER_REVIEW', adminId: id() });
  await transitionReturnStatus({ returnId: approved._id, toStatus: 'APPROVED', adminId: id() });
  const rejected = await createReturnRequest({ ...input(), requestKey: 'fixture-rejected' });
  await transitionReturnStatus({ returnId: rejected._id, toStatus: 'UNDER_REVIEW', adminId: id() });
  await transitionReturnStatus({ returnId: rejected._id, toStatus: 'REJECTED', adminId: id(), rejectionReason: 'Outside policy' });
  await flush();
  const approval = await Notification.findOne({ userId: sellerUser._id, event: 'RETURN_APPROVED' }).lean();
  expect(approval.route).toBe(`/seller/item-returns?return=${approved._id}`);
  expect(approval.message).toMatch(/Choose a pickup method/);
  const rejection = await Notification.findOne({ userId: sellerUser._id, event: 'RETURN_REJECTED' }).lean();
  expect(rejection.route).toBe(`/seller/item-returns?return=${rejected._id}`);
  expect(await Notification.countDocuments({ userId: sellerUser._id, event: 'RETURN_UNDER_REVIEW' })).toBe(0);
});

test('the owning seller approves or rejects a return; rejection releases the quantity and others cannot decide', async () => {
  const approved = await createReturnRequest(input());
  const foreign = await call(sellerDecideReturnCtrl, { seller: otherSeller, user: { _id: otherSeller.userId }, params: { returnId: String(approved._id) }, body: { decision: 'APPROVED' } });
  expect(foreign.statusCode).toBe(404);
  const ok = await call(sellerDecideReturnCtrl, { seller, user: sellerUser, params: { returnId: String(approved._id) }, body: { decision: 'APPROVED' } });
  expect(ok.body.data.status).toBe('APPROVED');
  const fresh = await Return.findById(approved._id).lean();
  expect(fresh.history.map(h => [h.toStatus, h.changedByRole])).toEqual([['RETURN_REQUESTED', 'customer'], ['UNDER_REVIEW', 'seller'], ['APPROVED', 'seller']]);
  expect((await call(sellerDecideReturnCtrl, { seller, user: sellerUser, params: { returnId: String(approved._id) }, body: { decision: 'REJECTED', rejectionReason: 'Too late' } })).statusCode).toBe(409);

  const rejected = await createReturnRequest({ ...input(), requestKey: 'fixture-seller-reject' });
  expect((await call(sellerDecideReturnCtrl, { seller, user: sellerUser, params: { returnId: String(rejected._id) }, body: { decision: 'REJECTED' } })).statusCode).toBe(400);
  await call(sellerDecideReturnCtrl, { seller, user: sellerUser, params: { returnId: String(rejected._id) }, body: { decision: 'REJECTED', rejectionReason: 'Seal broken by customer' } });
  expect(await Return.findById(rejected._id).lean()).toMatchObject({ status: 'REJECTED', rejectionReason: 'Seal broken by customer' });
  expect((await Order.findById(order._id).lean()).items[0].returnedQty).toBe(1);
  await flush();
  expect(await Notification.countDocuments({ userId: buyer._id, event: { $in: ['RETURN_APPROVED', 'RETURN_REJECTED'] } })).toBe(2);
  expect(await Notification.countDocuments({ userId: sellerUser._id, event: { $in: ['RETURN_APPROVED', 'RETURN_REJECTED'] } })).toBe(0);
});
