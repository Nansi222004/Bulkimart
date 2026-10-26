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
const { default: productRoutes } = await import('../../routes/product.routes.js');
const app = express(); app.use(express.json());
app.use('/api/products', productRoutes); app.use('/api/sellers', sellerRoutes); app.use('/api/admin', adminRoutes); app.use('/api/campaigns', campaignRoutes); app.use('/api/promotions', promotionRoutes); app.use('/api/banners', bannerRoutes); app.use('/api/notifications', notificationRoutes); app.use(errorHandler);
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
  const productId = id(); await Product.collection.insertOne({ _id: productId, name: 'Fixture item', isSponsored: true, sponsoredRank: -100, sellerId: seller._id, type: 'ecommerce', category: id(), price: 100, stock: 10, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical', images: ['https://example.invalid/item.png'], searchBoostRank: -100, searchBoostUntil: new Date(Date.now()+86400000) }); product = await Product.findById(productId);
  campaign = await Campaign.create({ name: 'Existing deal', targetType: 'PRODUCTS', targetProducts: [productId], discountValue: 10, startAt: new Date(Date.now()-60000), endAt: new Date(Date.now()+86400000) });
  await CampaignParticipation.create({ campaignId: campaign._id, sellerId: seller._id, productId, status: 'ACCEPTED', campaignPrice: 90, discountValue: 10 });
  promotion = await SellerPromotion.create({ sellerId: seller._id, module: 'ECOMMERCE', title: 'Existing advertisement', bannerImage: 'https://example.invalid/ad.png', status: 'ACTIVE', selectedProducts: [productId], expiresAt: new Date(Date.now()+86400000) });
  await Banner.create({ image: promotion.bannerImage, type: 'ecommerce', actionType: 'SELLER_PROMOTION', targetPromotion: promotion._id });
  await Banner.create({ image: 'https://example.invalid/ordinary.png', type: 'ecommerce', title: 'Ordinary banner', actionType: 'NONE' });
  await Product.collection.insertOne({ _id: id(), name: 'Fixture alpha', sellerId: seller._id, type: 'ecommerce', category: id(), price: 100, stock: 10, isActive: true, isDeleted: false, status: 'approved', fulfillmentType: 'physical' });
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
test('all admin promotion reads, writes, packages and sponsorship are retired without changing records', async () => {
  const before = await snapshot();
  const ref = String(promotion._id);
  const paths = ['/promotions', '/promotions/'+ref, '/promotions/'+ref+'/approve', '/promotions/'+ref+'/request-changes', '/promotions/'+ref+'/reject', '/promotions/'+ref+'/disable', '/promotion-packages', '/promotion-packages/'+ref, '/products/'+product._id+'/sponsor'];
  for (const path of paths) {
    await auth(request(app).get('/api/admin'+path)).expect(403);
    for (const method of ['get','post','put','patch','delete']) await auth(request(app)[method]('/api/admin'+path),adminToken).send({title:'Must not create',isSponsored:true}).expect(410);
  }
  expect(await snapshot()).toEqual(before);
});

test('public promotion URLs reject every method while ordinary campaigns and banners remain available', async () => {
  const before = await snapshot();
  for (const path of ['', '/'+promotion._id, '/packages', '/'+promotion._id+'/payment']) {
    for (const method of ['get','post','put','patch','delete']) await request(app)[method]('/api/promotions'+path).expect(410);
  }
  const deals = await request(app).get('/api/campaigns/'+campaign._id+'/products').expect(200);
  expect(deals.body.data.products[0]).toMatchObject({ id: String(product._id), campaignPrice:90 });
  for (const suffix of ['', '&all=true', '&category=home']) {
    const path = '/api/banners?type=ecommerce' + suffix;
    if (suffix === '&all=true') await request(app).get(path).expect(401);
    const banners = await (suffix === '&all=true' ? auth(request(app).get(path), adminToken) : request(app).get(path)).expect(200);
    expect(banners.body.some(b=>b.actionType==='SELLER_PROMOTION'||b.targetPromotion)).toBe(false);
    expect(banners.body.some(b=>b.title==='Ordinary banner')).toBe(true);
  }
  expect(await snapshot()).toEqual(before);
});

test('old boosts and sponsorship flags cannot change customer search or featured discovery', async () => {
  const search = await request(app).get('/api/products/search?q=Fixture&type=ecommerce').expect(200);
  expect(search.body.map(p=>p.name)).toEqual(['Fixture alpha','Fixture item']);
  const featured = await request(app).get('/api/products/featured?type=ecommerce').expect(200);
  expect(featured.body.some(p=>String(p._id)===String(product._id))).toBe(false);
  expect((await Product.findById(product._id)).searchBoostRank).toBe(-100);
});

test('banner APIs reject attempts to recreate or republish retired ads', async () => {
  const before = await snapshot();
  const old = await Banner.findOne({ targetPromotion:promotion._id });
  await auth(request(app).post('/api/banners'),adminToken).send({ image:'https://example.invalid/new.png', type:'ecommerce', actionType:'SELLER_PROMOTION', isDraft:true }).expect(410);
  await auth(request(app).put('/api/banners/'+old._id),adminToken).send({isActive:true}).expect(410);
  expect(await snapshot()).toEqual(before);
});

test('seller historical promotion notifications are excluded from inbox and badge without deleting history', async () => {
  const list = await auth(request(app).get('/api/notifications')).expect(200); expect(list.body.data).toEqual([]);
  const count = await auth(request(app).get('/api/notifications/unread-count')).expect(200); expect(count.body.data.count).toBe(0);
  expect(await Notification.countDocuments({ event: 'SELLER_PROMOTION_UPDATE' })).toBe(1);
});

test('retired advertisement events cannot create notifications or push/socket fanout', async () => {
  const { notifyUser, notifyAllAdmins } = await import('../../services/notification.service.js');
  const before = await Notification.countDocuments();
  const event = { event:'SELLER_PROMOTION_UPDATE', title:'Retired ad', message:'Must not send' };
  expect(await notifyUser(seller.userId, event)).toBeNull();
  expect(await notifyAllAdmins(event)).toEqual([]);
  expect(await Notification.countDocuments()).toBe(before);
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
  expect((await SellerPromotion.findById(promotion._id)).status).toBe('DISABLED');
  const replay = await settleSellerPromotionPayment({ payment: await Payment.findById(payment._id), state: 'COMPLETED' });
  expect(replay.changed).toBe(false);
  expect(await Notification.countDocuments()).toBe(before);
});
