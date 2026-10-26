import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Cart from '../models/Cart.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import CheckoutAttempt from '../models/CheckoutAttempt.js';
import { createDigitalOrder } from '../controllers/digitalCommerce.controller.js';
import { abandonCheckoutPayment } from '../controllers/checkoutCancellation.controller.js';
import { errorHandler } from '../middlewares/error.middleware.js';

const app = express(); app.use(express.json());
const asUser = (req, _res, next) => { req.user = { _id: new mongoose.Types.ObjectId(req.get('x-user')) }; next(); };
app.post('/checkout', asUser, createDigitalOrder);
app.post('/orders/:id/abandon', asUser, abandonCheckoutPayment);
app.use(errorHandler);

let db, seller, buyers;
const id = () => new mongoose.Types.ObjectId();
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Order.init(), Payment.init(), CheckoutAttempt.init(), Cart.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  const owner = await User.create({ phone: '9876511001', roles: ['seller'] });
  const sellerId = id(); await Seller.collection.insertOne({ _id: sellerId, userId: owner._id, businessName: 'Book store', status: 'approved', isActive: true });
  seller = await Seller.findById(sellerId);
  buyers = await User.create([{ phone: '9876511002', roles: ['buyer'] }, { phone: '9876511003', roles: ['buyer'] }]);
});

const ebook = async ({ stockTracked, stock }) => {
  const productId = id(), variantId = id();
  await Product.collection.insertOne({
    _id: productId, name: 'Limited book', type: 'ecommerce', fulfillmentType: 'digital', category: id(), sellerId: seller._id,
    status: 'approved', isActive: true, isDeleted: false, images: ['cover.jpg'], price: 99, mrp: 149, stock,
    variants: [{ _id: variantId, name: 'E-book', price: 99, mrp: 149, stock, unit: 'piece', sku: 'EB-1' }],
    digital: { author: 'Author', language: 'English', format: 'pdf', stockTracked, file: { fileId: 'file-1', sha256: 'a'.repeat(64), sizeBytes: 10, status: 'uploaded' } },
  });
  return { productId, variantId };
};
const fillCart = (user, { productId, variantId }) => Cart.collection.insertOne({ userId: user._id, channel: 'ecommerce',
  items: [{ productId, variantId, name: 'Limited book', price: 99, qty: 1, type: 'ecommerce', fulfillmentType: 'digital' }] });
const checkout = (user, key) => request(app).post('/checkout').set('x-user', String(user._id)).set('Idempotency-Key', key).send({ paymentMethod: 'online' });
const copiesLeft = async (productId) => (await Product.findById(productId).lean()).variants[0].stock;

test('a limited e-book reserves its last copy once, then sells out, and a cancelled checkout returns it', async () => {
  const book = await ebook({ stockTracked: true, stock: 1 });
  await fillCart(buyers[0], book); await fillCart(buyers[1], book);

  const first = await checkout(buyers[0], 'checkout-key-first-buyer');
  expect(first.status).toBe(201);
  expect(await copiesLeft(book.productId)).toBe(0);
  const order = await Order.findById(first.body.data.order._id).lean();
  expect(order.items[0].stockReserved).toBe(true);

  const second = await checkout(buyers[1], 'checkout-key-second-buyer');
  expect(second.status).toBe(409);
  expect(second.body.message).toMatch(/sold out/);
  expect(await copiesLeft(book.productId)).toBe(0);

  await request(app).post(`/orders/${order._id}/abandon`).set('x-user', String(buyers[0]._id)).expect(200);
  expect(await copiesLeft(book.productId)).toBe(1);
  await request(app).post(`/orders/${order._id}/abandon`).set('x-user', String(buyers[0]._id)).expect(200);
  expect(await copiesLeft(book.productId)).toBe(1); // a repeated cancel never adds a second copy
});

test('an e-book without a copy limit never touches stock on checkout or cancellation', async () => {
  const book = await ebook({ stockTracked: false, stock: 0 });
  await fillCart(buyers[0], book);
  const res = await checkout(buyers[0], 'checkout-key-unlimited-01');
  expect(res.status).toBe(201);
  const order = await Order.findById(res.body.data.order._id).lean();
  expect(order.items[0].stockReserved).toBeUndefined();
  await request(app).post(`/orders/${order._id}/abandon`).set('x-user', String(buyers[0]._id)).expect(200);
  expect(await copiesLeft(book.productId)).toBe(0);
});
