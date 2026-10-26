import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import crypto from 'node:crypto';

process.env.PAYMENT_GATEWAY = 'razorpay';
process.env.RAZORPAY_MODE = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_isolated_fixture';
process.env.RAZORPAY_KEY_SECRET = 'isolated-fixture-only';
process.env.RAZORPAY_WEBHOOK_SECRET = 'isolated-webhook-fixture-only';
const gatewayOrders = new Map(), gatewayPayments = new Map(), gatewayRefunds = new Map();
jest.unstable_mockModule('razorpay', () => ({ default: class {
  orders = { create: jest.fn(async value => { const order = { id: `order_${crypto.randomUUID()}`, ...value }; gatewayOrders.set(order.id, order); return order; }), fetchPayments: jest.fn(async id => ({ items: [...gatewayPayments.values()].filter(row => row.order_id === id) })), fetch: jest.fn(async id => gatewayOrders.get(id)), all: jest.fn(async query => ({ items: [...gatewayOrders.values()].filter(row => row.receipt === query.receipt).slice(query.skip,query.skip+query.count) })) };
  payments = { fetch: jest.fn(async id => gatewayPayments.get(id)), refund: jest.fn(async (paymentId, value) => {
    const row = { id: `rfnd_${crypto.randomUUID()}`, payment_id: paymentId, ...value, status: 'processed' };
    gatewayRefunds.set(row.id,row); const payment = gatewayPayments.get(paymentId); if (payment) payment.amount_refunded = (payment.amount_refunded || 0) + value.amount;
    return row;
  }) };
  refunds = { fetch: jest.fn(async id => gatewayRefunds.get(id)), all: jest.fn(async query => ({ items: [...gatewayRefunds.values()].filter(row => row.payment_id === query.payment_id).slice(query.skip,query.skip+query.count) })) };
} }));
jest.unstable_mockModule('../../socket/rooms.js', () => ({ emitToSeller: jest.fn(), emitToUser: jest.fn(), emitToRider: jest.fn() }));

jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({ uploadToCloudinary: jest.fn(async () => 'https://example.invalid/fixture.png'), uploadFileWithMeta: jest.fn(async () => ({ url: 'https://example.invalid/fixture.png' })) }));
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_, key) => String(key) }),
}));
const [{ default: productRoutes }, { default: cartRoutes }, { default: orderRoutes }, { errorHandler },
  { default: User }, { default: Seller }, { default: Product }, { default: Category }, { default: Cart }, { default: Order }, { default: Payment }] = await Promise.all([
  import('../../routes/product.routes.js'), import('../../routes/cart.routes.js'), import('../../routes/order.routes.js'), import('../../middlewares/error.middleware.js'),
  import('../../models/User.js'), import('../../models/Seller.js'), import('../../models/Product.js'), import('../../models/Category.js'), import('../../models/Cart.js'), import('../../models/Order.js'), import('../../models/Payment.js'),
]);
const { default: paymentRoutes } = await import('../../routes/payment.routes.js');
const { protect, requireAdmin, requireSellerSession } = await import('../../middlewares/auth.middleware.js');
const { requireApprovedSeller } = await import('../../middlewares/vendor.middleware.js');
const sellerControllers = await import('../../controllers/seller.controller.js');
const fulfillment = await import('../../controllers/fulfillment.controller.js');
const { decideSellerWholesaleChannel, getCaptureRefundObligations } = await import('../../controllers/admin.controller.js');
const { default: Admin } = await import('../../models/Admin.js');
const recoveryControllers = await import('../../controllers/paymentRecovery.controller.js');
const app = express(); app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer; } })); app.use('/api/products', productRoutes); app.use('/api/cart', cartRoutes); app.use('/api/orders', orderRoutes); app.use('/api/payments', paymentRoutes);
app.post('/api/sellers/wholesale-request', protect, requireSellerSession, requireApprovedSeller, sellerControllers.requestWholesaleChannel);
app.patch('/api/admin/sellers/:id/wholesale', protect, requireAdmin, decideSellerWholesaleChannel);
app.get('/api/admin/payment-refund-obligations', protect, requireAdmin, getCaptureRefundObligations);
app.get('/api/admin/payment-recovery/:paymentId', protect, requireAdmin, recoveryControllers.getPaymentRecovery);
app.get('/api/admin/payment-attempt-recovery', protect, requireAdmin, recoveryControllers.listUnresolvedPaymentAttempts);
app.post('/api/admin/payment-recovery/:paymentId/refund/process', protect, requireAdmin, recoveryControllers.processRefundRecovery);
app.post('/api/admin/payment-recovery/:paymentId/refund/reconcile', protect, requireAdmin, recoveryControllers.processRefundRecovery);
app.post('/api/admin/payment-recovery/:paymentId/attempt/reconcile', protect, requireAdmin, recoveryControllers.reconcilePaymentCreation);
app.get('/api/sellers/orders/:id', protect, requireSellerSession, requireApprovedSeller, sellerControllers.getSellerOrders);
app.patch('/api/sellers/orders/:id/status', protect, requireSellerSession, requireApprovedSeller, sellerControllers.updateOrderStatus);
app.post('/api/sellers/orders/:id/fulfillment/manual', protect, requireSellerSession, requireApprovedSeller, fulfillment.selectManualFulfillment);
app.use(errorHandler);
let db, buyer, vendor, seller, category, product;
const token = (user, role = 'buyer') => jwt.sign({ id: String(user._id), type: 'user', role }, process.env.JWT_SECRET);
const auth = (req, user = buyer, role = 'buyer') => req.set('Authorization', `Bearer ${token(user, role)}`);
const terms = { enabled: true, minimumQuantity: 5, quantityIncrement: 5, priceTiers: [{ minimumQuantity: 5, unitPrice: 80 }, { minimumQuantity: 10, unitPrice: 70 }, { minimumQuantity: 100, unitPrice: 60 }] };
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('isolated_wholesale_tests'));
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  await mongoose.models.CheckoutAttempt.createIndexes();
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  gatewayOrders.clear(); gatewayPayments.clear(); gatewayRefunds.clear();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  buyer = await User.create({ phone: '9800000001', name: 'Fixture Buyer', roles: ['buyer'] });
  vendor = await User.create({ phone: '9800000002', name: 'Fixture Seller', roles: ['buyer', 'seller'] });
  seller = await Seller.create({ userId: vendor._id, status: 'approved', businessName: 'Fixture Store', salesChannels: ['ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } });
  category = await Category.create({ name: 'Fixture leaf', type: 'ecommerce' });
  product = await Product.create({ type: 'ecommerce', name: 'Fixture Beans', category: category._id, sellerId: seller._id, isFeatured: true, variants: [{ name: 'Case', price: 100, mrp: 120, stock: 25, unit: 'pack', weight: 500, wholesalePricing: terms }] });
});

const address = { name: 'Fixture Buyer', phone: '9800000001', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.1, lng: 72.9 };
const addWholesale = (qty = 5) => auth(request(app).post('/api/cart/wholesale')).send({ productId: String(product._id), variantId: String(product.variants[0]._id), qty, price: 1, eligible: true }).expect(response => { if (response.status === 500) throw new Error(response.body.message); });
const quote = () => auth(request(app).get('/api/cart/wholesale')).query({ lat: address.lat, lng: address.lng });
const checkout = (quoteHash, key = 'wholesale-fixture-key-0001', extra = {}) => auth(request(app).post('/api/orders/unified')).set('Idempotency-Key', key).send({ purchaseMode: 'wholesale', shippingAddress: address, paymentMethod: 'cod', quoteHash, ...extra });

const captureEvent = (gateway, id, overrides = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured', ...overrides } } } });
const sendGatewayEvent = (event, signature) => request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature || crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex')).send(event);

describe('order flow acceptance audit', () => {
  const initiateFor = async orderId => (await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(200)).body.data;
  const combinations = [['grocery'], ['ecommerce'], ['wholesale'], ['grocery', 'ecommerce'], ['grocery', 'wholesale'], ['ecommerce', 'wholesale'], ['grocery', 'ecommerce', 'wholesale']];
  const basketQuote = () => auth(request(app).get('/api/cart/unified')).query({ purchaseMode: 'basket', lat: address.lat, lng: address.lng });
  const placeBasket = (quote, key = 'combined-basket-fixture-0001', extra = {}) => auth(request(app).post('/api/orders/unified')).set('Idempotency-Key', key).send({ purchaseMode: 'basket', basketHash: quote.basketHash, quoteHash: quote.quoteHash, shippingAddress: address, paymentMethod: 'cod', ...extra });
  const setupBasket = async (channels = combinations[6], sameVendor = false) => {
    const entries = {};
    for (const [index, channel] of ['grocery', 'ecommerce', 'wholesale'].entries()) {
      const account = sameVendor ? vendor : await User.create({ name: 'Basket seller ' + index, phone: '981234500' + index, roles: ['buyer', 'seller'] });
      const shop = sameVendor ? seller : await Seller.create({ userId: account._id, businessName: 'Basket vendor ' + index, status: 'approved', salesChannels: ['grocery', 'ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } });
      const type = channel === 'grocery' ? 'grocery' : 'ecommerce';
      const cat = await Category.create({ name: 'Basket category ' + channel, type });
      const item = await Product.create({ type, sellingChannels: channel === 'wholesale' ? ['wholesale'] : [type], category: cat._id, sellerId: shop._id, name: 'Basket ' + channel, status: 'approved', isActive: true,
        variants: [{ name: 'Basket pack', price: 100, mrp: 120, stock: 100, unit: 'pack', weight: 500, wholesalePricing: terms }] });
      const qty = channel === 'wholesale' ? 5 : 2;
      entries[channel] = { item, shop, qty };
      if (channels.includes(channel)) await auth(request(app).post(channel === 'wholesale' ? '/api/cart/wholesale' : '/api/cart')).send({ productId: item._id, variantId: item.variants[0]._id, qty }).expect(200);
    }
    return entries;
  };

  const evidence = [];
  afterAll(async () => {
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir('../test-artifacts/order-flow-audit', { recursive: true });
    await writeFile('../test-artifacts/order-flow-audit/http-state.json', JSON.stringify(evidence, null, 2));
  });
  const assertStock = async (entries, purchased) => {
    for (const [channel, entry] of Object.entries(entries)) {
      expect((await Product.findById(entry.item._id)).variants[0].stock).toBe(100 - (purchased.includes(channel) ? entry.qty : 0));
    }
  };
  const assertVisibility = async orders => {
    const history = await auth(request(app).get('/api/orders')).expect(200);
    expect(history.body.data).toHaveLength(orders.length);
    for (const order of orders) {
      await auth(request(app).get('/api/orders/' + order._id)).expect(200);
      const shop = await Seller.findById(order.items[0].sellerId);
      const owner = await User.findById(shop.userId);
      const visible = await auth(request(app).get('/api/sellers/orders/' + order._id), owner, 'seller').expect(200);
      expect(visible.body.data.items.every(item => orders.some(row => row.items.some(i => String(i.productId) === String(item.productId))))).toBe(true);
      const stranger = await User.create({ name: 'Unrelated fixture seller', phone: '97' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), roles: ['buyer', 'seller'] });
      await Seller.create({ userId: stranger._id, businessName: 'Unrelated', status: 'approved' });
      await auth(request(app).get('/api/sellers/orders/' + order._id), stranger, 'seller').expect(404);
    }
  };
  test.each(combinations)('%j insufficient wallet aborts without writes', async (...channels) => {
    // Jest spreads array rows; reconstruct the channel list.
    channels = channels.filter(value => typeof value === 'string');
    const entries = await setupBasket(channels);
    await User.updateOne({ _id: buyer._id }, { $set: { 'wallet.balance': 1 } });
    const q = (await basketQuote().expect(200)).body.data;
    const result = await placeBasket(q, 'audit-insufficient-wallet-0001', { paymentMethod: 'wallet' });
    expect(result.status).toBe(400);
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect(await mongoose.models.WalletLedger.countDocuments()).toBe(0);
    expect((await User.findById(buyer._id)).wallet.balance).toBe(1);
    expect((await Cart.find({ userId: buyer._id })).reduce((n, c) => n + c.items.length, 0)).toBe(channels.length);
    await assertStock(entries, []);
    evidence.push({ case: 'insufficient-wallet', channels, status: result.status, message: result.body.message, orders: 0, payments: 0, wallet: 1, stockUnchanged: true });
  });

  test.each(combinations.map(channels => [channels]))('%j timeout and read-only recovery retain one obligation', async channels => {
    const entries = await setupBasket(channels); const q = (await basketQuote().expect(200)).body.data;
    const key = 'audit-payment-timeout-0001';
    const placed = (await placeBasket(q, key, { paymentMethod: 'online' }).expect(201)).body.data;
    const { getRazorpayClient } = await import('../../services/razorpay.service.js');
    getRazorpayClient().orders.create.mockRejectedValueOnce(new Error('Isolated provider timeout'));
    await auth(request(app).post('/api/payments/initiate')).send({ orderId: placed.orders[0]._id }).expect(503);
    await auth(request(app).post('/api/payments/initiate')).send({ orderId: placed.orders[0]._id }).expect(409);
    const recovered = await auth(request(app).post('/api/orders/checkout-status')).set('Idempotency-Key', key).send({ operation: 'unified' }).expect(200);
    expect(recovered.body.data.orders).toHaveLength(channels.length);
    await placeBasket(q, key, { paymentMethod: 'online' }).expect(201);
    expect(await Order.countDocuments()).toBe(channels.length); expect(await Payment.countDocuments()).toBe(1);
    expect((await Payment.findOne()).gatewayAttempts).toHaveLength(1);
    expect((await Payment.findOne()).gatewayAttempts[0].status).toBe('creation_unknown');
    expect((await Payment.findOne()).captures).toHaveLength(0);
    await assertStock(entries, channels); await assertVisibility(placed.orders);
    evidence.push({ case: 'timeout', channels, orders: channels.length, payments: 1, captures: 0, recovery: recovered.body.data.state, attempt: 'creation_unknown', historyAndSellerOwnership: true });
  });

  test.each(combinations.map(channels => [channels]))('%j failure then capture and duplicate events settle once; cancellation is scoped', async channels => {
    const entries = await setupBasket(channels); const q = (await basketQuote().expect(200)).body.data;
    const placed = (await placeBasket(q, 'audit-failed-payment-0001', { paymentMethod: 'online' }).expect(201)).body.data;
    const gateway = await initiateFor(placed.orders[0]._id);
    const failed = captureEvent(gateway, 'pay_audit_failed', { status: 'failed' }); failed.event = 'payment.failed';
    await sendGatewayEvent(failed).expect(200); await sendGatewayEvent(failed).expect(200);
    expect((await Payment.findOne()).status).not.toBe('paid');
    const next = await initiateFor(placed.orders[0]._id);
    const captured = captureEvent(next, 'pay_audit_success');
    await sendGatewayEvent(captured).expect(200); await sendGatewayEvent(captured).expect(200);
    expect((await Payment.findOne()).status).toBe('paid');
    expect((await Payment.findOne()).captures).toHaveLength(1);
    expect(await Order.countDocuments()).toBe(channels.length); expect(await Payment.countDocuments()).toBe(1);
    await assertStock(entries, channels); await assertVisibility(placed.orders);
    const first = placed.orders[0];
    await auth(request(app).patch('/api/orders/' + first._id + '/cancel')).send({}).expect(200);
    const payment = await Payment.findOne();
    expect(payment.refundObligations).toHaveLength(1);
    expect(payment.refundObligations[0].amountPaise).toBe(Math.round(first.pricing.totalAmount * 100));
    expect(payment.refundObligations[0].status).toBe('pending');
    for (const channel of channels) {
      const entry = entries[channel];
      const cancelled = String(entry.item._id) === String(first.items[0].productId);
      expect((await Product.findById(entry.item._id)).variants[0].stock).toBe(cancelled ? 100 : 100 - entry.qty);
    }
    evidence.push({ case: 'failure-capture-cancel', channels, totals: q.totals, groups: q.groups.map(g => ({ channel: g.channel, salesChannel: g.salesChannel, subtotal: g.subtotal, deliveryCharge: g.deliveryCharge })), orders: channels.length, vendors: channels.length, payments: 1, captures: 1, refundPaise: payment.refundObligations[0].amountPaise, refundStatus: 'pending', historyAndSellerOwnership: true });
  });

  test.each(combinations.filter(channels => channels.length > 1).map(channels => [channels]))('%j same vendor grouping preserves fulfilment boundaries', async channels => {
    const entries = await setupBasket(channels, true); const q = (await basketQuote().expect(200)).body.data;
    expect(q.groups).toHaveLength(channels.length);
    expect(new Set(q.groups.map(g => String(g.seller._id))).size).toBe(1);
    const placed = (await placeBasket(q).expect(201)).body.data;
    expect(placed.orders).toHaveLength(channels.length); await assertStock(entries, channels); await assertVisibility(placed.orders);
    evidence.push({ case: 'same-vendor', channels, vendors: 1, orders: placed.orders.length, payments: await Payment.countDocuments() });
  });

  test.each(combinations.map(channels => [channels]))('%j multiple vendors in one channel create actual group count', async channels => {
    const entries = await setupBasket(channels); const channel = channels[0], entry = entries[channel];
    const account = await User.create({ name: 'Additional audit vendor', phone: '9899000000', roles: ['buyer', 'seller'] });
    const shop = await Seller.create({ userId: account._id, businessName: 'Additional audit store', status: 'approved', salesChannels: ['grocery', 'ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } });
    const item = await Product.create({ type: entry.item.type, category: entry.item.category, sellerId: shop._id, name: 'Additional vendor item', sellingChannels: entry.item.sellingChannels, variants: [{ name: 'Additional pack', price: 50, mrp: 60, stock: 100, unit: 'pack', weight: 500, wholesalePricing: terms }] });
    await auth(request(app).post(channel === 'wholesale' ? '/api/cart/wholesale' : '/api/cart')).send({ productId: item._id, variantId: item.variants[0]._id, qty: entry.qty }).expect(200);
    const q = (await basketQuote().expect(200)).body.data;
    expect(q.groups).toHaveLength(channels.length + 1);
    expect(q.totals.deliveryCharge).toBe(q.groups.reduce((n, g) => n + g.deliveryCharge, 0));
    const placed = (await placeBasket(q).expect(201)).body.data;
    expect(placed.orders).toHaveLength(channels.length + 1); await assertVisibility(placed.orders);
    expect((await Product.findById(item._id)).variants[0].stock).toBe(100 - entry.qty);
    evidence.push({ case: 'additional-vendor', channels, vendors: channels.length + 1, orders: placed.orders.length, totals: q.totals });
  });

});
