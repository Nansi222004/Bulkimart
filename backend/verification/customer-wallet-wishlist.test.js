import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

process.env.PAYMENT_GATEWAY = 'razorpay';
process.env.RAZORPAY_MODE = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_wallet';
process.env.RAZORPAY_KEY_SECRET = 'wallet-test-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'wallet-webhook-secret';
const original = await import('../services/razorpay.service.js');
const create = jest.fn(), live = jest.fn();
jest.unstable_mockModule('../services/razorpay.service.js', () => ({ ...original, createRazorpayOrder: create, getRazorpayPaymentStatus: live }));
const { default: walletRoutes } = await import('../routes/wallet.routes.js');
const { default: wishlistRoutes } = await import('../routes/wishlist.routes.js');
const { razorpayWebhook } = await import('../controllers/payment.controller.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { JWT_SECRET } = await import('../config/jwt.js');
const { default: User } = await import('../models/User.js');
const { default: Product } = await import('../models/Product.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: Ledger } = await import('../models/WalletLedger.js');
const app = express();
app.use(express.json({ verify: (req, _res, raw) => { req.rawBody = raw; } }));
app.use('/api/wallet', walletRoutes); app.use('/api/wishlist', wishlistRoutes);
app.post('/webhook', razorpayWebhook); app.use(errorHandler);
let db, user, other;
const auth = (req, who = user) => req.set('Authorization', 'Bearer ' + jwt.sign({ id: who._id, type: 'user', role: 'buyer' }, JWT_SECRET));
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri()); await Promise.all([User.init(), Payment.init(), Ledger.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  user = await User.create({ phone: '9876500501', name: 'Wallet Buyer', roles: ['buyer'], isActive: true });
  other = await User.create({ phone: '9876500502', name: 'Other Buyer', roles: ['buyer'], isActive: true });
  create.mockResolvedValue({ orderId: 'order_wallet', keyId: 'rzp_test_wallet' });
  live.mockResolvedValue({ state: 'COMPLETED', orderId: 'order_wallet', paymentId: 'pay_wallet', amountPaise: 10025, currency: 'INR', paymentDetails: [] });
});
async function start() {
  const response = await auth(request(app).post('/api/wallet/topup/initiate')).send({ amount: 100.25 });
  expect(response.status).toBe(201); return response.body.data;
}
const signed = checkout => ({ orderId: checkout.orderId, razorpay_order_id: checkout.razorpayOrderId, razorpay_payment_id: 'pay_wallet',
  razorpay_signature: crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update('order_wallet|pay_wallet').digest('hex') });

test('webhook credits an abandoned browser session and rolls back a failed ledger write', async () => {
  const checkout = await start();
  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wallet', order_id: 'order_wallet', status: 'captured', amount: 10025, currency: 'INR', captured: true } } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(event).digest('hex');
  const send = () => request(app).post('/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(event);
  const ledgerWrite = jest.spyOn(Ledger, 'create').mockRejectedValueOnce(new Error('Simulated ledger failure'));
  try { expect((await send()).status).toBe(500); } finally { ledgerWrite.mockRestore(); }
  expect((await User.findById(user._id)).wallet.balance).toBe(0);
  expect((await Payment.findById(checkout.orderId)).status).toBe('pending');
  expect((await send()).status).toBe(200);
  expect((await User.findById(user._id)).wallet.balance).toBe(100.25);
  expect(await Ledger.countDocuments({ userId: user._id })).toBe(1);
});

test('wallet credits only a verified capture, once across repeated verification and webhook', async () => {
  const checkout = await start();
  expect(checkout.verificationPath).toBe('/api/wallet/topup/verify');
  expect((await User.findById(user._id)).wallet.balance).toBe(0);
  const results = await Promise.all([1, 2].map(() => auth(request(app).post('/api/wallet/topup/verify')).send(signed(checkout))));
  for (const response of results) { expect(response.status).toBe(200); expect(response.body.data.status).toBe('paid'); }
  const event = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wallet', order_id: 'order_wallet', status: 'captured', amount: 10025, currency: 'INR', captured: true } } } });
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(event).digest('hex');
  expect((await request(app).post('/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', signature).send(event)).status).toBe(200);
  expect((await User.findById(user._id)).wallet.balance).toBe(100.25);
  expect(await Ledger.countDocuments({ userId: user._id, type: 'WALLET_TOPUP' })).toBe(1);
});

test('wallet rejects another customer, invalid signature and mismatched amount without credit', async () => {
  const checkout = await start();
  expect((await auth(request(app).post('/api/wallet/topup/verify'), other).send(signed(checkout))).status).toBe(404);
  expect((await auth(request(app).post('/api/wallet/topup/verify')).send({ ...signed(checkout), razorpay_signature: 'invalid' })).status).toBe(401);
  live.mockResolvedValue({ state: 'COMPLETED', orderId: 'order_wallet', paymentId: 'pay_wallet', amountPaise: 100, currency: 'INR' });
  expect((await auth(request(app).post('/api/wallet/topup/verify')).send(signed(checkout))).status).toBe(400);
  expect((await User.findById(user._id)).wallet.balance).toBe(0); expect(await Ledger.countDocuments()).toBe(0);
});

test('wallet validates amount limits and does not credit an uncaptured payment', async () => {
  for (const amount of [0, -1, 100001, 1.001, 'invalid']) {
    expect((await auth(request(app).post('/api/wallet/topup/initiate')).send({ amount })).status).toBe(400);
  }
  expect(create).not.toHaveBeenCalled();
  const checkout = await start(); live.mockResolvedValue({ state: 'PENDING', orderId: 'order_wallet', paymentId: 'pay_wallet', amountPaise: 10025, currency: 'INR' });
  const response = await auth(request(app).post('/api/wallet/topup/verify')).send(signed(checkout));
  expect(response.body.data.status).toBe('pending'); expect((await User.findById(user._id)).wallet.balance).toBe(0);
});

test('e-books can be saved, listed with digital stock information, and removed', async () => {
  const id = new mongoose.Types.ObjectId();
  await Product.collection.insertOne({ _id: id, name: 'Saved E-book', type: 'ecommerce', fulfillmentType: 'digital', digital: { stockTracked: false },
    sellingChannels: ['ecommerce'], stock: 0, price: 75, isActive: true, isDeleted: false, status: 'approved' });
  expect((await auth(request(app).post('/api/wishlist/' + id))).status).toBe(200);
  const response = await auth(request(app).get('/api/wishlist'));
  expect(response.body.data.items).toEqual([expect.objectContaining({ name: 'Saved E-book', fulfillmentType: 'digital', inStock: true, available: true })]);
  expect((await auth(request(app).delete('/api/wishlist/' + id))).status).toBe(200);
  expect((await auth(request(app).get('/api/wishlist'))).body.data.count).toBe(0);
});
