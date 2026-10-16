import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
jest.unstable_mockModule('../../services/fcm.service.js', () => ({ sendPushNotification: jest.fn(), sendBulkNotification: jest.fn() }));
const [{ default: sellerRoutes }, { default: adminRoutes }, { default: campaignRoutes }, { default: promotionRoutes }, { default: bannerRoutes }, { default: notificationRoutes }, { errorHandler }, { JWT_SECRET }] = await Promise.all([
  import('../../routes/seller.routes.js'), import('../../routes/admin.routes.js'), import('../../routes/campaign.routes.js'), import('../../routes/promotion.routes.js'), import('../../routes/banner.routes.js'), import('../../routes/notification.routes.js'), import('../../middlewares/error.middleware.js'), import('../../config/jwt.js'),
]);
const models = {};
for (const name of ['User', 'Seller', 'Admin', 'Product', 'Campaign', 'CampaignParticipation', 'SellerPromotion', 'PromotionPackage', 'Banner', 'Notification', 'Payment']) models[name] = (await import('../../models/' + name + '.js')).default;
const { User, Seller, Admin, Product, Campaign, CampaignParticipation, SellerPromotion, Banner, Notification, Payment } = models;
const app = express(); app.use(express.json());
app.use('/api/sellers', sellerRoutes); app.use('/api/admin', adminRoutes); app.use('/api/campaigns', campaignRoutes); app.use('/api/promotions', promotionRoutes); app.use('/api/banners', bannerRoutes); app.use('/api/notifications', notificationRoutes); app.use(errorHandler);
let db, sellerToken, adminToken, seller, campaign, promotion, product;
const id = () => new mongoose.Types.ObjectId();
const auth = (req, token = sellerToken) => req.set('Authorization', 'Bearer ' + token);
const snapshot = async () => Object.fromEntries(await Promise.all(['Seller','Product','Campaign','CampaignParticipation','SellerPromotion','PromotionPackage','Banner','Payment','Notification'].map(async n => [n, JSON.stringify(await models[n].find().sort({ _id: 1 }).lean())])));
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(db.getUri());
  const user = await User.create({ name: 'Fixture Seller', phone: '9876500111', roles: ['buyer','seller'], isActive: true });
  const inserted = await Seller.collection.insertOne({ userId: user._id, businessName: 'Fixture Store', status: 'approved', storeDetails: { name: 'Fixture Store' } });
  seller = await Seller.findById(inserted.insertedId);
  const admin = await Admin.create({ email: 'fixture@example.invalid', password: 'Fixture-password', role: 'superAdmin' });
  sellerToken = jwt.sign({ id: user._id, type: 'user', role: 'seller' }, JWT_SECRET);
  adminToken = jwt.sign({ id: admin._id, type: 'admin' }, JWT_SECRET);
  const productId = id(); await Product.collection.insertOne({ _id: productId, name: 'Fixture item', sellerId: seller._id, type: 'ecommerce', category: id(), price: 100, stock: 10, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical', images: ['https://example.invalid/item.png'], searchBoostRank: -100, searchBoostUntil: new Date(Date.now()+86400000) }); product = await Product.findById(productId);
  campaign = await Campaign.create({ name: 'Existing deal', targetType: 'PRODUCTS', targetProducts: [productId], discountValue: 10, startAt: new Date(Date.now()-60000), endAt: new Date(Date.now()+86400000) });
  await CampaignParticipation.create({ campaignId: campaign._id, sellerId: seller._id, productId, status: 'ACCEPTED', campaignPrice: 90, discountValue: 10 });
  promotion = await SellerPromotion.create({ sellerId: seller._id, module: 'ECOMMERCE', title: 'Existing advertisement', bannerImage: 'https://example.invalid/ad.png', status: 'ACTIVE', selectedProducts: [productId], expiresAt: new Date(Date.now()+86400000) });
  await Banner.create({ image: promotion.bannerImage, type: 'ecommerce', actionType: 'SELLER_PROMOTION', targetPromotion: promotion._id });
  await Payment.create({ userId: user._id, sellerPromotionId: promotion._id, amount: 100, method: 'online', status: 'pending' });
  await Notification.create({ userId: user._id, type: 'promotion', event: 'SELLER_PROMOTION_UPDATE', title: 'Historical ad', message: 'Historical message', route: '/seller/promotions' });
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });

test('retired seller HTTP routes reject direct access without changing historical, media or financial records', async () => {
  const before = await snapshot(); const ref = String(promotion._id);
  const routes = [['get','/campaigns'],['get','/campaigns/'+campaign._id],['patch','/campaigns/'+campaign._id+'/accept'],['patch','/campaigns/'+campaign._id+'/reject'],['post','/promo-request'],['get','/promotions/packages'],['get','/promotions'],['post','/promotions'],['get','/promotions/'+ref],['put','/promotions/'+ref],...['submit','resubmit','cancel','payment'].map(action => ['post','/promotions/'+ref+'/'+action])];
  for (const [method,path] of routes) await auth(request(app)[method]('/api/sellers'+path)).send({ title: 'Forbidden write', productIds: [product._id] }).expect(404);
  expect(await snapshot()).toEqual(before);
});
test('admin campaign/package management remains authorized and cannot be invoked by sellers', async () => {
  for (const path of ['/campaigns','/campaigns/'+campaign._id,'/promotions','/promotions/'+promotion._id,'/promotion-packages']) {
    await auth(request(app).get('/api/admin'+path)).expect(403);
    await auth(request(app).get('/api/admin'+path),adminToken).expect(200);
  }
  const draft = await auth(request(app).post('/api/admin/campaigns'),adminToken).send({ name: 'Admin draft', isDraft: true }).expect(201);
  await auth(request(app).patch('/api/admin/campaigns/'+draft.body.data._id),adminToken).send({ name: 'Updated draft' }).expect(200);
  await auth(request(app).post('/api/admin/promotion-packages'),adminToken).send({ name: 'Admin package', module: 'ECOMMERCE', durationDays: 7, price: 50, maxProducts: 2 }).expect(201);
});
test('public campaigns, accepted deals, existing advertisements and banners remain available', async () => {
  const deals = await request(app).get('/api/campaigns/'+campaign._id+'/products').expect(200);
  expect(deals.body.data.products[0]).toMatchObject({ id: String(product._id), campaignPrice: 90 });
  await request(app).get('/api/campaigns/'+campaign._id).expect(200);
  const ad = await request(app).get('/api/promotions/'+promotion._id).expect(200);
  expect(ad.body.data.products[0].id).toBe(String(product._id));
  const ads = await request(app).get('/api/promotions').expect(200); expect(ads.body.data.length).toBe(1);
  const banners = await request(app).get('/api/banners?type=ecommerce').expect(200); expect(banners.body.length).toBeGreaterThan(0);
  expect((await Product.findById(product._id)).searchBoostRank).toBe(-100);
});
test('seller historical promotion notifications are excluded from inbox and badge without deleting history', async () => {
  const list = await auth(request(app).get('/api/notifications')).expect(200); expect(list.body.data).toEqual([]);
  const count = await auth(request(app).get('/api/notifications/unread-count')).expect(200); expect(count.body.data.count).toBe(0);
  expect(await Notification.countDocuments({ event: 'SELLER_PROMOTION_UPDATE' })).toBe(1);
});

test('admin publication retains participation bookkeeping without producing retired seller invitations', async () => {
  const before = await Notification.countDocuments();
  await auth(request(app).post('/api/admin/campaigns'), adminToken).send({
    name: 'Admin published campaign', targetType: 'PRODUCTS', targetProducts: [product._id], discountValue: 5,
    startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 86400000),
  }).expect(201);
  expect(await Notification.countDocuments()).toBe(before);
  expect(await CampaignParticipation.countDocuments({ status: 'PENDING' })).toBe(1);
});

test('historical advertisement payment settlement remains supported without reopening seller billing', async () => {
  const { settleSellerPromotionPayment } = await import('../../controllers/sellerPromotion.controller.js');
  const payment = await Payment.findOne({ sellerPromotionId: promotion._id });
  const before = await Notification.countDocuments();
  const result = await settleSellerPromotionPayment({ payment, state: 'COMPLETED', gatewayOrderId: 'historical-provider-fixture' });
  expect(result).toEqual({ changed: true, status: 'paid' });
  expect((await Payment.findById(payment._id)).status).toBe('paid');
  expect((await SellerPromotion.findById(promotion._id)).status).toBe('ACTIVE');
  const replay = await settleSellerPromotionPayment({ payment: await Payment.findById(payment._id), state: 'COMPLETED' });
  expect(replay.changed).toBe(false);
  expect(await Notification.countDocuments()).toBe(before);
});
