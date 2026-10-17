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

describe('wholesale diagnostic API contracts', () => {
  const observedId = '6ad12379e87a768124c739d0';
  const groceryFixture = async enabled => {
    const groceryCategory = await Category.create({ name: 'Diagnostic grocery fixture', type: 'grocery' });
    return Product.create({ _id: observedId, type: 'grocery', name: 'Diagnostic grocery beans', category: groceryCategory._id, sellerId: seller._id,
      variants: [{ name: 'Pack', price: 100, mrp: 120, stock: 25, wholesalePricing: { ...terms, enabled } }] });
  };
  test('retail grocery without wholesale terms is successful empty data, not an API error', async () => {
    await groceryFixture(false);
    expect((await request(app).get(`/api/products/wholesale/availability?productId=${observedId}`).expect(200)).body).toEqual({ success:true, enabled:false });
    const result = await auth(request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`)).expect(200);
    expect(result.body.data).toEqual([]); expect(result.body.meta.total).toBe(0);
    // The storefront hint is global, and another eligible product still exists.
    expect((await request(app).get('/api/products/wholesale/availability').expect(200)).body.enabled).toBe(true);
    const retail = await request(app).get(`/api/products/${observedId}`).expect(200);
    expect(retail.body._id).toBe(observedId);
    expect(JSON.stringify(retail.body)).not.toMatch(/wholesalePricing|priceTiers|_terms/);
  });
  test('eligible grocery exposes terms only through the authenticated customer catalog', async () => {
    const grocery = await groceryFixture(true);
    const hint=await request(app).get(`/api/products/wholesale/availability?productId=${observedId}`).expect(200);
    expect(hint.body).toEqual({success:true,enabled:true});
    await request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`).expect(401);
    await auth(request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`),vendor,'seller').expect(403);
    await auth(request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`),vendor,'delivery').expect(403);
    const result=await auth(request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`)).expect(200);
    expect(result.body.data[0].variants[0]).toMatchObject({variantId:String(grocery.variants[0]._id),minimumQuantity:5,quantityIncrement:5});
    expect(result.body.data[0].variants[0].priceTiers[0].unitPrice).toBe(80);
    const retail=await request(app).get(`/api/products/${observedId}`).expect(200);
    expect(JSON.stringify(retail.body)).not.toMatch(/wholesalePricing|priceTiers|_terms/);
  });
  test('invalid IDs are rejected before aggregation; missing products are successful empty results', async () => {
    const aggregate=jest.spyOn(Product,'aggregate');
    try {
      await request(app).get('/api/products/wholesale/availability?productId=bad-id').expect(400);
      await auth(request(app).get('/api/products/wholesale/catalog?productId=bad-id')).expect(400);
      expect(aggregate).not.toHaveBeenCalled();
      expect((await request(app).get(`/api/products/wholesale/availability?productId=${observedId}`).expect(200)).body.enabled).toBe(false);
      expect((await auth(request(app).get(`/api/products/wholesale/catalog?productId=${observedId}`)).expect(200)).body.data).toEqual([]);
    } finally {aggregate.mockRestore();}
  });
  test('genuine database failures remain errors rather than false availability or empty catalogs', async () => {
    const aggregate=jest.spyOn(Product,'aggregate');
    try {
      for(const code of [50,2]) for(const endpoint of ['availability','catalog']) {
        aggregate.mockImplementationOnce(()=>({option:()=>Promise.reject(Object.assign(new Error('Synthetic aggregation failure'),{code}))}));
        const req=request(app).get(`/api/products/wholesale/${endpoint}?productId=${observedId}`);
        const response=await (endpoint==='catalog'?auth(req):req).expect(code===50?503:500);
        expect(response.body.success).toBe(false); expect(response.body.data).toBeNull(); expect(response.body.enabled).toBeUndefined();
      }
    } finally {aggregate.mockRestore();}
    await request(app).get(`/api/products/${product._id}`).expect(200);
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

const captureEvent = (gateway, id, overrides = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured', ...overrides } } } });
const sendGatewayEvent = (event, signature) => request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature || crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex')).send(event);
const onlineFixture = async (retail = false) => {
  let placed;
  if (retail) {
    await auth(request(app).post('/api/cart')).send({ productId: String(product._id), variantId: String(product.variants[0]._id), qty: 1 }).expect(200);
    placed = await auth(request(app).post('/api/orders')).set('Idempotency-Key', 'retail-safety-fixture-0001').send({ shippingAddress: address, paymentMethod: 'online', channel: 'ecommerce' }).expect(201);
  } else {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    placed = await checkout(q.quoteHash, 'online-safety-fixture-0001', { paymentMethod: 'online' }).expect(201);
  }
  const orderId = retail ? placed.body.data.order._id : placed.body.data.orders[0]._id;
  const start = () => auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(200);
  const gateway = (await start()).body.data;
  return { orderId, gateway, start };
};

const recoveryAdmin = async () => {
  const admin = await Admin.create({ email: `recovery-${crypto.randomUUID()}@example.invalid`, password: 'FixturePasswordOnly', role: 'superAdmin' });
  return jwt.sign({ id: String(admin._id), type: 'admin' }, process.env.JWT_SECRET);
};
const recoveryRequest = (paymentId, action, token, data) => request(app).post(`/api/admin/payment-recovery/${paymentId}/${action}`).set('Authorization', `Bearer ${token}`).send(data);
const refundFixture = async (retail = false) => {
  const fixture = await onlineFixture(retail);
  await auth(request(app).patch(`/api/orders/${fixture.orderId}/cancel`)).send({ reason: 'Fixture cancellation' }).expect(200);
  gatewayPayments.set('pay_recovery', { id: 'pay_recovery', order_id: fixture.gateway.razorpayOrderId, amount: fixture.gateway.amountPaise, amount_refunded: 0, currency: 'INR', status: 'captured' });
  await sendGatewayEvent(captureEvent(fixture.gateway, 'pay_recovery')).expect(200);
  const payment = await Payment.findOne();
  return { ...fixture, paymentId: String(payment._id), key: payment.refundObligations[0].key, adminToken: await recoveryAdmin() };
};
const refundEvent = (refund, overrides = {}) => ({ event: refund.status === 'failed' ? 'refund.failed' : 'refund.processed', payload: { refund: { entity: { ...refund, ...overrides } } } });

describe('recovery workflows', () => {
  const returnRow = async (order, extra={}) => mongoose.models.Return.create({ returnNumber:`RET-FIXTURE-${crypto.randomUUID()}`,orderId:order._id,orderItemId:order.items[0]._id,customerId:buyer._id,sellerId:seller._id,productId:product._id,unitPriceSnapshot:order.items[0].price,quantity:1,reason:'OTHER',status:'RETURN_RECEIVED',refundAmount:order.pricing.totalAmount,refundBreakdown:{refundAmount:order.pricing.totalAmount,allocatedCoinsCount:0},...extra });
  test('recovery: an existing verified Return refund and cancellation obligation share one debt',async()=>{
    const f=await refundFixture(),order=await Order.findById(f.orderId); const row={id:'rfnd_existing_return',payment_id:'pay_recovery',amount:f.gateway.amountPaise,status:'processed',receipt:'legacy-return-receipt'};
    gatewayRefunds.set(row.id,row);gatewayPayments.get(row.payment_id).amount_refunded=row.amount;
    await returnRow(order,{status:'REFUNDED',refundStatus:'completed',refundReference:row.id});
    const {getRazorpayClient}=await import('../../services/razorpay.service.js');const count=getRazorpayClient().payments.refund.mock.calls.length;
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    expect(getRazorpayClient().payments.refund.mock.calls.length).toBe(count);expect((await Payment.findById(f.paymentId)).refundObligations[0].providerRefundId).toBe(row.id);
    await sendGatewayEvent(refundEvent(row)).expect(200);
  });
  test('recovery: incomplete legacy Return processing blocks a separate cancellation refund',async()=>{
    const f=await refundFixture();await returnRow(await Order.findById(f.orderId),{refundStatus:'processing',refundAmount:100});
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(409);
    expect(gatewayRefunds.size).toBe(0);
  });
  test('recovery: ordinary Razorpay Return execution uses the same claim, verifies completion and replays safely',async()=>{
    const f=await onlineFixture(); gatewayPayments.set('pay_return_original',{id:'pay_return_original',order_id:f.gateway.razorpayOrderId,amount:f.gateway.amountPaise,amount_refunded:0,status:'captured',currency:'INR'});
    await sendGatewayEvent(captureEvent(f.gateway,'pay_return_original')).expect(200);
    await Order.updateOne({_id:f.orderId},{$set:{status:'delivered'}});const order=await Order.findById(f.orderId),ret=await returnRow(order);
    const {processReturnRefund}=await import('../../services/return.service.js'),{getRazorpayClient}=await import('../../services/razorpay.service.js');
    const result=await processReturnRefund({returnId:String(ret._id)});expect(result.status).toBe('REFUNDED');
    const count=getRazorpayClient().payments.refund.mock.calls.length;await processReturnRefund({returnId:String(ret._id)});
    const p=await Payment.findById(order.paymentId);expect(p.refundObligations[0].key).toBe(`RETURN:${ret._id}`);expect(p.status).toBe('refunded');
    await sendGatewayEvent(refundEvent([...gatewayRefunds.values()][0])).expect(200);expect(getRazorpayClient().payments.refund.mock.calls.length).toBe(count);
  });
  test('recovery: a Return timeout is reconciled by existing Return retry without redispatch',async()=>{
    const f=await onlineFixture();gatewayPayments.set('pay_return_timeout',{id:'pay_return_timeout',order_id:f.gateway.razorpayOrderId,amount:f.gateway.amountPaise,amount_refunded:0,status:'captured',currency:'INR'});await sendGatewayEvent(captureEvent(f.gateway,'pay_return_timeout')).expect(200);
    await Order.updateOne({_id:f.orderId},{$set:{status:'delivered'}});const ret=await returnRow(await Order.findById(f.orderId));
    const {processReturnRefund}=await import('../../services/return.service.js'),{getRazorpayClient}=await import('../../services/razorpay.service.js'),client=getRazorpayClient();
    client.payments.refund.mockImplementationOnce(async(paymentId,value)=>{gatewayRefunds.set('rfnd_return_timeout',{id:'rfnd_return_timeout',payment_id:paymentId,...value,status:'pending'});throw new Error('fixture timeout');});
    expect((await processReturnRefund({returnId:String(ret._id)})).status).toBe('REFUND_PENDING');const count=client.payments.refund.mock.calls.length;
    const row=gatewayRefunds.get('rfnd_return_timeout');row.status='processed';gatewayPayments.get(row.payment_id).amount_refunded=row.amount;
    expect((await processReturnRefund({returnId:String(ret._id)})).status).toBe('REFUNDED');expect(client.payments.refund.mock.calls.length).toBe(count);
  });
  test('recovery: interrupted Return finalization recovers a verified refund without another provider call',async()=>{
    const f=await onlineFixture();gatewayPayments.set('pay_finalize_return',{id:'pay_finalize_return',order_id:f.gateway.razorpayOrderId,amount:f.gateway.amountPaise,amount_refunded:0,status:'captured',currency:'INR'});await sendGatewayEvent(captureEvent(f.gateway,'pay_finalize_return')).expect(200);
    await Order.updateOne({_id:f.orderId},{$set:{status:'delivered'}});const ret=await returnRow(await Order.findById(f.orderId)),{processReturnRefund}=await import('../../services/return.service.js');
    const original=mongoose.models.Return.prototype.save;let fail=true;const spy=jest.spyOn(mongoose.models.Return.prototype,'save').mockImplementation(function(options){if(fail&&this.status==='REFUNDED'){fail=false;return Promise.reject(new Error('fixture finalization interruption'))}return original.call(this,options)});
    try{await expect(processReturnRefund({returnId:String(ret._id)})).rejects.toThrow('fixture finalization interruption');const {getRazorpayClient}=await import('../../services/razorpay.service.js'),count=getRazorpayClient().payments.refund.mock.calls.length;
      expect((await processReturnRefund({returnId:String(ret._id)})).status).toBe('REFUNDED');expect(getRazorpayClient().payments.refund.mock.calls.length).toBe(count);
    }finally{spy.mockRestore()}
  });
  test('recovery: historical Return refund webhooks verify the parent payment and retain old readers',async()=>{
    const f=await onlineFixture();gatewayPayments.set('pay_legacy_return',{id:'pay_legacy_return',order_id:f.gateway.razorpayOrderId,amount:f.gateway.amountPaise,amount_refunded:0,status:'captured',currency:'INR'});await sendGatewayEvent(captureEvent(f.gateway,'pay_legacy_return')).expect(200);
    const order=await Order.findById(f.orderId),ret=await returnRow(order,{status:'REFUND_PENDING',refundStatus:'processing',refundReference:'rfnd_legacy_event'});
    const row={id:'rfnd_legacy_event',payment_id:'pay_legacy_return',amount:f.gateway.amountPaise,status:'processed',receipt:'legacy'};gatewayRefunds.set(row.id,row);gatewayPayments.get(row.payment_id).amount_refunded=row.amount;
    await Payment.updateOne({_id:order.paymentId},{$set:{refund:{amount:row.amount/100,status:'pending',razorpayRefId:row.id,totalRefundedAmount:0}}});
    await sendGatewayEvent(refundEvent(row,{payment_id:'foreign'})).expect(400);expect((await mongoose.models.Return.findById(ret._id)).status).toBe('REFUND_PENDING');
    await sendGatewayEvent(refundEvent(row)).expect(200);await sendGatewayEvent(refundEvent(row)).expect(200);
    expect((await mongoose.models.Return.findById(ret._id)).status).toBe('REFUNDED');expect((await Payment.findById(order.paymentId)).refund.totalRefundedAmount).toBe(row.amount/100);
  });
  test('recovery: concurrent creation is blocked while the original SDK call is in flight',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'),client=getRazorpayClient(),original=client.orders.create.getMockImplementation();let release,arrived;
    const barrier=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{arrived=resolve});
    client.orders.create.mockImplementationOnce(async value=>{arrived();await barrier;return original(value);});
    try{const first=auth(request(app).post('/api/payments/initiate')).send({orderId}).then(r=>r);await ready;const before=client.orders.create.mock.calls.length;
      await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(409);expect(client.orders.create.mock.calls.length).toBe(before);release();expect((await first).status).toBe(200);
    }finally{release();client.orders.create.mockImplementation(original)}
  });
  test('recovery: unresolved attempt queue is bounded, admin-only and omits claim tokens',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js');getRazorpayClient().orders.create.mockRejectedValueOnce(new Error('fixture timeout'));
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(503);const adminToken=await recoveryAdmin();
    await auth(request(app).get('/api/admin/payment-attempt-recovery')).expect(403);
    const result=await request(app).get('/api/admin/payment-attempt-recovery?limit=1').set('Authorization',`Bearer ${adminToken}`).expect(200);expect(result.body.meta.total).toBe(1);expect(result.body.data[0].attempt.status).toBe('creation_unknown');expect(result.body.data[0].attempt.recoveryToken).toBeUndefined();
    await request(app).get('/api/admin/payment-attempt-recovery?limit=101').set('Authorization',`Bearer ${adminToken}`).expect(400);
  });
  test('recovery: additional captured attempts refund separately without repeating original settlement',async()=>{
    const {gateway,start}=await onlineFixture(),second=(await start()).body.data;
    await sendGatewayEvent(captureEvent(gateway,'pay_primary_recovery')).expect(200);await sendGatewayEvent(captureEvent(second,'pay_extra_recovery')).expect(200);
    gatewayPayments.set('pay_extra_recovery',{id:'pay_extra_recovery',order_id:second.razorpayOrderId,amount:second.amountPaise,amount_refunded:0,currency:'INR',status:'captured'});
    const p=await Payment.findOne(),adminToken=await recoveryAdmin();await recoveryRequest(String(p._id),'refund/process',adminToken,{key:'CAPTURE:pay_extra_recovery'}).expect(200);
    const updated=await Payment.findOne();expect(updated.status).toBe('paid');expect(updated.refundObligations[0].status).toBe('processed');expect((await Order.findOne()).timeline.filter(row=>row.note==='Online payment verified')).toHaveLength(1);expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
  });
  test('recovery: unknown creation links trusted provider evidence and settles the original capture after cancellation',async()=>{
    const {gateway,orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js');const client=getRazorpayClient(),original=client.orders.create.getMockImplementation(); let created;
    client.orders.create.mockImplementationOnce(async value=>{created=await original(value);throw new Error('fixture post-creation timeout');});
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(503);
    const payment=await Payment.findOne(),attempt=payment.gatewayAttempts.at(-1),adminToken=await recoveryAdmin();
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(409);
    await auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({}).expect(200);
    gatewayPayments.set('pay_unknown_creation',{id:'pay_unknown_creation',order_id:created.id,amount:created.amount,currency:'INR',status:'captured',amount_refunded:0});
    await recoveryRequest(String(payment._id),'attempt/reconcile',adminToken,{key:attempt.attemptId,gatewayOrderId:gateway.razorpayOrderId}).expect(409);
    const recovered=await recoveryRequest(String(payment._id),'attempt/reconcile',adminToken,{key:attempt.attemptId,gatewayOrderId:created.id}).expect(200);
    expect(recovered.body.data.status).toBe('paid'); const p=await Payment.findOne();expect(p.gatewayAttempts.at(-1).gatewayOrderId).toBe(created.id);expect(p.refundObligations).toHaveLength(1);expect((await Order.findById(orderId)).status).toBe('cancelled');
    await sendGatewayEvent(captureEvent({razorpayOrderId:created.id,amountPaise:created.amount},'pay_unknown_creation')).expect(200);expect((await Payment.findOne()).captures).toHaveLength(1);
  });
  test('recovery: signed late capture can discover an unknown attempt without trusting browser IDs',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient(),original=client.orders.create.getMockImplementation();let created;
    client.orders.create.mockImplementationOnce(async value=>{created=await original(value);throw new Error('fixture timeout');});
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(503);
    const gw={razorpayOrderId:created.id,amountPaise:created.amount};
    await sendGatewayEvent(captureEvent(gw,'pay_late_link',{amount:1})).expect(400);
    expect((await Payment.findOne()).gatewayAttempts.at(-1).status).toBe('creation_unknown');
    await sendGatewayEvent(captureEvent(gw,'pay_late_link')).expect(200);
    expect((await Payment.findOne()).gatewayAttempts.at(-1).status).toBe('captured');expect((await Payment.findOne()).status).toBe('paid');
  });
  test('recovery: empty or ambiguous creation lookup cannot authorize another initialization',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js');const client=getRazorpayClient();
    client.orders.create.mockRejectedValueOnce(new Error('fixture timeout'));await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(503);
    const p=await Payment.findOne(),a=p.gatewayAttempts.at(-1),adminToken=await recoveryAdmin();
    await recoveryRequest(String(p._id),'attempt/reconcile',adminToken,{key:a.attemptId}).expect(409);
    const row={id:'ambiguous_1',receipt:a.merchantOrderId,notes:{merchantOrderId:a.merchantOrderId,bulkimartOrderId:orderId},amount:a.amountPaise,currency:'INR'};
    gatewayOrders.set(row.id,row);gatewayOrders.set('ambiguous_2',{...row,id:'ambiguous_2'});
    await recoveryRequest(String(p._id),'attempt/reconcile',adminToken,{key:a.attemptId}).expect(409);
    const count=client.orders.create.mock.calls.length;await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(409);expect(client.orders.create.mock.calls.length).toBe(count);
  });
  test('recovery: confirmed creation rejection records no creation and permits a normal new attempt',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js');const client=getRazorpayClient();
    client.orders.create.mockRejectedValueOnce({statusCode:400,error:{code:'BAD_REQUEST_ERROR'}});
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(400);expect((await Payment.findOne()).gatewayAttempts.at(-1).status).toBe('creation_rejected');
    await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(200);
  });
  test('recovery: mismatched provider order amount/currency cannot resolve unknown creation',async()=>{
    const {orderId}=await onlineFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js');const client=getRazorpayClient(),original=client.orders.create.getMockImplementation();let created;
    client.orders.create.mockImplementationOnce(async value=>{created=await original(value);throw new Error('fixture timeout');});await auth(request(app).post('/api/payments/initiate')).send({orderId}).expect(503);
    const p=await Payment.findOne(),a=p.gatewayAttempts.at(-1),adminToken=await recoveryAdmin();
    created.currency='USD';await recoveryRequest(String(p._id),'attempt/reconcile',adminToken,{key:a.attemptId,gatewayOrderId:created.id}).expect(400);
    expect((await Payment.findOne()).gatewayAttempts.at(-1).status).toBe('creation_unknown');
  });
  test.each(['http', 'worker'])('recovery: concurrent %s claimants make one provider refund request', async kind => {
    const f = await refundFixture(), { getRazorpayClient } = await import('../../services/razorpay.service.js');
    const { processRefundObligation } = await import('../../services/paymentRecovery.service.js');
    const client = getRazorpayClient(), original = client.payments.refund.getMockImplementation(), before = client.payments.refund.mock.calls.length;
    let release, arrived; const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
    client.payments.refund.mockImplementationOnce(async (...args) => { arrived(); await barrier; return original(...args); });
    try {
      const first = kind === 'http' ? recoveryRequest(f.paymentId, 'refund/process', f.adminToken, { key:f.key }).then(r => r) : processRefundObligation({ paymentId:f.paymentId,key:f.key });
      await ready;
      if (kind === 'http') await recoveryRequest(f.paymentId, 'refund/process', f.adminToken, { key:f.key }).expect(409);
      else await expect(processRefundObligation({paymentId:f.paymentId,key:f.key})).rejects.toMatchObject({status:409});
      release(); const result = await first; if (kind === 'http') expect(result.status).toBe(200);
      expect(client.payments.refund.mock.calls.length-before).toBe(1);
      const payment=await Payment.findById(f.paymentId); expect(payment.refundObligations[0].status).toBe('processed');
      expect((await Order.findById(f.orderId)).status).toBe('cancelled'); expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    } finally { release(); client.payments.refund.mockImplementation(original); }
  });
  test('recovery: timeout after possible provider success is reconciled without another refund and webhook replay is harmless', async () => {
    const f=await refundFixture(), {getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient();
    client.payments.refund.mockImplementationOnce(async(paymentId,value)=>{ gatewayRefunds.set('rfnd_timeout',{id:'rfnd_timeout',payment_id:paymentId,...value,status:'pending'}); throw new Error('fixture timeout'); });
    const processed=await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200); expect(processed.body.data.status).toBe('reconciliation_required');
    const count=client.payments.refund.mock.calls.length;
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(409);
    const pending=await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key}).expect(200); expect(pending.body.data.status).toBe('processing');
    const row=gatewayRefunds.get('rfnd_timeout'); row.status='processed'; gatewayPayments.get(row.payment_id).amount_refunded=row.amount;
    await sendGatewayEvent(refundEvent(row)).expect(200); await sendGatewayEvent(refundEvent(row)).expect(200);
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    expect(client.payments.refund.mock.calls.length).toBe(count);
    const p=await Payment.findById(f.paymentId); expect(p.refundObligations[0].status).toBe('processed'); expect(p.status).toBe('refunded'); expect(p.refund.totalRefundedAmount).toBe(row.amount/100);
    expect(p.refundObligations[0].history.some(h=>h.status==='reconciliation_required')).toBe(true);
  });
  test('recovery: empty provider history after timeout remains blocked and visible',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient();
    client.payments.refund.mockRejectedValueOnce(new Error('fixture timeout'));
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    const r=await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key}).expect(200); expect(r.body.data.status).toBe('reconciliation_required');
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(409);
    const queue=await request(app).get('/api/admin/payment-refund-obligations?status=reconciliation_required').set('Authorization',`Bearer ${f.adminToken}`).expect(200);expect(queue.body.data).toHaveLength(1);
  });
  test('recovery: returned provider ID survives a verification-read timeout',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'),client=getRazorpayClient();
    client.refunds.fetch.mockRejectedValueOnce(new Error('fixture verification timeout'));
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(503);
    const debt=(await Payment.findById(f.paymentId)).refundObligations[0];expect(debt.providerRefundId).toBe([...gatewayRefunds.keys()][0]);expect(debt.status).toBe('reconciliation_required');
    const count=client.payments.refund.mock.calls.length;
    await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key,providerRefundId:debt.providerRefundId}).expect(200);
    expect(client.payments.refund.mock.calls.length).toBe(count);expect((await Payment.findById(f.paymentId)).refundObligations[0].status).toBe('processed');
  });
  test('recovery: another debt cannot dispatch while a refund on the same Payment is uncertain',async()=>{
    const {gateway,start,orderId}=await onlineFixture(),second=(await start()).body.data;
    await auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({}).expect(200);
    for(const [g,id] of [[gateway,'pay_first_unknown_refund'],[second,'pay_second_unknown_refund']]){gatewayPayments.set(id,{id,order_id:g.razorpayOrderId,amount:g.amountPaise,amount_refunded:0,currency:'INR',status:'captured'});await sendGatewayEvent(captureEvent(g,id)).expect(200);}
    const p=await Payment.findOne(),adminToken=await recoveryAdmin(),{getRazorpayClient}=await import('../../services/razorpay.service.js'),client=getRazorpayClient();
    client.payments.refund.mockRejectedValueOnce(new Error('fixture uncertain'));
    await recoveryRequest(String(p._id),'refund/process',adminToken,{key:`CANCEL:${orderId}`}).expect(200);const count=client.payments.refund.mock.calls.length;
    await recoveryRequest(String(p._id),'refund/process',adminToken,{key:'CAPTURE:pay_second_unknown_refund'}).expect(409);expect(client.payments.refund.mock.calls.length).toBe(count);
  });
  test('recovery: expired claims permit reconciliation only while the original POST is still in flight',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'),client=getRazorpayClient(),original=client.payments.refund.getMockImplementation();let release,arrived;
    const barrier=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{arrived=resolve});client.payments.refund.mockImplementationOnce(async(...args)=>{arrived();await barrier;return original(...args)});
    try{const first=recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).then(r=>r);await ready;
      await Payment.updateOne({_id:f.paymentId},{$set:{'refundOperation.startedAt':new Date(Date.now()-360000)}});
      expect((await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key}).expect(200)).body.data.status).toBe('reconciliation_required');
      await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(409);release();expect((await first).status).toBe(200);expect((await Payment.findById(f.paymentId)).refundObligations[0].status).toBe('processed');
    }finally{release();client.payments.refund.mockImplementation(original)}
  });
  test('recovery: a verified webhook winning just before dispatch prevents a second provider request',async()=>{
    const f=await refundFixture(),original=Payment.updateOne.bind(Payment);let release,arrived,pause=true;
    const barrier=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{arrived=resolve});
    const spy=jest.spyOn(Payment,'updateOne').mockImplementation((filter,update,options)=>{
      if(pause&&update.$inc?.['refundObligations.$.attemptCount']){pause=false;arrived();return barrier.then(()=>original(filter,update,options))}return original(filter,update,options);
    });
    try{const processing=recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).then(r=>r);await ready;
      const debt=(await Payment.findById(f.paymentId)).refundObligations[0],row={id:'rfnd_before_dispatch',payment_id:'pay_recovery',amount:debt.amountPaise,receipt:debt.receipt,status:'processed'};
      gatewayRefunds.set(row.id,row);gatewayPayments.get(row.payment_id).amount_refunded=row.amount;
      const {getRazorpayClient}=await import('../../services/razorpay.service.js'),count=getRazorpayClient().payments.refund.mock.calls.length;
      await sendGatewayEvent(refundEvent(row)).expect(200);release();expect((await processing).status).toBe(409);
      expect(getRazorpayClient().payments.refund.mock.calls.length).toBe(count);expect((await Payment.findById(f.paymentId)).refundObligations[0].status).toBe('processed');
    }finally{release();spy.mockRestore()}
  });
  test('recovery: explicit request rejection is a confirmed failure and can be retried after history checks',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient();
    client.payments.refund.mockRejectedValueOnce({statusCode:400,error:{code:'BAD_REQUEST_ERROR'}});
    const first=await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200); expect(first.body.data.status).toBe('failed');
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    const debt=(await Payment.findById(f.paymentId)).refundObligations[0];expect(debt.status).toBe('processed');expect(debt.attemptCount).toBe(2);
  });
  test('recovery: verified failed refund can retry, but its old failure cannot resolve a newer timed-out attempt',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient();
    client.payments.refund.mockImplementationOnce(async(paymentId,value)=>{const r={id:'rfnd_failed',payment_id:paymentId,...value,status:'failed'};gatewayRefunds.set(r.id,r);return r;});
    expect((await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200)).body.data.status).toBe('failed');
    client.payments.refund.mockRejectedValueOnce(new Error('fixture timeout on retry'));
    expect((await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200)).body.data.status).toBe('reconciliation_required');
    expect((await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key}).expect(200)).body.data.status).toBe('reconciliation_required');
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(409);
  });
  test('recovery: signed mismatched refund events and invalid signatures cannot complete another debt',async()=>{
    const f=await refundFixture(),{getRazorpayClient}=await import('../../services/razorpay.service.js'); const client=getRazorpayClient();
    client.payments.refund.mockImplementationOnce(async(paymentId,value)=>{const row={id:'rfnd_pending',payment_id:paymentId,...value,status:'pending'};gatewayRefunds.set(row.id,row);return row;});
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200); const row=gatewayRefunds.get('rfnd_pending');
    await sendGatewayEvent(refundEvent(row),'invalid').expect(401);
    for(const changes of [{amount:1},{currency:'USD'},{payment_id:'pay_foreign'}]) await sendGatewayEvent(refundEvent(row,changes)).expect(400);
    row.payment_id='pay_foreign'; await recoveryRequest(f.paymentId,'refund/reconcile',f.adminToken,{key:f.key,providerRefundId:row.id}).expect(400);
    expect((await Payment.findById(f.paymentId)).refundObligations[0].status).not.toBe('processed');
  });
  test.each([false,true])('recovery: verified refund preserves retail/wholesale cancellation and paid history (retail=%s)',async retail=>{
    const f=await refundFixture(retail);
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    const p=await Payment.findById(f.paymentId),before=p.refundObligations[0].history.length;
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key}).expect(200);
    expect((await Payment.findById(f.paymentId)).refundObligations[0].history.length).toBe(before);expect((await Order.findById(f.orderId)).status).toBe('cancelled');
  });
  test('recovery: admin endpoints deny customers, seller sessions and malformed references',async()=>{
    const f=await refundFixture();
    await auth(request(app).post(`/api/admin/payment-recovery/${f.paymentId}/refund/process`)).send({key:f.key}).expect(403);
    await auth(request(app).post(`/api/admin/payment-recovery/${f.paymentId}/refund/process`),vendor,'seller').send({key:f.key}).expect(403);
    await recoveryRequest(f.paymentId,'refund/process',f.adminToken,{key:f.key,amountPaise:1}).expect(400);
    await recoveryRequest('bad','refund/process',f.adminToken,{key:f.key}).expect(400);
    const detail=await request(app).get(`/api/admin/payment-recovery/${f.paymentId}`).set('Authorization',`Bearer ${f.adminToken}`).expect(200);expect(detail.body.data.refundOperation).toBeUndefined();
  });
});

describe('pre-staging payment and money safety matrix', () => {
  test('recovery: uncertain creation blocks the next provider initialization', async () => {
    const { gateway, orderId } = await onlineFixture();
    const { getRazorpayClient } = await import('../../services/razorpay.service.js');
    const client = getRazorpayClient();
    client.orders.create.mockRejectedValueOnce(new Error('fixture timeout after possible creation'));
    await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(503);
    const count = client.orders.create.mock.calls.length;
    await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(409);
    expect(client.orders.create.mock.calls.length).toBe(count);
    expect((await Payment.findOne()).gatewayAttempts.some(row => row.status === 'creation_unknown')).toBe(true);
  });
  test('recovery: administrators can process an existing captured cancellation debt', async () => {
    const { gateway, orderId } = await onlineFixture();
    await auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({ reason: 'Fixture recovery' }).expect(200);
    await sendGatewayEvent(captureEvent(gateway, 'pay_recovery_debt')).expect(200);
    gatewayPayments.set('pay_recovery_debt', { id: 'pay_recovery_debt', order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, amount_refunded: 0, currency: 'INR', status: 'captured' });
    const payment = await Payment.findOne();
    const admin = await Admin.create({ email: 'recovery-admin@example.invalid', password: 'FixturePasswordOnly', role: 'superAdmin' });
    await request(app).post(`/api/admin/payment-recovery/${payment._id}/refund/process`).set('Authorization', `Bearer ${jwt.sign({ id: String(admin._id), type: 'admin' }, process.env.JWT_SECRET)}`).send({ key: payment.refundObligations[0].key }).expect(200);
  });
  test('fractional wallet debits and credits keep exact paise and idempotent ledger balances', async () => {
    const { debitWallet, creditWallet } = await import('../../services/wallet.service.js');
    await User.updateOne({ _id: buyer._id }, { $set: { 'wallet.balance': 0.30 } });
    const debit = { userId: buyer._id, amount: 0.10, idempotencyKey: 'decimal-debit-fixture' };
    const credit = { userId: buyer._id, amount: 0.10, idempotencyKey: 'decimal-credit-fixture' };
    expect((await debitWallet(debit)).balance).toBe(0.20); await debitWallet(debit);
    expect((await creditWallet(credit)).balance).toBe(0.30); await creditWallet(credit);
    expect((await User.findById(buyer._id)).wallet.balance).toBe(0.30);
    expect(await mongoose.models.WalletLedger.countDocuments()).toBe(2);
  });
  test('a checkout that wins before seller deactivation retains its snapshot; later purchases fail', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash).expect(201), orderId = placed.body.data.orders[0]._id;
    const before = JSON.stringify(await Order.findById(orderId));
    await User.updateOne({ _id: vendor._id }, { $set: { isActive: false } });
    await addWholesale().expect(409);
    expect(JSON.stringify(await Order.findById(orderId))).toBe(before);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
  });
  test.each(['single', 'unified'])('retail %s checkout also rejects seller deactivation after its eligibility read', async mode => {
    await auth(request(app).post('/api/cart')).send({ productId: product._id, variantId: product.variants[0]._id, qty: 1, channel: 'ecommerce' }).expect(200);
    const original = User.updateOne.bind(User); let release, arrived, pause = true;
    const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
    const spy = jest.spyOn(User, 'updateOne').mockImplementation((filter, update, options) => {
      if (pause && String(filter._id) === String(vendor._id) && options?.session) { pause = false; arrived(); return barrier.then(() => original(filter, update, options)); }
      return original(filter, update, options);
    });
    try {
      const buying = auth(request(app).post(mode === 'single' ? '/api/orders' : '/api/orders/unified')).set('Idempotency-Key', `retail-account-race-${mode}`).send({ channel: 'ecommerce', paymentMethod: 'cod', shippingAddress: address }).then(result => result);
      await ready; await original({ _id: vendor._id }, { $set: { isActive: false } }); release();
      expect((await buying).status).toBe(409); expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
      expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    } finally { release(); spy.mockRestore(); }
  });
  test('tip exceeding the inclusive cap is rejected before inventory or payment writes', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing': { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 99960 }] } } });
    await addWholesale(1).expect(200); const q = (await quote()).body.data;
    await checkout(q.quoteHash, 'over-limit-tip-fixture', { tipAmount: 10 }).expect(400);
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
  });
  test('database pagination and scoped availability keep eligibility live and omit price books publicly', async () => {
    for (let index = 0; index < 3; index++) await Product.create({ type: 'ecommerce', name: `Page fixture ${index}`, category: category._id, sellerId: seller._id, variants: [{ name: 'Pack', price: 100, mrp: 120, stock: 25, wholesalePricing: terms }] });
    const aggregate = jest.spyOn(Product, 'aggregate');
    try {
      const first = await auth(request(app).get('/api/products/wholesale/catalog?limit=2&page=1')).expect(200);
      const pipeline = aggregate.mock.calls.at(-1)[0];
      expect(pipeline.at(-1).$facet.data).toEqual([{ $skip: 0 }, { $limit: 2 }]);
      const second = await auth(request(app).get('/api/products/wholesale/catalog?limit=2&page=2')).expect(200);
      expect(first.body.meta.total).toBe(4); expect(first.body.data).toHaveLength(2); expect(second.body.data).toHaveLength(2);
      expect(new Set([...first.body.data, ...second.body.data].map(row => row._id)).size).toBe(4);
      const url = `/api/products/wholesale/availability?productId=${product._id}&variantId=${product.variants[0]._id}`;
      expect((await request(app).get(url).expect(200)).body.enabled).toBe(true);
      expect(aggregate.mock.calls.at(-1)[0][0].$match._id).toEqual(product._id);
      await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'suspended' } });
      expect((await request(app).get(url).expect(200)).body.enabled).toBe(false);
      await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'approved' } });
      await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 4 } });
      expect((await request(app).get(url).expect(200)).body).toEqual({ success: true, enabled: false });
      await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 25, 'variants.0.wholesalePricing.enabled': false } });
      expect((await request(app).get(url).expect(200)).body.enabled).toBe(false);
      for (const query of ['page=1001', 'page=1e12', 'limit=101', 'limit=-1', 'q[a]=x']) await auth(request(app).get(`/api/products/wholesale/catalog?${query}`)).expect(400);
    } finally { aggregate.mockRestore(); }
  });
  test('public resource limits stop before database work and preserve the JSON error contract', async () => {
    const limited = express(); limited.set('trust proxy', 1); limited.use('/api/products', productRoutes); limited.use(errorHandler);
    const aggregate = jest.spyOn(Product, 'aggregate');
    try {
      for (let index = 0; index < 60; index++) await request(limited).get(`/api/products/wholesale/availability?productId=${product._id}`).set('X-Forwarded-For', '192.0.2.88').expect(200);
      const before = aggregate.mock.calls.length;
      const denied = await request(limited).get('/api/products/wholesale/availability').set('X-Forwarded-For', '192.0.2.88').expect(429);
      expect(denied.body).toMatchObject({ success: false, data: null }); expect(aggregate.mock.calls.length).toBe(before);
    } finally { aggregate.mockRestore(); }
  });
  test('malformed legacy price books fail closed without crashing a public availability query', async () => {
    for (const changes of [{ 'variants.0.stock': 'bad' }, { 'variants.0.wholesalePricing.minimumQuantity': true }, { 'variants.0.wholesalePricing.priceTiers': 'bad' }]) {
      await Product.collection.updateOne({ _id: product._id }, { $set: changes });
      expect((await request(app).get(`/api/products/wholesale/availability?productId=${product._id}`).expect(200)).body.enabled).toBe(false);
      await Product.collection.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 25, 'variants.0.wholesalePricing': terms } });
    }
  });
  test.each([false, true])('old attempt verifies through the browser API without a second settlement (retail=%s)', async retail => {
    const { orderId, gateway, start } = await onlineFixture(retail); await start();
    gatewayPayments.set('pay_browser_old', { id: 'pay_browser_old', order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured' });
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${gateway.razorpayOrderId}|pay_browser_old`).digest('hex');
    const body = { orderId, razorpay_order_id: gateway.razorpayOrderId, razorpay_payment_id: 'pay_browser_old', razorpay_signature: signature };
    await auth(request(app).post('/api/payments/razorpay/verify')).send(body).expect(200);
    await sendGatewayEvent(captureEvent(gateway, 'pay_browser_old')).expect(200);
    expect((await Payment.findOne()).captures).toHaveLength(1);
    expect((await Payment.findOne()).refundObligations).toHaveLength(0);
    expect((await Order.findById(orderId)).status).toBe('placed');
  });
  test('invalid signatures, amounts, currency, missing payment IDs and foreign attempts cannot settle', async () => {
    const { gateway, orderId } = await onlineFixture();
    await sendGatewayEvent(captureEvent(gateway, 'pay_wrong'), 'invalid').expect(401);
    for (const overrides of [{ amount: 1 }, { amount: 0 }, { currency: 'USD' }, { id: undefined }]) await sendGatewayEvent(captureEvent(gateway, 'pay_wrong', overrides)).expect(400);
    await sendGatewayEvent(captureEvent({ ...gateway, razorpayOrderId: 'unknown_fixture_order' }, 'pay_unknown')).expect(200);
    await auth(request(app).post('/api/payments/razorpay/verify')).send({ orderId, razorpay_order_id: 'unknown_fixture_order', razorpay_payment_id: 'pay_wrong', razorpay_signature: 'invalid' }).expect(400);
    expect((await Payment.findOne()).status).toBe('pending'); expect((await Payment.findOne()).captures).toHaveLength(0);
  });
  test.each([false, true])('both cancellation/capture orderings retain one debt and restore inventory once (captureFirst=%s)', async captureFirst => {
    const { gateway, orderId } = await onlineFixture();
    const event = captureEvent(gateway, 'pay_cancel_ordering');
    const cancel = () => auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({ reason: 'Fixture cancellation' });
    if (captureFirst) { await sendGatewayEvent(event).expect(200); await cancel().expect(200); }
    else { await cancel().expect(200); await sendGatewayEvent(event).expect(200); }
    await sendGatewayEvent(event).expect(200); await cancel().expect(400);
    const payment = await Payment.findOne();
    expect(payment.refundObligations).toHaveLength(1);
    expect(payment.refundObligations[0]).toMatchObject({ amountPaise: gateway.amountPaise, status: 'pending', gatewayPaymentId: 'pay_cancel_ordering', currency: 'INR' });
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    expect((await Order.findById(orderId)).status).toBe('cancelled');
  });
  test.each([false, true])('capture and cancellation serialize at their common payment write (cancelWins=%s)', async cancelWins => {
    const { gateway, orderId } = await onlineFixture(); const original = Payment.prototype.save, originalOrderUpdate = Order.updateOne.bind(Order);
    let release, arrived; const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; }); let pause = true;
    const spy = cancelWins ? jest.spyOn(Payment.prototype, 'save').mockImplementation(function(options) {
      const target = this.status === 'paid';
      if (pause && options?.session && target) { pause = false; arrived(); return barrier.then(() => original.call(this, options)); }
      return original.call(this, options);
    }) : jest.spyOn(Order, 'updateOne').mockImplementation((filter, update, options) => {
      if (pause && options?.session && update.$set?.status === 'cancelled') { pause = false; arrived(); return barrier.then(() => originalOrderUpdate(filter, update, options)); }
      return originalOrderUpdate(filter, update, options);
    });
    try {
      const event = captureEvent(gateway, 'pay_racing_cancel');
      const capturing = () => sendGatewayEvent(event).then(response => response);
      const cancelling = () => auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({ reason: 'Fixture' }).then(response => response);
      const paused = cancelWins ? capturing() : cancelling(); await ready;
      expect((await (cancelWins ? cancelling() : capturing())).status).toBe(200); release(); expect((await paused).status).toBe(200);
      expect((await Payment.findOne()).refundObligations).toHaveLength(1);
      expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    } finally { release(); spy.mockRestore(); }
  });
  test('legacy paid records replay safely; legacy pending records still reconcile', async () => {
    const { gateway } = await onlineFixture();
    await Payment.updateOne({}, { $set: { gatewayAttempts: [], status: 'paid', 'gateway.paymentId': 'pay_legacy' } });
    await sendGatewayEvent(captureEvent(gateway, 'pay_legacy')).expect(200);
    expect((await Payment.findOne()).refundObligations).toHaveLength(0);
    await Payment.updateOne({}, { $set: { captures: [], status: 'pending' }, $unset: { 'gateway.paymentId': 1 } });
    await sendGatewayEvent(captureEvent(gateway, 'pay_pending_legacy')).expect(200);
    expect((await Payment.findOne()).status).toBe('paid');
  });
  test('retrying a legacy pending payment preserves its old reference before changing the current gateway', async () => {
    const { gateway, start } = await onlineFixture();
    await Payment.updateOne({}, { $set: { gatewayAttempts: [] } });
    await start(); await sendGatewayEvent(captureEvent(gateway, 'pay_legacy_before_retry')).expect(200);
    const payment = await Payment.findOne(); expect(payment.status).toBe('paid');
    expect(payment.gatewayAttempts).toHaveLength(2); expect(payment.refundObligations).toHaveLength(0);
  });
  test('an uncertain provider creation retains its receipt for reconciliation without fabricating a payment', async () => {
    const { getRazorpayClient } = await import('../../services/razorpay.service.js');
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash, 'uncertain-provider-fixture', { paymentMethod: 'online' }).expect(201);
    const orderId = placed.body.data.orders[0]._id;
    getRazorpayClient().orders.create.mockRejectedValueOnce(new Error('fixture external outcome unknown'));
    await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(503);
    const payment = await Payment.findOne(); expect(payment.status).toBe('pending'); expect(payment.captures).toHaveLength(0);
    expect(payment.gatewayAttempts[0]).toMatchObject({ status: 'creation_unknown', orderId: new mongoose.Types.ObjectId(orderId), currency: 'INR' });
    expect(payment.gatewayAttempts[0].merchantOrderId).toMatch(/-A1$/);
  });
  test('concurrent initialization retains all references; initialization cannot reset a captured payment', async () => {
    const { gateway, start } = await onlineFixture();
    const { getRazorpayClient } = await import('../../services/razorpay.service.js');
    const client = getRazorpayClient(), original = client.orders.create.getMockImplementation();
    let release, arrived; const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
    client.orders.create.mockImplementationOnce(async value => { arrived(); await barrier; return original(value); });
    try {
      const starting = start().then(response => response); await ready;
      await sendGatewayEvent(captureEvent(gateway, 'pay_while_initializing')).expect(200); release(); await starting;
      const payment = await Payment.findOne(); expect(payment.status).toBe('paid'); expect(payment.gatewayAttempts).toHaveLength(2);
      expect(payment.gateway.paymentId).toBe('pay_while_initializing');
    } finally { release(); client.orders.create.mockImplementation(original); }
  });
  test('a first capture between journal persistence and the current gateway projection retains provider identity', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash, 'first-initialization-race', { paymentMethod: 'online' }).expect(201);
    const orderId = placed.body.data.orders[0]._id, original = Payment.updateOne.bind(Payment);
    let release, arrived, pause = true;
    const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
    const spy = jest.spyOn(Payment, 'updateOne').mockImplementation((filter, update, options) => {
      if (pause && update.$set?.gateway) { pause = false; arrived(); return barrier.then(() => original(filter, update, options)); }
      return original(filter, update, options);
    });
    try {
      const starting = auth(request(app).post('/api/payments/initiate')).send({ orderId }).then(result => result); await ready;
      const attempt = (await Payment.findOne()).gatewayAttempts[0];
      await sendGatewayEvent(captureEvent({ razorpayOrderId: attempt.gatewayOrderId, amountPaise: attempt.amountPaise }, 'pay_first_initialization')).expect(200);
      release(); expect((await starting).status).toBe(200);
      const payment = await Payment.findOne(); expect(payment.status).toBe('paid'); expect(payment.gateway.provider).toBe('razorpay'); expect(payment.gateway.paymentId).toBe('pay_first_initialization');
    } finally { release(); spy.mockRestore(); }
  });
  test('two successful attempts racing settle one obligation and retain the other as a refund debt', async () => {
    const { gateway, start } = await onlineFixture(), second = (await start()).body.data;
    const original = Payment.prototype.save; let release, arrived, pause = true;
    const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; });
    const spy = jest.spyOn(Payment.prototype, 'save').mockImplementation(function(options) {
      if (pause && options?.session && this.status === 'paid') { pause = false; arrived(); return barrier.then(() => original.call(this, options)); }
      return original.call(this, options);
    });
    try {
      const first = sendGatewayEvent(captureEvent(gateway, 'pay_parallel_first')).then(response => response); await ready;
      await sendGatewayEvent(captureEvent(second, 'pay_parallel_second')).expect(200); release(); expect((await first).status).toBe(200);
      const payment = await Payment.findOne(); expect(payment.status).toBe('paid'); expect(payment.captures).toHaveLength(2);
      expect(payment.captures.filter(row => row.disposition === 'settled')).toHaveLength(1);
      expect(payment.refundObligations).toHaveLength(1); expect(payment.refundObligations[0].gatewayPaymentId).toBe('pay_parallel_first');
      expect((await Order.findOne()).timeline.filter(row => row.note === 'Online payment verified')).toHaveLength(1);
      expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
    } finally { release(); spy.mockRestore(); }
  });
  test('failed-attempt late capture is retained as refund-required and cannot fulfil twice', async () => {
    const { gateway } = await onlineFixture();
    const failed = captureEvent(gateway, 'pay_failed_then_late'); failed.event = 'payment.failed';
    await sendGatewayEvent(failed).expect(200);
    await sendGatewayEvent(captureEvent(gateway, 'pay_failed_then_late')).expect(200);
    const payment = await Payment.findOne(); expect(payment.status).toBe('failed');
    expect(payment.refundObligations).toHaveLength(1); expect(payment.captures[0].disposition).toBe('refund_required');
    await auth(request(app).get('/api/admin/payment-refund-obligations')).expect(403);
    const admin = await Admin.create({ email: 'queue-fixture@example.invalid', password: 'FixturePasswordOnly', role: 'superAdmin' });
    const before = JSON.stringify(await Payment.findOne());
    const queue = await request(app).get('/api/admin/payment-refund-obligations?limit=1').set('Authorization', `Bearer ${jwt.sign({ id: String(admin._id), type: 'admin' }, process.env.JWT_SECRET)}`).expect(200);
    expect(queue.body.data).toHaveLength(1); expect(queue.body.data[0].obligation.gatewayPaymentId).toBe('pay_failed_then_late');
    expect(JSON.stringify(await Payment.findOne())).toBe(before);
  });
  test('money is exact at decimal tiers, fees, discounts and the confirmed inclusive checkout limit', async () => {
    const { priceOrder } = await import('../../services/pricing.service.js');
    const { toPaise, MAX_CHECKOUT_PAISE } = await import('../../utils/money.js');
    const priced = priceOrder([{ price: 0.10, qty: 3 }], {}, { ok: true, discount: 0.01 }, { deliveryFee: 0.20, sellerIncentive: 0.30 }, null, 10);
    expect(toPaise(priced.subtotal)).toBe(30); expect(toPaise(priced.totalAmount)).toBe(5079); expect(priced.tax).toBeUndefined();
    expect(toPaise(priceOrder([{ price: 99960, qty: 1 }]).totalAmount)).toBe(MAX_CHECKOUT_PAISE);
    for (const price of [99960.01, Infinity, Number.MAX_VALUE, -1, 0.001]) expect(() => priceOrder([{ price, qty: 1 }])).toThrow();
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing': { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 99960 }] } } });
    await addWholesale(1).expect(200); const q = (await quote()).body.data;
    expect(q.totals.totalAmount).toBe(100000); const result = await checkout(q.quoteHash).expect(201);
    expect((await Payment.findOne()).amount).toBe(100000); expect((await Order.findById(result.body.data.orders[0]._id)).pricing.totalAmount).toBe(100000);
  });
  test('decimal tier totals agree in product preview, cart, persisted order and provider paise', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing.priceTiers': [{ minimumQuantity: 5, unitPrice: 0.29 }, { minimumQuantity: 10, unitPrice: 0.19 }] } });
    const preview = await auth(request(app).post('/api/products/wholesale/quote')).send({ productId: product._id, variantId: product.variants[0]._id, quantity: 10 }).expect(200);
    await addWholesale(10).expect(200); const cart = (await quote()).body.data;
    expect(preview.body.data.subtotal).toBe(1.90); expect(cart.totals.subtotal).toBe(preview.body.data.subtotal);
    const placed = await checkout(cart.quoteHash, 'decimal-online-fixture', { paymentMethod: 'online' }).expect(201);
    const orderId = placed.body.data.orders[0]._id, order = await Order.findById(orderId);
    const gateway = (await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(200)).body.data;
    expect(gateway.amountPaise).toBe(4190); expect(order.pricing.totalAmount).toBe(41.90); expect((await Payment.findOne()).amount).toBe(41.90);
    await sendGatewayEvent(captureEvent(gateway, 'pay_decimal_fixture')).expect(200);
    expect((await Payment.findOne()).status).toBe('paid'); expect(order.items[0].wholesaleSnapshot.unitPrice).toBe(0.19);
  });
  test('maximum quantity wallet checkout, retry and refund preserve exact money and inventory', async () => {
    await User.updateOne({ _id: buyer._id }, { $set: { 'wallet.balance': 2000 } });
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 100000, 'variants.0.wholesalePricing': { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 0.01 }] } } });
    await addWholesale(100000).expect(200); const q = (await quote()).body.data;
    const placing = () => checkout(q.quoteHash, 'maximum-wallet-fixture-0001', { paymentMethod: 'wallet' });
    const placed = await placing().expect(201); await placing().expect(201);
    expect((await Payment.findOne()).amount).toBe(q.totals.totalAmount); expect((await User.findById(buyer._id)).wallet.balance).toBe(960);
    expect(await mongoose.models.WalletLedger.countDocuments()).toBe(1);
    await auth(request(app).patch(`/api/orders/${placed.body.data.orders[0]._id}/cancel`)).send({}).expect(200);
    expect((await User.findById(buyer._id)).wallet.balance).toBe(2000); expect((await Product.findById(product._id)).variants[0].stock).toBe(100000);
  });
});

describe('product detail read-only Wholesale preview', () => {
  const preview = quantity => auth(request(app).post('/api/products/wholesale/quote')).send({ productId: String(product._id), variantId: String(product.variants[0]._id), quantity, unitPrice: 1, subtotal: 1 });
  test.each([[5, 80, 400, 100, 5], [10, 70, 700, 300, 10], [25, 70, 1750, 750, 10]])('quantity %i uses the server tier and integer-money subtotal', async (quantity, price, subtotal, savings, tier) => {
    const before = JSON.stringify(await Product.findById(product._id));
    const response = await preview(quantity).expect(200);
    expect(response.body.data).toMatchObject({ quantity, unitPrice: price, subtotal, savings, retailUnitPrice: 100, tierMinimumQuantity: tier, minimumQuantity: 5, quantityIncrement: 5, availableStock: 25, maxQuantity: 25 });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body.data.priceTiers).toHaveLength(2);
    expect(await Cart.countDocuments()).toBe(0); expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect(JSON.stringify(await Product.findById(product._id))).toBe(before);
  });
  test.each([0, -5, 4, 6, 5.5, null, true, '', 100005])('invalid preview quantity %j is rejected', async quantity => { await preview(quantity).expect(400); });
  test('stock, variants, changed prices and seller suspension are revalidated without writes', async () => {
    await preview(30).expect(409);
    await auth(request(app).post('/api/products/wholesale/quote')).send({ productId: String(product._id), variantId: String(new mongoose.Types.ObjectId()), quantity: 5 }).expect(400);
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing.priceTiers.0.unitPrice': 79.99 } });
    expect((await preview(5).expect(200)).body.data).toMatchObject({ unitPrice: 79.99, subtotal: 399.95, savings: 100.05 });
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'suspended' } });
    await preview(5).expect(409);
    await Seller.updateOne({ _id: seller._id }, { $set: { 'wholesaleChannel.status': 'approved' } });
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.wholesalePricing.enabled': false } });
    await preview(5).expect(400);
  });
  test('customer-only preview rejects anonymous, seller and delivery tokens and malformed IDs', async () => {
    const body = { productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 5 };
    await request(app).post('/api/products/wholesale/quote').send(body).expect(401);
    await auth(request(app).post('/api/products/wholesale/quote'), vendor, 'seller').send(body).expect(403);
    await auth(request(app).post('/api/products/wholesale/quote'), buyer, 'delivery').send(body).expect(403);
    await auth(request(app).post('/api/products/wholesale/quote')).send({ ...body, productId: {} }).expect(400);
    await Category.updateOne({ _id: category._id }, { $set: { isActive: false } });
    await preview(5).expect(409);
  });
});
describe('separate wholesale cart and transactional checkout', () => {
  test('pre-staging: every issued payment attempt reconciles, duplicates and extra captures are durable', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash, 'attempt-regression-key-0001', { paymentMethod: 'online' }).expect(201);
    const orderId = placed.body.data.orders[0]._id;
    const start = () => auth(request(app).post('/api/payments/initiate')).send({ orderId });
    const first = (await start().expect(200)).body.data, second = (await start().expect(200)).body.data;
    const deliver = async (gateway, paymentId) => {
      const event = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured' } } } };
      const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex');
      return request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature).send(event);
    };
    await deliver(first, 'pay_first_regression');
    expect((await Payment.findOne()).status).toBe('paid');
    await deliver(first, 'pay_first_regression'); await deliver(second, 'pay_second_regression'); await deliver(second, 'pay_second_regression');
    const payment = await Payment.findOne();
    expect(payment.gatewayAttempts).toHaveLength(2);
    expect(payment.captures).toHaveLength(2);
    expect(payment.refundObligations).toHaveLength(1);
    expect(payment.refundObligations[0]).toMatchObject({ gatewayPaymentId: 'pay_second_regression', amountPaise: first.amountPaise, currency: 'INR', status: 'pending' });
    expect((await Order.findById(orderId)).timeline.filter(row => row.note === 'Online payment verified')).toHaveLength(1);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(20);
  });
  test('pre-staging: capture after cancellation records a durable obligation without restoring stock twice', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const placed = await checkout(q.quoteHash, 'late-capture-regression-0001', { paymentMethod: 'online' }).expect(201);
    const orderId = placed.body.data.orders[0]._id;
    const gateway = (await auth(request(app).post('/api/payments/initiate')).send({ orderId }).expect(200)).body.data;
    await auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({ reason: 'Fixture cancellation' }).expect(200);
    const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_late_regression', order_id: gateway.razorpayOrderId, amount: gateway.amountPaise, currency: 'INR', status: 'captured' } } } };
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex');
    for (let i = 0; i < 2; i++) await request(app).post('/api/payments/razorpay/webhook').set('x-razorpay-signature', signature).send(event).expect(200);
    const payment = await Payment.findOne();
    expect(payment.refundObligations).toHaveLength(1);
    expect(payment.refundObligations[0]).toMatchObject({ amountPaise: gateway.amountPaise, gatewayPaymentId: 'pay_late_regression', status: 'pending', currency: 'INR' });
    expect((await Order.findById(orderId)).status).toBe('cancelled');
    expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    await auth(request(app).patch(`/api/orders/${orderId}/cancel`)).send({}).expect(400);
    expect((await Payment.findOne()).refundObligations).toHaveLength(1);
  });
  test('pre-staging: stale additive cart write spanning checkout recomputes against the cleared cart', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const original = Cart.updateOne.bind(Cart); let release, arrived;
    const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; }); let pause = true;
    const spy = jest.spyOn(Cart, 'updateOne').mockImplementation((filter, update, options) => {
      if (pause && update.$set?.items?.length && !options?.session) { pause = false; arrived(); return barrier.then(() => original(filter, update, options)); }
      return original(filter, update, options);
    });
    try {
      const adding = addWholesale().then(result => result); await ready;
      await checkout(q.quoteHash).expect(201); release(); expect((await adding).status).toBe(200);
      expect((await Order.findOne()).items[0].qty).toBe(5);
      expect((await Cart.findOne({ userId: buyer._id, channel: 'wholesale' })).items[0].qty).toBe(5);
      await checkout(q.quoteHash).expect(201);
      expect(await Order.countDocuments()).toBe(1);
      expect((await Cart.findOne({ userId: buyer._id, channel: 'wholesale' })).items[0].qty).toBe(5);
    } finally { release(); spy.mockRestore(); }
  });
  test('pre-staging: seller User deactivation wins after eligibility reads and aborts checkout', async () => {
    await addWholesale().expect(200); const q = (await quote()).body.data;
    const original = User.updateOne.bind(User); let release, arrived;
    const barrier = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { arrived = resolve; }); let pause = true;
    const spy = jest.spyOn(User, 'updateOne').mockImplementation((filter, update, options) => {
      if (pause && String(filter._id) === String(buyer._id) && options?.session) { pause = false; arrived(); return barrier.then(() => original(filter, update, options)); }
      return original(filter, update, options);
    });
    try {
      const buying = checkout(q.quoteHash).then(result => result); await ready;
      await original({ _id: vendor._id }, { $set: { isActive: false } }); release();
      expect((await buying).status).toBe(409); expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
      expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
    } finally { release(); spy.mockRestore(); }
  });
  test('pre-staging: unsupported extreme amounts fail before cart, inventory or payment writes', async () => {
    // The original two aggregation paths disagree by one paisa despite both
    // results remaining within Number.MAX_SAFE_INTEGER.
    expect(Math.round(900719925.45 * 99999 * 100) - Math.round(900719925.45 * 100) * 99999).toBe(1);
    await Product.updateOne({ _id: product._id }, { $set: { 'variants.0.stock': 99999, 'variants.0.wholesalePricing': { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 900719925.45 }] } } });
    await auth(request(app).post('/api/products/wholesale/quote')).send({ productId: String(product._id), variantId: String(product.variants[0]._id), quantity: 99999 }).expect(400);
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).variants[0].stock).toBe(99999);
  });
  test('pre-staging: product-scoped availability avoids hydrating the full catalog', async () => {
    const find = jest.spyOn(Product, 'find');
    try {
      const response = await request(app).get(`/api/products/wholesale/availability?productId=${product._id}`).expect(200);
      expect(response.body).toEqual({ success: true, enabled: true });
      expect(find).not.toHaveBeenCalled();
    } finally { find.mockRestore(); }
    await request(app).get('/api/products/wholesale/availability?productId=bad-id').expect(400);
  });
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

// Combined logical basket: real HTTP routers and disposable replica-set transactions.
describe('customer basket mixed checkout', () => {
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
  test.each(combinations.flatMap(channels => ['cod', 'wallet', 'online'].map(method => [channels.join('+'), channels, method])))('%s (%j) with %s uses one payment, actual vendor groups, exact prices, stock, clearing and idempotent replay', async (_label, channels, method) => {
    const entries = await setupBasket(channels);
    await User.updateOne({ _id: buyer._id }, { $set: { 'wallet.balance': 10000 } });
    const q = (await basketQuote().expect(200)).body.data;
    expect(q.valid).toBe(true); expect(q.groups).toHaveLength(channels.length);
    expect(q.totals.itemCount).toBe(channels.reduce((n, channel) => n + entries[channel].qty, 0));
    const count = (await auth(request(app).get('/api/cart/summary')).expect(200)).body;
    expect(count.meta.totalItems).toBe(q.totals.itemCount);
    for (const channel of channels) {
      const group = q.groups.find(group => group.salesChannel === (channel === 'wholesale' ? 'wholesale' : 'retail') && group.channel === (channel === 'grocery' ? 'grocery' : 'ecommerce'));
      expect(String(group.seller._id)).toBe(String(entries[channel].shop._id));
      expect(group.items[0].price).toBe(channel === 'wholesale' ? 80 : 100);
      expect(group.subtotal).toBe(channel === 'wholesale' ? 400 : 200);
    }
    const placed = (await placeBasket(q, undefined, { paymentMethod: method }).expect(201)).body.data;
    expect(placed.orders).toHaveLength(channels.length); expect(await Payment.countDocuments()).toBe(1);
    expect((await Payment.findOne()).amount).toBe(q.totals.totalAmount);
    expect(placed.orders.reduce((n, order) => n + order.pricing.totalAmount, 0)).toBe(q.totals.totalAmount);
    await placeBasket(q, undefined, { paymentMethod: method }).expect(201);
    expect(await Order.countDocuments()).toBe(channels.length);
    for (const channel of channels) expect((await Product.findById(entries[channel].item._id)).variants[0].stock).toBe(100 - entries[channel].qty);
    expect((await Cart.find({ userId: buyer._id })).every(cart => cart.items.length === 0)).toBe(true);
    if (method === 'wallet') {
      expect((await User.findById(buyer._id)).wallet.balance).toBe(10000 - q.totals.totalAmount);
      expect(await mongoose.models.WalletLedger.countDocuments()).toBe(1);
    }
    if (method === 'online') {
      const gateway = await initiateFor(placed.orders[0]._id);
      expect(gateway.amountPaise).toBe(Math.round(q.totals.totalAmount * 100));
      const event = captureEvent(gateway, 'pay_basket_once');
      await sendGatewayEvent(event).expect(200); await sendGatewayEvent(event).expect(200);
      expect((await Payment.findOne()).status).toBe('paid'); expect((await Payment.findOne()).captures).toHaveLength(1);
    }
  });
  test('same vendor across channels retains financial and fulfilment boundaries; compatible items share a group', async () => {
    const entries = await setupBasket(undefined, true);
    const q = (await basketQuote()).body.data;
    expect(q.groups).toHaveLength(3); expect(new Set(q.groups.map(group => String(group.seller._id))).size).toBe(1);
    const ecom = entries.ecommerce.item;
    const second = await Product.create({ name: 'Second same-vendor item', type: 'ecommerce', category: ecom.category, sellerId: seller._id, variants: [{ name: 'Pack', price: 50, mrp: 60, stock: 50, weight: 500 }] });
    await auth(request(app).post('/api/cart')).send({ productId: second._id, variantId: second.variants[0]._id, qty: 1 }).expect(200);
    const quote = (await basketQuote()).body.data;
    expect(quote.groups).toHaveLength(3); expect(quote.groups.find(group => group.salesChannel === 'retail' && group.channel === 'ecommerce').items).toHaveLength(2);
    await placeBasket(quote).expect(201); expect(await Order.countDocuments()).toBe(3);
  });
  test.each(['wholesale-price', 'retail-price', 'retail-stock', 'seller', 'quote', 'quantity'])('%s changes invalidate the whole checkout and preserve carts', async fault => {
    const entries = await setupBasket(); const q = (await basketQuote()).body.data;
    if (fault === 'wholesale-price') await Product.updateOne({ _id: entries.wholesale.item._id }, { $set: { 'variants.0.wholesalePricing.priceTiers.0.unitPrice': 79 } });
    if (fault === 'retail-price') await Product.updateOne({ _id: entries.ecommerce.item._id }, { $set: { 'variants.0.price': 99 } });
    if (fault === 'retail-stock') await Product.updateOne({ _id: entries.grocery.item._id }, { $set: { 'variants.0.stock': 0 } });
    if (fault === 'seller') await User.updateOne({ _id: entries.wholesale.shop.userId }, { $set: { isActive: false } });
    if (fault === 'quote') q.quoteHash = 'untrusted-browser-hash';
    if (fault === 'quantity') {
      const cart = await Cart.findOne({ userId: buyer._id, channel: 'ecommerce' });
      await auth(request(app).put('/api/cart/' + cart.items[0]._id)).send({ qty: 3 }).expect(200);
    }
    await placeBasket(q).expect(409);
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0);
    expect((await Cart.find({ userId: buyer._id })).every(cart => cart.items.length === 1)).toBe(true);
    expect((await Product.findById(entries.wholesale.item._id)).variants[0].stock).toBe(100);
  });
  test.each(['payment', 'second-order', 'cart-clear'])('%s write failure rolls back every prepared group and allows safe same-key retry', async fault => {
    const entries = await setupBasket(); const q = (await basketQuote()).body.data;
    const logs = jest.spyOn(console, 'error').mockImplementation(() => {});
    let spy;
    if (fault === 'payment') spy = jest.spyOn(Payment, 'create').mockRejectedValueOnce(new Error('Isolated write failure'));
    if (fault === 'second-order') {
      const original = Order.create.bind(Order); let count = 0;
      spy = jest.spyOn(Order, 'create').mockImplementation((...args) => { if (++count === 2) throw new Error('Isolated second-order failure'); return original(...args); });
    }
    if (fault === 'cart-clear') {
      const original = Cart.updateOne.bind(Cart);
      spy = jest.spyOn(Cart, 'updateOne').mockImplementation((filter, update, options) => options?.session && update.$set?.items ? Promise.resolve({ modifiedCount: 0 }) : original(filter, update, options));
    }
    try { await placeBasket(q).expect(fault === 'cart-clear' ? 409 : 500); } finally { spy.mockRestore(); logs.mockRestore(); }
    expect(await Order.countDocuments()).toBe(0); expect(await Payment.countDocuments()).toBe(0); expect(await mongoose.models.CheckoutAttempt.countDocuments()).toBe(0);
    for (const entry of Object.values(entries)) expect((await Product.findById(entry.item._id)).variants[0].stock).toBe(100);
    expect((await Cart.find({ userId: buyer._id })).every(cart => cart.items.length === 1)).toBe(true);
    await placeBasket(q).expect(201);
  });
  test('concurrent identical checkout creates and deducts once and read-only recovery returns all orders', async () => {
    const entries = await setupBasket(); const q = (await basketQuote()).body.data;
    const results = await Promise.all([placeBasket(q), placeBasket(q)]);
    expect(results.some(result => result.status === 201)).toBe(true); expect(results.every(result => [201, 409].includes(result.status))).toBe(true);
    expect(await Order.countDocuments()).toBe(3); expect(await Payment.countDocuments()).toBe(1);
    const status = await auth(request(app).post('/api/orders/checkout-status')).set('Idempotency-Key', 'combined-basket-fixture-0001').send({ operation: 'unified' }).expect(200);
    expect(status.body.data.state).toBe('completed'); expect(status.body.data.orders).toHaveLength(3);
    expect((await Product.findById(entries.wholesale.item._id)).variants[0].stock).toBe(95);
  });
  test('online mixed cancellation refunds only its order and restores only its inventory', async () => {
    const entries = await setupBasket(); const q = (await basketQuote()).body.data;
    const placed = (await placeBasket(q, undefined, { paymentMethod: 'online' }).expect(201)).body.data;
    const gateway = await initiateFor(placed.orders[0]._id); await sendGatewayEvent(captureEvent(gateway, 'pay_basket_cancel')).expect(200);
    const wholesale = placed.orders.find(order => order.salesChannel === 'wholesale');
    await auth(request(app).patch('/api/orders/' + wholesale._id + '/cancel')).send({}).expect(200);
    expect((await Product.findById(entries.wholesale.item._id)).variants[0].stock).toBe(100);
    expect((await Product.findById(entries.ecommerce.item._id)).variants[0].stock).toBe(98);
    expect((await Payment.findOne()).refundObligations).toHaveLength(1);
    expect((await Payment.findOne()).refundObligations[0]).toMatchObject({ amountPaise: Math.round(wholesale.pricing.totalAmount * 100), status: 'pending' });
  });
  test('grouped benefits are refused; retail tip is attached once and never to Wholesale', async () => {
    await setupBasket(); const q = (await basketQuote()).body.data;
    await placeBasket(q, 'basket-coupon-fixture-0001', { coupon: 'FAKE' }).expect(400);
    await placeBasket(q, 'basket-coins-fixture-0001', { useCoins: true }).expect(400);
    const result = await placeBasket(q, undefined, { tipAmount: 10 }).expect(201);
    expect(result.body.data.orders.filter(order => order.pricing.tipAmount > 0)).toHaveLength(1);
    expect(result.body.data.orders.find(order => order.salesChannel === 'wholesale').pricing.tipAmount).toBe(0);
  });

  test.each(['quantity','seller','stock'])('concurrent %s change during a mixed transaction aborts all orders and preserves the basket', async fault=>{
    const entries=await setupBasket();const q=(await basketQuote()).body.data;
    const original=User.updateOne.bind(User);let release,arrived,pause=true;
    const barrier=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{arrived=resolve;});
    const spy=jest.spyOn(User,'updateOne').mockImplementation((filter,update,options)=>{
      if(pause&&String(filter._id)===String(buyer._id)&&options?.session){pause=false;arrived();return barrier.then(()=>original(filter,update,options));}
      return original(filter,update,options);
    });
    const logs=jest.spyOn(console,'error').mockImplementation(()=>{});
    try{
      const buying=placeBasket(q).then(result=>result);await ready;
      if(fault==='quantity'){
        const cart=await Cart.findOne({userId:buyer._id,channel:'wholesale'});
        await auth(request(app).put('/api/cart/wholesale/'+cart.items[0]._id)).send({qty:10}).expect(200);
      }
      if(fault==='seller')await original({_id:entries.wholesale.shop.userId},{$set:{isActive:false}});
      if(fault==='stock')await Product.updateOne({_id:entries.grocery.item._id},{$set:{'variants.0.stock':0}});
      release();expect((await buying).status).toBe(409);
      expect(await Order.countDocuments()).toBe(0);expect(await Payment.countDocuments()).toBe(0);
      expect((await Cart.find({userId:buyer._id})).every(cart=>cart.items.length===1)).toBe(true);
      expect((await Product.findById(entries.wholesale.item._id)).variants[0].stock).toBe(100);
    }finally{release();spy.mockRestore();logs.mockRestore();}
  });
  test('mixed online initialization timeout remains recoverable without duplicate checkout or settlement',async()=>{
    await setupBasket();const q=(await basketQuote()).body.data;const placed=(await placeBasket(q,undefined,{paymentMethod:'online'}).expect(201)).body.data;
    const {getRazorpayClient}=await import('../../services/razorpay.service.js');getRazorpayClient().orders.create.mockRejectedValueOnce(new Error('Isolated unknown provider result'));
    await auth(request(app).post('/api/payments/initiate')).send({orderId:placed.orders[0]._id}).expect(503);
    await auth(request(app).post('/api/payments/initiate')).send({orderId:placed.orders[0]._id}).expect(409);
    await placeBasket(q,undefined,{paymentMethod:'online'}).expect(201);
    expect(await Order.countDocuments()).toBe(3);expect(await Payment.countDocuments()).toBe(1);
    expect((await Payment.findOne()).gatewayAttempts[0].status).toBe('creation_unknown');
    expect((await Payment.findOne()).captures).toHaveLength(0);
  });
  test('digital basket preview preserves zero shipping and mixed digital checkout is rejected without clearing',async()=>{
    const entries=await setupBasket(['ecommerce']);
    await Product.updateOne({_id:entries.ecommerce.item._id},{$set:{fulfillmentType:'digital','variants.0.stock':0}});
    await Cart.updateOne({userId:buyer._id,channel:'ecommerce'},{$set:{'items.0.qty':1,'items.0.fulfillmentType':'digital'}});
    const digital=(await basketQuote()).body.data;expect(digital.valid).toBe(true);expect(digital.totals.deliveryCharge).toBe(0);expect(digital.groups[0].items[0].fulfillmentType).toBe('digital');
    await auth(request(app).post('/api/cart/wholesale')).send({productId:entries.wholesale.item._id,variantId:entries.wholesale.item.variants[0]._id,qty:5}).expect(200);
    await placeBasket((await basketQuote()).body.data).expect(400);
    expect(await Order.countDocuments()).toBe(0);expect((await Cart.find({userId:buyer._id})).every(cart=>cart.items.length===1)).toBe(true);
  });
  test('same product and variant in retail and Wholesale retain separate prices and deduct combined stock once',async()=>{
    await Product.updateOne({_id:product._id},{$set:{sellingChannels:['ecommerce','wholesale']}});
    await auth(request(app).post('/api/cart')).send({productId:product._id,variantId:product.variants[0]._id,qty:2}).expect(200);await addWholesale(5).expect(200);
    const q=(await basketQuote()).body.data;expect(q.groups).toHaveLength(2);expect(q.groups.map(group=>group.items[0].price).sort()).toEqual([100,80].sort());
    await placeBasket(q).expect(201);expect((await Product.findById(product._id)).variants[0].stock).toBe(18);
  });
  test('different vendors within one retail channel generate distinct delivery charges and orders',async()=>{
    const entries=await setupBasket(['ecommerce']);const second=await Product.create({name:'Second vendor same channel',type:'ecommerce',category:entries.ecommerce.item.category,sellerId:entries.wholesale.shop._id,variants:[{name:'Pack',price:50,mrp:60,stock:25,weight:500}]});
    await auth(request(app).post('/api/cart')).send({productId:second._id,variantId:second.variants[0]._id,qty:1}).expect(200);
    const q=(await basketQuote()).body.data;expect(q.groups).toHaveLength(2);expect(q.totals.deliveryCharge).toBe(q.groups.reduce((n,g)=>n+g.deliveryCharge,0));
    await placeBasket(q).expect(201);expect(await Order.countDocuments()).toBe(2);
  });

  test('aggregate review and the compatibility read preserve unavailable lines instead of silently deleting them',async()=>{
    const entries=await setupBasket(['grocery','wholesale']);await Product.updateOne({_id:entries.grocery.item._id},{$set:{'variants.0.stock':0}});
    await auth(request(app).get('/api/cart?channel=grocery&preserveUnavailable=true')).expect(200);
    const q=(await basketQuote()).body.data;expect(q.valid).toBe(false);expect(q.groups.flatMap(g=>g.items)).toHaveLength(2);expect(q.totals).toBeNull();
    expect((await Cart.findOne({userId:buyer._id,channel:'grocery'})).items).toHaveLength(1);
  });
  test('combined retail and Wholesale demand cannot oversell one shared variant',async()=>{
    await Product.updateOne({_id:product._id},{$set:{sellingChannels:['ecommerce','wholesale']}});
    await auth(request(app).post('/api/cart')).send({productId:product._id,variantId:product.variants[0]._id,qty:20}).expect(200);await addWholesale(10).expect(200);
    const q=(await basketQuote()).body.data;expect(q.valid).toBe(false);expect(q.totals).toBeNull();await placeBasket(q).expect(409);
    expect(await Order.countDocuments()).toBe(0);expect((await Product.findById(product._id)).variants[0].stock).toBe(25);
  });
});
