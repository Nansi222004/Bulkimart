import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const notifications = await import('../services/notification.service.js');
jest.unstable_mockModule('../services/notification.service.js', () => ({ ...notifications, notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}) }));
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn(), emitToAdmin: jest.fn() }));
const { getFulfillmentOptions, selectManualFulfillment } = await import('../controllers/fulfillment.controller.js');
const { acceptOrder, cancelDelivery, declineOrder, expireOrder, getPendingDeliveryOrders } = await import('../controllers/deliveryPartner.controller.js');
const { getSellerOrders } = await import('../controllers/seller.controller.js');
const { sellerOrderActions } = await import('../services/sellerOrderActions.service.js');
const { riderCashAllowsOrder } = await import('../services/riderCashEligibility.service.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: Delivery } = await import('../models/Delivery.js');
const { default: User } = await import('../models/User.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: Partner } = await import('../models/DeliveryPartner.js');
const id = () => new mongoose.Types.ObjectId();
const call = (handler, req) => new Promise((resolve, reject) => {
  handler(req, { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve(body); return this; } }, reject);
});
let db, seller, sellerUser, buyer, riders, users, order;
let broadcastTimer;
beforeAll(async () => {
  const originalTimer = globalThis.setTimeout;
  broadcastTimer = jest.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
    delay === 30000 && String(callback).includes('broadcastNewOrderToRiders') ? originalTimer(() => {}, 0) : originalTimer(callback, delay, ...args));
  process.env.SHIPROCKET_MODE = 'live'; delete process.env.SHIPROCKET_EMAIL; delete process.env.SHIPROCKET_PASSWORD;
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '1';
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterEach(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
afterAll(async () => { broadcastTimer.mockRestore(); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  [sellerUser, buyer, ...users] = await User.create([
    { phone: '9876500610', name: 'Seller', roles: ['seller'], isActive: true }, { phone: '9876500611', name: 'Buyer', roles: ['buyer'], isActive: true },
    ...[1,2,3].map(n => ({ phone: `987650061${n+1}`, name: `Rider ${n}`, roles: ['delivery'], isActive: true })),
  ]);
  seller = await Seller.create({ userId: sellerUser._id, status: 'approved', businessName: 'Store', storeDetails: { name: 'Store', address: 'Market Road', city: 'Indore', lat: 22.72, lng: 75.86, pincode: '452001' } });
  riders = await Partner.create(users.map(user => ({ userId: user._id, status: 'approved', isAvailable: true, zones: ['452001'], currentLocation: { lat: 22.72, lng: 75.86 } })));
  order = await Order.create({ orderNo: 'SELLER-BUGS', userId: buyer._id, type: 'ecommerce', status: 'preparing', deliveryType: 'internal', paymentMethod: 'cod',
    vendorDecision: { status: 'accepted' }, fulfillment: { method: 'manual', assignmentPolicy: 'seller_after_acceptance', readyAt: new Date() },
    pricing: { subtotal: 100, totalAmount: 100 }, shippingAddress: { name: 'Buyer', phone: '9876500611', city: 'Indore', pincode: '452001', lat: 22.73, lng: 75.87 },
    items: [{ productId: id(), sellerId: seller._id, name: 'Product', price: 100, qty: 1, weightSnapshot: 250 }] });
});
const sellerReq = body => ({ user: sellerUser, seller, params: { id: String(order._id) }, body: body || {}, query: {} });
const riderReq = (index = 0) => ({ user: users[index], partner: riders[index], params: { id: String(order._id) }, body: {}, query: {} });
const cash = async (index, collectedPaise, extra = {}) => Order.collection.insertOne({ _id: id(), orderNo: `CASH-${index}`, deliveryPartnerId: riders[index]._id, paymentMethod: 'cod', status: 'delivered',
  financialSnapshot: { version: 2 }, codFinance: { collectedPaise, status: 'collected', ...extra } });

test('seller history and direct details hide unpaid cancelled checkouts but retain paid, refunded and COD orders', async () => {
  const variants = [
    ['UNPAID', 'pending', null], ['FAILED', 'failed', null], ['ABANDONED', 'pending', new Date()],
    ['PAID-CANCELLED', 'paid', null], ['REFUNDED', 'refunded', null],
  ];
  for (const [name, status, abandoned] of variants) {
    const payment = await Payment.create({ userId: buyer._id, method: 'online', amount: 100, status, ...(abandoned ? { checkoutAbandonedAt: abandoned } : {}) });
    await Order.collection.insertOne({ ...order.toObject(), _id: id(), orderNo: name, status: 'cancelled', paymentMethod: 'online', paymentId: payment._id });
  }
  const response = await call(getSellerOrders, { user: sellerUser, params: {}, query: { limit: 100 } });
  expect(response.data.map(row => row.orderNo).sort()).toEqual(['PAID-CANCELLED', 'REFUNDED', 'SELLER-BUGS']);
  expect(response.meta.total).toBe(3);
  const hidden = await Order.findOne({ orderNo: 'UNPAID' });
  await expect(call(getSellerOrders, { user: sellerUser, params: { id: String(hidden._id) }, query: {} })).rejects.toMatchObject({ status: 404 });
});

test('manual availability excludes riders at the COD cash limit and includes them for prepaid orders', async () => {
  await cash(0, 200000); await cash(1, 199999); await cash(2, 250000);
  let result = await call(getFulfillmentOptions, sellerReq());
  expect(result.data.manual.riders.map(rider => String(rider.id))).toEqual([String(riders[1]._id)]);
  await expect(call(selectManualFulfillment, sellerReq({ riderId: String(riders[0]._id) }))).rejects.toMatchObject({ status: 409 });
  const payment = await Payment.create({ userId: buyer._id, method: 'online', amount: 100, status: 'paid' });
  await Order.updateOne({ _id: order._id }, { $set: { paymentMethod: 'online', paymentId: payment._id } });
  result = await call(getFulfillmentOptions, sellerReq()); expect(result.data.manual.eligibleRiderCount).toBe(3);
});

test('verified remittance frees COD eligibility; reported handover and disputes do not', async () => {
  await cash(0, 210000, { status: 'remittance_reported' });
  expect(await riderCashAllowsOrder(riders[0]._id, order)).toBe(false);
  await Order.collection.updateOne({ orderNo: 'CASH-0' }, { $set: { 'codFinance.status': 'disputed' } });
  expect(await riderCashAllowsOrder(riders[0]._id, order)).toBe(false);
  await Order.collection.updateOne({ orderNo: 'CASH-0' }, { $set: { 'codFinance.verifiedPaise': 11000 } });
  expect(await riderCashAllowsOrder(riders[0]._id, order)).toBe(true);
});

test('requested rider is saved, other riders cannot claim it, and stale COD acceptance rolls back', async () => {
  await call(selectManualFulfillment, sellerReq({ riderId: String(riders[0]._id) }));
  const selected = await Order.findById(order._id); expect(String(selected.fulfillment.requestedRiderId)).toBe(String(riders[0]._id));
  await Order.updateOne({ _id: order._id }, { $set: { status: 'dispatched' } });
  await expect(call(acceptOrder, riderReq(1))).rejects.toMatchObject({ status: 409 });
  await cash(0, 200000);
  await expect(call(acceptOrder, riderReq())).rejects.toMatchObject({ status: 409 });
  expect((await Order.findById(order._id)).deliveryPartnerId).toBeUndefined();
  expect(await Delivery.countDocuments()).toBe(0);
  const pending = await call(getPendingDeliveryOrders, riderReq()); expect(pending.data).toHaveLength(0);
});

test('accept then cancel clears active delivery references, preserves history and permits another rider request', async () => {
  await call(selectManualFulfillment, sellerReq({ riderId: String(riders[0]._id) }));
  await Order.updateOne({ _id: order._id }, { $set: { status: 'dispatched' } });
  await call(acceptOrder, riderReq());
  const accepted = await Order.findById(order._id); expect(accepted.deliveryId).toBeDefined();
  await call(cancelDelivery, riderReq());
  const released = await Order.findById(order._id);
  expect(released.deliveryId).toBeUndefined(); expect(released.deliveryPartnerId).toBeUndefined();
  expect((await Delivery.findById(accepted.deliveryId)).status).toBe('rejected');
  expect(sellerOrderActions(released)).toContainEqual({ setup: true, label: 'Reassign delivery partner' });
  await call(cancelDelivery, riderReq());
  await call(selectManualFulfillment, sellerReq({ riderId: String(riders[1]._id) }));
  expect(String((await Order.findById(order._id)).fulfillment.requestedRiderId)).toBe(String(riders[1]._id));
});

test.each([['decline', declineOrder], ['expiry', expireOrder]])('%s releases a requested rider for seller reassignment', async (_name, handler) => {
  await Order.updateOne({ _id: order._id }, { $set: { status: 'dispatched', 'fulfillment.requestedRiderId': riders[0]._id }, $push: { offerAttempts: { riderId: riders[0]._id, status: 'OFFERED', offeredAt: new Date() } } });
  await call(handler, riderReq());
  const released = await Order.findById(order._id); expect(released.fulfillment.requestedRiderId).toBeUndefined(); expect(released.needsManualAssignment).toBe(true);
  const options = await call(getFulfillmentOptions, sellerReq());
  expect(options.data.manual.riders.map(rider => String(rider.id))).not.toContain(String(riders[0]._id));
  expect(options.data.manual.available).toBe(true);
});

test('existing cancelled rider trips expose reassignment and release their stale delivery reference safely', async () => {
  const trip = await Delivery.create({ orderId: order._id, partnerId: riders[0]._id, status: 'rejected' });
  await Order.updateOne({ _id: order._id }, { $set: { status: 'dispatched', deliveryId: trip._id } });
  const details = await call(getSellerOrders, sellerReq());
  expect(details.data.permittedActions).toContainEqual({ setup: true, label: 'Reassign delivery partner' });
  await call(selectManualFulfillment, sellerReq({ riderId: String(riders[1]._id) }));
  const updated = await Order.findById(order._id);
  expect(updated.deliveryId).toBeUndefined();
  expect(String(updated.fulfillment.requestedRiderId)).toBe(String(riders[1]._id));
  expect((await Delivery.findById(trip._id)).status).toBe('rejected');
});
