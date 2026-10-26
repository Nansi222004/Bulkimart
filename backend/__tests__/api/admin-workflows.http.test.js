import { jest } from '@jest/globals';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

const buyer = { _id: new mongoose.Types.ObjectId(), isActive: true, roles: ['buyer'] };
const admin = { _id: new mongoose.Types.ObjectId(), isActive: true, role: 'admin' };
// Finance routes need explicit manage_finance permission (financePermission.middleware.js).
const financeAdmin = { _id: new mongoose.Types.ObjectId(), isActive: true, role: 'admin', permissions: ['manage_finance'] };
const admins = new Map([[String(admin._id), admin], [String(financeAdmin._id), financeAdmin]]);
const ledgerBalances = new Map();
const products = [];
const categories = [];
const sellerRecords = new Map();
const deliveryRates = [];
const orders = [];
const partners = new Map();
const Admin = { findById: jest.fn((id) => ({ select: async () => admins.get(String(id)) || null })) };
const User = {
  findById: jest.fn((id) => ({ select: async () => String(id) === String(buyer._id) ? buyer : null })),
  findByIdAndUpdate: jest.fn(async () => ({ acknowledged: true })),
};
const listQuery = (rows = []) => ({
  populate() { return this; },
  select() { return this; },
  sort() { return this; },
  skip() { return this; },
  limit: async () => rows,
  lean: async () => rows,
});
const Seller = {
  find: jest.fn(() => listQuery([...sellerRecords.values()])),
  findById: jest.fn(async (id) => sellerRecords.get(String(id)) || null),
  countDocuments: jest.fn(async () => sellerRecords.size),
};
const Product = {
  find: jest.fn(() => listQuery(products)),
  findById: jest.fn(async (id) => products.find((product) => String(product._id) === String(id)) || null),
  countDocuments: jest.fn(async () => products.length),
};
const Order = {
  find: jest.fn(() => ({
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    lean: async () => orders,
  })),
  countDocuments: jest.fn(async () => orders.length),
};
const Category = {
  exists: jest.fn(async () => null),
  create: jest.fn(async (data) => {
    const category = { ...data, _id: new mongoose.Types.ObjectId(), async save() { return this; } };
    categories.push(category);
    return category;
  }),
  findById: jest.fn(async (id) => categories.find((category) => String(category._id) === String(id)) || null),
};
const RadiusSetting = {
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
  create: jest.fn(async ([data]) => [{ ...data, _id: new mongoose.Types.ObjectId() }]),
  findOne: jest.fn(() => ({ sort() { return this; }, lean: async () => null })),
};
const DeliveryPartner = { findById: jest.fn(async (id) => partners.get(String(id)) || null) };
const DeliveryRate = {
  updateMany: jest.fn(async () => ({ modifiedCount: 0 })),
  create: jest.fn(async ([data]) => {
    const row = { ...data, _id: new mongoose.Types.ObjectId() };
    deliveryRates.unshift(row);
    return [row];
  }),
  find: jest.fn(() => ({ sort() { return this; }, lean: async () => deliveryRates })),
};
jest.unstable_mockModule('../../models/Admin.js', () => ({ default: Admin }));
jest.unstable_mockModule('../../models/User.js', () => ({ default: User }));
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: Seller }));
jest.unstable_mockModule('../../models/Product.js', () => ({ default: Product }));
jest.unstable_mockModule('../../models/Order.js', () => ({ default: Order }));
jest.unstable_mockModule('../../models/Category.js', () => ({ default: Category }));
jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({ default: DeliveryPartner }));
jest.unstable_mockModule('../../models/DeliveryRate.js', () => ({ default: DeliveryRate }));
// Rider rates may only go live once a customer distance tariff is approved.
const customerTariff = { current: null };
jest.unstable_mockModule('../../models/DeliveryChargeSetting.js', () => ({
  default: { findOne: jest.fn(() => ({ sort() { return this; }, lean: async () => customerTariff.current })) },
}));
jest.unstable_mockModule('../../models/RadiusSetting.js', () => ({
  default: RadiusSetting,
  RADIUS_HARD_SAFETY_CEILING_KM: 100,
}));
// Seller earnings are read from the ledger; balances come from this fixture map.
jest.unstable_mockModule('../../services/sellerLedger.service.js', () => ({
  sellerBalances: jest.fn(async (sellerId) => ledgerBalances.get(String(sellerId)) || { pending: 0, held: 0, eligible: 0, reserved: 0, settled: 0 }),
  postLedgerEntry: jest.fn(async () => { throw new Error('Ledger writes are not expected in admin workflow tests'); }),
  effectiveAccountExpr: { $ifNull: ['$account', 'seller_payable'] },
}));
jest.unstable_mockModule('../../services/cloudinary.service.js', () => ({
  uploadToCloudinary: jest.fn(async () => 'https://test.invalid/category.png'),
  uploadFileWithMeta: jest.fn(async () => ({ url: 'https://test.invalid/file', publicId: 'test-file' })),
}));

const [{ default: adminRoutes }, { default: categoryRoutes }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../routes/admin.routes.js'),
  import('../../routes/category.routes.js'),
  import('../../middlewares/error.middleware.js'),
  import('../../config/jwt.js'),
]);
const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/categories', categoryRoutes);
app.use(errorHandler);
const buyerToken = jwt.sign({ id: String(buyer._id), type: 'user' }, JWT_SECRET);
const adminToken = jwt.sign({ id: String(admin._id), type: 'admin' }, JWT_SECRET);
const financeAdminToken = jwt.sign({ id: String(financeAdmin._id), type: 'admin' }, JWT_SECRET);
const as = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  products.length = 0;
  categories.length = 0;
  sellerRecords.clear();
  deliveryRates.length = 0;
  orders.length = 0;
  partners.clear();
  ledgerBalances.clear();
  customerTariff.current = null;
  jest.clearAllMocks();
});

test('retired organization-seller administration endpoints are not exposed', async () => {
  await request(app).get('/api/admin/nhc/plans').set(as(adminToken)).expect(404);
  await request(app).get('/api/admin/nhc/applications').set(as(adminToken)).expect(404);
});

test('admin seller/product operations require admin authentication and return mocked records', async () => {
  await request(app).get('/api/admin/sellers').expect(401);
  await request(app).get('/api/admin/sellers').set(as(buyerToken)).expect(403);
  await request(app).get('/api/admin/products').set(as(buyerToken)).expect(403);

  const sellers = await request(app).get('/api/admin/sellers').set(as(adminToken)).expect(200);
  expect(sellers.body.success).toBe(true);
  expect(Seller.find).toHaveBeenCalled();
  const catalog = await request(app).get('/api/admin/products').set(as(adminToken)).expect(200);
  expect(catalog.body.success).toBe(true);
  expect(Product.find).toHaveBeenCalled();
});

test('admin can create a category through the existing protected category route', async () => {
  await request(app).post('/api/categories').set(as(buyerToken)).send({ name: 'Rejected by auth', type: 'ecommerce' }).expect(403);
  const response = await request(app).post('/api/categories').set(as(adminToken))
    .send({ name: 'Mock Admin Category', type: 'ecommerce', showOnHome: true }).expect(201);
  expect(response.body.category).toMatchObject({
    name: 'Mock Admin Category',
    type: 'ecommerce',
    slug: 'ecommerce--mock-admin-category',
    isPopular: false,
    showOnHome: true,
  });
  expect(categories).toHaveLength(1);
});

test('admin delivery-radius configuration validates all three values before any write', async () => {
  await request(app).post('/api/admin/radius-settings').set(as(buyerToken))
    .send({ sameDayMaxRadiusKm: 8, sellerServiceMaxRadiusKm: 10, deliveryPartnerMaxRadiusKm: 12 }).expect(403);
  await request(app).post('/api/admin/radius-settings').set(as(adminToken))
    .send({ sameDayMaxRadiusKm: 8, sellerServiceMaxRadiusKm: 10 }).expect(400);
  await request(app).post('/api/admin/radius-settings').set(as(adminToken))
    .send({ sameDayMaxRadiusKm: 101, sellerServiceMaxRadiusKm: 10, deliveryPartnerMaxRadiusKm: 12 }).expect(400);
  expect(RadiusSetting.updateMany).not.toHaveBeenCalled();
  expect(RadiusSetting.create).not.toHaveBeenCalled();
});

test('admin seller approval and rejection update only the mocked seller and grant seller role on approval', async () => {
  const sellerUserId = new mongoose.Types.ObjectId();
  const approvedCandidate = {
    _id: new mongoose.Types.ObjectId(), userId: sellerUserId, status: 'pending', onboardingStep: 5,
    async save() { return this; },
  };
  sellerRecords.set(String(approvedCandidate._id), approvedCandidate);
  await request(app).patch(`/api/admin/sellers/${approvedCandidate._id}/approve`).set(as(buyerToken)).send({}).expect(403);
  await request(app).patch(`/api/admin/sellers/${approvedCandidate._id}/approve`).set(as(adminToken))
    .send({ commissionRate: 7.5 }).expect(200);
  expect(approvedCandidate.status).toBe('approved');
  expect(approvedCandidate.commissionRate).toBe(7.5);
  expect(User.findByIdAndUpdate).toHaveBeenCalledWith(sellerUserId, { $addToSet: { roles: 'seller' } });

  const rejectedCandidate = {
    _id: new mongoose.Types.ObjectId(), status: 'pending', onboardingStep: 5,
    async save() { return this; },
  };
  sellerRecords.set(String(rejectedCandidate._id), rejectedCandidate);
  await request(app).patch(`/api/admin/sellers/${rejectedCandidate._id}/reject`).set(as(adminToken)).send({}).expect(400);
  await request(app).patch(`/api/admin/sellers/${rejectedCandidate._id}/reject`).set(as(adminToken))
    .send({ reason: 'Test fixture rejection' }).expect(200);
  expect(rejectedCandidate.status).toBe('rejected');
  expect(rejectedCandidate.rejectionReason).toBe('Test fixture rejection');
});

test('admin product moderation and category update use guarded protected writes', async () => {
  const product = { _id: new mongoose.Types.ObjectId(), status: 'pending', isActive: false, async save() { return this; } };
  products.push(product);
  await request(app).patch(`/api/admin/products/${product._id}/approve`).set(as(buyerToken)).send({}).expect(403);
  await request(app).patch(`/api/admin/products/${product._id}/approve`).set(as(adminToken)).send({}).expect(200);
  expect(product).toMatchObject({ status: 'approved', isActive: true });

  const created = await request(app).post('/api/categories').set(as(adminToken))
    .send({ name: 'Update Me', type: 'grocery' }).expect(201);
  const category = created.body.category;
  const categoryRecord = categories[0];
  await request(app).put(`/api/categories/${category._id}`).set(as(buyerToken)).send({ name: 'Nope' }).expect(403);
  await request(app).put(`/api/categories/${category._id}`).set(as(adminToken))
    .send({ name: 'Updated Category', type: 'ecommerce' }).expect(400);
  expect(categoryRecord.name).toBe('Update Me');
  await request(app).put(`/api/categories/${category._id}`).set(as(adminToken))
    .send({ name: 'Updated Category', description: 'Updated through API' }).expect(200);
  expect(categoryRecord).toMatchObject({ name: 'Updated Category', description: 'Updated through API' });
});

test('valid admin rider rate writes are isolated and malformed rates are rejected before writes', async () => {
  const rate = { mode: 'quick', base: 10, perKm: 20, minPayout: 25, maxPayout: 100, note: 'Fixture rate review' };
  await request(app).post('/api/admin/delivery-rates').set(as(adminToken)).send(rate).expect(403);
  const unexplained = await request(app).post('/api/admin/delivery-rates').set(as(financeAdminToken))
    .send({ ...rate, note: '' }).expect(400);
  expect(unexplained.body.message).toMatch(/audit reason/);
  const invalid = await request(app).post('/api/admin/delivery-rates').set(as(financeAdminToken))
    .send({ ...rate, minPayout: 50, maxPayout: 40 }).expect(400);
  expect(invalid.body.message).toMatch(/Maximum payout/);
  expect(DeliveryRate.create).not.toHaveBeenCalled();

  const transaction = { withTransaction: async (callback) => callback(), endSession: jest.fn(async () => {}) };
  const startSession = jest.spyOn(mongoose, 'startSession').mockResolvedValue(transaction);
  try {
    // Without explicit activation a rate is saved as a draft and changes nothing live.
    const draft = await request(app).post('/api/admin/delivery-rates').set(as(financeAdminToken)).send(rate).expect(200);
    expect(draft.body.data).toMatchObject({ mode: 'quick', base: 10, perKm: 20, minPayout: 25, maxPayout: 100, isActive: false, note: 'Fixture rate review' });
    expect(DeliveryRate.updateMany).not.toHaveBeenCalled();

    // Going live needs an approved customer distance tariff first.
    await request(app).post('/api/admin/delivery-rates').set(as(financeAdminToken)).send({ ...rate, isActive: true }).expect(409);
    customerTariff.current = { distanceRates: { quick: 12, same_day: 18 } };
    const live = await request(app).post('/api/admin/delivery-rates').set(as(financeAdminToken)).send({ ...rate, isActive: true }).expect(200);
    expect(live.body.data).toMatchObject({ isActive: true });
    expect(DeliveryRate.updateMany).toHaveBeenCalledWith({ mode: 'quick', isActive: true }, { $set: { isActive: false } }, { session: transaction });
    expect(DeliveryRate.create).toHaveBeenCalledTimes(2);
  } finally {
    startSession.mockRestore();
  }
});

// Rider payouts are paid from ledger-backed requests; sweeping a rider's
// unreserved pending counter into "paid" is disabled so money cannot be paid twice.
test('bulk rider payout settlement is refused and never moves a rider balance', async () => {
  const partner = {
    _id: new mongoose.Types.ObjectId(), earnings: { pending: 123.45, paid: 10 },
    bankDetails: { upiId: 'test@upi' },
    async save() { throw new Error('a refused settlement must not save'); },
  };
  partners.set(String(partner._id), partner);
  await request(app).patch(`/api/admin/rider-payouts/${partner._id}/settle`).set(as(buyerToken)).send({}).expect(403);
  await request(app).patch(`/api/admin/rider-payouts/${partner._id}/settle`).set(as(adminToken)).send({}).expect(403);
  const refused = await request(app).patch(`/api/admin/rider-payouts/${partner._id}/settle`).set(as(financeAdminToken)).send({}).expect(409);
  expect(refused.body.message).toMatch(/verified reservation/);
  expect(partner.earnings).toEqual({ pending: 123.45, paid: 10 });
});

// Seller earnings come from the ledger (commission already applied at posting),
// never from re-multiplying order lines by Seller.commissionRate.
test('admin vendor earnings report the ledger balance, not a recomputed legacy commission', async () => {
  const sellerId = new mongoose.Types.ObjectId();
  sellerRecords.set(String(sellerId), {
    _id: sellerId,
    status: 'approved',
    businessName: 'Fixture Seller',
    commissionRate: 7.5,
    storeDetails: { name: 'Fixture Store', city: 'Pune' },
    userId: { name: 'Fixture Owner', phone: '9000000001' },
  });
  orders.push({ status: 'delivered', items: [{ sellerId, price: 19.99, qty: 3 }] });
  ledgerBalances.set(String(sellerId), { pending: 0, held: 12.5, eligible: 41.25, reserved: 0, settled: 100 });

  await request(app).get('/api/admin/vendor-earnings').set(as(adminToken)).expect(403);
  const response = await request(app).get('/api/admin/vendor-earnings').set(as(financeAdminToken)).expect(200);
  expect(response.body.data.coverage).toMatchObject({ source: 'seller_ledger_entries' });
  expect(response.body.data.rows[0]).toMatchObject({ businessName: 'Fixture Seller', netPayable: 41.25, status: 'Eligible', balances: { held: 12.5, settled: 100 } });
  expect(response.body.data.rows[0]).not.toHaveProperty('platformFee');
  expect(response.body.data.summary).toMatchObject({ vendorCount: 1, totalNetPayable: 41.25 });
});

test('admin order management is protected and returns real handler-mapped order rows', async () => {
  const order = {
    _id: new mongoose.Types.ObjectId(), orderNo: 'ADMIN-ORDER-1', type: 'grocery', status: 'placed',
    items: [{ sellerId: { _id: new mongoose.Types.ObjectId(), businessName: 'Fixture Shop', storeDetails: { name: 'Fixture Shop' } }, qty: 2 }],
    shippingAddress: { name: 'Fixture Buyer', city: 'Pune' }, pricing: { totalAmount: 99.5 },
  };
  orders.push(order);
  await request(app).get('/api/admin/vendor-orders?mode=active').set(as(buyerToken)).expect(403);
  const response = await request(app).get('/api/admin/vendor-orders?mode=active').set(as(adminToken)).expect(200);
  expect(Order.find).toHaveBeenCalledWith({ status: { $in: ['pending', 'placed', 'confirmed', 'preparing', 'dispatched', 'accepted', 'processing', 'packing', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'dispatch'] } });
  expect(response.body.data[0]).toMatchObject({ orderNo: 'ADMIN-ORDER-1', status: 'placed', storeNames: 'Fixture Shop', totalAmount: 99.5, itemCount: 2 });
});
