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
 * Delivery methods, Phase 1: products carry Easy Ship / Self Delivery, checkout freezes the method
 * on every order and line, and nothing changes for existing products or while the feature is off.
 */
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToUser: jest.fn(), emitToSeller: jest.fn(), emitToRider: jest.fn() }));
jest.unstable_mockModule('../../controllers/deliveryPartner.controller.js', () => ({ broadcastNewOrderToRiders: jest.fn(async () => {}) }));

const [{ default: orderRoutes }, { getSellerOrders }, { updateProduct, getDeliveryMethodOptions }, { getVendorOrdersAdmin }, { protect, requireRole },
  { requireApprovedSeller }, { errorHandler }, { JWT_SECRET }, { buildFulfilmentGroups },
  { default: User }, { default: Seller }, { default: Product }, { default: Cart }, { default: Order }, { default: DeliveryMethodChange }] = await Promise.all([
  import('../../routes/order.routes.js'), import('../../controllers/seller.controller.js'), import('../../controllers/product.controller.js'),
  import('../../controllers/admin.controller.js'), import('../../middlewares/auth.middleware.js'), import('../../middlewares/vendor.middleware.js'),
  import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'), import('../../services/fulfilmentGroups.service.js'),
  import('../../models/User.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Cart.js'),
  import('../../models/Order.js'), import('../../models/DeliveryMethodChange.js'),
]);

const app = express(); app.use(requestContext); app.use(express.json());
app.use('/orders', orderRoutes);
app.get('/seller/orders/:id', protect, requireRole('seller'), requireApprovedSeller, getSellerOrders);
app.get('/seller/delivery-methods', protect, requireRole('seller'), getDeliveryMethodOptions);
app.put('/products/:id', protect, requireRole('seller'), updateProduct);
app.get('/admin/vendor-orders', (req, _res, next) => { req.user = { _id: new mongoose.Types.ObjectId() }; req.userType = 'admin'; next(); }, getVendorOrdersAdmin);
app.use(errorHandler);

let db, buyer, sellerUser, seller;
const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 };
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${jwt.sign({ id: user._id, type: 'user', role }, JWT_SECRET)}`);
const sellerAuth = (req) => auth(req, sellerUser, 'seller');
const checkout = (path, extra = {}) => auth(request(app).post(path)).set('Idempotency-Key', randomUUID()).send({ shippingAddress: address, paymentMethod: 'online', channel: 'ecommerce', ...extra }); // Self Delivery is prepaid only (Phase 2)
const makeProduct = async (extra = {}) => {
  const product = { _id: id(), sellerId: seller._id, type: 'ecommerce', category: id(), name: 'Fixture item', price: 100, stock: 10, isActive: true, status: 'approved',
    fulfillmentType: 'physical', gstRate: 0, images: [], variants: [{ _id: id(), name: 'One pack', sku: `FX-${randomUUID().slice(0, 6)}`, price: 100, mrp: 100, stock: 10, weight: 500, unit: 'piece' }], ...extra };
  await Product.collection.insertOne(product);
  return product;
};
const line = (product) => ({ productId: product._id, variantId: product.variants[0]._id, sellerId: seller._id, name: product.name, price: 100, qty: 1 });
const setFlag = (on) => { if (on) process.env.DELIVERY_METHODS_ENABLED = 'true'; else process.env.DELIVERY_METHODS_ENABLED = 'false'; };

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { setFlag(false); await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  setFlag(false);
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], isActive: true });
  sellerUser = await User.create({ name: 'Fixture Seller', phone: '9876500001', roles: ['buyer', 'seller'], isActive: true });
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: sellerUser._id, businessName: 'Fixture Store', status: 'approved',
    storeDetails: { name: 'Fixture Store', pincode: '400001', city: 'Mumbai', lat: 19.1, lng: 72.9 },
    selfDelivery: { states: ['Maharashtra'] } }); // Self Delivery needs a declared area (Phase 2)
  seller = await Seller.findById(sellerId);
});

test('switched off, an existing product checks out exactly as before and the order is stamped Easy Ship', async () => {
  const product = await makeProduct();
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [line(product)] });
  const groups = await buildFulfilmentGroups({ userId: buyer._id, destination: address });
  // The group key has no method suffix for Easy Ship: identical to every key before this feature.
  expect(groups.groups.map((g) => g.key)).toEqual([`ecommerce:${seller._id}:scheduled`]);
  const res = await checkout('/orders/unified').expect(201);
  const order = await Order.findById(res.body.data.orders[0]._id).lean();
  expect(order).toMatchObject({ deliveryMethod: 'easy_ship', fulfillmentOwner: 'seller' });
  expect(order.items[0].deliveryMethod).toBe('easy_ship');
  expect(order.fulfillment.assignmentPolicy).toBe('seller_after_acceptance');
  await auth(request(app).get('/seller/delivery-methods'), sellerUser, 'seller').expect(200).then((r) => expect(r.body.data.enabled).toBe(false));
});

test('single checkout stamps the method too', async () => {
  const product = await makeProduct({ deliveryMethod: 'self_delivery' });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [line(product)] });
  const res = await checkout('/orders').expect(201);
  const order = await Order.findById(res.body.data.order._id).lean();
  expect(order).toMatchObject({ deliveryMethod: 'self_delivery', fulfillmentOwner: 'seller' });
  expect(order.items[0].deliveryMethod).toBe('self_delivery');
});

test('one seller, two methods: grouped checkout splits into one order per method; single checkout refuses the mix', async () => {
  const easy = await makeProduct({ name: 'Easy item' });
  const self = await makeProduct({ name: 'Self item', deliveryMethod: 'self_delivery' });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [line(easy), line(self)] });
  const refused = await checkout('/orders').expect(409);
  expect(refused.body.message).toMatch(/delivered in different ways/);
  const res = await checkout('/orders/unified').expect(201);
  const orders = await Order.find({ _id: { $in: res.body.data.orders.map((o) => o._id) } }).lean();
  expect(orders.map((o) => o.deliveryMethod).sort()).toEqual(['easy_ship', 'self_delivery']);
  expect(new Set(orders.map((o) => o.groupRef)).size).toBe(1);
  for (const order of orders) expect(order.items.every((item) => item.deliveryMethod === order.deliveryMethod)).toBe(true);
});

test('the frozen method cannot be changed on an existing order', async () => {
  const product = await makeProduct();
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [line(product)] });
  const res = await checkout('/orders/unified').expect(201);
  const orderId = res.body.data.orders[0]._id;
  await Order.updateOne({ _id: orderId }, { $set: { deliveryMethod: 'fbb', fulfillmentOwner: 'bulkimart' } });
  expect(await Order.findById(orderId).lean()).toMatchObject({ deliveryMethod: 'easy_ship', fulfillmentOwner: 'seller' });
  // Changing the product afterwards never touches the placed order either.
  await Product.updateOne({ _id: product._id }, { $set: { deliveryMethod: 'self_delivery' } });
  expect((await Order.findById(orderId).lean()).deliveryMethod).toBe('easy_ship');
});

test('product edit: switching rules, audit trail, and the off switch', async () => {
  const product = await makeProduct();
  const edit = (deliveryMethod, target = product) => sellerAuth(request(app).put(`/products/${target._id}`)).send({ deliveryMethod });

  expect((await edit('self_delivery').expect(400)).body.message).toBe('Only Easy Ship is available right now');
  expect((await Product.findById(product._id).lean()).deliveryMethod).toBeUndefined();

  setFlag(true);
  await edit('self_delivery').expect(200);
  expect((await Product.findById(product._id).lean()).deliveryMethod).toBe('self_delivery');
  expect((await edit('fbb').expect(409)).body.message).toBe('Use "Convert to Fulfilled by Bulkimart", which shows the charges first'); // FBB is always on: conversion is the only way in
  await edit('easy_ship').expect(200);
  expect((await Product.findById(product._id).lean()).deliveryMethod).toBeUndefined();
  const history = await DeliveryMethodChange.find({ productId: product._id }).sort({ createdAt: 1 }).lean();
  expect(history.map((h) => [h.from, h.to, h.source])).toEqual([['easy_ship', 'self_delivery', 'product_edit'], ['self_delivery', 'easy_ship', 'product_edit']]);

  const quick = await makeProduct({ type: 'grocery' });
  expect((await edit('self_delivery', quick).expect(400)).body.message).toBe('Delivery methods apply only to physical E-Commerce products');
});

test('seller order detail and admin monitoring show the method and shipment summary; admin can filter by it', async () => {
  const easy = await makeProduct({ name: 'Easy item' });
  const self = await makeProduct({ name: 'Self item', deliveryMethod: 'self_delivery' });
  await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [line(easy), line(self)] });
  const res = await checkout('/orders/unified').expect(201);
  const selfOrder = (await Order.find({ _id: { $in: res.body.data.orders.map((o) => o._id) } }).lean()).find((o) => o.deliveryMethod === 'self_delivery');

  // Sellers see an online order only once it is paid.
  await mongoose.connection.collection('payments').updateOne({ _id: selfOrder.paymentId }, { $set: { status: 'paid' } });
  const detail = await sellerAuth(request(app).get(`/seller/orders/${selfOrder._id}`)).expect(200);
  expect(detail.body.data.deliveryMethod).toBe('self_delivery');
  expect(detail.body.data.shipment).toMatchObject({ deliveryMethod: 'self_delivery', fulfillmentOwner: 'seller', shippingProvider: null });

  // A Shop All order from before delivery methods existed counts as Easy Ship in the filter.
  await Order.collection.insertOne({ _id: id(), orderNo: 'LEGACY-1', userId: buyer._id, type: 'ecommerce', status: 'placed', items: [{ _id: id(), productId: easy._id, sellerId: seller._id, qty: 1, price: 100 }], createdAt: new Date() });
  const easyRows = (await request(app).get('/admin/vendor-orders?mode=all&deliveryMethod=easy_ship').expect(200)).body.data;
  expect(easyRows.map((o) => o.deliveryMethod)).toEqual(['easy_ship', 'easy_ship']);
  expect(easyRows.map((o) => o.orderNo)).toContain('LEGACY-1');
  const selfRows = (await request(app).get('/admin/vendor-orders?mode=all&deliveryMethod=self_delivery').expect(200)).body.data;
  expect(selfRows.map((o) => String(o._id))).toEqual([String(selfOrder._id)]);
  await request(app).get('/admin/vendor-orders?deliveryMethod=drone').expect(400);
});
