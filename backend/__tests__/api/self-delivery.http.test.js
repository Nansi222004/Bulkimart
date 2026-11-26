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
 * Delivery methods, Phase 2A — Self Delivery: prepaid only on every checkout path, the seller's declared
 * delivery area, and fulfilment by Bulkimart rider or the seller's own courier (never Bulkimart Shiprocket).
 */
const checkServiceability = jest.fn(); const createShiprocketOrder = jest.fn(); const assignCourier = jest.fn();
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true, quickCommerce: false }),
  listPickupLocations: jest.fn(async () => []), addPickupLocation: jest.fn(async () => ({})),
  verifyPickupLocation: jest.fn(async (location, store) => ({ pickup_location: location, pin_code: store.pincode })),
  checkServiceability, createShiprocketOrder, assignCourier, generateLabel: jest.fn(), schedulePickup: jest.fn(),
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));
const broadcast = jest.fn(async () => {});
jest.unstable_mockModule('../../controllers/deliveryPartner.controller.js', () => ({ broadcastNewOrderToRiders: broadcast }));

const [{ default: orderRoutes }, { default: cartRoutes }, sellerCtl, fulfillment, productCtl, { protect, requireRole }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET },
  { createOrdersFromGroups }, { buildFulfilmentGroups }, enums,
  { default: User }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }, { default: Payment }] = await Promise.all([
  import('../../routes/order.routes.js'), import('../../routes/cart.routes.js'), import('../../controllers/seller.controller.js'), import('../../controllers/fulfillment.controller.js'),
  import('../../controllers/product.controller.js'), import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'),
  import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'), import('../../services/fulfilmentOrders.service.js'),
  import('../../services/fulfilmentGroups.service.js'), import('../../constants/enums.js'),
  import('../../models/User.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Cart.js'), import('../../models/Order.js'), import('../../models/Payment.js'),
]);

const app = express(); app.use(requestContext); app.use(express.json());
app.use('/orders', orderRoutes); app.use('/cart', cartRoutes);
const seller = express.Router(); seller.use(protect, requireRole('seller'), requireApprovedSeller);
seller.patch('/orders/:id/status', sellerCtl.updateOrderStatus);
seller.get('/orders/:id', sellerCtl.getSellerOrders);
seller.get('/orders/:id/options', fulfillment.getFulfillmentOptions);
seller.post('/orders/:id/manual', fulfillment.selectManualFulfillment);
seller.post('/orders/:id/shiprocket', fulfillment.createShiprocketShipment);
seller.post('/orders/:id/external', fulfillment.dispatchExternalCourier);
seller.patch('/orders/:id/external', fulfillment.updateExternalCourier);
seller.get('/self-delivery-area', sellerCtl.getSelfDeliveryArea);
seller.put('/self-delivery-area', sellerCtl.updateSelfDeliveryArea);
app.use('/seller', seller);
app.put('/products/:id', protect, requireRole('seller'), productCtl.updateProduct);
app.use(errorHandler);

let db, buyer, sellerUser, sellerDoc, otherSellerUser;
const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', lat: 22.72, lng: 75.86 };
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role }, JWT_SECRET)}`);
const asSeller = (req, user = sellerUser) => auth(req, user, 'seller');
const checkout = (path, extra = {}) => auth(request(app).post(path)).set('Idempotency-Key', randomUUID()).send({ shippingAddress: address, paymentMethod: 'online', channel: 'ecommerce', ...extra });
const makeProduct = async (extra = {}) => {
  const product = { _id: id(), sellerId: sellerDoc._id, type: 'ecommerce', category: id(), name: 'Fixture item', price: 100, stock: 10, isActive: true, status: 'approved',
    fulfillmentType: 'physical', gstRate: 0, images: [], variants: [{ _id: id(), name: 'One pack', sku: `FX-${randomUUID().slice(0, 6)}`, price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }], ...extra };
  await Product.collection.insertOne(product);
  return product;
};
const line = (product) => ({ productId: product._id, variantId: product.variants[0]._id, sellerId: sellerDoc._id, name: product.name, price: 100, qty: 1 });
// Checkout empties the cart document but keeps it, so later fills update it in place.
const fillCart = (...products) => Cart.findOneAndUpdate({ userId: buyer._id, channel: 'ecommerce' },
  { $set: { items: products.map(line) } }, { upsert: true, returnDocument: 'after' });
const status = (order, to, extra = {}, user) => asSeller(request(app).patch(`/seller/orders/${order._id}/status`), user).send({ status: to, ...extra });
const courier = (overrides = {}) => ({ courierName: 'DTDC', awb: 'D1234567', trackingUrl: 'https://www.dtdc.in/track?awb=D1234567', dispatchDate: new Date().toISOString(), ...overrides });

/** Place a paid Self Delivery order and take it to Ready for pickup. */
async function readySelfDeliveryOrder() {
  const product = await makeProduct({ deliveryMethod: 'self_delivery' });
  await fillCart(product);
  const res = await checkout('/orders/unified').expect(201);
  const order = await Order.findById(res.body.data.orders[0]._id);
  await Payment.updateOne({ _id: order.paymentId }, { $set: { status: 'paid' } });
  await status(order, 'confirmed').expect(200); await status(order, 'preparing').expect(200); await status(order, 'ready_for_pickup').expect(200);
  return Order.findById(order._id);
}

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { delete process.env.DELIVERY_METHODS_ENABLED; await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  process.env.DELIVERY_METHODS_ENABLED = 'true';
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], isActive: true, wallet: { balance: 10000 } });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  otherSellerUser = await User.create({ name: 'Other Seller', phone: '9876500002', roles: ['buyer', 'seller'], isActive: true });
  const sellerId = id();
  await Seller.collection.insertMany([
    { _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved',
      storeDetails: { name: 'Fixture Store', pincode: '452001', city: 'Indore', state: 'Madhya Pradesh', lat: 22.7, lng: 75.85 },
      thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' },
      selfDelivery: { states: ['Madhya Pradesh'], pincodes: ['110001'] } },
    { _id: id(), userId: otherSellerUser._id, businessName: 'Other Store', status: 'approved', storeDetails: { name: 'Other Store', pincode: '452001', lat: 22.7, lng: 75.85 } },
  ]);
  sellerDoc = await Seller.findById(sellerId);
});

describe('Self Delivery is prepaid only on every checkout path', () => {
  test('grouped checkout refuses COD with a clear reason and accepts online payment', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    const refused = await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
    expect(refused.body.meta.code).toBe('COD_UNAVAILABLE_SELF_DELIVERY');
    expect(refused.body.message).toMatch(/Cash on Delivery is not available/);
    expect(await Order.countDocuments()).toBe(0);
    expect((await Product.findOne({}).lean()).variants[0].stock).toBe(10); // nothing written
    const placed = await checkout('/orders/unified', { paymentMethod: 'online' }).expect(201);
    expect(placed.body.data.orders[0].paymentMethod).toBe('online');
  });

  test('single-order checkout refuses COD; wallet is allowed', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    expect((await checkout('/orders', { paymentMethod: 'cod' }).expect(409)).body.meta.code).toBe('COD_UNAVAILABLE_SELF_DELIVERY');
    await checkout('/orders', { paymentMethod: 'wallet' }).expect(201);
  });

  test('a mixed basket (Easy Ship + Self Delivery) cannot use COD at all; prepaid splits into two orders', async () => {
    await fillCart(await makeProduct({ name: 'Easy item' }), await makeProduct({ name: 'Self item', deliveryMethod: 'self_delivery' }));
    await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
    const res = await checkout('/orders/unified', { paymentMethod: 'online' }).expect(201);
    const orders = await Order.find({ _id: { $in: res.body.data.orders.map((o) => o._id) } }).lean();
    expect(orders.map((o) => o.deliveryMethod).sort()).toEqual(['easy_ship', 'self_delivery']);
    // Each delivery carries its own delivery charge; the payment equals the sum of the orders.
    const payment = await Payment.findById(orders[0].paymentId).lean();
    expect(payment.amount).toBeCloseTo(orders.reduce((n, o) => n + o.pricing.totalAmount, 0), 2);
    expect(orders.every((o) => o.pricing.deliveryCharge > 0)).toBe(true);
  });

  test('an Easy Ship-only basket keeps COD exactly as before', async () => {
    await fillCart(await makeProduct());
    const res = await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(201);
    expect(res.body.data.orders[0].paymentMethod).toBe('cod');
  });

  test('stale cart: a product switched to Self Delivery after it was added is refused COD (method read live)', async () => {
    const product = await makeProduct();
    await fillCart(product);
    await Product.updateOne({ _id: product._id }, { $set: { deliveryMethod: 'self_delivery' } });
    await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
  });

  test('the restriction holds even with the feature switch turned off (old apps, direct API)', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    delete process.env.DELIVERY_METHODS_ENABLED;
    await checkout('/orders/unified', { paymentMethod: 'cod' }).expect(409);
  });

  test('basket path: createOrdersFromGroups refuses COD for any Self Delivery group before writing', async () => {
    const groups = [{ deliveryMethod: 'easy_ship', items: [], total: 100 }, { deliveryMethod: 'self_delivery', items: [], total: 100 }];
    await expect(createOrdersFromGroups({ user: buyer, address, groups, paymentMethod: 'cod', session: null }))
      .rejects.toMatchObject({ status: 409, meta: { code: 'COD_UNAVAILABLE_SELF_DELIVERY' } });
    expect(await Payment.countDocuments()).toBe(0);
  });

  test('cart previews tell the customer COD is unavailable and why, and show no COD fee', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    const unified = await auth(request(app).get('/cart/unified?lat=22.72&lng=75.86&pincode=452001&state=Madhya%20Pradesh')).expect(200);
    expect(unified.body.data.payment.cod).toMatchObject({ available: false, code: 'COD_UNAVAILABLE_SELF_DELIVERY' });
    expect(unified.body.data.groups[0].codFee).toBeNull();
    const single = await auth(request(app).get('/cart?channel=ecommerce')).expect(200);
    expect(single.body.data.payment.cod.available).toBe(false);
    expect(single.body.data.pricing.codFee).toBeNull();
  });
});

describe('Self Delivery area', () => {
  test('an address outside the seller area is refused at checkout; inside (state or pincode) is accepted', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    const outside = { ...address, state: 'Maharashtra', pincode: '400001', city: 'Mumbai' };
    const refused = await checkout('/orders/unified', { shippingAddress: outside }).expect(409);
    expect(refused.body.meta.code).toBe('SELF_DELIVERY_NOT_SERVICEABLE');
    await checkout('/orders', { shippingAddress: outside }).expect(409);
    await checkout('/orders/unified', { shippingAddress: { ...address, state: 'Delhi', pincode: '110001', city: 'Delhi' } }).expect(201);
  });

  test('a preview without a pincode reports unknown instead of refusing', async () => {
    await fillCart(await makeProduct({ deliveryMethod: 'self_delivery' }));
    const res = await auth(request(app).get('/cart/unified')).expect(200);
    expect(res.body.data.groups[0].selfDeliveryServiceable).toBeNull();
  });

  test('the seller must declare an area before choosing Self Delivery; the area is validated', async () => {
    await Seller.updateOne({ _id: sellerDoc._id }, { $unset: { selfDelivery: 1 } });
    const product = await makeProduct();
    const refused = await asSeller(request(app).put(`/products/${product._id}`)).send({ deliveryMethod: 'self_delivery' }).expect(409);
    expect(refused.body.meta.code).toBe('SELF_DELIVERY_AREA_REQUIRED');
    await asSeller(request(app).put('/seller/self-delivery-area')).send({ states: [], pincodes: '' }).expect(400);
    await asSeller(request(app).put('/seller/self-delivery-area')).send({ pincodes: '12345' }).expect(400);
    await asSeller(request(app).put('/seller/self-delivery-area')).send({ states: ['Atlantis'] }).expect(400);
    const saved = await asSeller(request(app).put('/seller/self-delivery-area')).send({ states: ['mp', 'Delhi'], pincodes: '452001, 452001 452010' }).expect(200);
    expect(saved.body.data).toMatchObject({ states: ['Madhya Pradesh', 'Delhi'], pincodes: ['452001', '452010'], configured: true });
    await asSeller(request(app).put(`/products/${product._id}`)).send({ deliveryMethod: 'self_delivery' }).expect(200);
  });
});

describe('Self Delivery fulfilment', () => {
  test('options: rider and own courier are offered; Bulkimart Shiprocket is not, and booking it is refused', async () => {
    const order = await readySelfDeliveryOrder();
    const options = (await asSeller(request(app).get(`/seller/orders/${order._id}/options`)).expect(200)).body.data;
    expect(options.deliveryMethod).toBe('self_delivery');
    expect(options.external.available).toBe(true);
    expect(options.shiprocket.available).toBe(false);
    expect(options.shiprocket.reason).toMatch(/Self Delivery/);
    expect(checkServiceability).not.toHaveBeenCalled();
    const refused = await asSeller(request(app).post(`/seller/orders/${order._id}/shiprocket`)).send({ confirm: true, quotedCourierCharge: 50, package: { length: 10, breadth: 10, height: 10 } }).expect(409);
    expect(refused.body.message).toMatch(/Self Delivery/);
    expect(createShiprocketOrder).not.toHaveBeenCalled();
  });

  test('own courier: tracking is validated, the hand-off is recorded once, and no rider is rung', async () => {
    const order = await readySelfDeliveryOrder();
    const send = (body) => asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(body);
    await send(courier({ trackingUrl: 'http://insecure.example.com/x' })).expect(400);
    await send(courier({ trackingUrl: 'javascript:alert(1)' })).expect(400);
    await send(courier({ awb: '' })).expect(400);
    await send(courier({ courierName: '' })).expect(400);
    await send(courier({ dispatchDate: new Date(Date.now() + 3 * 864e5).toISOString() })).expect(400);
    await send(courier({ dispatchDate: undefined })).expect(400);

    const ok = await send(courier()).expect(200);
    expect(ok.body.data).toMatchObject({ status: 'dispatched', deliveryType: 'external' });
    const saved = await Order.findById(order._id).lean();
    expect(saved.externalShipment).toMatchObject({ courierName: 'DTDC', awb: 'D1234567', status: 'dispatched' });
    expect(saved.fulfillment.method).toBe('external_courier');
    expect(saved.shiprocket?.awb).toBeUndefined(); // kept apart from Shiprocket records
    expect(broadcast).not.toHaveBeenCalled();

    // Repeat (double tap) is a no-op; a different courier is refused; riders cannot be chosen afterwards.
    await send(courier()).expect(200);
    expect((await Order.findById(order._id).lean()).timeline.filter((t) => t.status === 'dispatched')).toHaveLength(1);
    await send(courier({ awb: 'OTHER999' })).expect(409);
    await asSeller(request(app).post(`/seller/orders/${order._id}/manual`)).send({}).expect(409);
  });

  test('status: forward-only seller updates, delivery stamped, no regression; tracking visible to seller and customer', async () => {
    const order = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(200);
    await status(order, 'preparing').expect(400);
    await status(order, 'out_for_delivery').expect(200);
    await status(order, 'dispatched').expect(400);
    await status(order, 'delivered').expect(200);
    await status(order, 'out_for_delivery').expect(400);
    const saved = await Order.findById(order._id).lean();
    expect(saved.status).toBe('delivered');
    expect(saved.deliveredAt).toBeTruthy();
    expect(saved.externalShipment.status).toBe('delivered');
    expect(saved.externalShipment.events.map((e) => e.status)).toEqual(['dispatched', 'out_for_delivery', 'delivered']);
    expect(broadcast).not.toHaveBeenCalled();

    const detail = (await asSeller(request(app).get(`/seller/orders/${order._id}`)).expect(200)).body.data;
    expect(detail.shipment).toMatchObject({ shippingProvider: 'external_courier', courierName: 'DTDC', awbNumber: 'D1234567', trackingUrl: 'https://www.dtdc.in/track?awb=D1234567' });
    const track = (await auth(request(app).get(`/orders/${order._id}/track`)).expect(200)).body.data;
    expect(track.externalShipment).toMatchObject({ courierName: 'DTDC', awb: 'D1234567', status: 'delivered' });
    expect(track.externalShipment.enteredBy).toBeUndefined();
  });

  test('a delivery straight from dispatched is allowed for the seller-reported courier', async () => {
    const order = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(200);
    await status(order, 'delivered').expect(200);
  });

  test('authorization and duplicates: other sellers, Easy Ship orders and reused tracking IDs are refused', async () => {
    const order = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`), otherSellerUser).send(courier()).expect(403);
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(200);

    const second = await readySelfDeliveryOrder();
    const dup = await asSeller(request(app).post(`/seller/orders/${second._id}/external`)).send(courier()).expect(409);
    expect(dup.body.message).toMatch(/already used/);

    const easy = await makeProduct({ name: 'Easy item' });
    await Cart.deleteMany({}); await fillCart(easy);
    const res = await checkout('/orders/unified').expect(201);
    const easyOrder = await Order.findById(res.body.data.orders[0]._id);
    await Payment.updateOne({ _id: easyOrder.paymentId }, { $set: { status: 'paid' } });
    await status(easyOrder, 'confirmed').expect(200); await status(easyOrder, 'preparing').expect(200); await status(easyOrder, 'ready_for_pickup').expect(200);
    await asSeller(request(app).post(`/seller/orders/${easyOrder._id}/external`)).send(courier({ awb: 'E555555' })).expect(409);
  });

  test('internal rider path is unchanged for Self Delivery (manual selection dispatches to riders)', async () => {
    const order = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${order._id}/manual`)).send({}).expect(200);
    const saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ status: 'dispatched', deliveryType: 'internal' });
    expect(saved.fulfillment.method).toBe('manual');
    expect(broadcast).toHaveBeenCalledTimes(1);
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(409);
  });

  test('the delivery-charge payee is fixed at hand-off from the credit switch (off = platform)', async () => {
    delete process.env.SELF_DELIVERY_FEE_CREDIT_ENABLED;
    const off = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${off._id}/external`)).send(courier({ awb: 'OFF11111' })).expect(200);
    expect((await Order.findById(off._id).lean()).externalShipment.deliveryFeePayee).toBe('platform');
    process.env.SELF_DELIVERY_FEE_CREDIT_ENABLED = 'true';
    try {
      const on = await readySelfDeliveryOrder();
      await asSeller(request(app).post(`/seller/orders/${on._id}/external`)).send(courier({ awb: 'ON222222' })).expect(200);
      expect((await Order.findById(on._id).lean()).externalShipment.deliveryFeePayee).toBe('seller');
      // Switching it off later never changes an order already handed off.
      delete process.env.SELF_DELIVERY_FEE_CREDIT_ENABLED;
      expect((await Order.findById(on._id).lean()).externalShipment.deliveryFeePayee).toBe('seller');
    } finally { delete process.env.SELF_DELIVERY_FEE_CREDIT_ENABLED; }
  });

  test('after hand-off the seller can correct tracking or report a failure through the API; others cannot', async () => {
    const order = await readySelfDeliveryOrder();
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(200);
    await asSeller(request(app).patch(`/seller/orders/${order._id}/external`), otherSellerUser).send({ action: 'delivery_failed', reason: 'Not my order at all' }).expect(403);
    await asSeller(request(app).patch(`/seller/orders/${order._id}/external`)).send({ action: 'correct_tracking', awb: 'D7654321' }).expect(400); // reason required
    await asSeller(request(app).patch(`/seller/orders/${order._id}/external`)).send({ action: 'correct_tracking', awb: 'D7654321', reason: 'Wrong digits on slip' }).expect(200);
    await asSeller(request(app).patch(`/seller/orders/${order._id}/external`)).send({ action: 'delivery_failed', reason: 'Door locked twice' }).expect(200);
    const saved = await Order.findById(order._id).lean();
    expect(saved.externalShipment).toMatchObject({ awb: 'D7654321', status: 'delivery_failed' });
    expect(saved.externalShipment.corrections[0].previous.awb).toBe('D1234567');
    // Re-attempt: the seller can still report delivery afterwards.
    await status(order, 'delivered').expect(200);
    expect((await Order.findById(order._id).lean()).externalShipment.status).toBe('delivered');
  });

  test('Same-Day orders cannot be handed to an outside courier', async () => {
    const order = await readySelfDeliveryOrder();
    await Order.updateOne({ _id: order._id }, { $set: { 'delivery.mode': 'same_day' } });
    await asSeller(request(app).post(`/seller/orders/${order._id}/external`)).send(courier()).expect(409);
  });

  test('carrier rules: external couriers are never rider work and keep their own transitions', () => {
    expect(enums.COURIER_DELIVERY_TYPES).toEqual(['shiprocket', 'external']);
    expect(enums.vendorTransitions('external').dispatched).toEqual(['out_for_delivery', 'delivered']);
    expect(enums.vendorTransitions('external').preparing).toEqual(['cancelled']);
    expect(enums.vendorTransitions('internal')).toBe(enums.VENDOR_ORDER_TRANSITIONS);
    expect(enums.vendorTransitions('shiprocket')).toBe(enums.COURIER_VENDOR_TRANSITIONS);
  });
});
