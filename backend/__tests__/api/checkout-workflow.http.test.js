import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

const shopper = { _id: new mongoose.Types.ObjectId(), phone: '9400000001', roles: ['buyer'], isActive: true };
const sellerId = new mongoose.Types.ObjectId();
const productsByChannel = new Map();
const cartsByChannel = new Map();
const coupons = new Map();
const persistedOrders = [];
const persistedPayments = [];
const ordersById = new Map();
const paymentsById = new Map();
const checkoutAttempts = new Map();
let stockWriteResult = { modifiedCount: 1 };
let checkoutLookupBarrier = null;

const User = { findById: jest.fn(() => ({ select: async () => shopper })), updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
const Cart = {
  findOne: jest.fn(async ({ channel }) => cartsByChannel.get(channel) || null),
  updateOne: jest.fn(async ({ channel }) => {
    const cart = cartsByChannel.get(channel);
    if (cart) cart.items = [];
    return { modifiedCount: cart ? 1 : 0 };
  }),
};
const Product = {
  find: jest.fn(async ({ _id }) => [...productsByChannel.values()].filter((product) => _id.$in.some((id) => String(id) === String(product._id)))),
  findById: jest.fn((id) => ({
    session() { return this; },
    select: async () => [...productsByChannel.values()].find((product) => String(product._id) === String(id)) || null,
  })),
  updateOne: jest.fn(async (filter, update) => {
    const { _id } = filter;
    const product = [...productsByChannel.values()].find((item) => String(item._id) === String(_id));
    if (product && stockWriteResult.modifiedCount === 1) {
      if (Array.isArray(update)) {
        product.stock = product.variants.reduce((sum, variant) => sum + variant.stock, 0);
      } else if (update.$inc?.['variants.$.stock'] !== undefined) {
        const expected = filter.variants.$elemMatch._id;
        const variant = product.variants.find((entry) => String(entry._id) === String(expected));
        if (variant) variant.stock += update.$inc['variants.$.stock'];
      } else if (update.$inc?.stock !== undefined) {
        product.stock += update.$inc.stock;
      }
    }
    return stockWriteResult;
  }),
};
const Seller = {
  updateOne: jest.fn(async () => ({ matchedCount: 1 })),
  findById: jest.fn(() => ({ select() { return this; }, session: async () => ({ _id: sellerId, userId: new mongoose.Types.ObjectId() }) })),
  find: jest.fn(() => ({ select() { return this; }, lean: async () => [{ _id: sellerId, status: 'approved', storeDetails: {} }] })),
};
const Payment = {
  create: jest.fn(async ([data]) => {
    const payment = { ...data, _id: new mongoose.Types.ObjectId() };
    persistedPayments.push(payment);
    paymentsById.set(String(payment._id), payment);
    return [payment];
  }),
  findById: jest.fn((id) => ({ session: async () => paymentsById.get(String(id)) || null })),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};
const CheckoutAttempt = {
  findOne: jest.fn((filter) => ({
    lean: async () => {
      const found = checkoutAttempts.get(`${String(filter.userId)}:${filter.key}`) || null;
      const barrier = checkoutLookupBarrier;
      if (barrier && barrier.arrivals < 2) {
        barrier.arrivals += 1;
        if (barrier.arrivals === 2) barrier.release();
        await barrier.promise;
        if (checkoutLookupBarrier === barrier) checkoutLookupBarrier = null;
      }
      return found;
    },
  })),
  create: jest.fn(async ([data]) => {
    const identity = `${String(data.userId)}:${data.key}`;
    if (checkoutAttempts.has(identity)) {
      const error = new Error('duplicate checkout idempotency key');
      error.code = 11000;
      throw error;
    }
    const attempt = { ...data };
    checkoutAttempts.set(identity, attempt);
    // Deliberately let competing HTTP handlers overlap after the unique-key
    // claim. This tests controller behavior only; MongoDB index semantics are
    // covered only by the separate, currently blocked DB-backed suites.
    await new Promise((resolve) => setTimeout(resolve, 15));
    return [attempt];
  }),
  updateOne: jest.fn(async (filter, update) => {
    const attempt = checkoutAttempts.get(`${String(filter.userId)}:${filter.key}`);
    if (attempt) Object.assign(attempt, update.$set);
    return { modifiedCount: attempt ? 1 : 0 };
  }),
};
const Order = {
  create: jest.fn(async ([data]) => {
    const order = {
      ...data,
      orderNo: `TEST-${persistedOrders.length + 1}`,
      createdAt: new Date(),
      async save() { return this; },
    };
    persistedOrders.push(order);
    ordersById.set(String(order._id), order);
    return [order];
  }),
  findById: jest.fn(async (id) => ordersById.get(String(id)) || null),
  updateOne: jest.fn(async (filter, update) => {
    const order = ordersById.get(String(filter._id));
    if (!order || (filter.status?.$in && !filter.status.$in.includes(order.status)) || (typeof filter.status === 'string' && filter.status !== order.status)) return { modifiedCount: 0 };
    Object.assign(order, update.$set || {});
    if (update.$push?.timeline) order.timeline.push(update.$push.timeline);
    return { modifiedCount: 1 };
  }),
};
const Coupon = {
  findOne: jest.fn(async ({ code }) => coupons.get(code) || null),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};
const CouponRedemption = { create: jest.fn(async () => [{}]) };

jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/Cart.js', () => ({ default: Cart }));
jest.unstable_mockModule('../../models/Product.js', () => ({ default: Product }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: Seller }));
jest.unstable_mockModule('../../models/Payment.js', () => ({ default: Payment }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/CheckoutAttempt.js', () => ({ default: CheckoutAttempt }));
jest.unstable_mockModule('../../models/Coupon.js', () => ({
  default: Coupon,
  DISCOUNT_TYPE: { PERCENTAGE: 'percentage', FIXED: 'fixed', FREE_SHIPPING: 'free_shipping' },
}));
jest.unstable_mockModule('../../models/CouponRedemption.js', () => ({ default: CouponRedemption }));
jest.unstable_mockModule('../../services/campaign.service.js', () => ({
  resolveCampaignPricesForProducts: jest.fn(async () => new Map()),
}));
jest.unstable_mockModule('../../services/geocode.service.js', () => ({
  forwardGeocode: jest.fn(async () => ({ ok: false, message: 'Not geocoded in test' })),
}));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}),
  notifySeller: jest.fn(async () => {}),
  notifyRider: jest.fn(async () => {}),
  notifyAllAdmins: jest.fn(async () => {}),
  registerPushToken: jest.fn(async () => 'web'),
  removePushToken: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_target, key) => String(key) }),
}));
jest.unstable_mockModule('../../services/coin.service.js', () => ({
  getOrCreateWallet: jest.fn(async () => ({ availableCoins: 0 })),
  calculateRedemptionEligibility: jest.fn(() => ({ eligible: false, coinsToUse: 0, coinDiscount: 0 })),
  reserveCoins: jest.fn(async () => {}),
  redeemReservedCoins: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../../services/wallet.service.js', () => ({
  debitWallet: jest.fn(async () => {}),
  refundToWallet: jest.fn(async () => {}),
}));
jest.unstable_mockModule('../../services/returnPolicy.service.js', () => ({
  buildReturnPolicySnapshotsFor: jest.fn(async () => new Map()),
}));
jest.unstable_mockModule('../../services/sameDay.service.js', () => ({
  checkCartSameDayEligibility: jest.fn(async () => ({ available: false, reason: 'Unavailable in test' })),
}));
jest.unstable_mockModule('../../socket/rooms.js', () => ({
  emitToUser: jest.fn(),
  emitToSeller: jest.fn(),
}));

const [{ default: orderRoutes }, { errorHandler }, { JWT_SECRET }, { notifyUser, notifySeller }] = await Promise.all([
  import('../../routes/order.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
  import('../../services/notification.service.js'),
]);

const app = express();
app.use(express.json());
app.use('/api/orders', orderRoutes);
app.use(errorHandler);
const shopperToken = jwt.sign({ id: String(shopper._id), type: 'user' }, JWT_SECRET);
const auth = { Authorization: `Bearer ${shopperToken}`, 'Idempotency-Key': 'checkout-test-key-0001' };
const address = { name: 'Test Shopper', phone: '9400000001', line1: '1 Test Road', city: 'Pune', state: 'MH', pincode: '411001' };

const setCart = (channel, { productType = channel, stock = 10, qty = 2 } = {}) => {
  const productId = new mongoose.Types.ObjectId();
  const product = {
    _id: productId, type: productType, name: `${channel} fixture`, price: 10.25, mrp: 12,
    stock, unit: 'piece', images: ['https://test.invalid/item.png'], category: new mongoose.Types.ObjectId(),
    sellerId, isActive: true, isDeleted: false, status: 'approved',
  };
  productsByChannel.set(channel, product);
  cartsByChannel.set(channel, { userId: shopper._id, channel, items: [{ productId, name: product.name, qty }] });
  return product;
};

beforeEach(() => {
  productsByChannel.clear(); cartsByChannel.clear(); coupons.clear();
  ordersById.clear(); paymentsById.clear();
  checkoutAttempts.clear();
  checkoutLookupBarrier = null;
  persistedOrders.length = 0; persistedPayments.length = 0;
  stockWriteResult = { modifiedCount: 1 };
  jest.clearAllMocks();
  jest.spyOn(mongoose, 'startSession').mockResolvedValue({
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  });
});

afterEach(() => {
  mongoose.startSession.mockRestore();
});

describe('checkout HTTP workflow with mocked persistence', () => {
  test('rejects invalid channel and missing delivery address before writing order or payment', async () => {
    await request(app).post('/api/orders').set(auth).send({ channel: 'quick' }).expect(400);
    await request(app).post('/api/orders').set(auth).send({ channel: 'ecommerce' }).expect(400);
    expect(persistedOrders).toHaveLength(0);
    expect(persistedPayments).toHaveLength(0);
  });

  test.each(['grocery', 'ecommerce'])('%s checkout reads only that channel cart and clears it after placement', async (channel) => {
    const product = setCart(channel);
    const response = await request(app).post('/api/orders').set(auth).send({ channel, shippingAddress: address }).expect(201);

    expect(Cart.findOne).toHaveBeenCalledWith({ userId: shopper._id, channel });
    expect(response.body.data.order.type).toBe(channel);
    expect(response.body.data.order.items[0].productId).toBe(String(product._id));
    expect(response.body.data.order.pricing.cdsDiscount).toBe(0);
    expect(response.body.data.order.pricing.subtotal).toBe(20.5);
    expect(Product.updateOne).toHaveBeenCalledTimes(1);
    expect(product.stock).toBe(8);
    expect(cartsByChannel.get(channel).items).toHaveLength(0);
    expect(notifyUser).toHaveBeenCalledWith(shopper._id, expect.objectContaining({ event: 'ORDER_CREATED' }));
    expect(notifySeller).toHaveBeenCalledWith(String(sellerId), expect.objectContaining({ event: 'ORDER_CREATED' }));
  });

  test('uses coupon service response and refuses an inactive coupon without creating an order', async () => {
    setCart('ecommerce');
    coupons.set('INACTIVE', { _id: new mongoose.Types.ObjectId(), code: 'INACTIVE', isActive: false, minOrderValue: 0 });
    await request(app).post('/api/orders').set(auth)
      .send({ channel: 'ecommerce', shippingAddress: address, coupon: 'INACTIVE' }).expect(400);
    expect(persistedOrders).toHaveLength(0);
    expect(persistedPayments).toHaveLength(0);
  });

  test('applies valid coupon discount using server-side coupon data and rounds totals', async () => {
    setCart('ecommerce');
    coupons.set('SAVE10', {
      _id: new mongoose.Types.ObjectId(), code: 'SAVE10', title: 'Ten percent', isActive: true,
      discountType: 'percentage', value: 10, maxDiscount: 0, minOrderValue: 0,
      channel: 'ecommerce', products: [], sellers: [], categories: [], totalUsageLimit: 0,
      perUserLimit: 0, firstOrderOnly: false,
    });
    const response = await request(app).post('/api/orders').set(auth)
      .send({ channel: 'ecommerce', shippingAddress: address, coupon: 'save10' }).expect(201);
    expect(response.body.data.order.pricing.subtotal).toBe(20.5);
    expect(response.body.data.order.pricing.couponDiscount).toBe(2.05);
    expect(response.body.data.order.pricing.cdsDiscount).toBe(0);
    expect(response.body.data.order.pricing.totalAmount).toBe(58.45);
    expect(CouponRedemption.create).toHaveBeenCalledTimes(1);
  });

  test('rejects unavailable stock before creating payment/order records', async () => {
    setCart('grocery', { stock: 1, qty: 2 });
    await request(app).post('/api/orders').set(auth)
      .send({ channel: 'grocery', shippingAddress: address }).expect(409);
    expect(Product.updateOne).not.toHaveBeenCalled();
    expect(persistedOrders).toHaveLength(0);
    expect(persistedPayments).toHaveLength(0);
  });

  test('variant checkout uses selected variant price/stock and snapshots its identity', async () => {
    const product = setCart('ecommerce', { stock: 99, qty: 2 });
    const variantId = new mongoose.Types.ObjectId();
    product.variants = [
      { _id: variantId, name: '1kg', sku: 'RICE-1K', price: 12.5, mrp: 15, stock: 2, unit: 'kg', weight: 1000, attributes: [{ name: 'Pack', value: '1kg' }] },
      { _id: new mongoose.Types.ObjectId(), name: '5kg', sku: 'RICE-5K', price: 50, mrp: 60, stock: 5, unit: 'kg', weight: 5000, attributes: [] },
    ];
    cartsByChannel.get('ecommerce').items[0].variantId = variantId;

    const response = await request(app).post('/api/orders').set(auth)
      .send({ channel: 'ecommerce', shippingAddress: address }).expect(201);

    expect(response.body.data.order.items[0]).toMatchObject({ variantId: String(variantId), sku: 'RICE-1K', variantName: '1kg', price: 12.5, qty: 2, unitSnapshot: 'kg' });
    expect(product.variants[0].stock).toBe(0);
    expect(product.variants[1].stock).toBe(5);
    expect(product.stock).toBe(5);
  });

  test('cancellation restores the exact ordered variant and recalculates root projection', async () => {
    const product = setCart('grocery', { stock: 9, qty: 1 });
    const variantId = new mongoose.Types.ObjectId();
    product.variants = [{ _id: variantId, name: 'Single', sku: 'MILK-1', price: 8, mrp: 9, stock: 1, unit: 'piece' }, { _id: new mongoose.Types.ObjectId(), name: 'Family', sku: 'MILK-2', price: 15, mrp: 17, stock: 4, unit: 'piece' }];
    cartsByChannel.get('grocery').items[0].variantId = variantId;

    const placed = await request(app).post('/api/orders').set(auth)
      .send({ channel: 'grocery', shippingAddress: address }).expect(201);
    expect(product.variants[0].stock).toBe(0);
    await request(app).patch(`/api/orders/${placed.body.data.order._id}/cancel`).set(auth)
      .send({ reason: 'test restore' }).expect(200);
    expect(product.variants[0].stock).toBe(1);
    expect(product.variants[1].stock).toBe(4);
    expect(product.stock).toBe(5);
  });

  test('a successful retry with the same key returns the original order without repeating writes', async () => {
    setCart('ecommerce');
    const payload = { channel: 'ecommerce', shippingAddress: address };
    const first = await request(app).post('/api/orders').set(auth).send(payload).expect(201);
    const retry = await request(app).post('/api/orders').set(auth).send(payload).expect(201);
    expect(retry.body.data.order._id).toBe(first.body.data.order._id);
    expect(persistedOrders).toHaveLength(1);
    expect(persistedPayments).toHaveLength(1);
    expect(Product.updateOne).toHaveBeenCalledTimes(1);
  });

  test('concurrent duplicate checkouts create one order/payment and deduct stock once', async () => {
    const product = setCart('ecommerce');
    const payload = { channel: 'ecommerce', shippingAddress: address };
    let releaseLookups;
    checkoutLookupBarrier = {
      arrivals: 0,
      promise: new Promise((resolve) => { releaseLookups = resolve; }),
      release: () => releaseLookups(),
    };
    const [first, second] = await Promise.all([
      request(app).post('/api/orders').set(auth).send(payload),
      request(app).post('/api/orders').set(auth).send(payload),
    ]);
    const successful = [first, second].filter((res) => res.status === 201);
    expect(successful).toHaveLength(2);
    expect(first.body.data.order._id).toBe(second.body.data.order._id);
    expect(persistedOrders).toHaveLength(1);
    expect(persistedPayments).toHaveLength(1);
    expect(Product.updateOne).toHaveBeenCalledTimes(1);
    expect(product.stock).toBe(8);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifySeller).toHaveBeenCalledTimes(1);
  });

  test('rejects reusing a checkout key for changed checkout details', async () => {
    setCart('ecommerce');
    await request(app).post('/api/orders').set(auth)
      .send({ channel: 'ecommerce', shippingAddress: address }).expect(201);
    await request(app).post('/api/orders').set(auth)
      .send({ channel: 'ecommerce', shippingAddress: { ...address, line1: 'Different road' } }).expect(409);
    expect(persistedOrders).toHaveLength(1);
    expect(Product.updateOne).toHaveBeenCalledTimes(1);
  });

  test('unrelated duplicate database keys are not misreported as checkout-key reuse', async () => {
    setCart('ecommerce');
    const error = Object.assign(new Error('fixture-only unique index conflict'), { code: 11000, keyPattern: { orderNo: 1 } });
    CheckoutAttempt.create.mockRejectedValueOnce(error);
    const response = await request(app).post('/api/orders').set(auth).send({ channel: 'ecommerce', shippingAddress: address }).expect(409);
    expect(response.body.meta.code).toBe('CHECKOUT_DATA_CONFLICT');
    expect(response.body.message).not.toMatch(/checkout key|different details/i);
    expect(persistedOrders).toHaveLength(0);
  });

  test('repeated cancellation restores stock once and refuses a terminal repeat', async () => {
    const product = setCart('grocery');
    const created = await request(app).post('/api/orders').set(auth)
      .send({ channel: 'grocery', shippingAddress: address }).expect(201);
    const orderId = created.body.data.order._id;
    expect(product.stock).toBe(8);

    await request(app).patch(`/api/orders/${orderId}/cancel`).set(auth).send({ reason: 'Test cancellation' }).expect(200);
    await request(app).patch(`/api/orders/${orderId}/cancel`).set(auth).send({ reason: 'Repeated cancellation' }).expect(400);

    expect(product.stock).toBe(10);
    expect(Product.updateOne).toHaveBeenCalledTimes(2);
    expect(ordersById.get(String(orderId)).status).toBe('cancelled');
  });
});
