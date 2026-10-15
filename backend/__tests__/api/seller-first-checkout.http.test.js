import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';

const checkServiceability = jest.fn(); const createShiprocketOrder = jest.fn(); const assignCourier = jest.fn();
const generateLabel = jest.fn(); const schedulePickup = jest.fn(); const broadcast = jest.fn(async () => {});
jest.unstable_mockModule('../../services/shiprocket.service.js', () => ({
  getShiprocketCapabilities: () => ({ configured: true, quickCommerce: false }),
  checkServiceability, createShiprocketOrder, assignCourier, generateLabel, schedulePickup,
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
const app = express(); app.use(express.json()); app.use('/orders', orderRoutes);
const vendor = express.Router(); vendor.use(protect, requireRole('seller'), requireApprovedSeller);
vendor.patch('/:id/status', updateOrderStatus); vendor.get('/:id/options', fulfillment.getFulfillmentOptions);
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
  await state(order, 'confirmed').expect(200); await state(order, 'preparing').expect(200);
  return Order.findById(order._id);
}
async function cart(channel = 'ecommerce', mode) {
  await Cart.create({ userId: buyer._id, channel, items: [{ productId: product._id, variantId: product.variants[0]._id, sellerId: seller._id, name: 'Fixture', price: 100, qty: 1, ...(mode ? { deliveryMode: mode } : {}) }] });
}
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
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
});
test('seller must accept and prepare before choosing delivery; dispatch cannot skip the choice', async () => {
  const order = await placed(); await sellerAuth(request(app).post('/seller/' + order._id + '/manual')).expect(409);
  await state(order, 'confirmed').expect(200); await state(order, 'preparing').expect(200); await state(order, 'dispatched').expect(409);
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
