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
