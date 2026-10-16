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
const gatewayOrders = new Map(), gatewayPayments = new Map();
jest.unstable_mockModule('razorpay', () => ({ default: class {
  orders = { create: jest.fn(async value => { const order = { id: `order_${crypto.randomUUID()}`, ...value }; gatewayOrders.set(order.id, order); return order; }), fetchPayments: jest.fn(async () => ({ items: [] })) };
  payments = { fetch: jest.fn(async id => gatewayPayments.get(id)), refund: jest.fn(async () => ({ id: 'fixture_refund', status: 'processed' })) };
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
const { decideSellerWholesaleChannel } = await import('../../controllers/admin.controller.js');
const { default: Admin } = await import('../../models/Admin.js');
const app = express(); app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer; } })); app.use('/api/products', productRoutes); app.use('/api/cart', cartRoutes); app.use('/api/orders', orderRoutes); app.use('/api/payments', paymentRoutes);
app.post('/api/sellers/wholesale-request', protect, requireSellerSession, requireApprovedSeller, sellerControllers.requestWholesaleChannel);
app.patch('/api/admin/sellers/:id/wholesale', protect, requireAdmin, decideSellerWholesaleChannel);
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
  gatewayOrders.clear(); gatewayPayments.clear();
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  buyer = await User.create({ phone: '9800000001', name: 'Fixture Buyer', roles: ['buyer'] });
  vendor = await User.create({ phone: '9800000002', name: 'Fixture Seller', roles: ['buyer', 'seller'] });
  seller = await Seller.create({ userId: vendor._id, status: 'approved', businessName: 'Fixture Store', salesChannels: ['ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } });
  category = await Category.create({ name: 'Fixture leaf', type: 'ecommerce' });
  product = await Product.create({ type: 'ecommerce', name: 'Fixture Beans', category: category._id, sellerId: seller._id, isFeatured: true, variants: [{ name: 'Case', price: 100, mrp: 120, stock: 25, unit: 'pack', weight: 500, wholesalePricing: terms }] });
});

describe('wholesale seller decisions', () => {
  const adminAuth = async req => {
    const admin = await Admin.create({ email: `fixture-${crypto.randomUUID()}@example.invalid`, password: 'FixturePasswordOnly', role: 'superAdmin' });
    return { req: req.set('Authorization', `Bearer ${jwt.sign({ id: String(admin._id), type: 'admin' }, process.env.JWT_SECRET)}`) };
  };
  test('request, rejection, resubmission, approval, suspension and restoration persist without changing retail channels', async () => {
    await Seller.updateOne({ _id: seller._id }, { $set: { salesChannels: ['ecommerce'], wholesaleChannel: { status: 'not_requested' } } });
    await auth(request(app).post('/api/sellers/wholesale-request'), vendor, 'seller').send({}).expect(202);
    await auth(request(app).post('/api/sellers/wholesale-request'), vendor, 'seller').send({}).expect(202);
    for (const status of ['rejected', 'approved', 'suspended', 'approved']) {
      let current = await Seller.findById(seller._id);
      if (current.wholesaleChannel.status === 'rejected') await auth(request(app).post('/api/sellers/wholesale-request'), vendor, 'seller').send({}).expect(202);
      current = await Seller.findById(seller._id);
      const req = request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`);
      await (await adminAuth(req)).req.send({ status, version: current.__v, rejectionReason: 'Fixture review', suspensionReason: 'Fixture review' }).expect(200);
      const updated = await Seller.findById(seller._id);
      expect(updated.wholesaleChannel.status).toBe(status); expect(updated.salesChannels).toContain('ecommerce');
      expect(updated.salesChannels.includes('wholesale')).toBe(status === 'approved');
    }
    expect(await Seller.countDocuments({ userId: vendor._id })).toBe(1);
  });
  test('stale decisions reject; notification failure cannot undo approval', async () => {
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'pending' } });
    const version = (await Seller.findById(seller._id)).__v;
    const { notifySeller } = await import('../../services/notification.service.js');
    notifySeller.mockRejectedValueOnce(new Error('Fixture notification unavailable'));
    await (await adminAuth(request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`))).req.send({ status: 'approved', version }).expect(200);
    await (await adminAuth(request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`))).req.send({ status: 'rejected', version }).expect(409);
    expect((await Seller.findById(seller._id)).wholesaleChannel.status).toBe('approved');
  });
});

describe('wholesale payment via the real Razorpay service with a mocked SDK', () => {
  const onlineOrder = async () => {
    await addWholesale().expect(200);
    const q = (await quote()).body.data;
    const result = await checkout(q.quoteHash, 'online-wholesale-fixture-0001', { paymentMethod: 'online' }).expect(201);
    const order = await Order.findById(result.body.data.orders[0]._id);
    const initiated = await auth(request(app).post('/api/payments/initiate')).send({ orderId: order._id }).expect(200);
    return { order, gateway: initiated.body.data };
  };
  test('provider amount is authoritative, invalid signatures fail and captured payment settles once', async () => {
    const { order, gateway } = await onlineOrder();
    expect(gatewayOrders.get(gateway.razorpayOrderId).amount).toBe(Math.round(order.pricing.totalAmount * 100));
    const body = { orderId: String(order._id), razorpay_order_id: gateway.razorpayOrderId, razorpay_payment_id: 'pay_fixture', razorpay_signature: 'invalid' };
    await auth(request(app).post('/api/payments/razorpay/verify')).send(body).expect(401);
    gatewayPayments.set('pay_fixture', { id: 'pay_fixture', order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured' });
    body.razorpay_signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${gateway.razorpayOrderId}|pay_fixture`).digest('hex');
    await auth(request(app).post('/api/payments/razorpay/verify')).send(body).expect(200);
    const webhook = { event: 'payment.captured', payload: { payment: { entity: gatewayPayments.get('pay_fixture') } } };
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(webhook)).digest('hex');
    await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', 'invalid').send(webhook).expect(401);
    await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature).send(webhook).expect(200);
    await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature).send(webhook).expect(200);
    expect((await Payment.findById(order.paymentId)).status).toBe('paid');
    expect((await Order.findById(order._id)).timeline.filter(entry => entry.note === 'Online payment verified')).toHaveLength(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
  });
  test('failed payment remains unpaid, can retry initiation and restores stock on cancellation', async () => {
    const { order, gateway } = await onlineOrder();
    const event = { event: 'payment.failed', payload: { payment: { entity: { id: 'pay_failed_fixture', order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'failed' } } } };
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex');
    await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature).send(event).expect(200);
    expect((await Payment.findById(order.paymentId)).status).toBe('failed');
    const retried = await auth(request(app).post('/api/payments/initiate')).send({ orderId: order._id }).expect(200);
    expect(retried.body.data.razorpayOrderId).not.toBe(gateway.razorpayOrderId);
    await auth(request(app).patch(`/api/orders/${order._id}/cancel`)).send({ reason: 'Fixture cancellation' }).expect(200);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
  });
});

describe('wholesale security against real models and query projections', () => {
  test('grocery and category results use the same safe retail serialization', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { type: 'grocery' } });
    for (const url of ['/api/products/grocery', `/api/products?type=grocery&category=${category._id}`]) {
      const response = await request(app).get(url).expect(200);
      expect(JSON.stringify(response.body)).toContain('Fixture Beans');
      expect(JSON.stringify(response.body)).not.toMatch(/wholesalePricing|priceTiers/);
    }
    const { publicProduct } = await import('../../utils/publicProduct.js');
    const serialized = publicProduct({ _id: product._id, price: 100, variants: [{ price: 100, wholesalePricing: terms, wholesaleEligibility: true }], digital: { author: 'Fixture author', file: { fileId: 'synthetic-private-file', sha256: 'synthetic-hash' } }, wholesaleChannel: 'approved' });
    expect(JSON.stringify(serialized)).not.toMatch(/wholesale|fileId|sha256|synthetic-private/);
    expect(serialized.price).toBe(100); expect(serialized.digital.author).toBe('Fixture author');
  });
  test.each(['approved', 'suspended', 'rejected'])('public retail APIs never disclose terms for %s wholesale seller', async status => {
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': status } });
    for (const url of ['/api/products?type=ecommerce', '/api/products/featured?type=ecommerce', '/api/products/search?q=Fixture&type=ecommerce', `/api/products/${product._id}`]) {
      for (const authenticated of [false, true]) {
        const req = request(app).get(url); if (authenticated) auth(req);
        const response = await req.expect(200);
        expect(JSON.stringify(response.body)).not.toMatch(/wholesalePricing|priceTiers|wholesaleChannel|fileId|sha256/);
        expect(JSON.stringify(response.body)).toContain('Fixture Beans');
      }
    }
  });
  test.each(['incomplete', 'pending', 'under_review', 'rejected', 'suspended'])('%s seller cannot upload, edit or publish products', async status => {
    await Seller.updateOne({ _id: seller._id }, { $set: { status } });
    const csv = Buffer.from('Product Name,Price,MRP,Stock,Category\nBlocked Fixture,100,120,10,Fixture leaf\n');
    await auth(request(app).post('/api/products/bulk/upload'), vendor, 'seller').attach('excelFile', csv, 'fixture.csv').expect(403);
    await auth(request(app).post('/api/products'), vendor, 'seller').send({}).expect(403);
    await auth(request(app).put(`/api/products/${product._id}`), vendor, 'seller').send({ name: 'Blocked' }).expect(403);
    await auth(request(app).patch(`/api/products/${product._id}/channels`), vendor, 'seller').send({ type: 'grocery', isActive: true }).expect(403);
    expect(await Product.countDocuments()).toBe(1);
  });
  test('approved seller bulk import remains available without granting wholesale approval', async () => {
    await Seller.updateOne({ _id: seller._id }, { $set: { salesChannels: ['ecommerce'], 'wholesaleChannel.status': 'pending' } });
    const csv = Buffer.from('Product Name,Price,MRP,Stock,Category\nImported Fixture,100,120,10,Fixture leaf\n');
    const response = await auth(request(app).post('/api/products/bulk/upload'), vendor, 'seller').attach('excelFile', csv, 'fixture.csv').expect(200);
    expect(response.body.successCount).toBe(1);
    expect((await Seller.findById(seller._id)).wholesaleChannel.status).toBe('pending');
  });
});

describe('wholesale catalog and numeric boundaries', () => {
  test('multiple valid variants survive; unavailable, digital and inactive-category offers are excluded', async () => {
    product.variants.push({ name: 'Alternate case', price: 110, mrp: 120, stock: 10, unit: 'pack', wholesalePricing: terms });
    await product.save();
    expect((await auth(request(app).get('/api/products/wholesale/catalog'))).body.data[0].variants).toHaveLength(2);
    await Category.updateOne({ _id: category._id }, { $set: { isActive: false } });
    expect((await auth(request(app).get('/api/products/wholesale/catalog'))).body.data).toHaveLength(0);
    await Category.updateOne({ _id: category._id }, { $set: { isActive: true } });
    await Product.collection.updateOne({ _id: product._id }, { $set: { fulfillmentType: 'digital' } });
    expect((await auth(request(app).get('/api/products/wholesale/catalog'))).body.data).toHaveLength(0);
    await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`), vendor, 'seller').send({ variants: [{ variantId: product.variants[0]._id, wholesalePricing: terms }] }).expect(400);
  });
  test('term writes enforce ownership, stable variants and approval; retail editing preserves terms', async () => {
    const payload = { variants: [{ variantId: product.variants[0]._id, wholesalePricing: terms }] };
    await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`)).send(payload).expect(403);
    const otherUser = await User.create({ phone: '9800000099', roles: ['buyer', 'seller'] });
    await Seller.create({ userId: otherUser._id, status: 'approved' });
    await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`), otherUser, 'seller').send(payload).expect(404);
    await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`), vendor, 'seller').send({ variants: [{ variantId: new mongoose.Types.ObjectId(), wholesalePricing: terms }] }).expect(400);
    await auth(request(app).put(`/api/products/${product._id}`), vendor, 'seller').send({ name: 'Updated fixture' }).expect(200);
    expect((await Product.findById(product._id).select('+variants.wholesalePricing')).variants[0].wholesalePricing.enabled).toBe(true);
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'suspended' } });
    await auth(request(app).patch(`/api/products/${product._id}/wholesale-pricing`), vendor, 'seller').send(payload).expect(403);
  });
  test('catalog retains variant identity and advertises only reachable tiers', async () => {
    const response = await auth(request(app).get('/api/products/wholesale/catalog')).expect(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].variants[0]).toMatchObject({ variantId: String(product.variants[0]._id), minimumQuantity: 5, maxQuantity: 25, startingPrice: 70 });
    expect(response.body.data[0].variants[0].priceTiers).toHaveLength(2);
    expect((await request(app).get('/api/products/wholesale/availability')).body.enabled).toBe(true);
    expect((await auth(request(app).get(`/api/products/wholesale/catalog?productId=${product._id}`))).body.data[0]._id).toBe(String(product._id));
    await auth(request(app).get('/api/products/wholesale/catalog?limit=1000')).expect(400);
  });
  test('anonymous and seller sessions cannot access the buyer catalog', async () => {
    await request(app).get('/api/products/wholesale/catalog').expect(401);
    await auth(request(app).get('/api/products/wholesale/catalog'), vendor, 'seller').expect(403);
  });
  test.each([
    { enabled: false }, { ...terms, minimumQuantity: 0 }, { ...terms, priceTiers: [] },
  ])('invalid or disabled terms never appear in catalog: %j', async value => {
    await Product.collection.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing': value } });
    expect((await auth(request(app).get('/api/products/wholesale/catalog'))).body.data).toHaveLength(0);
  });
  test('below-MOQ stock and suspended sellers are unavailable', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 4 } });
    expect((await request(app).get('/api/products/wholesale/availability')).body.enabled).toBe(false);
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 25 } });
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'suspended' } });
    expect((await request(app).get('/api/products/wholesale/availability')).body.enabled).toBe(false);
  });
  test('pricing validates tier boundaries, integers, decimals and safe totals', async () => {
    const { priceWholesaleQuantity, normalizeWholesalePricing } = await import('../../services/wholesalePricing.service.js');
    for (const [qty, price] of [[5, 80], [10, 70], [95, 70], [100, 60]]) expect(priceWholesaleQuantity(terms, qty).unitPrice).toBe(price);
    for (const qty of [0, -1, 4, 6, 5.5, true, '', null, 100001]) expect(() => priceWholesaleQuantity(terms, qty)).toThrow();
    for (const price of [0, -1, 1.001, Infinity, true, '']) expect(() => normalizeWholesalePricing({ ...terms, priceTiers: [{ minimumQuantity: 5, unitPrice: price }] })).toThrow();
    expect(() => normalizeWholesalePricing({ ...terms, quantityIncrement: true })).toThrow();
    expect(() => normalizeWholesalePricing({ ...terms, minimumQuantity: 1, priceTiers: [{ minimumQuantity: true, unitPrice: 1 }] })).toThrow();
    expect(() => normalizeWholesalePricing({ ...terms, priceTiers: [{ minimumQuantity: 5, unitPrice: 1 }, { minimumQuantity: 5, unitPrice: 1 }] })).toThrow();
  });
});

const address = { name: 'Fixture Buyer', phone: '9800000001', line1: 'Fixture address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001', lat: 19.1, lng: 72.9 };
const addWholesale = (qty = 5) => auth(request(app).post('/api/cart/wholesale')).send({ productId: String(product._id), variantId: String(product.variants[0]._id), qty, price: 1, eligible: true }).expect(response => { if (response.status === 500) throw new Error(response.body.message); });
const quote = () => auth(request(app).get('/api/cart/wholesale')).query({ lat: address.lat, lng: address.lng });
const checkout = (quoteHash, key = 'wholesale-fixture-key-0001', extra = {}) => auth(request(app).post('/api/orders/unified')).set('Idempotency-Key', key).send({ purchaseMode: 'wholesale', shippingAddress: address, paymentMethod: 'cod', quoteHash, ...extra });
describe('separate wholesale cart and transactional checkout', () => {
  test('transaction failure rolls back stock, payment, order, cart and checkout claim', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const create = jest.spyOn(Payment, 'create').mockRejectedValueOnce(new Error('Fixture payment write failure'));
    const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
    try { await checkout(q.quoteHash).expect(500); } finally { create.mockRestore(); logs.mockRestore(); }
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect(await mongoose.models.CheckoutAttempt.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    expect((await Cart.findOne({ userId: buyer._id, channel: 'wholesale' })).items).toHaveLength(1);
    await checkout(q.quoteHash).expect(201);
  });
  test('Wholesale COD order enters existing seller acceptance, preparation and manual delivery rules', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash).expect(201); const orderId = placed.body.data.orders[0]._id;
    const detail = await auth(request(app).get(`/api/sellers/orders/${orderId}`), vendor, 'seller').expect(200);
    expect(detail.body.data.salesChannel).toBe('wholesale');
    await auth(request(app).post(`/api/sellers/orders/${orderId}/fulfillment/manual`), vendor, 'seller').send({}).expect(409);
    for (const status of ['confirmed', 'preparing', 'ready_for_pickup']) await auth(request(app).patch(`/api/sellers/orders/${orderId}/status`), vendor, 'seller').send({ status }).expect(200);
    await auth(request(app).post(`/api/sellers/orders/${orderId}/fulfillment/manual`), vendor, 'seller').send({}).expect(200);
    expect((await Order.findById(orderId)).fulfillment.method).toBe('manual');
    await auth(request(app).get(`/api/orders/${orderId}`), vendor).expect(403);
  });
  test('cart reprices tiers, removes lines and cannot be changed through retail endpoints', async () => {
    const added = await addWholesale().expect(200);
    expect(added.body.data.groups[0].items[0].price).toBe(80);
    const cart = await Cart.findOne({ userId: buyer._id, channel: 'wholesale' });
    const line = cart.items[0];
    const updated = await auth(request(app).put(`/api/cart/wholesale/${line._id}`)).send({ qty: 10, price: 1 }).expect(200);
    expect(updated.body.data.groups[0].items[0].price).toBe(70);
    await auth(request(app).put(`/api/cart/${line._id}`)).send({ qty: 1 }).expect(400);
    await auth(request(app).delete(`/api/cart/wholesale/${line._id}`)).expect(200);
    expect((await Cart.findById(cart._id)).items).toHaveLength(0);
  });
  test.each([0, -1, 4, 6, 5.5, true, null, 100001])('rejects invalid wholesale quantity %j', async qty => {
    await addWholesale(qty).expect(400);
    expect(await Order.countDocuments()).toBe(0);
  });
  test('seller sessions and another buyer cannot use the customer cart', async () => {
    await auth(request(app).post('/api/cart/wholesale'), vendor, 'seller').send({}).expect(403);
    await addWholesale().expect(200);
    const line = (await Cart.findOne({ userId: buyer._id, channel: 'wholesale' })).items[0];
    await auth(request(app).delete(`/api/cart/wholesale/${line._id}`), vendor).expect(404);
  });
  test('COD preserves wholesale snapshot, retail cart and exact stock across retries and cancellation', async () => {
    await Cart.create({ userId: buyer._id, channel: 'ecommerce', items: [{ productId: product._id, variantId: product.variants[0]._id, qty: 1, price: 100 }] });
    await addWholesale(10).expect(200);
    const q = (await quote().expect(200)).body.data;
    const placed = await checkout(q.quoteHash).expect(201);
    const order = await Order.findById(placed.body.data.orders[0]._id);
    expect(order.salesChannel).toBe('wholesale'); expect(order.type).toBe('ecommerce');
    expect(order.items[0].price).toBe(70); expect(order.items[0].wholesaleSnapshot.tierMinimumQuantity).toBe(10);
    expect(order.pricing.subtotal).toBe(700);
    expect((await Payment.findById(order.paymentId)).amount).toBe(order.pricing.totalAmount);
    await checkout(q.quoteHash).expect(201);
    expect(await Order.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(15);
    expect((await Cart.findOne({ userId: buyer._id, channel: 'ecommerce' })).items).toHaveLength(1);
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing.enabled': false } });
    expect((await Order.findById(order._id)).items[0].wholesaleSnapshot.unitPrice).toBe(70);
    await auth(request(app).patch(`/api/orders/${order._id}/cancel`)).send({ reason: 'Fixture cancellation' }).expect(200);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
  });
  test('stale price, suspension and invalid quote cannot create orders or deduct stock', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing.priceTiers.0.unitPrice': 79 } });
    await checkout(q.quoteHash).expect(409);
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'suspended' } });
    await checkout(q.quoteHash).expect(409);
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
  });
  test('concurrent retries place one order; mixed purchase modes are rejected', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    await checkout(q.quoteHash, 'mixed-fixture-key-0001', { channel: 'ecommerce' }).expect(400);
    const responses = await Promise.all([checkout(q.quoteHash), checkout(q.quoteHash)]);
    expect(responses.every(response => [201, 409].includes(response.status))).toBe(true);
    expect(await Order.countDocuments()).toBe(1); expect(await Payment.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
  });
});
