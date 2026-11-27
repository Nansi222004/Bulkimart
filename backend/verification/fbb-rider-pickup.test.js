// FBB rider pickup (found in the live phone test, 2026-11-27): when a rider accepts a Fulfilled by Bulkimart
// order, the pickup recorded on the Delivery must be the Bulkimart warehouse, not the seller's own store.
// Before the fix the accept handler loaded the order without `origin`, so the rider was navigated to the
// seller's shop and the pickup distance was measured from there. Real controllers and a loopback replica set.
import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
const notify = jest.fn(async () => ({}));
jest.unstable_mockModule('../services/notification.service.js', () => ({
  notifyUser: notify, notifySeller: notify, notifyRider: notify, notifyAllAdmins: notify, NOTIFICATION_EVENT: {},
}));
jest.unstable_mockModule('../socket/rooms.js', () => ({
  emitToUser: notify, emitToSeller: notify, emitToRider: notify, emitToAdmins: notify, broadcastToRiders: notify,
}));
const [{ default: Order }, { default: Delivery }, { default: Partner }, { default: User }, { default: Seller }, { default: Warehouse },
  { acceptOrder, getActiveDelivery }, { errorHandler }] = await Promise.all([
  import('../models/Order.js'), import('../models/Delivery.js'), import('../models/DeliveryPartner.js'), import('../models/User.js'),
  import('../models/Seller.js'), import('../models/Warehouse.js'), import('../controllers/deliveryPartner.controller.js'),
  import('../middlewares/error.middleware.js'),
]);
let db, driver, partner, sellerId, warehouse;
const app = express();
app.use(express.json());
app.use(async (req, _res, next) => { try { req.user = driver; req.partner = await Partner.findById(partner._id); next(); } catch (e) { next(e); } });
app.post('/accept/:id', acceptOrder);
app.get('/active', getActiveDelivery);
app.use(errorHandler);

const STORE = { name: 'Seller Shop', address: 'Shop street', city: 'Indore', pincode: '452001', lat: 22.70, lng: 75.85 };
const makeOrder = (origin) => Order.create({
  userId: driver._id, type: 'ecommerce', paymentMethod: 'cod', deliveryType: 'internal', status: 'dispatched',
  ...(origin ? { origin, deliveryMethod: 'fbb' } : {}),
  items: [{ sellerId, productId: new mongoose.Types.ObjectId(), name: 'Synthetic product', qty: 1, price: 10 }],
  shippingAddress: { name: 'Fixture', line1: 'Customer lane', city: 'Indore', pincode: '452001', lat: 22.72, lng: 75.86 },
  pricing: { subtotal: 10, totalAmount: 10 },
});

beforeAll(async () => {
  delete process.env.MONGO_URI; delete process.env.MONGODB_URI;
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('fbb-rider-pickup'));
  for (const model of [Order, Delivery, Partner, User, Seller, Warehouse]) await model.init();
});
beforeEach(async () => {
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  process.env.RIDER_MAX_CONCURRENT_DELIVERIES = '0';
  driver = await User.create({ phone: '9876500098', roles: ['delivery'], isActive: true });
  partner = await Partner.create({ userId: driver._id, status: 'approved', isAvailable: true, currentLocation: { lat: 22.72, lng: 75.87, updatedAt: new Date() } });
  sellerId = new mongoose.Types.ObjectId();
  await Seller.collection.insertOne({ _id: sellerId, userId: new mongoose.Types.ObjectId(), businessName: 'Seller Shop', storeDetails: STORE });
  warehouse = await Warehouse.create({ code: 'IDR-1', name: 'Bulkimart Indore', phone: '9876500097',
    address: { line1: 'Warehouse unit 7', city: 'Indore', state: 'Madhya Pradesh', pincode: '452010', lat: 22.75, lng: 75.90 } });
});
afterAll(async () => { delete process.env.RIDER_MAX_CONCURRENT_DELIVERIES; await mongoose.disconnect(); await db?.stop(); });

test('a rider accepting an FBB order is sent to the warehouse, not the seller shop', async () => {
  const order = await makeOrder({ kind: 'warehouse', warehouseId: warehouse._id });
  const res = await request(app).post(`/accept/${order._id}`).send({});
  expect(res.status).toBe(200);
  const delivery = await Delivery.findOne({ orderId: order._id }).lean();
  expect(delivery.pickupLocation.address).toContain('Warehouse unit 7');
  expect(delivery.pickupLocation.address).not.toContain('Shop street');
  expect([delivery.pickupLocation.lat, delivery.pickupLocation.lng]).toEqual([22.75, 75.90]);

  const active = (await request(app).get('/active')).body.data;
  expect(active.merchantName).toBe('Bulkimart Indore');
  expect(active.merchantAddress).toContain('Warehouse unit 7');
  expect(active.merchantLocation).toEqual({ lat: 22.75, lng: 75.90 });
});

test('a normal seller order is still picked up from the seller shop', async () => {
  const order = await makeOrder(null);
  expect((await request(app).post(`/accept/${order._id}`).send({})).status).toBe(200);
  const delivery = await Delivery.findOne({ orderId: order._id }).lean();
  expect(delivery.pickupLocation.address).toContain('Shop street');
  expect([delivery.pickupLocation.lat, delivery.pickupLocation.lng]).toEqual([22.70, 75.85]);
});
