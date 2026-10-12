import { jest } from '@jest/globals';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

// This suite keeps the actual Express routes, middleware, controllers, input
// validation, OTP verifier, and webhook signature verifier. Only persistence
// and image storage are substituted, so it never needs MongoDB or Cloudinary.
const users = new Map();
const sellers = new Map();
const admins = new Map();
const products = new Map();
const categories = new Map();
const orders = new Map();
const payments = new Map();
const productFindById = jest.fn();
const productFindOne = jest.fn();
const productUpdateOne = jest.fn();

const queryResult = (value) => ({
  select() { return this; },
  populate() { return this; },
  sort() { return this; },
  lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const User = {
  findOne: jest.fn(async ({ phone }) => [...users.values()].find((user) => user.phone === phone) || null),
  findById: jest.fn((id) => queryResult(users.get(String(id)) || null)),
  updateOne: jest.fn(async () => ({ acknowledged: true })),
};
const Admin = {
  findById: jest.fn((id) => queryResult(admins.get(String(id)) || null)),
};
const Seller = {
  findOne: jest.fn(async ({ userId }) => sellers.get(String(userId)) || null),
  findById: jest.fn(async (id) => [...sellers.values()].find((seller) => String(seller._id) === String(id)) || null),
  find: jest.fn(() => queryResult([...sellers.values()])),
  create: jest.fn(async (data) => {
    const seller = {
      _id: new mongoose.Types.ObjectId(),
      salesChannels: ['ecommerce'],
      ...data,
      async save() { sellers.set(String(this.userId), this); return this; },
    };
    sellers.set(String(seller.userId), seller);
    return seller;
  }),
};
const Category = {
  find: jest.fn((filter = {}) => queryResult([...categories.values()].filter((category) => {
    if (filter.isActive !== undefined && category.isActive !== filter.isActive) return false;
    if (typeof filter.type === 'string' && category.type !== filter.type) return false;
    if (filter.type?.$in && !filter.type.$in.includes(category.type)) return false;
    return true;
  }))),
  findById: jest.fn(async (id) => categories.get(String(id)) || null),
  exists: jest.fn(async () => null),
};
const Product = {
  create: jest.fn(async (data) => {
    const product = {
      ...data,
      _id: new mongoose.Types.ObjectId(),
      async populate() { return this; },
      async save() { products.set(String(this._id), this); return this; },
    };
    products.set(String(product._id), product);
    return product;
  }),
  find: jest.fn(() => queryResult([...products.values()])),
  findOne: productFindOne,
  updateOne: productUpdateOne,
  findById: productFindById,
};
const Order = {
  findById: jest.fn(async (id) => {
    if (!mongoose.Types.ObjectId.isValid(String(id))) {
      return Promise.reject(Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' }));
    }
    return orders.get(String(id)) || null;
  }),
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
};
const Payment = {
  findById: jest.fn((id) => {
    const value = payments.get(String(id)) || null;
    return {
      session: async () => value,
      then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
    };
  }),
  findOne: jest.fn(async ({ 'gateway.merchantOrderId': merchantOrderId }) =>
    [...payments.values()].find((payment) => payment.gateway?.merchantOrderId === merchantOrderId) || null),
};

jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/Admin.js', () => ({ default: Admin }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: Seller }));
jest.unstable_mockModule('../../models/Category.js', () => ({ default: Category }));
jest.unstable_mockModule('../../models/Product.js', () => ({ default: Product }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/Payment.js', () => ({ default: Payment }));
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({
  uploadToCloudinary: jest.fn(async () => 'https://test.invalid/product.png'),
  uploadFileWithMeta: jest.fn(async () => ({ url: 'https://test.invalid/file.png' })),
}));

process.env.PHONEPE_WEBHOOK_USERNAME = 'http-test-user';
process.env.PHONEPE_WEBHOOK_SECRET = 'http-test-secret';
process.env.PHONEPE_MOCK = 'true';

const [{ default: authRoutes }, { default: productRoutes }, { default: paymentRoutes },
  { default: categoryRoutes },
  { errorHandler }, { JWT_SECRET }, { protect, requireAdmin }, { requireApprovedSeller },
  { startOnboarding, requestWholesaleChannel, updateSalesChannels }, { decideSellerWholesaleChannel, getWholesaleManagementSummary }] = await Promise.all([
  import('../../routes/auth.routes.js'),
  import('../../routes/product.routes.js'),
  import('../../routes/payment.routes.js'),
  import('../../routes/category.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
  import('../../middlewares/auth.middleware.js'),
  import('../../middlewares/vendor.middleware.js'),
  import('../../controllers/seller.controller.js'),
  import('../../controllers/admin.controller.js'),
]);

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/payments', paymentRoutes);
app.post('/api/sellers/start', protect, startOnboarding);
app.post('/api/sellers/wholesale-request', protect, requireApprovedSeller, requestWholesaleChannel);
app.patch('/api/sellers/channels', protect, requireApprovedSeller, updateSalesChannels);
app.patch('/api/admin/sellers/:id/wholesale', protect, requireAdmin, decideSellerWholesaleChannel);
app.get('/api/admin/wholesale/summary', protect, requireAdmin, getWholesaleManagementSummary);
app.use(errorHandler);

const tokenFor = (userId, role) => jwt.sign(
  { id: String(userId), type: 'user', ...(role ? { role } : {}) },
  JWT_SECRET,
);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const makePayment = (fields = {}) => {
  const payment = {
    _id: new mongoose.Types.ObjectId(),
    userId: shopper._id,
    amount: 60,
    method: 'online',
    status: 'pending',
    attempts: 0,
    gateway: {},
    saveCalls: 0,
    ...fields,
    async save() { this.saveCalls += 1; payments.set(String(this._id), this); return this; },
  };
  payments.set(String(payment._id), payment);
  return payment;
};

let sellerUser;
let otherSellerUser;
let shopper;
let adminUser;
let sellerToken;
let otherSellerToken;
let shopperToken;
let adminToken;
let categoryId;

beforeEach(() => {
  users.clear(); admins.clear(); sellers.clear(); products.clear(); categories.clear(); orders.clear(); payments.clear();
  jest.clearAllMocks();

  sellerUser = { _id: new mongoose.Types.ObjectId(), phone: '9300000001', name: 'Seller One', roles: ['buyer', 'seller'], isActive: true };
  otherSellerUser = { _id: new mongoose.Types.ObjectId(), phone: '9300000002', name: 'Seller Two', roles: ['buyer', 'seller'], isActive: true };
  shopper = { _id: new mongoose.Types.ObjectId(), phone: '9300000003', name: 'Buyer', roles: ['buyer'], isActive: true };
  adminUser = { _id: new mongoose.Types.ObjectId(), name: 'Test Admin', isActive: true };
  [sellerUser, otherSellerUser, shopper].forEach((user) => users.set(String(user._id), user));
  admins.set(String(adminUser._id), adminUser);
  sellers.set(String(sellerUser._id), { _id: new mongoose.Types.ObjectId(), userId: sellerUser._id, status: 'approved', salesChannels: ['ecommerce'], businessName: 'One Shop', storeDetails: { name: 'One Shop' }, async save() { sellers.set(String(this.userId), this); return this; } });
  sellers.set(String(otherSellerUser._id), { _id: new mongoose.Types.ObjectId(), userId: otherSellerUser._id, status: 'approved', salesChannels: ['ecommerce'], businessName: 'Two Shop', storeDetails: { name: 'Two Shop' }, async save() { sellers.set(String(this.userId), this); return this; } });
  categoryId = new mongoose.Types.ObjectId();
  categories.set(String(categoryId), { _id: categoryId, name: 'Test Leaf', type: 'ecommerce', isActive: true });
  sellerToken = tokenFor(sellerUser._id, 'seller');
  otherSellerToken = tokenFor(otherSellerUser._id, 'seller');
  shopperToken = tokenFor(shopper._id);
  adminToken = jwt.sign({ id: String(adminUser._id), type: 'admin' }, JWT_SECRET);
  productFindOne.mockImplementation((filter) => queryResult([...products.values()].find((product) =>
    String(product._id) === String(filter._id) && String(product.sellerId) === String(filter.sellerId) && !product.isDeleted) || null));
  productUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
});

describe('mocked HTTP seller and product API', () => {
  test.each([
    [['ecommerce'], ['ecommerce']],
    [['grocery'], ['grocery']],
    [['ecommerce', 'grocery'], ['ecommerce', 'grocery']],
  ])('seller onboarding persists canonical sales channels %j', async (salesChannels, expected) => {
    const applicant = { _id: new mongoose.Types.ObjectId(), phone: '9300000099', roles: ['buyer'], isActive: true };
    users.set(String(applicant._id), applicant);
    await request(app).post('/api/sellers/start').send({ salesChannels }).expect(401);
    const response = await request(app).post('/api/sellers/start')
      .set(bearer(tokenFor(applicant._id)))
      .send({ salesChannels }).expect(200);
    expect(sellers.get(String(applicant._id)).salesChannels).toEqual(expected);
    expect(response.body.seller.salesChannels).toEqual(expected);
    expect(response.body.salesChannels).toEqual(expected);
    expect(response.body.channelSelectionDefaulted).toBe(false);
  });

  test('seller onboarding rejects missing-invalid forms but explicitly flags the legacy omitted-channel default', async () => {
    const applicant = { _id: new mongoose.Types.ObjectId(), phone: '9300000098', roles: ['buyer'], isActive: true };
    users.set(String(applicant._id), applicant);
    const token = bearer(tokenFor(applicant._id));

    await request(app).post('/api/sellers/start').set(token).send({ salesChannels: [] }).expect(400);
    await request(app).post('/api/sellers/start').set(token).send({ salesChannels: ['quick'] }).expect(400);
    expect(Seller.create).not.toHaveBeenCalled();

    const legacy = await request(app).post('/api/sellers/start').set(token).send({}).expect(200);
    expect(legacy.body.salesChannels).toEqual(['ecommerce']);
    expect(legacy.body.channelSelectionDefaulted).toBe(true);
    const retry = await request(app).post('/api/sellers/start').set(token).send({}).expect(200);
    expect(retry.body.salesChannels).toEqual(['ecommerce']);
  });

  test('multiple phone-based seller registrations do not require an email address', async () => {
    for (const phone of ['9300000096', '9300000097']) {
      const applicant = { _id: new mongoose.Types.ObjectId(), phone, roles: ['buyer'], isActive: true };
      users.set(String(applicant._id), applicant);
      const response = await request(app).post('/api/sellers/start')
        .set(bearer(tokenFor(applicant._id)))
        .send({ salesChannels: ['ecommerce'] })
        .expect(200);
      expect(response.body.seller.email).toBeUndefined();
    }
  });

  test('duplicate-key errors return a safe registration message instead of a MongoDB error', async () => {
    const applicant = { _id: new mongoose.Types.ObjectId(), phone: '9300000095', roles: ['buyer'], isActive: true };
    users.set(String(applicant._id), applicant);
    Seller.create.mockRejectedValueOnce(Object.assign(
      new Error('E11000 duplicate key error collection: bulkimart.sellers index: email_1 dup key: { email: null }'),
      { code: 11000, keyPattern: { email: 1 }, keyValue: { email: null } },
    ));

    const response = await request(app).post('/api/sellers/start')
      .set(bearer(tokenFor(applicant._id)))
      .send({ salesChannels: ['ecommerce'] })
      .expect(409);

    expect(response.body.message).toMatch(/registration is temporarily unavailable/i);
    expect(response.body.message).not.toMatch(/E11000|collection:|index:|dup key/i);
    expect(response.body.stack).toBeUndefined();
  });

  test('the onboarding endpoint cannot change channels for an already approved seller', async () => {
    const seller = sellers.get(String(sellerUser._id));
    const before = [...(seller.salesChannels || ['ecommerce'])];
    await request(app).post('/api/sellers/start').set(bearer(sellerToken))
      .send({ salesChannels: ['grocery'] }).expect(409);
    expect(seller.salesChannels || ['ecommerce']).toEqual(before);
  });

  test('Wholesale must be requested separately; seller channel payload cannot self-activate it', async () => {
    const seller = sellers.get(String(sellerUser._id));
    await request(app).post('/api/sellers/wholesale-request').set(bearer(shopperToken)).expect(403);
    const requestResponse = await request(app).post('/api/sellers/wholesale-request')
      .set(bearer(sellerToken)).send({}).expect(202);
    expect(requestResponse.body.status).toBe('pending');
    expect(seller.salesChannels).toEqual(['ecommerce']);

    await request(app).patch('/api/sellers/channels').set(bearer(sellerToken))
      .send({ channels: ['ecommerce', 'wholesale'] }).expect(403);
    expect(seller.salesChannels).toEqual(['ecommerce']);
  });

  test('admin approval activates only a pending Wholesale request and retail channel updates retain it', async () => {
    const seller = sellers.get(String(sellerUser._id));
    seller.wholesaleChannel = { status: 'pending', requestedAt: new Date() };
    await request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`)
      .set(bearer(sellerToken)).send({ status: 'approved' }).expect(403);
    const approved = await request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`)
      .set(bearer(adminToken)).send({ status: 'approved' }).expect(200);
    expect(approved.body.data.salesChannels).toEqual(['ecommerce', 'wholesale']);
    expect(seller.wholesaleChannel.status).toBe('approved');

    const retailUpdate = await request(app).patch('/api/sellers/channels').set(bearer(sellerToken))
      .send({ channels: ['grocery'] }).expect(200);
    expect(retailUpdate.body.salesChannels).toEqual(['grocery', 'wholesale']);
  });

  test('admin can suspend and restore Wholesale access; suspended sellers cannot self-request restoration', async () => {
    const seller = sellers.get(String(sellerUser._id));
    seller.wholesaleChannel = { status: 'approved' };
    seller.salesChannels.push('wholesale');
    await request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`).set(bearer(adminToken))
      .send({ status: 'suspended', suspensionReason: 'Review required' }).expect(200);
    expect(seller.wholesaleChannel.status).toBe('suspended');
    expect(seller.salesChannels).not.toContain('wholesale');
    await request(app).post('/api/sellers/wholesale-request').set(bearer(sellerToken)).expect(409);

    await request(app).patch(`/api/admin/sellers/${seller._id}/wholesale`).set(bearer(adminToken))
      .send({ status: 'approved' }).expect(200);
    expect(seller.wholesaleChannel.status).toBe('approved');
    expect(seller.salesChannels).toContain('wholesale');
  });

  test('public availability and admin Wholesale counts derive from eligible catalog data', async () => {
    const seller = sellers.get(String(sellerUser._id));
    seller.wholesaleChannel = { status: 'approved' };
    seller.salesChannels.push('wholesale');
    const variantId = new mongoose.Types.ObjectId();
    const product = {
      _id: new mongoose.Types.ObjectId(), name: 'Test bulk product', sellerId: seller._id,
      type: 'ecommerce', status: 'approved', isActive: true, isDeleted: false,
      variants: [{ _id: variantId, name: 'Case', sku: 'CASE-1', stock: 30, wholesalePricing: {
        enabled: true, minimumQuantity: 10, quantityIncrement: 5,
        priceTiers: [{ minimumQuantity: 10, unitPrice: 20 }],
      } }],
    };
    products.set(String(product._id), product);

    const availability = await request(app).get('/api/products/wholesale/availability').expect(200);
    expect(availability.body.enabled).toBe(true);
    expect(availability.body).not.toHaveProperty('data');

    await request(app).get('/api/admin/wholesale/summary').set(bearer(shopperToken)).expect(403);
    const admin = await request(app).get('/api/admin/wholesale/summary').set(bearer(adminToken)).expect(200);
    expect(admin.body.data.counts.eligibleProducts).toBe(1);
    expect(admin.body.data.counts.eligibleVariants).toBe(1);
    expect(admin.body.data.counts.availableVariants).toBe(1);
    expect(admin.body.data.offers[0].variants[0].minimumQuantity).toBe(10);
  });

  test('active category APIs expose only Shop All and Quick, while both remain queryable', async () => {
    categories.set(String(categoryId), { _id: categoryId, name: 'Test Leaf', type: 'ecommerce', isActive: true });
    const quickId = new mongoose.Types.ObjectId();
    categories.set(String(quickId), { _id: quickId, name: 'Quick Leaf', type: 'grocery', isActive: true });
    const legacyId = new mongoose.Types.ObjectId();
    categories.set(String(legacyId), { _id: legacyId, name: 'Legacy category', type: 'shg', isActive: true });

    await request(app).get('/api/categories?type=shg').expect(200).expect([]);
    const ecommerce = await request(app).get('/api/categories?type=ecommerce').expect(200);
    const grocery = await request(app).get('/api/categories?type=grocery').expect(200);
    const stats = await request(app).get('/api/categories/stats').expect(200);
    expect(ecommerce.body.map((category) => category.name)).toEqual(['Test Leaf']);
    expect(grocery.body.map((category) => category.name)).toEqual(['Quick Leaf']);
    expect(stats.body.data).not.toHaveProperty('shg');
    expect(stats.body.data.ecommerce.total).toBe(1);
    expect(stats.body.data.grocery.total).toBe(1);
  });

  test('seller OTP accepts only the mock OTP for a registered account', async () => {
    await request(app).post('/api/auth/seller/send-otp').send({ phone: '9399999999' }).expect(404);
    await request(app).post('/api/auth/seller/send-otp').send({ phone: sellerUser.phone }).expect(200);
    await request(app).post('/api/auth/seller/verify-otp').send({ phone: sellerUser.phone, otp: '0000' }).expect(400);
    const response = await request(app).post('/api/auth/seller/verify-otp')
      .send({ phone: sellerUser.phone, otp: '1234' }).expect(200);
    expect(response.body.token).toBeTruthy();
  });

  test('seller-only listing rejects missing and buyer auth, and /seller/mine reaches its handler', async () => {
    await request(app).get('/api/products/seller/mine').expect(401);
    await request(app).get('/api/products/seller/mine').set(bearer(shopperToken)).expect(403);
    const response = await request(app).get('/api/products/seller/mine').set(bearer(sellerToken)).expect(200);
    expect(response.body).toEqual([]);
    expect(productFindById).not.toHaveBeenCalled();
  });

  test('product creation validates variants, stores an image URL, and blocks cross-seller edits', async () => {
    await request(app).post('/api/products').set(bearer(sellerToken))
      .field('type', 'ecommerce').field('name', 'Bad Variant').field('category', String(categoryId))
      .field('variants', JSON.stringify([{ name: 'Pack', price: 20, mrp: 10, stock: 2, unit: 'piece' }]))
      .attach('images', Buffer.from('image'), { filename: 'item.png', contentType: 'image/png' })
      .expect(400);
    expect(Product.create).not.toHaveBeenCalled();

    const created = await request(app).post('/api/products').set(bearer(sellerToken))
      .field('type', 'ecommerce').field('name', 'Valid Product').field('category', String(categoryId))
      .field('variants', JSON.stringify([{ name: 'Pack', price: 20, mrp: 25, stock: 4, unit: 'piece' }]))
      .attach('images', Buffer.from('image'), { filename: 'item.png', contentType: 'image/png' })
      .expect(201);
    expect(created.body.product.images).toEqual(['https://test.invalid/product.png']);

    const product = products.get(created.body.product._id);
    productFindById.mockResolvedValue(product);
    await request(app).put(`/api/products/${product._id}`).set(bearer(otherSellerToken))
      .send({ name: 'Unauthorized edit' }).expect(403);
    expect(product.name).toBe('Valid Product');
  });

  test('wholesale variant pricing needs an approved channel and does not replace the retail price', async () => {
    const payload = (price) => JSON.stringify([{
      name: 'Case', price, mrp: 30, stock: 20, unit: 'piece',
      wholesalePricing: {
        enabled: true, minimumQuantity: 5, quantityIncrement: 5,
        priceTiers: [{ minimumQuantity: 5, unitPrice: 18 }, { minimumQuantity: 10, unitPrice: 16 }],
      },
    }]);
    const route = () => request(app).post('/api/products').set(bearer(sellerToken))
      .field('type', 'ecommerce').field('name', 'Wholesale Eligible Product').field('category', String(categoryId))
      .field('variants', payload(24))
      .attach('images', Buffer.from('image'), { filename: 'item.png', contentType: 'image/png' });

    await route().expect(403);
    expect(Product.create).not.toHaveBeenCalled();

    const seller = sellers.get(String(sellerUser._id));
    seller.salesChannels = ['ecommerce', 'wholesale'];
    await route().expect(403); // a forged channel field alone is not approval
    seller.wholesaleChannel = { status: 'approved', decidedAt: new Date(), decidedBy: adminUser._id };
    const response = await route().expect(201);
    expect(response.body.product.variants[0].price).toBe(24);
    expect(response.body.product.variants[0].wholesalePricing.priceTiers[0].unitPrice).toBe(18);
  });

  test('malformed bulk workbook is rejected without reaching seller persistence', async () => {
    await request(app).post('/api/products/bulk/upload').set(bearer(sellerToken))
      .attach('excelFile', Buffer.from('not a workbook'), {
        filename: 'malformed.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }).expect(400);
    expect(products.size).toBe(0);
  });

  test('seller can update only owned variant wholesale terms without sending retail price or stock writes', async () => {
    const seller = sellers.get(String(sellerUser._id));
    seller.salesChannels.push('wholesale');
    seller.wholesaleChannel = { status: 'approved' };
    const productId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    products.set(String(productId), {
      _id: productId,
      sellerId: seller._id,
      isDeleted: false,
      variants: [{ _id: variantId, name: 'Case', price: 24, stock: 25 }],
    });

    const response = await request(app).patch(`/api/products/${productId}/wholesale-pricing`)
      .set(bearer(sellerToken)).send({ variants: [{ variantId, wholesalePricing: {
        enabled: true,
        minimumQuantity: 5,
        quantityIncrement: 5,
        priceTiers: [{ minimumQuantity: 5, unitPrice: 18 }, { minimumQuantity: 10, unitPrice: 16 }],
      } }] }).expect(200);

    expect(response.body.variants[0].wholesalePricing.minimumQuantity).toBe(5);
    const [, update] = productUpdateOne.mock.calls.at(-1);
    expect(update.$set['variants.$[wholesaleVariant0].wholesalePricing'].enabled).toBe(true);
    expect(JSON.stringify(update)).not.toMatch(/"(?:price|stock|sellerId)"/);
    expect(products.get(String(productId)).variants[0]).toMatchObject({ price: 24, stock: 25 });
  });

  test('invalid wholesale tiers are rejected without writing product changes', async () => {
    const seller = sellers.get(String(sellerUser._id));
    seller.salesChannels.push('wholesale');
    seller.wholesaleChannel = { status: 'approved' };
    const productId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    products.set(String(productId), { _id: productId, sellerId: seller._id, isDeleted: false, variants: [{ _id: variantId }] });

    await request(app).patch(`/api/products/${productId}/wholesale-pricing`).set(bearer(sellerToken)).send({ variants: [{ variantId, wholesalePricing: {
      enabled: true, minimumQuantity: 5, quantityIncrement: 5,
      priceTiers: [{ minimumQuantity: 5, unitPrice: 18 }, { minimumQuantity: 5, unitPrice: 16 }],
    } }] }).expect(400);
    expect(productUpdateOne).not.toHaveBeenCalled();
  });

  test('unapproved sellers and sellers editing another seller product cannot enable a wholesale offer', async () => {
    const productId = new mongoose.Types.ObjectId();
    const variantId = new mongoose.Types.ObjectId();
    const seller = sellers.get(String(sellerUser._id));
    seller.wholesaleChannel = { status: 'pending' };
    products.set(String(productId), {
      _id: productId, sellerId: seller._id, isDeleted: false,
      variants: [{ _id: variantId, name: 'Case', price: 24, stock: 25 }],
    });
    const payload = { variants: [{ variantId, wholesalePricing: { enabled: true, minimumQuantity: 5, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 5, unitPrice: 18 }] } }] };
    await request(app).patch(`/api/products/${productId}/wholesale-pricing`).set(bearer(sellerToken)).send(payload).expect(403);
    expect(productUpdateOne).not.toHaveBeenCalled();

    seller.wholesaleChannel.status = 'approved';
    seller.salesChannels.push('wholesale');
    const otherProductId = new mongoose.Types.ObjectId();
    products.set(String(otherProductId), { _id: otherProductId, sellerId: sellers.get(String(otherSellerUser._id))._id, isDeleted: false, variants: [{ _id: variantId }] });
    await request(app).patch(`/api/products/${otherProductId}/wholesale-pricing`).set(bearer(sellerToken)).send(payload).expect(404);
    expect(productUpdateOne).not.toHaveBeenCalled();
  });

  test('read-only wholesale catalog filters ineligible offers and uses canonical variant stock', async () => {
    const approvedSeller = sellers.get(String(sellerUser._id));
    approvedSeller.salesChannels.push('wholesale');
    approvedSeller.wholesaleChannel = { status: 'approved' };
    approvedSeller.userId = { _id: sellerUser._id, isActive: true };
    const variantId = new mongoose.Types.ObjectId();
    const item = {
      _id: new mongoose.Types.ObjectId(), name: 'Bulk beans', description: 'Catalog item', images: [],
      category: { _id: categoryId, name: 'Test Leaf' }, sellerId: approvedSeller._id,
      sellerName: 'One Shop', type: 'ecommerce', price: 25, stock: 3,
      variants: [
        { _id: variantId, name: 'Bag', sku: 'BEAN-1', price: 25, stock: 3, unit: 'kg', wholesalePricing: {
          enabled: true, minimumQuantity: 5, quantityIncrement: 5,
          priceTiers: [{ minimumQuantity: 5, unitPrice: 20 }],
        } },
        { _id: new mongoose.Types.ObjectId(), name: 'Large bag', sku: 'BEAN-2', price: 45, stock: 0, unit: 'kg', wholesalePricing: {
          enabled: true, minimumQuantity: 10, quantityIncrement: 5,
          priceTiers: [{ minimumQuantity: 10, unitPrice: 36 }],
        } },
      ],
    };
    Seller.find.mockImplementation(() => queryResult([approvedSeller]));
    Product.find.mockImplementation(() => queryResult([item]));

    const response = await request(app).get('/api/products/wholesale/catalog').set(bearer(shopperToken)).expect(200);
    expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].variants).toHaveLength(2);
      expect(response.body.data[0].variants[0]).toMatchObject({ variantId: String(variantId), available: true, availableStock: 3, minimumQuantity: 5 });
      expect(response.body.data[0].variants[1]).toMatchObject({ available: false, availableStock: 0, minimumQuantity: 10 });
    expect(response.body.data[0]).not.toHaveProperty('price');
    expect(response.body.data[0].variants[0]).not.toHaveProperty('price');
    expect(Product.find.mock.calls.at(-1)[0].status).toBe('approved');
    expect(Product.find.mock.calls.at(-1)[0].isActive).toBe(true);
    expect(Seller.find.mock.calls.at(-1)[0]).toMatchObject({ status: 'approved', salesChannels: 'wholesale', 'wholesaleChannel.status': 'approved' });
  });

    test('Wholesale catalog requires an authenticated customer and does not require business verification', async () => {
      await request(app).get('/api/products/wholesale/catalog').expect(401);
      Seller.find.mockImplementation(() => queryResult([]));
      const response = await request(app).get('/api/products/wholesale/catalog').set(bearer(shopperToken)).expect(200);
      expect(response.body.data).toEqual([]);
    });
});

describe('mocked HTTP payment API', () => {
  test('initiation validates references and enforces order ownership', async () => {
    await request(app).post('/api/payments/initiate').set(bearer(shopperToken)).send({}).expect(400);
    await request(app).post('/api/payments/initiate').set(bearer(shopperToken)).send({ orderId: 'not-an-id' }).expect(400);
    const missingOrderId = new mongoose.Types.ObjectId();
    await request(app).post('/api/payments/initiate').set(bearer(shopperToken))
      .send({ orderId: String(missingOrderId) }).expect(404);

    const orderId = new mongoose.Types.ObjectId();
    orders.set(String(orderId), {
      _id: orderId,
      orderNo: 'TEST-ORDER-HTTP',
      userId: sellerUser._id,
      status: 'placed',
      paymentId: new mongoose.Types.ObjectId(),
      pricing: { totalAmount: 60 },
    });
    await request(app).post('/api/payments/initiate').set(bearer(shopperToken)).send({ orderId: String(orderId) }).expect(403);

    const ownedOrderId = new mongoose.Types.ObjectId();
    const ownedPaymentId = new mongoose.Types.ObjectId();
    orders.set(String(ownedOrderId), {
      _id: ownedOrderId,
      orderNo: 'TEST-ORDER-OWNED',
      userId: shopper._id,
      status: 'placed',
      paymentId: ownedPaymentId,
      pricing: { totalAmount: 60 },
    });
    makePayment({ _id: ownedPaymentId });
    const started = await request(app).post('/api/payments/initiate').set(bearer(shopperToken))
      .send({ orderId: String(ownedOrderId) }).expect(200);
    expect(started.body.data.redirectUrl).toContain('mock-phonepe');
  });

  test('webhook rejects missing/invalid signatures and safely acknowledges unknown and duplicate events', async () => {
    const signature = `SHA256 ${crypto.createHash('sha256').update('http-test-user:http-test-secret').digest('hex')}`;
    const payload = { event: 'checkout.order.completed', payload: { merchantOrderId: 'UNKNOWN-REF' } };
    await request(app).post('/api/payments/webhook').send(payload).expect(401);
    await request(app).post('/api/payments/webhook').set('Authorization', 'SHA256 bad').send(payload).expect(401);

    // Unknown references are acknowledged to prevent an endless provider retry;
    // duplicate acknowledgement is the implemented behavior for this branch.
    await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);
    await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);

    const noReference = { event: 'checkout.order.completed', payload: {} };
    await request(app).post('/api/payments/webhook').set('Authorization', signature).send(noReference).expect(200);
  });

  test('a matched signed payment event settles once; a duplicate does not repeat settlement', async () => {
    const signature = `SHA256 ${crypto.createHash('sha256').update('http-test-user:http-test-secret').digest('hex')}`;
    const payment = makePayment({ gateway: { provider: 'phonepe', merchantOrderId: 'MATCHED-REF' } });
    Payment.findOne.mockResolvedValue(payment);
    const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
    const payload = { event: 'checkout.order.completed', payload: { merchantOrderId: 'MATCHED-REF', orderId: 'GATEWAY-REF' } };

    try {
      await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);
      expect(payment.status).toBe('paid');
      await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);
      expect(startSession).toHaveBeenCalledTimes(1);
      expect(payment.status).toBe('paid');
    } finally {
      startSession.mockRestore();
    }
  });

  test('a failed payment remains retryable at the order and a duplicate failure has no second settlement side effect', async () => {
    const signature = `SHA256 ${crypto.createHash('sha256').update('http-test-user:http-test-secret').digest('hex')}`;
    const orderId = new mongoose.Types.ObjectId();
    orders.set(String(orderId), { _id: orderId, status: 'placed' });
    const payment = makePayment({
      orderId,
      gateway: { provider: 'phonepe', merchantOrderId: 'FAILED-REF' },
    });
    Payment.findOne.mockResolvedValue(payment);
    const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
    const payload = { event: 'checkout.order.failed', payload: { merchantOrderId: 'FAILED-REF', orderId: 'GATEWAY-FAILED' } };

    try {
      await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);
      expect(payment.status).toBe('failed');
      expect(orders.get(String(orderId)).status).toBe('placed');
      await request(app).post('/api/payments/webhook').set('Authorization', signature).send(payload).expect(200);
      expect(startSession).toHaveBeenCalledTimes(1);
      expect(payment.saveCalls).toBe(1);
      expect(Order.updateMany).not.toHaveBeenCalled();
    } finally {
      startSession.mockRestore();
    }
  });

  test('repeated authenticated status polls reconcile a pending payment only once', async () => {
    const orderId = new mongoose.Types.ObjectId();
    const paymentId = new mongoose.Types.ObjectId();
    const merchantOrderId = 'POLL-RETRY-REF';
    orders.set(String(orderId), {
      _id: orderId,
      orderNo: 'POLL-RETRY-ORDER',
      userId: shopper._id,
      status: 'placed',
      paymentId,
      pricing: { totalAmount: 60 },
    });
    const payment = makePayment({
      _id: paymentId,
      orderId,
      gateway: { provider: 'phonepe', merchantOrderId },
    });
    await request(app).post('/api/payments/mock-set-state').send({ merchantOrderId, state: 'COMPLETED' }).expect(200);
    const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
    const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
    try {
      const first = await request(app).get(`/api/payments/${orderId}/status`).set(bearer(shopperToken)).expect(200);
      const repeated = await request(app).get(`/api/payments/${orderId}/status`).set(bearer(shopperToken)).expect(200);
      expect(first.body.data.status).toBe('paid');
      expect(repeated.body.data.status).toBe('paid');
      expect(payment.saveCalls).toBe(1);
      expect(Order.updateMany).toHaveBeenCalledTimes(1);
      expect(startSession).toHaveBeenCalledTimes(1);
    } finally {
      startSession.mockRestore();
    }
  });
});
