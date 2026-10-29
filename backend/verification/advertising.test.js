import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import Admin from '../models/Admin.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Promotion from '../models/SellerPromotion.js';
import Package from '../models/PromotionPackage.js';
import Payment from '../models/Payment.js';
import Notification from '../models/Notification.js';
import { advertisingRouter } from '../routes/advertising.routes.js';
import { advertisingPublicRouter } from '../routes/advertisingPublic.routes.js';
import { advertisingPilotCapabilities } from '../services/advertisingPolicy.service.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { settleSellerPromotionPayment } from '../controllers/sellerPromotion.controller.js';
import { JWT_SECRET } from '../config/jwt.js';
let app;
let db, user, other, seller, category, product, admin, reviewer, configurer, pack;
const auth = (r, u = user, type = 'user', role = 'seller') => r.set('Authorization', `Bearer ${jwt.sign({ id: String(u._id), type, role }, JWT_SECRET)}`);
const input = () => ({ name: 'Synthetic category campaign', module: 'ECOMMERCE', categoryId: String(category._id),
  items: [{ productId: String(product._id), ...(product.variants?.length ? { variantId: String(product.variants[0]._id) } : {}) }], packageId: String(pack.id), requestedStartAt: new Date(Date.now() + 86400000).toISOString() });
const packageInput = () => ({ name: 'Synthetic configurable package', module: 'ECOMMERCE', durationDays: 9, maxProducts: 2,
  amountPaise: 12345, categories: [], isActive: true, reason: 'Synthetic test configuration',
  policies: { sellerPause: 'Pending approved terms', attribution: { windowHours: 19, conversionEvent: 'DELIVERED', model: 'LAST_CLICK' } } });
const make = async (body = input()) => (await auth(request(app).post('/seller/campaigns')).send(body).expect(201)).body.data;
const submit = async row => (await auth(request(app).post(`/seller/campaigns/${row.id}/submit`)).send({ version: row.version, packageVersion: pack.version }).expect(200)).body.data;
const decide = (row, action, u = reviewer, extra = {}) => auth(request(app).post(`/admin/campaigns/${row.id}/${action}`), u, 'admin').send({ version: row.version, reason: 'Synthetic decision', ...extra });
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri('advertising-isolated'));
  for (const m of [User, Seller, Admin, Product, Category, Promotion, Package, Payment]) await m.init();
});
beforeEach(async () => {
  // Fresh router rate-limit stores per isolated HTTP fixture; retain real limits.
  app = express(); app.use(express.json());
  app.use('/seller', advertisingRouter()); app.use('/admin', advertisingRouter(true));
  app.use('/public', advertisingPublicRouter); app.use(errorHandler);
  delete process.env.ADVERTISING_CATEGORY_PILOT_ENABLED;
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  [user, other] = await User.create([{ phone: '9876500901', roles: ['seller', 'buyer'] }, { phone: '9876500902', roles: ['seller'] }]);
  seller = await Seller.create({ userId: user._id, status: 'approved', salesChannels: ['ecommerce'] });
  await Seller.create({ userId: other._id, status: 'approved', salesChannels: ['ecommerce'] });
  category = await Category.create({ name: 'Synthetic category', slug: 'synthetic-ads', type: 'ecommerce' });
  product = await Product.create({ sellerId: seller._id, name: 'Synthetic product', type: 'ecommerce', category: category._id, price: 10, mrp: 12, stock: 8, unit: 'piece', status: 'approved', isActive: true });
  const admins = ['superAdmin', 'admin', 'admin'].map((role, i) => ({ _id: new mongoose.Types.ObjectId(), email: `ads-${i}@example.test`, role, isActive: true, permissions: i === 1 ? ['advertising_review'] : i === 2 ? ['advertising_configure'] : [] }));
  await Admin.collection.insertMany(admins); [admin, reviewer, configurer] = admins;
  pack = (await auth(request(app).post('/admin/packages'), admin, 'admin').send(packageInput()).expect(201)).body.data;
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); delete process.env.ADVERTISING_MANAGEMENT_ENABLED; delete process.env.ADVERTISING_CATEGORY_PILOT_ENABLED; });
test('management is enabled without env flags; gateway readiness is still required', async () => {
  delete process.env.ADVERTISING_MANAGEMENT_ENABLED;
  const r = await auth(request(app).get('/seller/capabilities')).expect(200);
  expect(r.body.data).toMatchObject({ managementEnabled: true, pilotEnabled: true, paymentsEnabled: false, deliveryEnabled: false });
  expect(r.headers['cache-control']).toBe('private, no-store');
  await auth(request(app).post('/seller/campaigns')).send(input()).expect(201);
});
test('seller identity, live membership, activity and approval are mandatory', async () => {
  await request(app).get('/seller/campaigns').expect(401);
  await auth(request(app).get('/seller/campaigns'), user, 'user', 'buyer').expect(403);
  await auth(request(app).get('/seller/campaigns'), admin, 'admin').expect(403);
  await Seller.updateOne({ _id: seller._id }, { $set: { status: 'suspended' } });
  await auth(request(app).get('/seller/campaigns')).expect(403);
});
test('fine-grained admin permissions cannot configure or review each others areas', async () => {
  await auth(request(app).post('/admin/packages'), reviewer, 'admin').send(packageInput()).expect(403);
  await auth(request(app).get('/admin/campaigns'), configurer, 'admin').expect(403);
  const pending = await submit(await make());
  await decide(pending, 'approve', configurer).expect(403);
  await decide(pending, 'approve').expect(200);
});
test('seller isolation applies to detail, edits, submission and payment stubs', async () => {
  const row = await make();
  await auth(request(app).get(`/seller/campaigns/${row.id}`), other).expect(404);
  for (const suffix of ['submit', 'payment-attempts', 'payment-verification']) await auth(request(app).post(`/seller/campaigns/${row.id}/${suffix}`), other).send({ version: 0 }).expect(404);
  await auth(request(app).patch(`/seller/campaigns/${row.id}`), other).send({ version: 0, name: 'Hijack' }).expect(404);
});
test('foreign products, invalid channels, invalid references and injected state are rejected', async () => {
  await auth(request(app).post('/seller/campaigns'), other).send(input()).expect(409);
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), module: 'WHOLESALE' }).expect(400);
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), categoryId: { $ne: null } }).expect(400);
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), funding: 'FUNDED' }).expect(400);
});
test.each([{ stock: 0, 'variants.0.stock': 0 }, { isActive: false }, { isDeleted: true }, { status: 'rejected' }, { sellingChannels: ['wholesale'] }])('live product ineligibility prevents authoring: %p', async change => {
  await Product.updateOne({ _id: product._id }, { $set: change });
  await auth(request(app).post('/seller/campaigns')).send(input()).expect(409);
});
test('category ancestry and seller channel eligibility are enforced', async () => {
  const parent = await Category.create({ name: 'Inactive parent', slug: 'inactive', type: 'ecommerce', isActive: false });
  await Category.updateOne({ _id: category._id }, { $set: { parent: parent._id } });
  await auth(request(app).post('/seller/campaigns')).send(input()).expect(409);
});
test('package snapshots are immutable across later administrative changes', async () => {
  const pending = await submit(await make());
  await auth(request(app).patch(`/admin/packages/${pack.id}`), admin, 'admin').send({ ...packageInput(), version: 1, amountPaise: 98765, durationDays: 13 }).expect(200);
  const approved = (await decide(pending, 'approve').expect(200)).body.data;
  expect(approved.terms).toMatchObject({ packageVersion: 1, amountPaise: 12345, durationDays: 9, policies: { attribution: { windowHours: 19 } } });
  expect(approved).toMatchObject({ review: 'APPROVED', funding: 'UNPAID', delivery: 'NOT_SCHEDULED', approvedRevision: 1 });
  expect(approved.history.at(-1).actorId).toBeUndefined();
  expect(await Payment.countDocuments({})).toBe(0);
});
test('submission requires explicit confirmation of the current package version', async () => {
  const row = await make();
  await auth(request(app).post(`/seller/campaigns/${row.id}/submit`)).send({ version: row.version }).expect(409);
  await auth(request(app).post(`/seller/campaigns/${row.id}/submit`)).send({ version: row.version, packageVersion: 99 }).expect(409);
  expect((await Promotion.findById(row.id)).advertising.review).toBe('DRAFT');
});
test('catalogue is bounded, seller-owned and does not return private wholesale metadata', async () => {
  const r = await auth(request(app).get('/seller/products?module=ECOMMERCE&limit=1')).expect(200);
  expect(r.body.meta.total).toBe(1); expect(r.body.data[0].id).toBe(String(product._id));
  expect(JSON.stringify(r.body)).not.toMatch(/wholesalePricing|bankDetails|digitalFile/);
  const otherCatalog = await auth(request(app).get('/seller/products?module=ECOMMERCE'), other).expect(200);
  expect(otherCatalog.body.data).toHaveLength(0);
});
test('edits require a current version and invalidate previous review and terms', async () => {
  const pending = await submit(await make());
  await auth(request(app).patch(`/seller/campaigns/${pending.id}`)).send({ version: pending.version, name: 'Blocked' }).expect(409);
  const changes = (await decide(pending, 'request-changes').expect(200)).body.data;
  const edited = (await auth(request(app).patch(`/seller/campaigns/${changes.id}`)).send({ version: changes.version, name: 'Corrected' }).expect(200)).body.data;
  expect(edited.review).toBe('DRAFT'); expect(edited.revision).toBe(2); expect(edited.terms).toBeUndefined();
  await auth(request(app).patch(`/seller/campaigns/${edited.id}`)).send({ version: changes.version, name: 'Stale' }).expect(409);
});
test('concurrent review decisions commit exactly once with one audit decision', async () => {
  const pending = await submit(await make());
  const results = await Promise.all([decide(pending, 'approve'), decide(pending, 'reject')]);
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const row = await Promotion.findById(pending.id); expect(row.advertising.history).toHaveLength(3);
});
test('approval rechecks products, and cancelled drafts cannot be submitted', async () => {
  const pending = await submit(await make()); await Product.updateOne({ _id: product._id }, { $set: { stock: 0, 'variants.0.stock': 0 } });
  await decide(pending, 'approve').expect(409);
  await Product.updateOne({ _id: product._id }, { $set: { stock: 8, 'variants.0.stock': 8 } });
  const draft = await make();
  const r = await auth(request(app).post(`/seller/campaigns/${draft.id}/actions`)).send({ version: draft.version, action: 'cancel' }).expect(200);
  await auth(request(app).post(`/seller/campaigns/${draft.id}/submit`)).send({ version: r.body.data.version }).expect(409);
});
test('packages validate dynamic amounts, duration, attribution, placement and archive semantics', async () => {
  for (const change of [{ amountPaise: 1.2 }, { durationDays: 0 }, { placement: 'SEARCH' }, { policies: { attribution: { windowHours: 0 } } }]) await auth(request(app).post('/admin/packages'), admin, 'admin').send({ ...packageInput(), ...change }).expect(400);
  const archived = await auth(request(app).patch(`/admin/packages/${pack.id}`), admin, 'admin').send({ ...packageInput(), version: 1, isActive: false, archived: true }).expect(200);
  expect(archived.body.data.archivedAt).toBeTruthy();
  expect((await auth(request(app).get('/seller/packages')).expect(200)).body.data).toHaveLength(0);
  await auth(request(app).patch(`/admin/packages/${pack.id}`), admin, 'admin').send({ ...packageInput(), version: 2 }).expect(409);
});
test('legacy records never enter v2 queries or acquire v2 defaults', async () => {
  const legacy = await Promotion.create({ sellerId: seller._id, module: 'ECOMMERCE', title: 'Historical ad', status: 'ACTIVE' });
  expect(legacy.advertising).toBeUndefined();
  await auth(request(app).get(`/seller/campaigns/${legacy._id}`)).expect(404);
  const row = await make();
  const listed = await auth(request(app).get('/seller/campaigns?limit=1')).expect(200);
  expect(listed.body.meta.total).toBe(1); expect(listed.body.data[0].id).toBe(row.id);
  await auth(request(app).get('/seller/campaigns?review=UNKNOWN')).expect(400);
  await auth(request(app).get('/seller/campaigns?limit=1.5')).expect(400);
});
test('blocked payment endpoints and legacy settlement cannot fund or activate v2 campaigns', async () => {
  const row = await submit(await make());
  await decide(row, 'approve').expect(200);
  for (const path of ['payment-attempts', 'payment-verification']) await auth(request(app).post(`/seller/campaigns/${row.id}/${path}`)).send({}).expect(503);
  const before = await Promotion.findById(row.id).lean();
  const payment = await Payment.create({ userId: user._id, sellerPromotionId: row.id, amount: 1, method: 'online' });
  await settleSellerPromotionPayment({ payment, state: 'COMPLETED', gatewayOrderId: 'synthetic-old-callback' });
  expect(await Promotion.findById(row.id).lean()).toEqual(before);
});

const pilotSchedule = () => ({ enabled: true, startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() });
async function pilot() {
  const pending = await submit(await make());
  const approved = (await decide(pending, 'approve').expect(200)).body.data;
  return (await decide(approved, 'pilot', reviewer, pilotSchedule()).expect(200)).body.data;
}
const placements = (extra = {}) => request(app).get('/public/placements').query({ type: 'ecommerce', category: String(category._id), ...extra });
test('pilot is explicit, permission gated and cannot mark unpaid service as funded', async () => {
  const pending = await submit(await make());
  const approved = (await decide(pending, 'approve').expect(200)).body.data;
  await decide(approved, 'pilot', configurer, pilotSchedule()).expect(403);
  const r = await decide(approved, 'pilot', reviewer, pilotSchedule()).expect(200);
  expect(r.body.data).toMatchObject({ funding: 'UNPAID', delivery: 'NOT_SCHEDULED', pilot: { enabled: true, billable: false } });
  expect(r.body.data.pilot.authorizedBy).toBeUndefined();
  expect((await Promotion.findById(approved.id)).status).toBe('DISABLED');
  expect(await Payment.countDocuments({})).toBe(0);
  const result = await placements().expect(200);
  expect(result.body.data).toHaveLength(1);
  expect(result.body.data[0]).toMatchObject({ disclosure: 'Sponsored', mode: 'NON_BILLABLE_PILOT', product: { _id: String(product._id) } });
  expect(JSON.stringify(result.body)).not.toMatch(/amountPaise|sellerPromotionId|authorizedBy|userId|bankDetails|wholesalePricing/);
});
test('ordinary approved unpaid campaigns and historical active promotions do not serve', async () => {
  const pending = await submit(await make()); await decide(pending, 'approve').expect(200);
  await Promotion.create({ sellerId: seller._id, module: 'ECOMMERCE', status: 'ACTIVE', selectedProducts: [product._id] });
  expect((await placements()).body.data).toEqual([]);
});
test('legacy management/pilot flags cannot disable an authorized local pilot', async () => {
  await pilot(); delete process.env.ADVERTISING_CATEGORY_PILOT_ENABLED;
  expect((await placements()).body.data).toHaveLength(1);
  process.env.ADVERTISING_CATEGORY_PILOT_ENABLED = 'false'; process.env.ADVERTISING_MANAGEMENT_ENABLED = 'false';
  expect((await placements()).body.data).toHaveLength(1);
});
test.each(['NODE_ENV','DEPLOYMENT_ENV','APP_ENV','VERCEL_ENV','RENDER_ENV'])('production aliases block pilot: %s', async key => {
  const row = await pilot(); const previous = process.env[key]; process.env[key] = 'production';
  try {
    expect(advertisingPilotCapabilities()).toMatchObject({ pilotEnabled: false, productionBlocked: true });
    expect((await placements()).body.data).toEqual([]);
    await decide(row, 'pilot', reviewer, pilotSchedule()).expect(503);
  } finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
});
test.each([
  ['advertising.review', 'REJECTED'], ['advertising.funding','FUNDED'], ['advertising.delivery','ADMIN_SUSPENDED'],
  ['advertising.approvedRevision',99], ['advertising.pilot.revision',99],
  ['advertising.pilot.enabled',false], ['advertising.pilot.endAt',new Date(0)],
  ['advertising.pilot.startAt',new Date(Date.now()+86400000)],
])('campaign eligibility is rechecked on every request: %s', async (field, value) => {
  const row = await pilot(); await Promotion.updateOne({ _id: row.id }, { $set: { [field]: value } });
  expect((await placements()).body.data).toEqual([]);
});
test('seller suspension, revoked role and deactivated accounts suppress pilot products', async () => {
  await pilot();
  await Seller.updateOne({ _id: seller._id }, { $set: { status: 'suspended' } }); expect((await placements()).body.data).toEqual([]);
  await Seller.updateOne({ _id: seller._id }, { $set: { status: 'approved' } });
  await User.updateOne({ _id: user._id }, { $set: { isActive: false } }); expect((await placements()).body.data).toEqual([]);
  await User.updateOne({ _id: user._id }, { $set: { isActive: true, roles: ['buyer'] } }); expect((await placements()).body.data).toEqual([]);
});
test.each([{ isActive:false },{ status:'rejected' },{ isDeleted:true },{ 'variants.0.stock':0 },{ sellingChannels:['wholesale'] }])('product visibility and selected variant availability: %p', async change => {
  await pilot(); await Product.updateOne({ _id: product._id }, { $set: change });
  expect((await placements()).body.data).toEqual([]);
});
test('category/channel matching and active ancestry are required', async () => {
  await pilot(); const otherCategory = await Category.create({ name:'Other', slug:'other-pilot', type:'ecommerce' });
  expect((await placements({category:String(otherCategory._id)})).body.data).toEqual([]);
  expect((await placements({type:'grocery'})).body.data).toEqual([]);
  await Category.updateOne({ _id: category._id }, { $set: { isActive: false } });
  expect((await placements()).body.data).toEqual([]);
});
test('a parent category may serve matching descendants and existing organic ids are never duplicated', async () => {
  const parent = await Category.create({ name:'Parent', slug:'parent-pilot', type:'ecommerce' });
  await Category.updateOne({ _id: category._id }, { $set: { parent: parent._id } });
  await pilot(); expect((await placements({category:String(parent._id)})).body.data).toHaveLength(1);
  expect((await placements({exclude:String(product._id)})).body.data).toEqual([]);
  await Category.updateOne({ _id: parent._id }, { $set: { isActive:false } }); expect((await placements()).body.data).toEqual([]);
});
test('seller radius requires known in-range coordinates; no coordinates are stored', async () => {
  await pilot(); await Seller.updateOne({ _id:seller._id }, { $set:{serviceRadiusKm:3,'storeDetails.lat':12,'storeDetails.lng':77} });
  expect((await placements()).body.data).toEqual([]);
  expect((await placements({lat:'13',lng:'78'})).body.data).toEqual([]);
  expect((await placements({lat:'12.001',lng:'77.001'})).body.data).toHaveLength(1);
  await placements({lat:'Infinity',lng:'77'}).expect(400);
  await placements({lat:'12'}).expect(400);
});
test('pilot authorization validates revision, schedule and package duration; stop is durable', async () => {
  const row = await pilot();
  await decide(row, 'pilot', reviewer, { ...pilotSchedule(), endAt:new Date(0).toISOString() }).expect(400);
  await decide(row, 'pilot', reviewer, { ...pilotSchedule(), endAt:new Date(Date.now()+30*86400000).toISOString() }).expect(400);
  await decide(row, 'pilot', reviewer, { ...pilotSchedule(), version:0 }).expect(409);
  const stopped = (await decide(row, 'pilot', reviewer, {enabled:false}).expect(200)).body.data;
  expect(stopped.pilot.enabled).toBe(false); expect((await placements()).body.data).toEqual([]);
});
test('public reads never mutate campaigns/products and database failures fail open', async () => {
  await pilot(); const before = await Product.findById(product._id).lean(), campaignsBefore = await Promotion.find({}).lean();
  await placements().expect(200);
  expect(await Product.findById(product._id).lean()).toEqual(before); expect(await Promotion.find({}).lean()).toEqual(campaignsBefore);
  const failing = jest.spyOn(Category, 'find').mockImplementation(() => {throw Error('private database error');});
  try {
    const result = await placements().expect(200); expect(result.body.data).toEqual([]); expect(result.body.meta.unavailable).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain('private database');
  } finally { failing.mockRestore(); }
});
test('Quick uses its own approved module/category and normal inventory contract', async () => {
  await Category.updateOne({_id:category._id},{$set:{type:'grocery'}});
  await Product.updateOne({_id:product._id},{$set:{type:'grocery'}});
  await Seller.updateOne({_id:seller._id},{$set:{salesChannels:['grocery']}});
  await Package.updateOne({_id:pack.id},{$set:{module:'QUICK'}});
  const pending=await submit(await make({...input(),module:'QUICK'}));
  const approved=(await decide(pending,'approve').expect(200)).body.data;
  await decide(approved,'pilot',reviewer,pilotSchedule()).expect(200);
  expect((await placements({type:'grocery'})).body.data[0].product.type).toBe('grocery');
  expect((await placements()).body.data).toEqual([]);
});
test('cross-type products are suppressed until cart routing can preserve the selected storefront', async () => {
  const grocery=await Category.create({name:'Quick root',slug:'quick-root',type:'grocery'});
  await Product.updateOne({_id:product._id},{$set:{type:'grocery',category:grocery._id,channels:[{type:'ecommerce',category:category._id,isActive:true}]}});
  await pilot();expect((await placements()).body.data).toEqual([]);
});
test('the simple admin package form payload is accepted and quotes GST on top of the price', async () => {
  // Exactly what AdvertisingPackageForm sends for ₹999, 7 days, 5 products, 18% GST added on top.
  const body = { name: 'Simple form package', description: '', module: 'ECOMMERCE', placement: 'CATEGORY_SPONSORED', amountPaise: 99900, durationDays: 7, maxProducts: 5,
    categories: [], isActive: true, archived: false, reason: 'Package created by admin',
    policies: { sellerPause: 'Pause terms', cancellation: 'Cancel terms', rejection: 'Reject terms', suspension: 'Suspend terms', unusedService: 'Unused terms', refunds: 'Refund terms',
      tax: { treatment: '18% GST is added on top of the package price.' }, attribution: { windowHours: 24, conversionEvent: 'PAID', model: 'LAST_CLICK' },
      billing: { approvalReference: 'Standard advertising package', issuer: 'Bulkimart', taxRecognition: 'ON_RECEIPT', invoiceMode: 'NOT_REQUIRED', creditNoteMode: 'NOT_REQUIRED',
        startCondition: 'VERIFIED_PAYMENT_OR_REQUESTED_START', interruption: 'STOP_AND_REVIEW', recognition: 'MANUAL_AFTER_COMPLETION',
        refunds: { cancellationBps: 10000, suspensionBps: 10000, unavailableBps: 10000, unusedBps: 10000 }, taxTreatment: 'EXCLUSIVE', taxRateBps: 1800 } } };
  const saved = (await auth(request(app).post('/admin/packages'), admin, 'admin').send(body).expect(201)).body.data;
  expect(saved.billingQuote).toMatchObject({ basePaise: 99900, taxPaise: 17982, totalPaise: 117882 });
  expect(saved.policyApproval).toBe('CONFIGURED_REQUIRES_CAMPAIGN_AUTHORIZATION');
});
test('admins see which seller sent each campaign; sellers never receive seller details', async () => {
  await Seller.updateOne({ _id: seller._id }, { businessName: 'Synthetic Traders Pvt Ltd', 'storeDetails.name': 'Synthetic Store', 'storeDetails.city': 'Indore' });
  const row = await submit(await make());
  const expected = { id: String(seller._id), storeName: 'Synthetic Store', businessName: 'Synthetic Traders Pvt Ltd', city: 'Indore' };
  const listed = (await auth(request(app).get('/admin/campaigns'), reviewer, 'admin').expect(200)).body.data;
  expect(listed.find(c => c.id === row.id).seller).toEqual(expected);
  expect((await auth(request(app).get(`/admin/campaigns/${row.id}`), reviewer, 'admin').expect(200)).body.data.seller).toEqual(expected);
  expect((await auth(request(app).get('/seller/campaigns')).expect(200)).body.data[0].seller).toBeUndefined();
  expect((await auth(request(app).get(`/seller/campaigns/${row.id}`)).expect(200)).body.data.seller).toBeUndefined();
  const notice = await Notification.findOne({ event: 'ADVERTISING_SUBMITTED' }).lean();
  expect(notice.message).toBe('Synthetic Store submitted “Synthetic category campaign”. Open the campaign to review it.');
});
test('saving enforces the package products per ad and a start date from now onwards', async () => {
  const extra = await Product.create(['Second', 'Third'].map(name => ({ sellerId: seller._id, name: `Synthetic ${name}`, type: 'ecommerce', category: category._id, price: 10, mrp: 12, stock: 8, unit: 'piece', status: 'approved', isActive: true })));
  const items = [product, ...extra].map(p => ({ productId: String(p._id), ...(p.variants?.length ? { variantId: String(p.variants[0]._id) } : {}) }));
  const tooMany = await auth(request(app).post('/seller/campaigns')).send({ ...input(), items }).expect(400);
  expect(tooMany.body.message).toBe('This package allows up to 2 products per ad');
  const row = await make({ ...input(), items: items.slice(0, 2) });
  const edit = await auth(request(app).patch(`/seller/campaigns/${row.id}`)).send({ version: row.version, items }).expect(400);
  expect(edit.body.message).toBe('This package allows up to 2 products per ad');
  const past = await auth(request(app).post('/seller/campaigns')).send({ ...input(), requestedStartAt: new Date(Date.now() - 86400000).toISOString() }).expect(400);
  expect(past.body.message).toBe('Choose a start date and time from now onwards');
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), requestedStartAt: new Date(Date.now() + 120000).toISOString() }).expect(201);
});
test('views and clicks cover the campaign run, not the last 30 days', async () => {
  const row = await make();
  const before = (await auth(request(app).get(`/seller/campaigns/${row.id}/analytics`)).expect(200)).body.data;
  expect(before).toMatchObject({ started: false, from: null, to: null, rows: [] });
  const startAt = new Date(Date.now() - 2 * 86400000), endAt = new Date(Date.now() + 5 * 86400000);
  await Promotion.updateOne({ _id: row.id }, { 'advertising.pilot': { enabled: true, revision: 1, startAt, endAt, approvedBy: admin._id, approvedAt: startAt } });
  const during = (await auth(request(app).get(`/seller/campaigns/${row.id}/analytics`)).expect(200)).body.data;
  expect(during.started).toBe(true); expect(new Date(during.from).getTime()).toBe(startAt.getTime());
  expect(Date.now() - new Date(during.to).getTime()).toBeLessThan(60000);
});

// Multi-category builder support: categories per product, safe create retries, independent campaigns.
const sellerProduct = extra => Product.create({ sellerId: seller._id, type: 'ecommerce', price: 10, mrp: 12, stock: 8, unit: 'piece', status: 'approved', isActive: true, ...extra });
const itemOf = p => ({ productId: String(p._id), ...(p.variants?.length ? { variantId: String(p.variants[0]._id) } : {}) });
test('the seller product list names every category a campaign may use (most specific first), with search and a category filter', async () => {
  const child = await Category.create({ name: 'Synthetic child', slug: 'synthetic-ads-child', type: 'ecommerce', parent: category._id });
  const other = await Category.create({ name: 'Synthetic other', slug: 'synthetic-ads-other', type: 'ecommerce' });
  const shirt = await sellerProduct({ name: 'Synthetic Shirt', sku: 'SHIRT-ONE', category: category._id, subCategory: child._id });
  const lamp = await sellerProduct({ name: 'Synthetic Lamp', category: other._id });
  const get = query => auth(request(app).get('/seller/products').query({ module: 'ECOMMERCE', ...query })).expect(200).then(r => r.body.data);
  const row = (await get({})).find(p => p.id === String(shirt._id));
  expect(row.adCategories).toEqual([{ id: String(child._id), name: 'Synthetic child', parentId: String(category._id), parentName: 'Synthetic category' },
    { id: String(category._id), name: 'Synthetic category', parentId: null, parentName: '' }]);
  expect(row.categories).toEqual([{ id: String(category._id), name: 'Synthetic category' }]);
  expect((await get({ q: 'shirt' })).map(p => p.id)).toEqual([String(shirt._id)]);
  expect((await get({ q: 'shirt-one' })).map(p => p.id)).toEqual([String(shirt._id)]);
  expect(await get({ q: 'a.*(' })).toEqual([]);
  expect((await get({ category: String(child._id) })).map(p => p.id)).toEqual([String(shirt._id)]);
  expect((await get({ category: String(other._id) })).map(p => p.id)).toEqual([String(lamp._id)]);
  expect((await get({ category: String(category._id) })).map(p => p.id).sort()).toEqual([String(product._id), String(shirt._id)].sort());
  await auth(request(app).get('/seller/products').query({ module: 'ECOMMERCE', q: 'x'.repeat(101) })).expect(400);
  // A campaign may run in the product's sub-category or its category; never in an unrelated one.
  await make({ ...input(), categoryId: String(child._id), items: [itemOf(shirt)] });
  await make({ ...input(), categoryId: String(category._id), items: [itemOf(shirt)] });
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), categoryId: String(other._id), items: [itemOf(shirt)] }).expect(409);
});
test('a create request key returns the campaign already created instead of a duplicate, also when retries race', async () => {
  const first = await make({ ...input(), requestKey: 'synthetic-request-key-0001' });
  const again = await make({ ...input(), requestKey: 'synthetic-request-key-0001' });
  expect(again.id).toBe(first.id); expect(await Promotion.countDocuments({ advertisingVersion: 2 })).toBe(1);
  const racing = await Promise.all([1, 2, 3].map(() => auth(request(app).post('/seller/campaigns')).send({ ...input(), requestKey: 'synthetic-request-key-0002' })));
  expect(racing.map(r => r.status)).toEqual([201, 201, 201]);
  expect(new Set(racing.map(r => r.body.data.id)).size).toBe(1); expect(await Promotion.countDocuments({ advertisingVersion: 2 })).toBe(2);
  // Another seller's identical key never returns this seller's campaign.
  const foreign = await auth(request(app).post('/seller/campaigns'), other).send({ ...input(), requestKey: 'synthetic-request-key-0001' });
  expect(foreign.status).not.toBe(201); expect(foreign.body.data?.id).not.toBe(first.id);
  await auth(request(app).post('/seller/campaigns')).send({ ...input(), requestKey: 'short' }).expect(400);
  await make(input()); expect(await Promotion.countDocuments({ advertisingVersion: 2 })).toBe(3);
});
test('campaigns from one wizard are independent: admin sees each with seller, category and products and decides each separately', async () => {
  await Seller.updateOne({ _id: seller._id }, { businessName: 'Sharma Traders', 'storeDetails.name': 'Sharma Store' });
  const categories = await Category.create(['Mens', 'Womens', 'Gadgets'].map(name => ({ name: `Synthetic ${name}`, slug: `synthetic-ads-${name.toLowerCase()}`, type: 'ecommerce' })));
  const products = await Promise.all(categories.map((c, i) => sellerProduct({ name: `Synthetic product ${i}`, category: c._id })));
  const rows = [];
  for (const [i, c] of categories.entries()) rows.push(await submit(await make({ ...input(), name: `Diwali Sale – ${c.name}`, categoryId: String(c._id), items: [itemOf(products[i])], requestKey: `synthetic-wizard-key-000${i}` })));
  const listed = (await auth(request(app).get('/admin/campaigns').query({ review: 'PENDING_REVIEW' }), reviewer, 'admin').expect(200)).body.data;
  expect(listed).toHaveLength(3);
  for (const [i, c] of categories.entries()) {
    const card = listed.find(r => r.id === rows[i].id);
    expect(card).toMatchObject({ name: `Diwali Sale – ${c.name}`, module: 'ECOMMERCE', category: { name: c.name }, products: [{ id: String(products[i]._id), name: `Synthetic product ${i}` }], seller: { storeName: 'Sharma Store' } });
    expect(card.terms).toMatchObject({ name: pack.name, durationDays: pack.durationDays, maxProducts: pack.maxProducts, amountPaise: pack.amountPaise });
  }
  const [approved, changes, rejected] = await Promise.all([decide(rows[0], 'approve'), decide(rows[1], 'request-changes'), decide(rows[2], 'reject')]);
  expect([approved.status, changes.status, rejected.status]).toEqual([200, 200, 200]);
  const detail = id => auth(request(app).get(`/admin/campaigns/${id}`), reviewer, 'admin').expect(200).then(r => r.body.data);
  const after = await Promise.all(rows.map(r => detail(r.id)));
  expect(after.map(r => r.review)).toEqual(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']);
  after.forEach((r, i) => { expect(r.products.map(p => p.id)).toEqual([String(products[i]._id)]); expect(r.category.name).toBe(categories[i].name); });
  const notices = await Notification.find({ event: 'ADVERTISING_SUBMITTED' }).lean();
  // One notification per campaign for every active admin, each naming the seller and that campaign.
  const activeAdmins = await Admin.countDocuments({ isActive: true });
  expect(notices).toHaveLength(3 * activeAdmins);
  expect([...new Set(notices.map(n => n.message))].sort()).toEqual(categories.map(c => `Sharma Store submitted “Diwali Sale – ${c.name}”. Open the campaign to review it.`).sort());
  for (const row of rows) expect(notices.filter(n => String(n.metadata?.campaignId) === row.id)).toHaveLength(activeAdmins);
  // The seller sees each outcome on its own campaign.
  const own = (await auth(request(app).get('/seller/campaigns')).expect(200)).body.data;
  expect(Object.fromEntries(own.map(r => [r.name, r.review]))).toEqual(Object.fromEntries(categories.map((c, i) => [`Diwali Sale – ${c.name}`, after[i].review])));
});
