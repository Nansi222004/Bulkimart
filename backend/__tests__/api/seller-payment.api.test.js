import { jest } from '@jest/globals';
import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';

// Prevent product tests from invoking Cloudinary. Only the upload boundary is
// mocked; product validation, ownership, persistence, routes, and auth remain real.
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({
  uploadToCloudinary: jest.fn(async () => 'https://test.invalid/product.png'),
}));

process.env.PHONEPE_WEBHOOK_USERNAME = 'integration-user';
process.env.PHONEPE_WEBHOOK_SECRET = 'integration-secret';
process.env.PHONEPE_MOCK = 'true';

const [{ default: authRoutes }, { default: productRoutes }, { default: paymentRoutes },
  { errorHandler }, { default: User }, { default: Seller }, { default: Category },
  { default: Product }, { default: Payment }, { default: Order }, { JWT_SECRET }] = await Promise.all([
  import('../../routes/auth.routes.js'),
  import('../../routes/product.routes.js'),
  import('../../routes/payment.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../models/User.js'),
  import('../../models/Seller.js'),
  import('../../models/Category.js'),
  import('../../models/Product.js'),
  import('../../models/Payment.js'),
  import('../../models/Order.js'),
  import('../../config/jwt.js'),
]);

let replSet;
let app;
let sellerUser;
let otherSellerUser;
let seller;
let otherSeller;
let category;
let sellerToken;
let otherSellerToken;
let buyer;
let buyerToken;
let dbReady = false;

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const tokenFor = (id, role = undefined) => jwt.sign({ id: String(id), type: 'user', ...(role ? { role } : {}) }, JWT_SECRET);

beforeAll(async () => {
  // A local one-node replica set is needed for real Mongo transaction behavior
  // in payment settlement. No process/database URI is read from environment.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const isolatedUri = replSet.getUri('bulkimart_seller_payment_test');
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):/.test(isolatedUri)) {
    throw new Error('Integration tests refused a non-local MongoDB URI.');
  }
  await mongoose.connect(isolatedUri, { autoIndex: true });
  dbReady = true;

  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use(errorHandler);

  [sellerUser, otherSellerUser, buyer] = await User.create([
    { phone: '9200000001', name: 'Integration Seller', roles: ['buyer', 'seller'] },
    { phone: '9200000002', name: 'Other Integration Seller', roles: ['buyer', 'seller'] },
    { phone: '9200000003', name: 'Integration Buyer', roles: ['buyer'] },
  ]);
  [seller, otherSeller] = await Seller.create([
    { userId: sellerUser._id, businessName: 'Seller One', status: 'approved', storeDetails: { name: 'Seller One' } },
    { userId: otherSellerUser._id, businessName: 'Seller Two', status: 'approved', storeDetails: { name: 'Seller Two' } },
  ]);
  category = await Category.create({ name: 'Integration Leaf', type: 'ecommerce', isActive: true });
  sellerToken = tokenFor(sellerUser._id, 'seller');
  otherSellerToken = tokenFor(otherSellerUser._id, 'seller');
  buyerToken = tokenFor(buyer._id);
}, 300_000);

afterEach(async () => {
  if (!dbReady) return;
  await Promise.all([
    Product.deleteMany({}),
    Payment.deleteMany({}),
    Order.deleteMany({}),
  ]);
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

describe('seller authentication and product API', () => {
  test('seller OTP login requires a registered user and a valid mock OTP', async () => {
    await request(app).post('/api/auth/seller/send-otp').send({ phone: '9299999999' }).expect(404);
    const sent = await request(app).post('/api/auth/seller/send-otp').send({ phone: sellerUser.phone }).expect(200);
    expect(sent.body.otp).toBe('1234');
    await request(app).post('/api/auth/seller/verify-otp')
      .send({ phone: sellerUser.phone, otp: '0000' }).expect(400);
    const verified = await request(app).post('/api/auth/seller/verify-otp')
      .send({ phone: sellerUser.phone, otp: '1234' }).expect(200);
    expect(verified.body.token).toBeTruthy();
    await request(app).get('/api/products/seller/mine').set(auth(verified.body.token)).expect(200);
  });

  test('registered seller list path, product creation, variant validation, and ownership isolation work', async () => {
    await request(app).get('/api/products/seller/mine').expect(401);
    await request(app).get('/api/products/seller/mine').set(auth(buyerToken)).expect(403);

    const created = await request(app).post('/api/products').set(auth(sellerToken))
      .field('type', 'ecommerce')
      .field('name', 'Integration Product')
      .field('category', String(category._id))
      .field('variants', JSON.stringify([
        { name: 'Small', price: 20, mrp: 25, stock: 7, unit: 'piece' },
        { name: 'Large', price: 35, mrp: 40, stock: 3, unit: 'piece' },
      ]))
      .attach('images', Buffer.from('test-image'), { filename: 'product.png', contentType: 'image/png' })
      .expect(201);

    const productId = created.body.product._id;
    expect(created.body.product.variants).toHaveLength(2);
    expect(created.body.product.stock).toBe(7); // root stock mirrors primary variant
    const mine = await request(app).get('/api/products/seller/mine').set(auth(sellerToken)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]._id).toBe(productId);

    await request(app).put(`/api/products/${productId}`).set(auth(otherSellerToken))
      .send({ name: 'Stolen edit' }).expect(403);
    await request(app).put(`/api/products/${productId}`).set(auth(sellerToken))
      .send({ variants: [{ name: 'Invalid', price: 30, mrp: 20, stock: 1, unit: 'piece' }] })
      .expect(400);

    const persisted = await Product.findById(productId).lean();
    expect(persisted.name).toBe('Integration Product');
    expect(persisted.sellerId.toString()).toBe(seller._id.toString());
  });

  test('bulk upload endpoint rejects malformed workbook input without changing catalog', async () => {
    await request(app).post('/api/products/bulk/upload').set(auth(sellerToken))
      .attach('excelFile', Buffer.from('not an xlsx file'), { filename: 'bad.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      .expect(400);
    expect(await Product.countDocuments({})).toBe(0);
  });
});

describe('signed PhonePe webhook route', () => {
  const signature = () => `SHA256 ${crypto.createHash('sha256').update('integration-user:integration-secret').digest('hex')}`;

  test('rejects missing/invalid signatures and accepts a valid signed event idempotently', async () => {
    const payment = await Payment.create({
      userId: buyer._id,
      amount: 50,
      method: 'online',
      status: 'pending',
      gateway: { provider: 'phonepe', merchantOrderId: 'TEST-MERCHANT-ORDER-1' },
    });
    const payload = { event: 'checkout.order.completed', payload: { merchantOrderId: 'TEST-MERCHANT-ORDER-1', orderId: 'TEST-GATEWAY-1' } };

    await request(app).post('/api/payments/webhook').send(payload).expect(401);
    await request(app).post('/api/payments/webhook').set('Authorization', 'SHA256 invalid').send(payload).expect(401);
    expect((await Payment.findById(payment._id)).status).toBe('pending');

    await request(app).post('/api/payments/webhook').set('Authorization', signature()).send(payload).expect(200);
    expect((await Payment.findById(payment._id)).status).toBe('paid');
    await request(app).post('/api/payments/webhook').set('Authorization', signature()).send(payload).expect(200);
    expect((await Payment.findById(payment._id)).status).toBe('paid');
  });

  test('mock payment initiation creates a redirect only for the authenticated order owner', async () => {
    const order = await Order.create({
      userId: buyer._id,
      type: 'ecommerce',
      items: [],
      pricing: { subtotal: 50, totalAmount: 50 },
      status: 'placed',
      paymentMethod: 'online',
    });
    const payment = await Payment.create({ userId: buyer._id, orderId: order._id, amount: 50, method: 'online', status: 'pending' });
    order.paymentId = payment._id;
    await order.save();

    await request(app).post('/api/payments/initiate').set(auth(tokenFor(sellerUser._id)))
      .send({ orderId: order._id }).expect(403);
    const initiated = await request(app).post('/api/payments/initiate').set(auth(buyerToken))
      .send({ orderId: order._id }).expect(200);
    expect(initiated.body.data.redirectUrl).toContain('mock-phonepe');
    expect((await Payment.findById(payment._id)).attempts).toBe(1);
  });
});
