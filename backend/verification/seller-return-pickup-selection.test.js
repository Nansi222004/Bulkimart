import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const notices = { notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}), NOTIFICATION_EVENT: new Proxy({}, { get: (_, key) => String(key) }) };
jest.unstable_mockModule('../services/notification.service.js', () => notices);
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToSeller: jest.fn(), emitToUser: jest.fn(), emitToRider: jest.fn(), emitToAdmins: jest.fn() }));
const { default: User } = await import('../models/User.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: Order } = await import('../models/Order.js');
const { default: Return } = await import('../models/Return.js');
const { default: Partner } = await import('../models/DeliveryPartner.js');
const { returnPickupOptions, arrangeReturnPickup, broadcastReturnPickupToRiders, acceptReturnPickup, declineReturnPickup, expireReturnPickupOffer } = await import('../services/returnPickup.service.js');
const { selectReturnPickup, assignRiderForReturn, cancelReturnPickup, getReturnPickupOptions } = await import('../controllers/return.controller.js');
const { listReturnPickups } = await import('../controllers/returnDelivery.controller.js');
let db, seller, order, ret, riders;
const id = () => new mongoose.Types.ObjectId();
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri()); await Promise.all([Partner.init(), Return.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  const users = await User.create([
    { name: 'Buyer', phone: '9876500901', roles: ['buyer'] },
    { name: 'Seller', phone: '9876500902', roles: ['seller'] },
    { name: 'Rider One', phone: '9876500903', roles: ['delivery'] },
    { name: 'Rider Two', phone: '9876500904', roles: ['delivery'] },
  ]);
  seller = await Seller.create({ userId: users[1]._id, businessName: 'Return store', status: 'approved', storeDetails: { city: 'Indore', lat: 22.72, lng: 75.86 } });
  order = await Order.create({ userId: users[0]._id, status: 'delivered', type: 'grocery', paymentMethod: 'cod', pricing: { subtotal: 50, totalAmount: 50 },
    shippingAddress: { line1: 'Customer address', city: 'Indore', pincode: '452001', lat: 22.725, lng: 75.865 },
    items: [{ productId: id(), sellerId: seller._id, name: 'Item', qty: 1, price: 50 }] });
  ret = await Return.create({ returnNumber: 'RET-SELECTION', orderId: order._id, orderItemId: order.items[0]._id, customerId: users[0]._id,
    sellerId: seller._id, productId: order.items[0].productId, unitPriceSnapshot: 50, quantity: 1, productName: 'Item', reason: 'DAMAGED', status: 'APPROVED' });
  riders = await Partner.create(users.slice(2).map(user => ({ userId: user._id, status: 'approved', isAvailable: true, baseLocation: { lat: 22.725, lng: 75.865, point: { type: 'Point', coordinates: [75.865, 22.725] } } })));
});
const input = () => ({ returnId: ret._id, sellerId: seller._id });
const call = (handler, req) => new Promise(resolve => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, ...body }); return this; } };
  handler({ seller, params: { returnId: String(ret._id) }, body: {}, ...req }, res, error => resolve({ status: error.statusCode || error.status || 500, message: error.message }));
});
const offer = async rider => {
  await arrangeReturnPickup({ ...input(), riderId: rider._id });
  for (let i = 0; i < 100; i++) {
    const fresh = await Return.findById(ret._id);
    if (fresh.pickup.offerAttempts.length) return fresh;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Rider offer did not persist');
};

test('options list eligible riders with masked contact and enforce seller ownership', async () => {
  const response = await call(getReturnPickupOptions);
  expect(response.status).toBe(200); expect(response.data.manual.riders).toHaveLength(2);
  expect(response.data.manual.riders[0].contact).toMatch(/090[34]$/);
  expect(JSON.stringify(response.data)).not.toContain('9876500903');
  await expect(returnPickupOptions({ ...input(), sellerId: id() })).rejects.toThrow('Return not found');
  await Partner.updateOne({ _id: riders[1]._id }, { $set: { isAvailable: false } });
  expect((await returnPickupOptions(input())).manual.riders).toHaveLength(1);
});
test('both seller manual endpoints require a rider and never broadcast without selection', async () => {
  expect((await call(selectReturnPickup, { body: { pickupMethod: 'MANUAL' } })).status).toBe(400);
  expect((await call(assignRiderForReturn)).status).toBe(400);
  expect((await Return.findById(ret._id)).pickupMethod).toBeUndefined();
  expect(notices.notifyRider).not.toHaveBeenCalled();
});
test('only the selected rider receives an offer and another rider cannot claim it', async () => {
  const fresh = await offer(riders[0]);
  expect(fresh.pickup.offerAttempts.map(row => String(row.riderId))).toEqual([String(riders[0]._id)]);
  expect(String(fresh.pickup.requestedRiderId)).toBe(String(riders[0]._id));
  // Even an obsolete offer cannot override the selected-rider guard.
  await Return.updateOne({ _id: ret._id }, { $push: { 'pickup.offerAttempts': { riderId: riders[1]._id, status: 'OFFERED' } } });
  expect((await call(listReturnPickups, { partner: riders[1] })).data.pending).toHaveLength(0);
  await expect(acceptReturnPickup({ returnId: ret._id, partnerId: riders[1]._id })).rejects.toThrow('no longer available');
  expect((await acceptReturnPickup({ returnId: ret._id, partnerId: riders[0]._id })).ret.pickup.status).toBe('ASSIGNED');
});
test('concurrent seller choices cannot replace a pending request', async () => {
  const outcomes = await Promise.allSettled(riders.map(rider => arrangeReturnPickup({ ...input(), riderId: rider._id })));
  expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  for (let i = 0; i < 50 && !notices.notifyRider.mock.calls.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(notices.notifyRider).toHaveBeenCalledTimes(1);
});
for (const [name, resolveOffer] of [['decline', declineReturnPickup], ['expiry', expireReturnPickupOffer]]) test(`${name} releases the request without broadcasting to anyone else`, async () => {
  await offer(riders[0]);
  await resolveOffer({ returnId: ret._id, partnerId: riders[0]._id });
  const fresh = await Return.findById(ret._id);
  expect(fresh.pickup.requestedRiderId).toBeUndefined(); expect(fresh.pickupMethod).toBeUndefined();
  expect((await returnPickupOptions(input())).manual.riders.map(row => String(row.id))).toEqual([String(riders[1]._id)]);
  await broadcastReturnPickupToRiders(ret._id);
  expect((await Return.findById(ret._id)).pickup.offerAttempts).toHaveLength(1);
  expect(notices.notifySeller).toHaveBeenCalledWith(seller._id, expect.objectContaining({ title: 'Choose another delivery partner' }));
});
test('cancellation removes the selected rider and offers, and allows a new choice', async () => {
  await offer(riders[0]); expect((await call(cancelReturnPickup)).status).toBe(200);
  const fresh = await Return.findById(ret._id);
  expect(fresh.pickup.requestedRiderId).toBeUndefined(); expect(fresh.pickup.offerAttempts).toHaveLength(0);
  await expect(acceptReturnPickup({ returnId: ret._id, partnerId: riders[0]._id })).rejects.toThrow('no longer available');
  expect((await returnPickupOptions(input())).stateReady).toBe(true);
  await offer(riders[1]);
});
test('unavailable riders and active courier bookings cannot be selected', async () => {
  await Partner.updateOne({ _id: riders[0]._id }, { $set: { isAvailable: false } });
  await expect(arrangeReturnPickup({ ...input(), riderId: riders[0]._id })).rejects.toThrow('no longer eligible');
  await Return.updateOne({ _id: ret._id }, { $set: { pickupMethod: 'SHIPROCKET', 'reverseBooking.state': 'uncertain' } });
  expect((await returnPickupOptions(input())).stateReady).toBe(false);
  await expect(arrangeReturnPickup({ ...input(), riderId: riders[1]._id })).rejects.toThrow('Reconcile or cancel');
});
