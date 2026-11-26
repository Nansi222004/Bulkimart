import { jest } from '@jest/globals';
process.env.SHIPROCKET_MODE = 'mock';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../../middlewares/requestContext.middleware.js';

/**
 * Easy Ship COD through Shiprocket (C1 amended, behind SHIPROCKET_COD_ENABLED): real checkout, seller flow and
 * booking path with the provider mocked. No real shipment is created.
 */
const checkServiceability = jest.fn(); const createShiprocketOrder = jest.fn(); const assignCourier = jest.fn();
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true, quickCommerce: false }),
  listPickupLocations: jest.fn(async () => []), addPickupLocation: jest.fn(async () => ({})),
  verifyPickupLocation: jest.fn(async (location, store) => ({ pickup_location: location, pin_code: store.pincode })),
  checkServiceability, createShiprocketOrder, assignCourier, generateLabel: jest.fn(async () => ({})), schedulePickup: jest.fn(async () => ({ pickup_status: 1 })),
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));
jest.unstable_mockModule('../../controllers/deliveryPartner.controller.js', () => ({ broadcastNewOrderToRiders: jest.fn(async () => {}) }));

const [{ default: orderRoutes }, sellerCtl, fulfillment, { protect, requireRole }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET }, { saveCommissionVersion },
  { default: User }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }] = await Promise.all([
  import('../../routes/order.routes.js'), import('../../controllers/seller.controller.js'), import('../../controllers/fulfillment.controller.js'),
  import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'),
  import('../../services/vendorCommission.service.js'),
  import('../../models/User.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Cart.js'), import('../../models/Order.js'),
]);
const app = express(); app.use(requestContext); app.use(express.json()); app.use('/orders', orderRoutes);
const seller = express.Router(); seller.use(protect, requireRole('seller'), requireApprovedSeller);
seller.patch('/orders/:id/status', sellerCtl.updateOrderStatus);
seller.get('/orders/:id/options', fulfillment.getFulfillmentOptions);
seller.post('/orders/:id/manual', fulfillment.selectManualFulfillment);
seller.post('/orders/:id/shiprocket', fulfillment.createShiprocketShipment);
app.use('/seller', seller); app.use(errorHandler);

let db, buyer, sellerUser, sellerId;
const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.72, lng: 75.86 };
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role }, JWT_SECRET)}`);
const asSeller = (req) => auth(req, sellerUser, 'seller');
const status = (order, to) => asSeller(request(app).patch(`/seller/orders/${order._id}/status`)).send({ status: to });
const book = (order) => asSeller(request(app).post(`/seller/orders/${order._id}/shiprocket`)).send({ confirm: true, quotedCourierCharge: 70, package: { length: 10, breadth: 10, height: 10 } });

async function readyCodOrder(productExtra = {}) {
  const product = { _id: id(), sellerId, type: 'ecommerce', category: id(), name: 'Lamp', price: 250, stock: 10, isActive: true, status: 'approved', fulfillmentType: 'physical', gstRate: 0, images: [],
    variants: [{ _id: id(), name: 'One', sku: `L-${randomUUID().slice(0, 6)}`, price: 250, mrp: 250, stock: 10, weight: 500, unit: 'piece' }], ...productExtra };
  await Product.collection.insertOne(product);
  await Cart.findOneAndUpdate({ userId: buyer._id, channel: 'ecommerce' }, { $set: { items: [{ productId: product._id, variantId: product.variants[0]._id, sellerId, name: 'Lamp', price: 250, qty: 2 }] } }, { upsert: true });
  const res = await auth(request(app).post('/orders/unified')).set('Idempotency-Key', randomUUID()).send({ shippingAddress: address, paymentMethod: 'cod', channel: 'ecommerce' }).expect(201);
  const order = await Order.findById(res.body.data.orders[0]._id);
  await status(order, 'confirmed').expect(200); await status(order, 'preparing').expect(200); await status(order, 'ready_for_pickup').expect(200);
  return Order.findById(order._id);
}

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { delete process.env.SHIPROCKET_COD_ENABLED; await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  delete process.env.SHIPROCKET_COD_ENABLED;
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  checkServiceability.mockResolvedValue({ available: true, couriers: [{ courier_company_id: 7, courier_name: 'Fixture Courier', rate: 65, freight_charge: 60 }] });
  createShiprocketOrder.mockResolvedValue({ order_id: 'SR-1', shipment_id: 'SH-1' });
  assignCourier.mockResolvedValue({ awb: 'AWB-1', courier_name: 'Fixture Courier' });
  await saveCommissionVersion({ vendorType: 'general', channel: 'ecommerce', method: 'percentage', value: 10, minimum: null, maximum: null, base: 'eligible_item_subtotal',
    fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' }, id());
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], isActive: true });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved',
    storeDetails: { name: 'Fixture Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7, lng: 75.85 },
    thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' } });
});

test('switched off (default): a COD order cannot be booked with Shiprocket and Shiprocket is never called', async () => {
  const order = await readyCodOrder();
  const options = (await asSeller(request(app).get(`/seller/orders/${order._id}/options`)).expect(200)).body.data;
  expect(options.shiprocket).toMatchObject({ available: false, codUnavailable: true });
  const refused = await book(order).expect(409);
  expect(refused.body.meta.code).toBe('SHIPROCKET_COD_UNAVAILABLE');
  expect(createShiprocketOrder).not.toHaveBeenCalled();
});

test('switched on: Easy Ship COD books once with a COD payload whose collectable amount equals the order total', async () => {
  process.env.SHIPROCKET_COD_ENABLED = 'true';
  const order = await readyCodOrder();
  expect(order.financialSnapshot.state).toBe('configured');
  const options = (await asSeller(request(app).get(`/seller/orders/${order._id}/options`)).expect(200)).body.data;
  expect(options.shiprocket.codUnavailable).toBe(false);
  const res = await book(order);
  expect({ status: res.status, message: res.body.message }).toEqual({ status: 200, message: expect.any(String) });
  expect(checkServiceability).toHaveBeenCalledWith(expect.objectContaining({ cod: true })); // COD serviceability asked of the provider
  const payload = createShiprocketOrder.mock.calls[0][0];
  expect(payload.payment_method).toBe('COD');
  expect(Math.round((payload.sub_total + payload.shipping_charges - payload.total_discount) * 100)).toBe(Math.round(order.pricing.totalAmount * 100));
  const saved = await Order.findById(order._id).lean();
  expect(saved.shiprocket).toMatchObject({ awb: 'AWB-1', status: 'awb_assigned' });
  expect(saved.codFinance?.status).toBeUndefined(); // booking never touches COD cash
  // A second booking request returns the existing shipment; Shiprocket is not called again.
  await book(order).expect(200);
  expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});

test('switched on: Self Delivery COD can never exist, and the rider fallback for Easy Ship COD is unchanged', async () => {
  process.env.SHIPROCKET_COD_ENABLED = 'true';
  const order = await readyCodOrder();
  await asSeller(request(app).post(`/seller/orders/${order._id}/manual`)).send({}).expect(200);
  expect((await Order.findById(order._id).lean())).toMatchObject({ deliveryType: 'internal', status: 'dispatched' });
  await book(order).expect(409); // already handed to riders
  expect(createShiprocketOrder).not.toHaveBeenCalled();
});
