import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
import { requestContext } from '../../middlewares/requestContext.middleware.js';
import { reconcileCheckoutIndexes } from '../../services/checkoutIndexCompatibility.service.js';

const checkServiceability = jest.fn(); const createShiprocketOrder = jest.fn(); const assignCourier = jest.fn();
const verifyPickupLocation = jest.fn(async (location, store) => ({ pickup_location: location, pin_code: store.pincode, address: store.address }));
const generateLabel = jest.fn(); const schedulePickup = jest.fn(); const broadcast = jest.fn(async () => {});
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true, quickCommerce: false }),
  listPickupLocations: jest.fn(async () => []), addPickupLocation: jest.fn(async () => ({})),
  verifyPickupLocation, checkServiceability, createShiprocketOrder, assignCourier, generateLabel, schedulePickup,
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));
jest.unstable_mockModule('../../controllers/deliveryPartner.controller.js', () => ({ broadcastNewOrderToRiders: broadcast }));
const [{ default: orderRoutes }, { updateOrderStatus }, fulfillment, { protect, requireRole }, { requireApprovedSeller }, { errorHandler }, { JWT_SECRET },
  { default: User }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }, { default: Payment }, { default: WalletLedger }, { buildFulfilmentGroups }] = await Promise.all([
  import('../../routes/order.routes.js'), import('../../controllers/seller.controller.js'), import('../../controllers/fulfillment.controller.js'),
  import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'),
  import('../../models/User.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Cart.js'), import('../../models/Order.js'), import('../../models/Payment.js'), import('../../models/WalletLedger.js'), import('../../services/fulfilmentGroups.service.js'),
]);
const app = express(); app.use(requestContext); app.use(express.json()); app.use('/orders', orderRoutes);
const { getSellerOrders } = await import('../../controllers/seller.controller.js');
const { notifySeller } = await import('../../services/notification.service.js');
const vendor = express.Router(); vendor.use(protect, requireRole('seller'), requireApprovedSeller);
vendor.patch('/:id/status', updateOrderStatus); vendor.get('/:id/options', fulfillment.getFulfillmentOptions);
vendor.get('/:id', getSellerOrders);
vendor.post('/:id/manual', fulfillment.selectManualFulfillment); vendor.post('/:id/shiprocket', fulfillment.createShiprocketShipment);
app.use('/seller', vendor); app.use(errorHandler);
let db, buyer, sellerUser, seller, product;
const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 };
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role }, JWT_SECRET)}`);
const sellerAuth = req => auth(req, sellerUser, 'seller');
const checkout = (path = '/orders/unified', extra = {}, key = randomUUID()) => auth(request(app).post(path)).set('Idempotency-Key', key).send({ shippingAddress: address, paymentMethod: 'cod', ...extra });
const state = (order, status) => sellerAuth(request(app).patch('/seller/' + order._id + '/status')).send({ status });
const ship = order => sellerAuth(request(app).post('/seller/' + order._id + '/shiprocket')).send({ confirm: true, quotedCourierCharge: 65.25, package: { length: 10, breadth: 10, height: 10 } });
async function placed(extra = {}, path = '/orders/unified') {
  const res = await checkout(path, extra); expect({ status: res.status, error: res.status >= 400 ? res.body.message : undefined }).toEqual({ status: 201, error: undefined });
  return Order.findById(res.body.data.orders?.[0]._id || res.body.data.order._id);
}
async function prepared(extra = {}) {
  const order = await placed(extra);
  if (order.paymentMethod === 'online') await Payment.updateOne({ _id: order.paymentId }, { $set: { status: 'paid' } });
  await state(order, 'confirmed').expect(200); await state(order, 'preparing').expect(200); await state(order, 'ready_for_pickup').expect(200);
  return Order.findById(order._id);
}
async function cart(channel = 'ecommerce', mode) {
  await Cart.create({ userId: buyer._id, channel, items: [{ productId: product._id, variantId: product.variants[0]._id, sellerId: seller._id, name: 'Fixture', price: 100, qty: 1, ...(mode ? { deliveryMode: mode } : {}) }] });
}
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  // Production requires this explicit index too; autoIndex is disabled on
  // CheckoutAttempt. Exercise the real uniqueness boundary in this fixture.
  await mongoose.models.CheckoutAttempt.createIndexes();
});

test.each([
  ['/orders', 'cod'], ['/orders', 'online'],
  ['/orders/unified', 'cod'], ['/orders/unified', 'online'],
])('ambiguous response retry recovers the persisted %s %s order without duplicating writes', async (path, paymentMethod) => {
  const key = randomUUID();
  const extra = { channel: 'ecommerce', paymentMethod };
  const first = await checkout(path, extra, key).expect(201);
  // Treat this first successful response as lost. The server has already
  // cleared the cart, so replay must run before empty-cart validation.
  const retry = await checkout(path, extra, key).expect(201);
  const firstId = first.body.data.order?._id || first.body.data.orders[0]._id;
  const retryId = retry.body.data.order?._id || retry.body.data.orders[0]._id;
  expect(retryId).toBe(firstId);
  expect(await Order.countDocuments({ userId: buyer._id })).toBe(1);
  expect(await Payment.countDocuments({ userId: buyer._id })).toBe(1);
  const persisted = await Order.findById(firstId);
  expect(persisted.fulfillment.assignmentPolicy).toBe('seller_after_acceptance');
  expect(persisted.paymentMethod).toBe(paymentMethod);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  checkServiceability.mockResolvedValue({ available: true, couriers: [{ courier_company_id: 1, courier_name: 'Fixture Courier', rate: 65.25, freight_charge: 60 }] });
  createShiprocketOrder.mockResolvedValue({ order_id: 'provider-order', shipment_id: 'provider-shipment' });
  assignCourier.mockResolvedValue({ awb: 'fixture-awb', courier_name: 'Fixture Courier' });
  generateLabel.mockResolvedValue({ label_url: 'https://example.invalid/fixture-label' }); schedulePickup.mockResolvedValue({ pickup_status: 1 });
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], wallet: { balance: 10000 }, isActive: true });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved', storeDetails: { name: 'Fixture Store', pincode: '400001', city: 'Mumbai', lat: 19.1, lng: 72.9 }, thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' } });
  seller = await Seller.findById(sellerId);
  product = { _id: id(), sellerId, type: 'ecommerce', category: id(), name: 'Fixture item', price: 100, stock: 10, isActive: true, status: 'approved', fulfillmentType: 'physical', images: [], variants: [{ _id: id(), name: 'One pack', sku: 'FIXTURE-1', price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }] };
  await Product.collection.insertOne(product); await cart();
});

test('reproduces gatewayOrderId_1 null collision, rolls back, and repairs optional legacy indexes without losing identifier uniqueness', async () => {
  await Payment.collection.insertOne({ userId: id(), amount: 1, method: 'cod', status: 'pending' });
  await Payment.collection.createIndex({ gatewayOrderId: 1 }, { name: 'gatewayOrderId_1', unique: true });
  await Order.collection.insertMany([
    { userId: id(), orderNo: 'LEGACY-FIXTURE-1', orderId: 'LEGACY-REAL-ID' },
    { userId: id(), orderNo: 'LEGACY-FIXTURE-2' },
  ]);
  await Order.collection.createIndex({ orderId: 1 }, { name: 'orderId_1', unique: true });
  buyer.addresses.push({ ...address, isDefault: true }); await buyer.save();
  const key = randomUUID(); const payload = { channel: 'ecommerce', paymentMethod: 'cod', addressId: buyer.addresses[0]._id };
  const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const failed = await checkout('/orders', payload, key).expect(409);
    expect(failed.body.meta.code).toBe('CHECKOUT_DATA_CONFLICT');
    const diagnostic = logs.mock.calls.map(([line]) => JSON.parse(line)).find(line => line.event === 'checkout_database_failure');
    expect(diagnostic).toMatchObject({ stage: 'payment.create', databaseCode: 11000, index: 'gatewayOrderId_1', keyPattern: { gatewayOrderId: 1 }, keyValue: { gatewayOrderId: null }, requestId: failed.headers['x-request-id'] });
    expect(diagnostic.transactionState).toBe('TRANSACTION_ABORTED');
    expect(await Order.countDocuments({ userId: buyer._id })).toBe(0);
    expect(await Payment.countDocuments({ userId: buyer._id })).toBe(0);
    expect(await mongoose.models.CheckoutAttempt.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
    expect((await Cart.findOne({ userId: buyer._id })).items).toHaveLength(1);
    const plan = await reconcileCheckoutIndexes(mongoose.connection.db);
    expect(plan.every(item => item.legacyPresent)).toBe(true);
    await reconcileCheckoutIndexes(mongoose.connection.db, { apply: true });
    for (const collection of ['orders', 'payments']) {
      const indexes = await mongoose.connection.db.collection(collection).indexes();
      expect(indexes.filter(index => index.unique && index.partialFilterExpression)).not.toHaveLength(0);
    }
    const placed = await checkout('/orders', payload, key).expect(201);
    const retry = await checkout('/orders', payload, key).expect(201);
    expect(retry.body.data.order._id).toBe(placed.body.data.order._id);
    expect(await Order.countDocuments({ userId: buyer._id })).toBe(1);
    expect(await Payment.countDocuments({ userId: buyer._id })).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(9);
    // Constraints still reject duplicate real IDs after replacement.
    await expect(Order.collection.insertOne({ orderNo: 'DUPLICATE-LEGACY', orderId: 'LEGACY-REAL-ID' })).rejects.toMatchObject({ code: 11000 });
    await Payment.collection.insertOne({ gatewayOrderId: 'provider-real-fixture' });
    await expect(Payment.collection.insertOne({ gatewayOrderId: 'provider-real-fixture' })).rejects.toMatchObject({ code: 11000 });
  } finally {
    logs.mockRestore();
    // Isolated fixture only. Always leave a canonical optional-field index for
    // later cases, even if a reproduction assertion fails.
    await reconcileCheckoutIndexes(mongoose.connection.db, { apply: true });
  }
});

test('legacy orderId_1 collision occurs after payment creation and the whole transaction rolls back', async () => {
  await Order.collection.insertOne({ userId: id(), orderNo: 'HISTORICAL-FIXTURE' });
  await Order.collection.createIndex({ orderId: 1 }, { name: 'orderId_1', unique: true });
  const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await checkout('/orders', { channel: 'ecommerce' }).expect(409);
    const diagnostic = logs.mock.calls.map(([line]) => JSON.parse(line)).find(line => line.event === 'checkout_database_failure');
    expect(diagnostic).toMatchObject({ stage: 'order.create', databaseCode: 11000, index: 'orderId_1', keyValue: { orderId: null } });
    expect(await Payment.countDocuments()).toBe(0);
    expect(await mongoose.models.CheckoutAttempt.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
  } finally { logs.mockRestore(); await reconcileCheckoutIndexes(mongoose.connection.db, { apply: true }); }
});

test.each(['cod', 'wallet', 'online'])('%s failure after order insertion rolls back all checkout writes and exposes no database details in production', async paymentMethod => {
  const key = randomUUID();
  const previousEnv = process.env.NODE_ENV;
  const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  const failure = Object.assign(new Error('fixture-private-database-detail'), { name: 'MongoServerError', code: 121 });
  const update = jest.spyOn(Cart, 'updateOne').mockRejectedValueOnce(failure);
  try {
    process.env.NODE_ENV = 'production';
    const response = await checkout('/orders', { channel: 'ecommerce', paymentMethod }, key).expect(500);
    expect(response.body.meta.code).toBe('CHECKOUT_SAVE_FAILED');
    expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.stack).toBeUndefined();
    const publicError = structuredClone(response.body);
    delete publicError.meta.requestId; // A random UUID may legitimately contain "121".
    expect(JSON.stringify(publicError)).not.toMatch(/fixture-private|MongoServerError|121|E11000/);
    const diagnostic = logs.mock.calls.map(([line]) => JSON.parse(line)).find(line => line.event === 'checkout_database_failure');
    expect(diagnostic).toMatchObject({ stage: 'cart.clear', databaseCode: 121, transactionState: 'TRANSACTION_ABORTED' });
    expect(await Order.countDocuments()).toBe(0);
    expect(await Payment.countDocuments()).toBe(0);
    expect(await WalletLedger.countDocuments()).toBe(0);
    expect(notifySeller).not.toHaveBeenCalled();
    expect((await User.findById(buyer._id)).wallet.balance).toBe(10000);
    expect(await mongoose.models.CheckoutAttempt.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
    expect((await Cart.findOne({ userId: buyer._id })).items).toHaveLength(1);
    await checkout('/orders', { channel: 'ecommerce', paymentMethod }, key).expect(201);
    await checkout('/orders', { channel: 'ecommerce', paymentMethod }, key).expect(201);
    expect(await Order.countDocuments()).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
    expect(await WalletLedger.countDocuments()).toBe(paymentMethod === 'wallet' ? 1 : 0);
  } finally {
    update.mockRestore(); logs.mockRestore();
    if (previousEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousEnv;
  }
});

test('checkout recovery is authenticated, read-only, owner-scoped and returns a committed result without resubmitting', async () => {
  const key = randomUUID();
  const status = (operation = 'single') => auth(request(app).post('/orders/checkout-status')).set('Idempotency-Key', key).send({ operation });
  await request(app).post('/orders/checkout-status').send({ operation: 'single' }).expect(401);
  await auth(request(app).post('/orders/checkout-status')).set('Idempotency-Key', key).expect(400);
  await auth(request(app).post('/orders/checkout-status')).set('Idempotency-Key', 'bad').send({ operation: 'single' }).expect(400);
  const missing = await status().expect(200);
  expect(missing.body.data).toEqual({ state: 'not_found', canRetrySameKey: true });
  expect(await Order.countDocuments()).toBe(0);
  const placed = await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
  const result = await status().expect(200);
  expect(result.body.data).toMatchObject({ state: 'completed', canRetrySameKey: false, orders: [{ _id: placed.body.data.order._id }], payment: { status: 'pending' } });
  expect(JSON.stringify(result.body)).not.toMatch(/shippingAddress|Fixture Buyer|gatewayOrderId|requestHash/);
  await status('unified').expect(409);
  const other = await User.create({ name: 'Other Fixture', phone: '9876500099', roles: ['buyer'], isActive: true });
  const isolated = await auth(request(app).post('/orders/checkout-status'), other).set('Idempotency-Key', key).send({ operation: 'single' }).expect(200);
  expect(isolated.body.data).toEqual({ state: 'not_found', canRetrySameKey: true });
  await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
  expect(await Order.countDocuments()).toBe(1);
  expect(await Payment.countDocuments()).toBe(1);
  expect((await Product.findById(product._id)).variants[0].stock).toBe(9);
  // An incomplete or corrupt reference must never authorize another submission.
  await mongoose.models.CheckoutAttempt.updateOne({ key }, { $set: { status: 'processing' } });
  expect((await status()).body.data).toEqual({ state: 'processing', canRetrySameKey: false });
  await mongoose.models.CheckoutAttempt.updateOne({ key }, { $set: { status: 'completed', paymentId: id() } });
  expect((await status()).body.data).toEqual({ state: 'unavailable', canRetrySameKey: false });
});

test('a lost commit acknowledgement reports uncertainty and recovers the one committed online order and payment', async () => {
  const key = randomUUID();
  const session = await mongoose.startSession();
  const commit = session.withTransaction.bind(session);
  const uncertain = Object.assign(new Error('fixture acknowledgement lost'), { errorLabels: ['UnknownTransactionCommitResult'] });
  jest.spyOn(session, 'withTransaction').mockImplementation(async callback => {
    await commit(callback); // Real replica-set commit, followed by a lost acknowledgement.
    throw uncertain;
  });
  const start = jest.spyOn(mongoose, 'startSession').mockResolvedValueOnce(session);
  const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await checkout('/orders', { channel: 'ecommerce', paymentMethod: 'online' }, key).expect(503);
    expect(response.body.meta.code).toBe('CHECKOUT_OUTCOME_UNCERTAIN');
    expect(await Order.countDocuments()).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
    const recovery = await auth(request(app).post('/orders/checkout-status')).set('Idempotency-Key', key).send({ operation: 'single' }).expect(200);
    expect(recovery.body.data).toMatchObject({ state: 'completed', canRetrySameKey: false, payment: { status: 'pending' } });
    const retry = await checkout('/orders', { channel: 'ecommerce', paymentMethod: 'online' }, key).expect(201);
    expect(retry.body.data.order._id).toBe(recovery.body.data.orders[0]._id);
    expect(await Order.countDocuments()).toBe(1);
    expect(await Payment.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(9);
  } finally { start.mockRestore(); logs.mockRestore(); }
});

test.each(['cod', 'wallet', 'online'])('grouped %s checkout requires no provider and freezes customer price', async paymentMethod => {
  const preview = await buildFulfilmentGroups({ userId: buyer._id, user: buyer, destination: address });
  expect(preview.needsDeliveryChoice).toBe(false); expect(preview.groups[0].deliveryType).toBeUndefined();
  const order = await placed({ paymentMethod }); expect(order.deliveryType).toBeUndefined(); expect(order.fulfillment.method).toBeUndefined();
  expect(order.fulfillment.assignmentPolicy).toBe('seller_after_acceptance'); expect(order.vendorDecision.status).toBe('pending'); expect(order.status).toBe('placed');
  expect(order.pricing.totalAmount).toBe(preview.totals.totalAmount); expect(order.delivery.mode).toBe('scheduled');
  expect(createShiprocketOrder).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
  expect((await Payment.findById(order.paymentId)).status).toBe(paymentMethod === 'wallet' ? 'paid' : 'pending');
});
test('single checkout has the same seller-first policy and repeated key does not charge twice', async () => {
  const key = randomUUID(); const first = await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
  const second = await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
  expect(first.body.data.order._id).toBe(second.body.data.order._id); expect(await Order.countDocuments()).toBe(1);
  expect((await Order.findOne()).deliveryType).toBeUndefined();
  expect(notifySeller).toHaveBeenCalledTimes(1);
  expect(notifySeller.mock.calls[0][0]).toBe(String(seller._id));
});

test('seller notification detail lookup is fresh, owner-scoped and does not expose another seller items', async () => {
  const order = await placed();
  const other = await User.create({ name: 'Other Fixture Seller', phone: '9876500999', roles: ['seller'], isActive: true });
  const otherSellerId = id();
  await Seller.collection.insertOne({ _id: otherSellerId, userId: other._id, businessName: 'Other Fixture', status: 'approved' });
  await request(app).get(`/seller/${order._id}`).expect(401);
  await auth(request(app).get(`/seller/${order._id}`), other, 'seller').expect(404);
  await sellerAuth(request(app).get('/seller/not-an-id')).expect(400);
  await Order.updateOne({ _id: order._id }, { $set: { status: 'preparing' }, $push: { items: { sellerId: otherSellerId, productId: id(), name: 'PRIVATE OTHER SELLER ITEM', qty: 1, price: 999 } } });
  await Payment.updateOne({ _id: order.paymentId }, { $set: { status: 'paid' } });
  const detail = await sellerAuth(request(app).get(`/seller/${order._id}`)).expect(200);
  expect(detail.body.data).toMatchObject({ _id: String(order._id), channel: 'ecommerce', status: 'preparing', paymentStatus: 'paid', subtotal: 100 });
  expect(detail.body.data.items).toHaveLength(1);
  expect(JSON.stringify(detail.body)).not.toMatch(/PRIVATE OTHER SELLER ITEM/);
  expect(detail.body.data.shippingAddress.city).toBe('Mumbai');
});
test('seller must accept and prepare before choosing delivery; dispatch cannot skip the choice', async () => {
  const order = await placed(); await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(409);
  await state(order, 'confirmed').expect(200); await state(order, 'preparing').expect(200); await state(order, 'dispatched').expect(409);
  await state(order, 'ready_for_pickup').expect(200);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(200); await state(order, 'dispatched').expect(200);
  expect((await Order.findById(order._id)).deliveryType).toBe('internal'); expect(broadcast).toHaveBeenCalledTimes(1);
});
test('seller rejection requires reason, restores stock and refunds wallet exactly once', async () => {
  const order = await placed({ paymentMethod: 'wallet' });
  await state(order, 'cancelled').expect(400);
  const reject = () => sellerAuth(request(app).patch('/seller/' + order._id + '/status')).send({ status: 'cancelled', reason: 'Cannot fulfil fixture' });
  await reject().expect(200); await reject().expect(200);
  const updated = await Order.findById(order._id); expect(updated.vendorDecision.status).toBe('rejected'); expect(updated.status).toBe('cancelled');
  expect((await User.findById(buyer._id)).wallet.balance).toBe(10000);
  expect((await Product.findById(product._id)).variants[0].stock).toBe(10);
  expect(await WalletLedger.countDocuments({ direction: 'debit' })).toBe(1); expect(createShiprocketOrder).not.toHaveBeenCalled();
});
test('unpaid online orders cannot be accepted or shipped', async () => {
  const order = await placed({ paymentMethod: 'online' }); await state(order, 'confirmed').expect(409); await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
});
test('Shiprocket records one quote and preserves customer payment and fee snapshots across retries', async () => {
  const order = await prepared({ paymentMethod: 'wallet' }); const before = order.pricing.toObject(); const balance = (await User.findById(buyer._id)).wallet.balance;
  await ship(order).expect(200); await ship(order).expect(200);
  const updated = await Order.findById(order._id); expect(updated.deliveryType).toBe('shiprocket'); expect(updated.fulfillment.method).toBe('shiprocket');
  expect(updated.fulfillment.quote.toObject()).toMatchObject({ courierCharge: 65.25, customerAdditionalCharge: 0, serviceFee: 0, customerDeliveryCharge: before.deliveryCharge, billingPolicy: 'checkout_charge_unchanged' });
  expect(updated.pricing.toObject()).toEqual(before); expect((await User.findById(buyer._id)).wallet.balance).toBe(balance);
  expect(createShiprocketOrder).toHaveBeenCalledTimes(1); expect(assignCourier).toHaveBeenCalledTimes(1); expect(await WalletLedger.countDocuments({ direction: 'debit' })).toBe(1);
  const payload = createShiprocketOrder.mock.calls[0][0]; expect(payload.payment_method).toBe('Prepaid'); expect(payload.sub_total + payload.shipping_charges - payload.total_discount).toBe(before.totalAmount);
});
test('COD provider amount includes the already quoted delivery charge once', async () => {
  const order = await prepared(); await ship(order).expect(200);
  const payload = createShiprocketOrder.mock.calls[0][0]; expect(payload.payment_method).toBe('COD');
  expect(payload.sub_total + payload.shipping_charges - payload.total_discount).toBe(order.pricing.totalAmount);
});
test('Quick Commerce stays internal and third-party activation remains blocked', async () => {
  await Cart.deleteMany({}); await Product.updateOne({ _id: product._id }, { $set: { type: 'grocery' } }); await cart('grocery');
  await checkout('/orders', { channel: 'grocery', deliveryMode: 'scheduled' }).expect(400);
  const order = await prepared(); expect(order.type).toBe('grocery'); expect(order.deliveryType).toBe('internal');
  const options = await sellerAuth(request(app).get('/seller/' + order._id + '/options')).expect(200); expect(options.body.data.shiprocket.available).toBe(false);
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(200); await state(order, 'dispatched').expect(200);
});
test('address, stock, seller serviceability and invalid payment remain authoritative', async () => {
  await checkout('/orders/unified', { shippingAddress: {} }).expect(400);
  await checkout('/orders/unified', { paymentMethod: 'carrier' }).expect(400);
  await Seller.updateOne({ _id: seller._id }, { $set: { serviceRadiusKm: 0.01 } }); await checkout().expect(409);
  await Seller.updateOne({ _id: seller._id }, { $unset: { serviceRadiusKm: 1 } });
  await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 0 } }); await checkout().expect(409);
  expect(await Order.countDocuments()).toBe(0);
});
test('explicit Same-Day requests cannot silently fall back to regular delivery', async () => {
  await Cart.updateOne({ userId: buyer._id }, { $set: { 'items.0.deliveryMode': 'same_day' } });
  await checkout().expect(409); expect(await Order.countDocuments()).toBe(0);
});
test('same-day orders cannot be changed to standard Shiprocket', async () => {
  const order = await prepared(); await Order.updateOne({ _id: order._id }, { $set: { 'delivery.mode': 'same_day', deliveryType: 'internal' } });
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
});
test('invalid or inaccessible vendor calls cannot create shipments', async () => {
  const order = await prepared(); await request(app).post('/seller/' + order._id + '/shiprocket').expect(401);
  await auth(request(app).post('/seller/' + order._id + '/shiprocket')).expect(403);
  const other = await User.create({ name: 'Other Fixture Seller', phone: '9876500002', roles: ['seller'] });
  await Seller.collection.insertOne({ userId: other._id, businessName: 'Other Store', status: 'approved' });
  await auth(request(app).post('/seller/' + order._id + '/shiprocket'), other, 'seller').send({ confirm: true }).expect(403);
  expect(createShiprocketOrder).not.toHaveBeenCalled();
});
test('unserviceable provider quote does not mutate order routing or customer price', async () => {
  const order = await prepared(); checkServiceability.mockResolvedValue({ available: false, couriers: [] });
  await ship(order).expect(409); const updated = await Order.findById(order._id); expect(updated.status).toBe('preparing'); expect(updated.deliveryType).toBeUndefined(); expect(createShiprocketOrder).not.toHaveBeenCalled();
});
test('uncertain creation blocks retries, manual reassignment and cancellation without charging again', async () => {
  const order = await prepared(); createShiprocketOrder.mockRejectedValue(new Error('fixture timeout'));
  await ship(order).expect(502); await ship(order).expect(409);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(409);
  await state(order, 'cancelled').expect(409);
  const updated = await Order.findById(order._id); expect(updated.shiprocket.status).toBe('reconciliation_required'); expect(updated.status).toBe('preparing'); expect(updated.pricing.totalAmount).toBe(order.pricing.totalAmount); expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});
test('concurrent requests cannot reset the winning creation lock or create a duplicate shipment', async () => {
  const order = await prepared(); let release, signal;
  const started = new Promise(resolve => { signal = resolve; });
  createShiprocketOrder.mockImplementationOnce(() => new Promise(resolve => { release = resolve; signal(); }));
  const first = ship(order).then(response => response); await started;
  await ship(order).expect(409); expect((await Order.findById(order._id)).shiprocket.status).toBe('creating');
  await state(order, 'dispatched').expect(409);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(409);
  release({ order_id: 'provider-order', shipment_id: 'provider-shipment' }); expect((await first).status).toBe(200); expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});
test('AWB failure retains provider IDs and blocks blind recreation', async () => {
  const order = await prepared(); assignCourier.mockRejectedValue(new Error('fixture timeout'));
  await ship(order).expect(502); const updated = await Order.findById(order._id);
  expect(updated.shiprocket.orderId).toBe('provider-order'); expect(updated.shiprocket.shipmentId).toBe('provider-shipment'); expect(updated.shiprocket.status).toBe('reconciliation_required');
  await ship(order).expect(409); expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});
test('label or pickup failures preserve the confirmed AWB without duplicate provider requests', async () => {
  const order = await prepared(); generateLabel.mockRejectedValue(new Error('fixture label error')); schedulePickup.mockResolvedValue({ pickup_status: 0 });
  await ship(order).expect(200); await ship(order).expect(200); const updated = await Order.findById(order._id);
  expect(updated.shiprocket.awb).toBe('fixture-awb'); expect(updated.shiprocket.pickupScheduledAt).toBeUndefined(); expect(updated.shiprocket.lastError).toMatch(/follow-up/); expect(assignCourier).toHaveBeenCalledTimes(1);
});
test('multiple stores produce separate accepted-by-seller orders and one payment without choosing carriers', async () => {
  const anotherSeller = id(), anotherProduct = { ...product, _id: id(), sellerId: anotherSeller };
  await Seller.collection.insertOne({ _id: anotherSeller, userId: id(), businessName: 'Second Fixture Store', status: 'approved', storeDetails: { pincode: '400001', lat: 19.1, lng: 72.9 } });
  await Product.collection.insertOne(anotherProduct);
  await Cart.updateOne({ userId: buyer._id }, { $push: { items: { productId: anotherProduct._id, variantId: anotherProduct.variants[0]._id, qty: 1, price: 100 } } });
  const response = await checkout().expect(201); expect(response.body.data.orders).toHaveLength(2);
  const orders = await Order.find({}); expect(orders.every(order => order.deliveryType === undefined && order.vendorDecision.status === 'pending')).toBe(true);
  expect(await Payment.countDocuments()).toBe(1); expect(response.body.data.payment.amount).toBe(orders.reduce((sum, order) => sum + order.pricing.totalAmount, 0));
  expect(notifySeller).toHaveBeenCalledTimes(2);
  expect(new Set(notifySeller.mock.calls.map(call => call[0]))).toEqual(new Set([String(seller._id), String(anotherSeller)]));
});

test('post-commit seller notification failure never fails checkout or recreates the order on replay', async () => {
  const key = randomUUID();
  notifySeller.mockRejectedValueOnce(new Error('fixture notification failure'));
  const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const first = await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
    const replay = await checkout('/orders', { channel: 'ecommerce' }, key).expect(201);
    expect(replay.body.data.order._id).toBe(first.body.data.order._id);
    expect(await Order.countDocuments()).toBe(1); expect(await Payment.countDocuments()).toBe(1);
    expect(notifySeller).toHaveBeenCalledTimes(1);
  } finally { logs.mockRestore(); }
});
test('malformed cart modes and missing sellers are rejected instead of becoming carrier defaults', async () => {
  await Cart.collection.updateOne({ userId: buyer._id }, { $set: { 'items.0.deliveryMode': 'shiprocket' } }); await checkout().expect(400);
  await Cart.collection.updateOne({ userId: buyer._id }, { $unset: { 'items.0.deliveryMode': 1 } }); await Seller.deleteOne({ _id: seller._id }); await checkout().expect(409);
});
test('a raised provider quote requires new seller confirmation before creating anything', async () => {
  const order = await prepared(); checkServiceability.mockResolvedValue({ available: true, couriers: [{ courier_company_id: 1, rate: 90 }] });
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled(); expect((await Order.findById(order._id)).shiprocket.status).toBeUndefined();
});
test('failed quote lookup leaves the order unchanged and can be retried safely', async () => {
  const order = await prepared(); checkServiceability.mockRejectedValueOnce(new Error('fixture unavailable'));
  await ship(order).expect(502); expect((await Order.findById(order._id)).shiprocket.status).toBeUndefined();
  await ship(order).expect(200); expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});
test('provider payload reconciles existing discounts and tip without duplicating coupon reductions', async () => {
  const order = await prepared({ tipAmount: 10 });
  // Historical single-order snapshots can contain both aggregate discount and
  // its coupon component. The locked total, rather than their sum, is authoritative.
  await Order.updateOne({ _id: order._id }, { $set: { 'pricing.discount': 20, 'pricing.couponDiscount': 20, 'pricing.coinDiscount': 5, 'pricing.totalAmount': 125 } });
  await ship(order).expect(200); const payload = createShiprocketOrder.mock.calls[0][0];
  expect(payload.total_discount).toBe(25); expect(payload.order_items.at(-1).selling_price).toBe(10);
  expect(payload.sub_total + payload.shipping_charges - payload.total_discount).toBe(125);
});
test('partial historical provider references cannot trigger duplicate shipment creation', async () => {
  const order = await prepared(); await Order.updateOne({ _id: order._id }, { $set: { 'shiprocket.orderId': 'known-provider-order' } });
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
});

test('ready step is required, versioned and idempotent; delivery selection preserves its audit record', async () => {
  const order = await placed();
  await state(order, 'ready_for_pickup').expect(409);
  await state(order, 'confirmed').expect(200); await state(order, 'preparing').expect(200);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(409);
  await sellerAuth(request(app).patch('/seller/' + order._id + '/status')).send({ status: 'ready_for_pickup', version: -1 }).expect(409);
  await state(order, 'ready_for_pickup').expect(200); await state(order, 'ready_for_pickup').expect(200);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).send({ riderId: String(id()) }).expect(400);
  const concurrent = await Promise.all([1, 2].map(() => sellerAuth(request(app).post('/seller/' + order._id + '/manual'))));
  expect(concurrent.some(result => result.status === 200)).toBe(true);
  expect(concurrent.every(result => [200, 409].includes(result.status))).toBe(true);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(200);
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(200);
  const saved = await Order.findById(order._id);
  expect(saved.timeline.filter(e => e.note?.includes('marked the parcel ready'))).toHaveLength(1);
  expect(saved.timeline.filter(e => e.note?.includes('selected manual delivery'))).toHaveLength(1);
  expect(saved.deliveryId).toBeUndefined();
});

test('pickup eligibility is verified before provider creation and package constraints fail safely', async () => {
  const order = await prepared();
  verifyPickupLocation.mockResolvedValueOnce(null);
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
  verifyPickupLocation.mockRejectedValueOnce(new Error('fixture unavailable'));
  await ship(order).expect(502); expect(createShiprocketOrder).not.toHaveBeenCalled();
  await sellerAuth(request(app).post('/seller/' + order._id + '/shiprocket')).send({ confirm: true, quotedCourierCharge: 65.25, package: { length: 0.5, breadth: 10, height: 10 } }).expect(400);
  await ship(order).expect(200);
  const saved = await Order.findById(order._id);
  expect(saved.shiprocket.pickupLocation).toBe('fixture-pickup'); expect(saved.shiprocket.package.weight).toBe(0.5);
  await state(order, 'cancelled').send({ reason: 'Too late' }).expect(409);
});

test('seller detail exposes only authorized rider delivery facts and correct customer/store snapshots', async () => {
  const order = await prepared();
  const { default: Partner } = await import('../../models/DeliveryPartner.js');
  const { default: Delivery } = await import('../../models/Delivery.js');
  const riderUser = await User.create({ name: 'Fixture Assigned Rider', phone: '9876500002', roles: ['delivery'], isActive: true });
  const partner = await Partner.create({ userId: riderUser._id, status: 'approved', isAvailable: true });
  const delivery = await Delivery.create({ orderId: order._id, partnerId: partner._id, status: 'assigned', otp: 'PRIVATE_TEST_SECRET' });
  await Order.updateOne({ _id: order._id }, { $set: { deliveryId: delivery._id, deliveryPartnerId: partner._id, status: 'dispatched' } });
  const detail = await sellerAuth(request(app).get('/seller/' + order._id)).expect(200);
  expect(detail.body.data.deliveryAssignment.rider.name).toBe('Fixture Assigned Rider');
  expect(JSON.stringify(detail.body)).not.toContain('PRIVATE_TEST_SECRET');
  expect(detail.body.data.shippingAddress.line1).toBe(address.line1);
  expect(detail.body.data.store.name).toBe('Fixture Store');
  expect(detail.body.data.pricing.totalAmount).toBe(order.pricing.totalAmount);
  expect(detail.body.data.items[0].sku).toBe('FIXTURE-1');
  expect(detail.body.data.permittedActions).toEqual([]);
});

test('late/terminal internal orders reject the forbidden mutation matrix without changing persisted status', async () => {
  const order = await prepared();
  for (const status of ['dispatched', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'refunded']) {
    await Order.updateOne({ _id: order._id }, { $set: { status, deliveryType: 'internal' } });
    for (const target of ['preparing', 'dispatched', 'delivered', 'cancelled']) {
      const result = await sellerAuth(request(app).patch('/seller/' + order._id + '/status')).send({ status: target, reason: 'Fixture invalid mutation' });
      expect([400, 409]).toContain(result.status);
      expect((await Order.findById(order._id)).status).toBe(status);
    }
  }
});

test('pending pickup registration blocks new courier bookings while manual delivery is independent', async () => {
  const order = await prepared();
  await Seller.updateOne({ _id: seller._id }, { $set: { 'pickupSync.status': 'pending' } });
  await ship(order).expect(409); expect(createShiprocketOrder).not.toHaveBeenCalled();
  await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(200);
});

test('address resynchronization never recreates an existing shipment or replaces its recorded pickup', async () => {
  const order = await prepared(); await ship(order).expect(200);
  const before = (await Order.findById(order._id)).shiprocket.toObject();
  await Seller.updateOne({ _id: seller._id }, { $set: { 'pickupSync.status': 'pending', 'storeDetails.address': 'Different saved store address 456' } });
  await ship(order).expect(200);
  const after = (await Order.findById(order._id)).shiprocket.toObject();
  expect(after.pickupLocation).toBe(before.pickupLocation); expect(after.pickupAddress).toEqual(before.pickupAddress); expect(createShiprocketOrder).toHaveBeenCalledTimes(1);
});
