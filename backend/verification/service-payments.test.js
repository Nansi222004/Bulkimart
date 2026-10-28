import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const orders = new Map(), captures = new Map(); let uncertain = false;
const sdk = { orders: {
  create: jest.fn(async input => { const row = { id: `order_service_${orders.size + 1}`, ...input }; orders.set(row.id, row); if (uncertain) throw Error('Synthetic lost acknowledgement'); return row; }),
  fetch: async id => orders.get(id), all: async input => ({ items: [...orders.values()].filter(row => !input.receipt || row.receipt === input.receipt) }),
  fetchPayments: async id => ({ items: [...captures.values()].filter(row => row.order_id === id) }),
}, payments: { fetch: async id => captures.get(id) } };
jest.unstable_mockModule('razorpay', () => ({ default: class { constructor() { return sdk; } } }));
const notify = jest.fn(async () => {});
jest.unstable_mockModule('../services/notification.service.js', () => ({ notifyUser: notify, notifySeller: notify, notifyRider: notify, notifyAllAdmins: notify, NOTIFICATION_EVENT: {} }));
const { serviceRouter } = await import('../routes/serviceManagement.routes.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { razorpayWebhook } = await import('../controllers/payment.controller.js');
const { requireServiceGateway } = await import('../services/servicePaymentPolicy.service.js');
const { default: User } = await import('../models/User.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: Admin } = await import('../models/Admin.js');
const { default: Service } = await import('../models/Service.js');
const { default: Application } = await import('../models/ServiceApplication.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: Ledger } = await import('../models/SellerLedgerEntry.js');
const app = express(); app.use(express.json({ verify: (req, _res, bytes) => { req.rawBody = Buffer.from(bytes); } }));
app.use('/api/services', serviceRouter()); app.use('/api/admin/services', serviceRouter(true)); app.post('/webhook', razorpayWebhook); app.use(errorHandler);
let db, user, other, buyer, admin, service;
const auth = (r, who = user, type = 'user', role = 'seller') => r.set('Authorization', `Bearer ${jwt.sign({ id: String(who._id), type, ...(type === 'user' ? { role } : {}) }, process.env.JWT_SECRET)}`);
const adminAuth = r => auth(r, admin, 'admin', undefined);
const get = async id => (await auth(request(app).get(`/api/services/applications/${id}`)).expect(200)).body.data;
const action = async (id, status, message = 'Synthetic review', expected = 200) => { const a = await get(id); return (await adminAuth(request(app).post(`/api/admin/services/applications/${id}/transition`)).field('version', a.__v).field('status', status).field('message', message).expect(expected)).body.data; };
const submit = () => auth(request(app).post(`/api/services/${service._id}/applications`)).set('Idempotency-Key', crypto.randomUUID()).field('formVersion', service.formVersion).field('serviceVersion', service.__v).field('answers', '{}');
async function billed() { const a = (await submit().expect(201)).body.data; await action(a._id, 'under_review'); return action(a._id, 'awaiting_payment', 'Synthetic fee and refund terms'); }
const pay = (a, body = {}, who = user, key = crypto.randomUUID()) => auth(request(app).post(`/api/services/applications/${a._id}/payment`), who).set('Idempotency-Key', key).send({ feeVersion: a.billing.version, amountPaise: a.billing.amountPaise, acceptTerms: true, ...body });
const capture = (checkout, id = 'pay_service_fixture', amount = checkout.amountPaise) => { const p = { id, order_id: checkout.razorpayOrderId, amount, currency: 'INR', status: 'captured', captured: true, amount_refunded: 0 }; captures.set(id, p); return p; };
const verify = (a, checkout, id = 'pay_service_fixture', signature) => auth(request(app).post('/api/services/payments/verify')).send({ orderId: a._id, razorpay_order_id: checkout.razorpayOrderId, razorpay_payment_id: id, razorpay_signature: signature ?? crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${checkout.razorpayOrderId}|${id}`).digest('hex') });
const webhook = body => { const bytes = JSON.stringify(body); return request(app).post('/webhook').set('Content-Type', 'application/json').set('x-razorpay-signature', crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(bytes).digest('hex')).send(bytes); };
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  await Promise.all([User.init(), Seller.init(), Admin.init(), Service.init(), Application.init(), Payment.init(), Ledger.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  orders.clear(); captures.clear(); uncertain = false; jest.clearAllMocks();
  Object.assign(process.env, { NODE_ENV: 'test', PAYMENT_GATEWAY: 'razorpay', RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_test_service_fixture', RAZORPAY_KEY_SECRET: 'isolated-service-secret', RAZORPAY_WEBHOOK_SECRET: 'isolated-service-webhook' });
  delete process.env.DEPLOYMENT_ENV;
  [user, other, buyer] = await User.create([{ phone: '9876500781', roles: ['seller'] }, { phone: '9876500782', roles: ['seller'] }, { phone: '9876500783', roles: ['buyer'] }]);
  await Seller.create([{ userId: user._id, businessName: 'Fixture seller', status: 'approved' }, { userId: other._id, businessName: 'Other fixture seller', status: 'approved' }]);
  const id = new mongoose.Types.ObjectId(); await Admin.collection.insertOne({ _id: id, role: 'superAdmin', isActive: true, email: 'service-fixture@example.test' }); admin = await Admin.findById(id);
  service = await Service.create({ name: 'Fixture service', slug: 'fixture-service', status: 'published', pricing: { mode: 'fixed', amount: 100, currency: 'INR' }, fields: [{ id: 'optional', label: 'Optional answer', type: 'text' }] });
});

test('submission with omitted optional answers returns a renderable detail and an admin request creates the frozen fee', async () => {
  const a = await billed(); expect(a.answers).toEqual({}); expect((await get(a._id)).answers).toEqual({});
  expect(a.billing).toMatchObject({ amountPaise: 10000, version: 1, status: 'unpaid', terms: 'Synthetic fee and refund terms' });
  await Service.updateOne({ _id: service._id }, { $set: { 'pricing.amount': 900 } });
  const key = crypto.randomUUID(), checkout = (await pay(a, {}, user, key).expect(200)).body.data;
  expect(checkout).toMatchObject({ amountPaise: 10000, currency: 'INR', verificationPath: '/api/services/payments/verify' });
  expect((await pay(a, {}, user, key).expect(200)).body.data.razorpayOrderId).toBe(checkout.razorpayOrderId);
  expect(sdk.orders.create).toHaveBeenCalledTimes(1);
  capture(checkout); await verify(a, checkout).expect(200); await verify(a, checkout).expect(200);
  expect((await get(a._id)).status).toBe('payment_verified'); expect(await Ledger.countDocuments({ account: 'service_collections' })).toBe(1);
  await action(a._id, 'in_progress'); await action(a._id, 'completed');
});

test('unpaid fixed services cannot start, and clients cannot change the fee, terms version, or owner', async () => {
  const a = (await submit().expect(201)).body.data; await action(a._id, 'under_review');
  await action(a._id, 'in_progress', 'Cannot start unpaid work', 409);
  const bill = await action(a._id, 'awaiting_payment');
  for (const patch of [{ amountPaise: 1 }, { feeVersion: 999 }, { acceptTerms: false }]) await pay(bill, patch).expect(409);
  await pay(bill, {}, other).expect(404);
  await auth(request(app).post(`/api/services/applications/${a._id}/payment`), buyer, 'user', 'buyer').send({}).expect(403);
  expect(await Payment.countDocuments()).toBe(0);
});

test('payment requires a valid signature and independently verified amount; a pending checkout is not paid', async () => {
  const a = await billed(), checkout = (await pay(a).expect(200)).body.data;
  await auth(request(app).post(`/api/services/applications/${a._id}/payment-status`)).send({}).expect(200).expect(r => expect(r.body.data.status).toBe('pending'));
  capture(checkout); captures.get('pay_service_fixture').status = 'authorized';
  await verify(a, checkout).expect(200).expect(r => expect(r.body.data.status).toBe('pending'));
  captures.get('pay_service_fixture').status = 'captured';
  await verify(a, checkout, 'pay_service_fixture', 'invalid').expect(401);
  captures.get('pay_service_fixture').amount = 1; await verify(a, checkout).expect(409);
  expect(await Ledger.countDocuments()).toBe(0); expect((await get(a._id)).status).toBe('awaiting_payment');
});

test('an uncertain checkout recovers the existing provider order and signed webhooks verify payment once', async () => {
  const a = await billed(); uncertain = true;
  await pay(a).expect(503); await pay(a).expect(409); expect(sdk.orders.create).toHaveBeenCalledTimes(1);
  uncertain = false;
  await auth(request(app).post(`/api/services/applications/${a._id}/payment-status`)).send({}).expect(200);
  const checkout = (await pay(a).expect(200)).body.data; const p = capture(checkout);
  const body = { event: 'payment.captured', payload: { payment: { entity: p } } };
  await webhook(body).expect(200); await webhook(body).expect(200);
  expect((await get(a._id)).billing.status).toBe('paid'); expect(await Ledger.countDocuments()).toBe(1);
});

test('extra captures create a refund obligation and financial hold instead of authorizing more work', async () => {
  const a = await billed(), checkout = (await pay(a).expect(200)).body.data;
  capture(checkout); await verify(a, checkout).expect(200);
  const extra = capture(checkout, 'pay_extra_fixture'); await webhook({ event: 'payment.captured', payload: { payment: { entity: extra } } }).expect(200);
  expect((await get(a._id)).billing.reviewRequired).toBe(true);
  expect((await Payment.findOne({ serviceApplicationId: a._id })).refundObligations).toHaveLength(1);
  await action(a._id, 'in_progress', 'Held payment', 409);
});

test('provider refund evidence is posted once and blocks processing without losing the original collection', async () => {
  const a = await billed(), checkout = (await pay(a).expect(200)).body.data;
  capture(checkout); await verify(a, checkout).expect(200);
  captures.get('pay_service_fixture').amount_refunded = 5000;
  const body = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_fixture', payment_id: 'pay_service_fixture', amount: 5000, currency: 'INR', status: 'processed' } } } };
  await webhook(body).expect(200); await webhook(body).expect(200);
  expect((await get(a._id)).billing).toMatchObject({ status: 'partial_refund', reviewRequired: true, refundedPaise: 5000 });
  expect(await Ledger.countDocuments()).toBe(2);
});

test('live service payments require production mode and matching configured keys; old test payments cannot cross environments', async () => {
  const a = await billed(); await pay(a).expect(200);
  process.env.DEPLOYMENT_ENV = 'production'; expect(() => requireServiceGateway()).toThrow(/live mode/);
  process.env.RAZORPAY_MODE = 'live'; expect(() => requireServiceGateway()).toThrow(/not configured/);
  process.env.RAZORPAY_KEY_ID = 'rzp_live_isolated_fixture'; expect(() => requireServiceGateway()).not.toThrow();
  await pay(a).expect(409);
});
