// Product GST through the real checkout APIs: server-calculated snapshots on every new order,
// unchanged by later product edits, independent of commission rules.
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { randomUUID } from 'node:crypto';
process.env.PAYMENT_GATEWAY = 'razorpay'; process.env.RAZORPAY_MODE = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_gst_fixture'; process.env.RAZORPAY_KEY_SECRET = 'fixture-razorpay-secret'; process.env.RAZORPAY_WEBHOOK_SECRET = 'fixture-webhook-secret';
const push = jest.fn(async () => ({ success: true }));
jest.unstable_mockModule('../services/fcm.service.js', () => ({ sendPushNotification: push, sendBulkNotification: push }));
jest.unstable_mockModule('../socket/rooms.js', () => ({ emitToSeller: jest.fn(), emitToRider: jest.fn(), emitToUser: jest.fn(), emitToAdmins: jest.fn(), broadcastToRiders: jest.fn() }));
const { default: orderRoutes } = await import('../routes/order.routes.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { requestContext } = await import('../middlewares/requestContext.middleware.js');
const { JWT_SECRET } = await import('../config/jwt.js');
const { default: User } = await import('../models/User.js'); const { default: Seller } = await import('../models/Seller.js');
const { default: Product } = await import('../models/Product.js'); const { default: Cart } = await import('../models/Cart.js');
const { default: Order } = await import('../models/Order.js'); const { default: Payment } = await import('../models/Payment.js');
const { buildCustomerBasket } = await import('../services/customerBasket.service.js');
const { calculateReturnRefund } = await import('../services/return.service.js');
const app = express(); app.use(requestContext); app.use(express.json()); app.use('/api/orders', orderRoutes); app.use(errorHandler);

let db, buyer, seller, otherSeller; const id = () => new mongoose.Types.ObjectId();
const address = { name: 'Fixture Buyer', phone: '9876500000', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.11, lng: 72.91 };
const auth = req => req.set('Authorization', 'Bearer ' + jwt.sign({ id: buyer._id, type: 'user', role: 'buyer' }, JWT_SECRET));
const makeSeller = async (name, phone) => { const user = await User.create({ name, phone, roles: ['buyer', 'seller'], isActive: true }); const sid = id();
  await Seller.collection.insertOne({ _id: sid, userId: user._id, businessName: name, status: 'approved', storeDetails: { name, pincode: '400001', city: 'Mumbai', lat: 19.1, lng: 72.9 }, thirdPartyFulfillment: { enabled: true, shiprocketPickupLocation: 'fixture-pickup' } });
  return Seller.findById(sid); };
// Products go through the real schema (defaults and enums apply), unlike raw fixture inserts.
const makeProduct = (owner, name, price, gst) => Product.create({ sellerId: owner._id, type: 'ecommerce', category: id(), name, price, stock: 20, unit: 'piece', status: 'approved', isActive: true,
  fulfillmentType: 'physical', ...gst, variants: [{ name: 'One', sku: `${name}-1`.replace(/\W/g, ''), price, mrp: price, stock: 20, weight: 500, unit: 'piece' }] });
const fill = async lines => Cart.create({ userId: buyer._id, channel: 'ecommerce', items: lines.map(([product, qty]) => ({ productId: product._id, variantId: product.variants[0]._id, sellerId: product.sellerId, name: product.name, price: product.variants[0].price, qty })) });
const place = (path = '/api/orders/unified', key = randomUUID()) => auth(request(app).post(path)).set('Idempotency-Key', key).send({ shippingAddress: address, channel: 'ecommerce', paymentMethod: 'cod' });
const ordersOf = res => Order.find({ _id: { $in: (res.body.data.orders || [res.body.data.order]).map(o => o._id) } }).sort({ _id: 1 });

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all(Object.values(mongoose.models).map(model => model.init())); await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  buyer = await User.create({ name: 'Fixture Buyer', phone: '9876500000', roles: ['buyer'], wallet: { balance: 100000 }, isActive: true });
  seller = await makeSeller('GST Store', '9876500001'); otherSeller = await makeSeller('Other Store', '9876500002');
});

test('mixed GST rates: basket, orders and payment all use the same server amounts', async () => {
  const amla = await makeProduct(seller, 'Amla', 105, { gstRate: 5 });                                     // legacy: no type saved, read as inclusive
  const cream = await makeProduct(seller, 'Ice cream', 118, { gstRate: 18, gstPriceType: 'inclusive' });
  const plain = await makeProduct(otherSeller, 'Plain', 50, { gstRate: 0, gstPriceType: 'inclusive' });
  await Product.collection.updateOne({ _id: amla._id }, { $unset: { gstPriceType: '' } });
  await fill([[amla, 2], [cream, 1], [plain, 1]]);
  const basket = await buildCustomerBasket({ userId: buyer._id, user: buyer, destination: address });
  expect(basket.totals.productTax).toMatchObject({ sellingPricePaise: 37800, taxableValuePaise: 35000, gstPaise: 2800, grossPaise: 37800, addedGstPaise: 0, includedGstPaise: 2800 });
  const res = await place(); expect(res.status).toBe(201);
  const orders = await ordersOf(res); expect(orders).toHaveLength(2); // one per seller
  const lines = orders.flatMap(o => o.productTax.lines);
  expect(lines.map(l => [l.gstRate, l.gstPriceType, l.gstConfigurationSource, l.taxableValuePaise, l.gstPaise, l.grossPaise]).sort()).toEqual([
    [0, 'inclusive', 'explicit', 5000, 0, 5000], [18, 'inclusive', 'explicit', 10000, 1800, 11800], [5, 'inclusive', 'legacy_inclusive', 20000, 1000, 21000]].sort());
  for (const order of orders) {
    expect(Math.round(order.pricing.subtotal * 100)).toBe(order.productTax.grossPaise);
    expect(order.items.every((item, index) => item.productTax.gstPaise === order.productTax.lines[index].gstPaise)).toBe(true);
    expect(order.productTax.lines.every(line => String(line.sellerId) === String(order.items[0].sellerId))).toBe(true);
  }
  // What the customer is charged reconciles to the GST-inclusive item totals plus delivery.
  const payment = await Payment.findOne({ _id: orders[0].paymentId });
  const charged = orders.reduce((n, o) => n + Math.round(o.pricing.totalAmount * 100), 0);
  expect(Math.round(payment.amount * 100)).toBe(charged);
  expect(charged).toBe(37800 + orders.reduce((n, o) => n + Math.round((o.pricing.deliveryCharge || 0) * 100), 0));
});

test('editing the product afterwards never changes the order; snapshots cannot be rewritten', async () => {
  const cream = await makeProduct(seller, 'Ice cream', 118, { gstRate: 18, gstPriceType: 'inclusive' });
  await fill([[cream, 3]]); const [order] = await ordersOf(await place('/api/orders'));
  const before = JSON.stringify(order.productTax);
  await Product.updateOne({ _id: cream._id }, { gstRate: 5, gstPriceType: 'inclusive', 'variants.0.price': 999 });
  const reread = await Order.findById(order._id); expect(JSON.stringify(reread.productTax)).toBe(before);
  expect(reread.productTax).toMatchObject({ gstPaise: 5400, grossPaise: 35400 });
  await expect(Order.updateOne({ _id: order._id }, { $set: { 'productTax.gstPaise': 0 } })).rejects.toThrow('immutable');
  await expect(Order.updateOne({ _id: order._id }, { $set: { 'items.0.productTax.gstRate': 5 } })).rejects.toThrow('immutable');
  await expect(Order.updateOne({ _id: order._id }, { $set: { 'items.0.price': 1 } })).rejects.toThrow('immutable');
  // The field is immutable: an attempt to change it on a loaded order is ignored, never stored.
  reread.productTax = { ...reread.productTax, gstPaise: 1 }; await reread.save().catch(() => {});
  expect(JSON.stringify((await Order.findById(order._id)).productTax)).toBe(before);
});

test('without a commission rule the order still has its product GST; seller settlement stays blocked', async () => {
  const amla = await makeProduct(seller, 'Amla', 105, { gstRate: 5, gstPriceType: 'inclusive' });
  await fill([[amla, 1]]); const [order] = await ordersOf(await place('/api/orders'));
  expect(order.productTax).toMatchObject({ taxableValuePaise: 10000, gstPaise: 500 });
  const [line] = order.financialSnapshot.lines;
  expect(line).toMatchObject({ blocker: 'No approved enabled commission rule', gstRatePercent: 5, taxableValuePaise: 10000, productGstPaise: 500 });
  expect(line.netPaise).toBeUndefined();
});

test('a product whose GST rate is missing cannot be bought until the seller reviews it', async () => {
  const p = await makeProduct(seller, 'Unrated', 100, { gstRate: 5 });
  await Product.collection.updateOne({ _id: p._id }, { $unset: { gstRate: '' } });
  await fill([[p, 1]]);
  const res = await place('/api/orders');
  expect(res.status).toBe(409); expect(res.body.message).toBe('Product GST rate needs seller review before checkout');
  expect(await Order.countDocuments()).toBe(0);
});

test('a repeated checkout request creates one order with one snapshot', async () => {
  const amla = await makeProduct(seller, 'Amla', 105, { gstRate: 5 });
  await fill([[amla, 1]]); const key = randomUUID();
  const first = await place('/api/orders/unified', key), again = await place('/api/orders/unified', key);
  expect(first.status).toBe(201); expect([200, 201]).toContain(again.status);
  expect(await Order.countDocuments()).toBe(1);
  expect(again.body.data.orders[0].productTax.gstPaise).toBe(500);
});

test('returns refund from the stored snapshot, not the current product, and partial returns add up', async () => {
  const cream = await makeProduct(seller, 'Ice cream', 118, { gstRate: 18, gstPriceType: 'inclusive' });
  await fill([[cream, 3]]); const [order] = await ordersOf(await place('/api/orders'));
  await Product.updateOne({ _id: cream._id }, { gstRate: 0, gstPriceType: 'inclusive' });
  const item = order.items[0], part = (before, quantity) => calculateReturnRefund({ orderItemId: item._id, quantity, refundAllocationStartQuantity: before }, order);
  const one = part(0, 1), two = part(1, 2);
  expect(one.productTax).toMatchObject({ gstRate: 18, gstPriceType: 'inclusive', grossPaise: 11800, taxableValuePaise: 10000, gstPaise: 1800 });
  expect(Math.round((one.refundAmount + two.refundAmount) * 100)).toBe(order.productTax.lines[0].customerPaidPaise);
  expect(one.productTax.gstPaise + two.productTax.gstPaise).toBe(order.productTax.gstPaise);
});

test('prices must include GST: sellers cannot choose exclusive, and a stored exclusive product is held for review', async () => {
  const { validateProductGstInput } = await import('../services/productGst.service.js');
  expect(() => validateProductGstInput({ gstRate: 5, gstPriceType: 'exclusive' })).toThrow('Product prices must include GST');
  expect(validateProductGstInput({ gstRate: '5' })).toEqual({ gstRate: 5, gstPriceType: 'inclusive' });
  await expect(makeProduct(seller, 'Rejected', 100, { gstRate: 5, gstPriceType: 'exclusive' })).rejects.toThrow();
  const p = await makeProduct(seller, 'Legacy exclusive', 100, { gstRate: 5 });
  await Product.collection.updateOne({ _id: p._id }, { $set: { gstPriceType: 'exclusive' } });
  await fill([[p, 1]]);
  const res = await place('/api/orders');
  expect(res.status).toBe(409); expect(res.body.message).toBe('Product GST price type needs seller review before checkout');
});
