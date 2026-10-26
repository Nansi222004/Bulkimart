import { jest } from '@jest/globals';
import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';

const previousPaymentEnv = {
  PAYMENT_GATEWAY: process.env.PAYMENT_GATEWAY,
  RAZORPAY_MODE: process.env.RAZORPAY_MODE,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET,
};

process.env.PAYMENT_GATEWAY = 'razorpay';
process.env.RAZORPAY_MODE = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_http';
process.env.RAZORPAY_KEY_SECRET = 'http-payment-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'http-webhook-secret';

let payment;
let order;
const shopperId = new mongoose.Types.ObjectId();
const createRazorpayOrder = jest.fn();
const Payment = {
  findOneAndUpdate: jest.fn(async (_filter, update) => {
    payment.attempts += update.$inc.attempts;
    payment.gatewayAttempts ||= []; payment.gatewayAttempts.push(update.$push.gatewayAttempts);
    return payment;
  }),
  // Honour purpose filters: unrelated domain handlers must see no payment.
  findOne: jest.fn(async filter => filter?.gstAssistanceRequestId || filter?.parcelDeliveryId || filter?.serviceApplicationId || filter?.['advertising.campaignId'] ? null : payment),
  findById: jest.fn(() => ({
    session: async () => payment,
    then: (resolve, reject) => Promise.resolve(payment).then(resolve, reject),
  })),
  updateOne: jest.fn(async (_filter, update) => {
    if (update?.$set?.['gateway.paymentId']) payment.gateway.paymentId = update.$set['gateway.paymentId'];
    if (update?.$set?.gateway) payment.gateway = update.$set.gateway;
    if (update?.$set?.status) payment.status = update.$set.status;
    if (_filter['gatewayAttempts.attemptId']) {
      const attempt = payment.gatewayAttempts.find(row => row.attemptId === _filter['gatewayAttempts.attemptId']);
      for (const [key, value] of Object.entries(update.$set || {})) attempt[key.replace('gatewayAttempts.$.', '')] = value;
    }
  }),
};
const Order = {
  updateMany: jest.fn(async () => ({ modifiedCount: 1 })),
  findOne: jest.fn(() => ({ sort() { return this; }, session: async () => null })),
  findById: jest.fn(() => ({
    session: async () => order,
    then: (resolve, reject) => Promise.resolve(order).then(resolve, reject),
  })),
  find: jest.fn(filter => ({ select: async () => [order], session: async () => filter?.status === 'cancelled' ? [] : [order] })),
};

jest.unstable_mockModule('../../models/Payment.js', () => ({ default: Payment }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../controllers/sellerPromotion.controller.js', () => ({
  settleSellerPromotionPayment: jest.fn(),
}));
jest.unstable_mockModule('../../controllers/packaging.controller.js', () => ({
  settlePackagingOrderPayment: jest.fn(),
}));
jest.unstable_mockModule('../../controllers/wallet.controller.js', () => ({
  settleWalletTopupPayment: jest.fn(),
}));
jest.unstable_mockModule('../../services/coin.service.js', () => ({
  redeemReservedCoins: jest.fn(),
  releaseReservedCoins: jest.fn(),
}));
jest.unstable_mockModule('../../services/razorpay.service.js', () => ({
  validateRazorpayConfig: jest.fn(),
  getRazorpayClient: jest.fn(),
  createRazorpayOrder,
  createRazorpayRefund: jest.fn(),
  getRazorpayPaymentStatus: jest.fn(),
  verifyRazorpayPaymentSignature: jest.fn(),
  verifyRazorpayWebhookSignature: (raw, signature) => {
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(raw).digest('hex');
    return signature === expected;
  },
  parseRazorpayWebhookEvent: (body) => {
    const entity = body.payload?.payment?.entity;
    return {
      kind: body.event === 'payment.captured' ? 'payment_completed'
        : (body.event === 'payment.failed' ? 'payment_failed' : 'unknown'),
      gatewayOrderId: entity?.order_id,
      paymentId: entity?.id,
      amountPaise: entity?.amount,
      currency: entity?.currency,
      paymentDetails: entity ? [{ id: entity.id, status: entity.status }] : [],
    };
  },
}));
jest.unstable_mockModule('../../middlewares/auth.middleware.js', () => ({
  protect: (req, _res, next) => { req.user = { _id: shopperId }; next(); },
}));

const [{ default: paymentRoutes }, { errorHandler }] = await Promise.all([
  import('../../routes/payment.routes.js'),
  import('../../middlewares/error.middleware.js'),
]);

const app = express();
app.use(express.json({
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); },
}));
app.use('/api/payments', paymentRoutes);
app.use(errorHandler);

const signedPost = (body, signature) => request(app)
  .post('/api/payments/razorpay/webhook')
  .set('x-razorpay-signature', signature)
  .send(body);

const signatureFor = (body) => crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
  .update(Buffer.from(JSON.stringify(body)))
  .digest('hex');

beforeEach(() => {
  jest.clearAllMocks();
  payment = {
    _id: new mongoose.Types.ObjectId(),
    orderId: new mongoose.Types.ObjectId(),
    amount: 125,
    status: 'pending',
    gateway: { provider: 'razorpay', orderId: 'order_test_http' },
    attempts: 0,
    async save() { return this; },
  };
  order = {
    _id: payment.orderId,
    orderNo: 'BM-RAZORPAY-1',
    userId: shopperId,
    status: 'placed',
    paymentId: payment._id,
    pricing: { totalAmount: 125 },
  };
  createRazorpayOrder.mockResolvedValue({
    orderId: 'order_test_http', amountPaise: 12500, currency: 'INR', keyId: 'rzp_test_http',
  });
});

afterAll(() => {
  for (const [key, value] of Object.entries(previousPaymentEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('invalid Razorpay webhook signatures cannot mark a payment paid', async () => {
  const body = { event: 'payment.captured', payload: { payment: { entity: {
    id: 'pay_test_http', order_id: 'order_test_http', amount: 12500, currency: 'INR', status: 'captured',
  } } } };
  await signedPost(body, 'invalid').expect(401);
  expect(payment.status).toBe('pending');
  expect(Payment.findOne).not.toHaveBeenCalled();
});

test('staging initiation selects Razorpay and returns only public checkout configuration', async () => {
  const response = await request(app).post('/api/payments/initiate')
    .send({ orderId: String(order._id) })
    .expect(200);
  expect(createRazorpayOrder).toHaveBeenCalledWith(expect.objectContaining({ amountPaise: 12500 }));
  expect(response.body.data).toEqual(expect.objectContaining({
    provider: 'razorpay',
    keyId: 'rzp_test_http',
    razorpayOrderId: 'order_test_http',
  }));
  expect(JSON.stringify(response.body)).not.toContain('http-payment-secret');
  expect(payment.gateway.provider).toBe('razorpay');
});

test('a valid Razorpay webhook settles once and duplicate delivery is idempotent', async () => {
  const body = { event: 'payment.captured', payload: { payment: { entity: {
    id: 'pay_test_http', order_id: 'order_test_http', amount: 12500, currency: 'INR', status: 'captured',
  } } } };
  const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
  const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
  try {
    await signedPost(body, signatureFor(body)).expect(200);
    expect(payment.status).toBe('paid');
    await signedPost(body, signatureFor(body)).expect(200);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(Order.updateMany).toHaveBeenCalledTimes(1);
  } finally {
    startSession.mockRestore();
  }
});

test('pending and unknown Razorpay events never produce a fake paid state', async () => {
  const body = { event: 'payment.authorized', payload: { payment: { entity: {
    id: 'pay_pending', order_id: 'order_test_http', amount: 12500, status: 'authorized',
  } } } };
  await signedPost(body, signatureFor(body)).expect(200);
  expect(payment.status).toBe('pending');
  expect(Order.updateMany).not.toHaveBeenCalled();
});

