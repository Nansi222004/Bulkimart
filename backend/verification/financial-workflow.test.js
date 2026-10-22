import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Commission from '../models/Commission.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Delivery from '../models/Delivery.js';
import Partner from '../models/DeliveryPartner.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { validateCommissionRule, calculateCommission, allocatePaise, saveCommissionVersion, buildOrderFinancialSnapshot } from '../services/vendorCommission.service.js';
import { recordCodEvent, postOrderFinance, releaseOrderFinance, releaseDeliveryEarning, recordDeliveryEarning, reverseRefundedReturn } from '../services/orderFinance.service.js';
import { requestVerifiedRiderPayout, resolveVerifiedRiderPayout } from '../services/deliveryPayout.service.js';
import { sellerBalances, postLedgerEntry } from '../services/sellerLedger.service.js';
import { financialTransaction, requireFinanceOperation } from '../services/financeSafety.service.js';
import { financialReconciliation } from '../services/financialReconciliation.service.js';
import WalletLedger from '../models/WalletLedger.js';
import SellerPayout from '../models/SellerPayout.js';
import adminRoutes from '../routes/admin.routes.js';
import deliveryRoutes from '../routes/delivery.routes.js';
import sellerRoutes from '../routes/seller.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

const app = express(); app.use(express.json());
app.use('/api/admin', adminRoutes); app.use('/api/delivery', deliveryRoutes); app.use('/api/sellers', sellerRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const ruleInput = () => ({ vendorType: 'general', channel: 'quick', method: 'percentage', value: 10,
  minimum: null, maximum: null, base: 'eligible_item_subtotal', fixedScope: 'order_item',
  taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' });
const enable = () => { process.env.FINANCE_OPERATIONS_ENABLED = 'true'; process.env.FINANCE_PAYOUTS_ENABLED = 'true'; process.env.FINANCE_POLICY_APPROVAL_REFERENCE = 'TEST-POLICY'; process.env.FINANCE_E2E_APPROVAL_REFERENCE = 'TEST-E2E'; };
let db, user, rider, admin, seller, product, partner, order, payment, delivery;
const bearer = (who, type = 'user', role = 'delivery') => `Bearer ${jwt.sign({ id: String(who._id), type, ...(type === 'user' ? { role } : {}) }, JWT_SECRET)}`;
const cod = (action, amount = 100, extra = {}) => recordCodEvent({ orderId: order._id, partnerId: partner._id, actorId: action === 'verify' ? admin._id : rider._id, action,
  input: { amount, method: 'cash', reference: `${action}-TEST`, reason: 'Synthetic cash evidence', ...extra } });
const verifyCash = async () => { await cod('collect'); await cod('remit'); await cod('verify'); };
const queryOrder = () => Order.findById(order._id);
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Ledger.init(), Payment.init(), DeliveryPayout.init(), SellerPayout.init(), Order.init(), Partner.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  for (const name of ['FINANCE_SNAPSHOTS_ENABLED','FINANCE_OPERATIONS_ENABLED','FINANCE_PAYOUTS_ENABLED','FINANCE_POLICY_APPROVAL_REFERENCE','FINANCE_E2E_APPROVAL_REFERENCE']) delete process.env[name];
  user = await User.create({ name: 'Customer', phone: '9876600001', roles: ['buyer'], isActive: true });
  rider = await User.create({ name: 'Fixture rider', phone: '9876600002', roles: ['delivery'], isActive: true });
  const adminId = id(); await Admin.collection.insertOne({ _id: adminId, name: 'Fixture admin', email: 'fixture@example.test', password: 'not-a-password', role: 'admin', isActive: true }); admin = await Admin.findById(adminId);
  const sellerId = id(); await Seller.collection.insertOne({ _id: sellerId, userId: user._id, businessName: 'Fixture store', status: 'approved', bankDetails: { upiId: 'fixture@test' } }); seller = await Seller.findById(sellerId);
  const productId = id(); await Product.collection.insertOne({ _id: productId, category: id(), type: 'grocery' }); product = await Product.findById(productId);
  await Category.collection.insertOne({ _id: product.category, name: 'Fixture category', type: 'grocery' });
  partner = await Partner.create({ userId: rider._id, status: 'approved', bankDetails: { upiId: 'fixture@test' } });
  await saveCommissionVersion(ruleInput(), admin._id);
  payment = await Payment.create({ userId: user._id, amount: 100, method: 'cod', status: 'pending' });
  process.env.FINANCE_SNAPSHOTS_ENABLED = 'true';
  order = await Order.create({ userId: user._id, type: 'grocery', items: [{ productId, sellerId, type: 'grocery', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }],
    paymentMethod: 'cod', paymentId: payment._id, status: 'delivered', pricing: { subtotal: 100, totalAmount: 100 } });
  delete process.env.FINANCE_SNAPSHOTS_ENABLED;
  payment.orderId = order._id; await payment.save();
  delivery = await Delivery.create({ orderId: order._id, partnerId: partner._id, status: 'delivered', otpVerified: true, direction: 'forward', route: { distanceKm: 2 }, ratesUsed: { base: 20, perKm: 10, rateId: id(), mode: 'quick' }, partnerEarnings: 40 });
  await Order.updateOne({ _id: order._id }, { $set: { deliveryId: delivery._id, deliveryPartnerId: partner._id } }); order = await queryOrder();
});

test('all new money operations default disabled even when snapshots exist', async () => {
  expect(() => requireFinanceOperation()).toThrow(/disabled/);
  await expect(cod('collect')).rejects.toMatchObject({ status: 503 });
  expect((await Payment.findById(payment._id)).status).toBe('pending'); expect(await Ledger.countDocuments()).toBe(0);
});
test('seller summary includes delivered sales without creating or exposing settlement funds', async () => {
  const legacy = { ...order.toObject(), _id: id(), orderNo: 'LEGACY-DELIVERED' };
  delete legacy.financialSnapshot;
  legacy.items = [{ sellerId: seller._id, price: 125, qty: 2 }, { sellerId: id(), price: 999, qty: 10 }];
  await Order.collection.insertOne(legacy);
  await Order.collection.insertOne({ ...legacy, _id: id(), orderNo: 'OTHER-SELLER', items: [{ sellerId: id(), price: 9999, qty: 1 }] });
  await Order.collection.insertOne({ ...legacy, _id: id(), orderNo: 'CANCELLED', status: 'cancelled' });
  const response = await request(app).get('/api/sellers/finances/summary').set('Authorization', bearer(user, 'user', 'seller'));
  expect(response.status).toBe(200);
  expect(response.body.data.deliveredSales).toMatchObject({ orderCount: 2, grossAmount: 350, limit: 20 });
  const history = response.body.data.deliveredSales.orders.find(row => row.orderNo === 'LEGACY-DELIVERED');
  expect(history.grossAmount).toBe(250);
  expect(history.snapshotVersion).toBeUndefined();
  expect(history.items).toBeUndefined();
  expect(response.body.data.balances).toMatchObject({ earnedEarnings: 0, eligible: 0 });
  expect(response.body.data.payoutActionsEnabled).toBe(false);
  expect(await Ledger.countDocuments()).toBe(0);
});

test('feature flag alone cannot bypass policy and end-to-end approval', () => {
  process.env.FINANCE_OPERATIONS_ENABLED = 'true'; expect(() => requireFinanceOperation()).toThrow(/disabled/);
  process.env.FINANCE_POLICY_APPROVAL_REFERENCE = 'TEST'; expect(() => requireFinanceOperation()).toThrow(/disabled/);
});
test.each([
  [{ method: 'fixed', value: 8 }, { commissionPaise: 800, taxPaise: 0, netPaise: 9200 }],
  [{ method: 'percentage', value: 10, minimum: 12 }, { commissionPaise: 1200, netPaise: 8800 }],
  [{ method: 'percentage', value: 80, maximum: 15 }, { commissionPaise: 1500, netPaise: 8500 }],
  [{ value: 10, taxTreatment: 'exclusive', taxRate: 18 }, { commissionPaise: 1000, taxPaise: 180, netPaise: 8820 }],
  [{ method: 'fixed', value: 11.8, taxTreatment: 'inclusive', taxRate: 18 }, { commissionPaise: 1000, taxPaise: 180, netPaise: 8820 }],
])('commission calculations use approved fixed/percentage/limits/tax fixtures: %j', (changes, expected) => {
  expect(calculateCommission(10000, { ...ruleInput(), ...changes })).toMatchObject(expected);
});
test.each([{ value: null }, { taxRate: '' }, { taxRate: 18, taxTreatment: 'exempt' }, { minimum: -1 }, { minimum: 10, maximum: 1 }, { isActive: 'true' }, { effectiveDate: 'bad' }, { channel: 'unknown' }, { productId: '$gt' }, { value: 100.001 }])('backend rejects invalid configuration: %j', changes => {
  expect(() => validateCommissionRule({ ...ruleInput(), ...changes })).toThrow();
});
test('fully discounted item has no fixed minimum; deductions cannot produce negative net', () => {
  expect(calculateCommission(0, { ...ruleInput(), method: 'fixed', value: 10, minimum: 20 }).netPaise).toBe(0);
  expect(() => calculateCommission(1, { ...ruleInput(), method: 'fixed', value: 10 })).toThrow(/exceed/);
});
test('proportional allocation conserves discount residuals and uses deterministic tie breaking', () => {
  expect(allocatePaise(1, [1, 1, 1])).toEqual([1, 0, 0]);
  expect(allocatePaise(100, [100, 200, 300]).reduce((a,b) => a+b,0)).toBe(100);
  expect(() => allocatePaise(4, [1,2])).toThrow();
});
test('product override wins; effective dates and historical snapshots remain independent', async () => {
  await saveCommissionVersion({ ...ruleInput(), productId: String(product._id), value: 12 }, admin._id);
  expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1200);
  await saveCommissionVersion({ ...ruleInput(), effectiveDate: '2100-01-01', value: 20, supersedes: (await Commission.findOne({ productId: null }))._id.toString() }, admin._id);
  expect((await queryOrder()).financialSnapshot.lines[0].commissionPaise).toBe(1000);
  expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1200);
});
test('category and channel overrides respect wholesale separation', async () => {
  await saveCommissionVersion({ ...ruleInput(), categoryId: String(product.category), value: 11 }, admin._id);
  expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1100);
  const copy = order.toObject(); copy.salesChannel = 'wholesale';
  expect((await buildOrderFinancialSnapshot(copy)).state).toBe('held_missing_rule');
});
test('cross-listed products use the category in the purchased storefront',async()=>{
  await Product.collection.updateOne({_id:product._id},{$set:{type:'ecommerce',category:id(),channels:[{type:'grocery',category:product.category,isActive:true}]}});
  await saveCommissionVersion({...ruleInput(),categoryId:String(product.category),value:11},admin._id);
  expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1100);
});
test('concurrent commission edits reject a stale parent and preserve audit records', async () => {
  const parent = await Commission.findOne({});
  const results = await Promise.allSettled([saveCommissionVersion({ ...ruleInput(), supersedes: String(parent._id), value: 11 }, admin._id), saveCommissionVersion({ ...ruleInput(), supersedes: String(parent._id), value: 12 }, admin._id)]);
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(await Commission.countDocuments()).toBe(2);
  await expect(Commission.updateOne({ _id: parent._id }, { value: 99 })).rejects.toThrow(/append-only/);
});
test('cash reports do not mark payment paid; verified reconciliation allocates commission only once', async () => {
  enable(); await cod('collect'); await cod('remit'); expect((await Payment.findById(payment._id)).status).toBe('pending');
  await expect(postOrderFinance(order._id, admin._id)).rejects.toThrow(/not verified/);
  await cod('verify'); expect((await Payment.findById(payment._id)).status).toBe('paid');
  const results = await Promise.all([postOrderFinance(order._id, admin._id), postOrderFinance(order._id, admin._id)]);
  expect(results.filter(row => !row.alreadyProcessed)).toHaveLength(1);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 90, eligible: 0, earnedEarnings: 90 });
  expect(await Ledger.countDocuments({ account: 'commission_revenue' })).toBe(1);
  expect(await Ledger.countDocuments({ account: 'cod_custody' })).toBe(2);
});
test('incorrect collection, duplicate evidence, unauthorized rider and unverified delivery fail closed', async () => {
  enable(); await expect(cod('collect', 99)).rejects.toThrow(/match/);
  await expect(recordCodEvent({ orderId: order._id, partnerId: id(), actorId: rider._id, action: 'collect', input: { amount: 100, method: 'cash', reference: 'TEST', reason: 'Fixture evidence' } })).rejects.toMatchObject({ status: 404 });
  await cod('collect'); await cod('collect');
  expect(await Ledger.countDocuments({ account: 'cod_custody' })).toBe(1);
  await expect(cod('collect',100,{reference:'another-collection'})).rejects.toThrow(/already/);
  await expect(cod('collect',100,{reason:'Changed evidence'})).rejects.toThrow(/reused/);
});
test.each([90,110])('shortage/excess %i remains disputed and cannot allocate', async amount => {
  enable(); await cod('collect'); await cod('remit', amount); await cod('verify', amount);
  expect((await queryOrder()).codFinance.status).toBe('discrepancy');
  expect((await Payment.findById(payment._id)).status).toBe('pending');
  const custody=await Ledger.find({account:'cod_custody'});expect(custody.reduce((sum,row)=>sum+(row.direction==='credit'?row.amount:-row.amount),0)).toBe(Math.max(0,100-amount));
  if(amount>100)expect((await Ledger.findOne({account:'cod_excess_liability'})).amount).toBe(amount-100);
  await expect(postOrderFinance(order._id, admin._id)).rejects.toThrow(/not verified/);
  await cod('verify',100,{ reference:'CORRECTED-HANDOVER', reason:'Additional cash independently received' });
  expect((await queryOrder()).codFinance.events).toHaveLength(4);
});
test('cash reporter cannot self-verify and a failed delivery cannot collect', async () => {
  enable(); await cod('collect'); await cod('remit');
  await expect(recordCodEvent({ orderId: order._id, actorId: rider._id, action:'verify', input:{ amount:100, reference:'SELF', reason:'Fixture evidence' } })).rejects.toMatchObject({status:403});
  await Delivery.updateOne({_id:delivery._id},{$set:{status:'failed'}}); await expect(cod('verify')).rejects.toThrow(/delivery/);
});
test('grouped COD Payment stays unpaid until every order cash handover is verified', async () => {
  enable(); const groupRef = 'fixture-group';
  await Payment.updateOne({_id:payment._id},{$set:{groupRef,amount:200}});
  await Order.updateOne({_id:order._id},{$set:{groupRef}});
  const data = order.toObject(); const secondId = id(), secondDelivery = id();
  await Order.collection.insertOne({...data,_id:secondId,orderNo:'GROUP-SECOND',groupRef,deliveryId:secondDelivery});
  await Delivery.collection.insertOne({_id:secondDelivery,orderId:secondId,partnerId:partner._id,status:'delivered',otpVerified:true,direction:'forward'});
  await verifyCash(); expect((await Payment.findById(payment._id)).status).toBe('pending');
  const original=order; order=await Order.findById(secondId); await verifyCash(); order=original;
  expect((await Payment.findById(payment._id)).status).toBe('paid');
});
test('seller funds release only after return holds clear, with idempotent transfer between buckets', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id);
  await Order.updateOne({_id:order._id},{$set:{'items.0.returnEligibleUntil':new Date('2100-01-01')}});
  await expect(releaseOrderFinance(order._id,admin._id)).rejects.toThrow(/hold/);
  await Order.updateOne({_id:order._id},{$set:{'items.0.returnEligibleUntil':new Date('2020-01-01')}});
  await Promise.all([releaseOrderFinance(order._id,admin._id),releaseOrderFinance(order._id,admin._id)]);
  expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:90});
});
test('rider earning is held once and cannot release from unverified COD', async () => {
  enable(); const settlement = { total:40,tip:0,base:20,perKm:10,distanceKm:2 };
  await financialTransaction(session=>recordDeliveryEarning({order,delivery,settlement,session}));
  await Partner.updateOne({_id:partner._id},{$set:{'earnings.held':40,'earnings.total':40}});
  await expect(releaseDeliveryEarning(order._id,admin._id)).rejects.toThrow(/not verified/);
  await verifyCash(); await Promise.all([releaseDeliveryEarning(order._id,admin._id),releaseDeliveryEarning(order._id,admin._id)]);
  expect((await Partner.findById(partner._id)).earnings).toMatchObject({held:0,pending:40});
});
const fundedRider = async () => {
  await postLedgerEntry({idempotencyKey:'fixture-rider-eligible',partnerId:partner._id,account:'rider_payable',type:'delivery_earning',direction:'credit',bucket:'eligible',amount:400,description:'Verified test earning'});
  await Partner.updateOne({_id:partner._id},{$set:{'earnings.pending':400,'earnings.total':400}});
};
test('rider payout concurrent requests reserve once; paid requires evidence and resolves once', async () => {
  enable(); await fundedRider(); const args={partnerId:partner._id,userId:rider._id,amount:300,key:'fixture-request'};
  const [a,b]=await Promise.all([requestVerifiedRiderPayout(args),requestVerifiedRiderPayout(args)]); expect(String(a.payout._id)).toBe(String(b.payout._id));
  expect((await Partner.findById(partner._id)).earnings.pending).toBe(100);
  const payoutId=a.payout._id;
  await expect(resolveVerifiedRiderPayout({payoutId,actorId:admin._id,complete:true,input:{transactionRef:'TEST'}})).rejects.toMatchObject({status:400});
  const input={verified:true,transactionRef:'BANK-TEST',reason:'Verified synthetic bank statement'};
  await Promise.all([resolveVerifiedRiderPayout({payoutId,actorId:admin._id,complete:true,input}),resolveVerifiedRiderPayout({payoutId,actorId:admin._id,complete:true,input})]);
  expect((await Partner.findById(partner._id)).earnings).toMatchObject({pending:100,reserved:0,paid:300});
});
test('rider cannot withdraw unverified legacy pending balance or exceed verified amount', async () => {
  enable(); await Partner.updateOne({_id:partner._id},{$set:{'earnings.pending':1000}});
  await expect(requestVerifiedRiderPayout({partnerId:partner._id,userId:rider._id,amount:300,key:'fixture-request'})).rejects.toThrow(/verified payable/);
});
test('concurrent reject and complete cannot both move reserved money', async () => {
  enable(); await fundedRider(); const {payout}=await requestVerifiedRiderPayout({partnerId:partner._id,userId:rider._id,amount:300,key:'fixture-request'});
  const results=await Promise.allSettled([resolveVerifiedRiderPayout({payoutId:payout._id,actorId:admin._id,complete:true,input:{verified:true,transactionRef:'BANK-TEST',reason:'Fixture evidence'}}),resolveVerifiedRiderPayout({payoutId:payout._id,actorId:admin._id,complete:false,input:{reason:'Fixture rejection'}})]);
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  const fresh=await Partner.findById(partner._id); expect(fresh.earnings.pending+fresh.earnings.paid+fresh.earnings.reserved).toBe(400);
});
test('partial/full refunds append compensations and cannot reverse the same refund twice', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id);
  const retId=id(); await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'TEST-REFUND',refundAmount:50,returnNumber:'RET-TEST'});
  await Promise.all([reverseRefundedReturn(retId,admin._id),reverseRefundedReturn(retId,admin._id)]);
  expect(await sellerBalances(seller._id)).toMatchObject({held:45});
  await releaseOrderFinance(order._id,admin._id); expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:45});
});
test('append-only ledger rejects mutation and event key collisions with different money', async () => {
  const payload={idempotencyKey:'fixture-ledger',sellerId:seller._id,type:'order_earning',direction:'credit',bucket:'held',amount:1,description:'Fixture'};
  await postLedgerEntry(payload); await expect(postLedgerEntry({...payload,amount:2})).rejects.toMatchObject({status:409});
  await expect(Ledger.updateOne({},{$set:{amount:5}})).rejects.toThrow(/append-only/);
  await expect(Ledger.findOneAndDelete({})).rejects.toThrow(/append-only/);
  const row=await Ledger.findOne({});row.description='mutated';await expect(row.save()).rejects.toThrow(/append-only/);
});
test('admin, seller and rider endpoints enforce ownership and real CSV export', async () => {
  expect((await request(app).get('/api/admin/finance/orders')).status).toBe(401);
  expect((await request(app).get('/api/admin/finance/orders').set('Authorization',bearer(rider))).status).toBe(403);
  const report=await request(app).get('/api/admin/finance/orders?export=csv&cod=true').set('Authorization',bearer(admin,'admin'));
  expect(report.status).toBe(200);expect(report.headers['content-type']).toMatch(/text\/csv/);expect(report.text).toContain(order.orderNo);
  const own=await request(app).get('/api/delivery/finances/cod').set('Authorization',bearer(rider));expect(own.body.data).toHaveLength(1);expect(own.body.data[0].financialSnapshot.lines).toBeUndefined();
  const stranger=await User.create({phone:'9876600003',roles:['seller'],isActive:true});await Seller.collection.insertOne({_id:id(),userId:stranger._id,status:'approved'});
  const other=await request(app).get(`/api/sellers/orders/${order._id}/financial-breakdown`).set('Authorization',bearer(stranger,'user','seller'));expect(other.status).toBe(404);
});

test('discount and multi-vendor allocation conserve every paisa even for fully discounted tiny lines', async () => {
  const data=order.toObject();data.items=[{_id:id(),productId:product._id,sellerId:seller._id,type:'grocery',qty:1,price:.01},{_id:id(),productId:product._id,sellerId:id(),type:'grocery',qty:1,price:.01}];
  data.pricing={subtotal:.02,couponDiscount:.01,coinDiscount:.01,totalAmount:0};
  const snapshot=await buildOrderFinancialSnapshot(data);
  expect(snapshot.lines.every(line=>line.eligiblePaise===0&&line.netPaise===0)).toBe(true);
  expect(snapshot.lines.reduce((n,line)=>n+line.allocatedDiscounts.couponDiscount,0)).toBe(1);
  expect(snapshot.lines.reduce((n,line)=>n+line.allocatedDiscounts.coinDiscount,0)).toBe(1);
});
test('disabled commission version affects future orders and never rewrites frozen orders', async () => {
  const parent=await Commission.findOne({});await saveCommissionVersion({...ruleInput(),isActive:false,supersedes:String(parent._id)},admin._id);
  expect((await buildOrderFinancialSnapshot(order)).state).toBe('held_missing_rule');
  expect((await queryOrder()).financialSnapshot.state).toBe('configured');
  await expect(Order.updateOne({_id:order._id},{$set:{'financialSnapshot.lines.0.netPaise':1}})).rejects.toThrow(/immutable/);
});
const prepaidFixture=async method=>{
  await Payment.updateOne({_id:payment._id},{$set:{method,status:'paid',...(method==='online'?{captures:[{gatewayOrderId:'order-test',gatewayPaymentId:'pay-test',amountPaise:10000,currency:'INR',disposition:'settled'}]}:{})}});
  // Synthetic fixture only; the application never rewrites a frozen snapshot.
  await Order.collection.updateOne({_id:order._id},{$set:{paymentMethod:method,'financialSnapshot.paymentMethod':method}});
};
test('online verified capture posts once; an unpaid or missing capture cannot accrue earnings', async () => {
  enable();await prepaidFixture('online');await Payment.updateOne({_id:payment._id},{$set:{status:'pending'}});
  await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/Verified customer payment/);
  await Payment.updateOne({_id:payment._id},{$set:{status:'paid',captures:[]}});await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/captured/);
  await prepaidFixture('online');await Promise.all([postOrderFinance(order._id,admin._id),postOrderFinance(order._id,admin._id)]);
  expect(await sellerBalances(seller._id)).toMatchObject({held:90,eligible:0});
});
test('wallet payment status alone cannot substitute for the authoritative wallet debit', async () => {
  enable();await prepaidFixture('wallet');await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/Wallet debit/);
  await WalletLedger.collection.insertOne({userId:user._id,direction:'debit',referenceId:String(order._id),amount:100,status:'completed',transactionId:'WALLET-TEST'});
  await postOrderFinance(order._id,admin._id);expect(await sellerBalances(seller._id)).toMatchObject({held:90});
});
test.each(['placed','confirmed','cancelled'])('%s status cannot establish collected cash or earnings',async status=>{
  enable();await Order.updateOne({_id:order._id},{$set:{status}});
  await expect(cod('collect')).rejects.toThrow(/delivery/);await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/completed deliveries/);
  expect(await Ledger.countDocuments()).toBe(0);expect((await Payment.findById(payment._id)).status).toBe('pending');
});
test('full refund compensates every remaining paisa and does not rewrite the original entries', async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:2,status:'REFUNDED',refundReference:'REFUND-FULL',refundAmount:100,returnNumber:'RET-FULL'});
  await reverseRefundedReturn(retId,admin._id);await releaseOrderFinance(order._id,admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:0});
  expect((await Ledger.findOne({type:'order_earning'})).amount).toBe(90);
});
test('post-settlement refund creates explicit held debt and reconciliation exceptions',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  await postLedgerEntry({idempotencyKey:'fixture-paid',sellerId:seller._id,account:'seller_payable',type:'payout_reservation',direction:'debit',bucket:'eligible',amount:90,description:'Synthetic completed withdrawal'});
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'REFUND-LATE',refundAmount:50,returnNumber:'RET-LATE'});
  await reverseRefundedReturn(retId,admin._id);expect(await sellerBalances(seller._id)).toMatchObject({eligible:0,held:-45});
  const report=await financialReconciliation();expect(report.negativeBalances.some(row=>row._id.account==='seller_payable'&&row.amount===-45)).toBe(true);
});
test('refund allocation mismatch requires reconciliation and cannot silently alter earnings',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'REFUND-BAD',refundAmount:49.99,returnNumber:'RET-BAD'});
  await expect(reverseRefundedReturn(retId,admin._id)).rejects.toThrow(/differs/);expect(await sellerBalances(seller._id)).toMatchObject({held:90});
});
test('missing rider rate evidence holds financial eligibility without fabricating earnings',async()=>{
  const copy=delivery.toObject();delete copy.ratesUsed;
  const result=await financialTransaction(session=>recordDeliveryEarning({order,delivery:copy,settlement:{total:40,tip:0,base:20,perKm:10,distanceKm:2},session}));
  expect(result).toEqual({credited:false,status:'reconciliation_required'});expect(await Ledger.countDocuments({account:'rider_payable'})).toBe(0);
  expect((await Delivery.findById(delivery._id)).financialEarningStatus).toBe('reconciliation_required');
});
test('reconciliation detects missing allocations and persisted commission mismatches',async()=>{
  enable();let report=await financialReconciliation();expect(report.exceptions.some(row=>row.code==='allocation_missing')).toBe(true);
  await verifyCash();await postOrderFinance(order._id,admin._id);
  // Synthetic corruption establishes that the read-only report detects drift.
  await Ledger.collection.updateOne({account:'commission_revenue'},{$set:{amount:9}});
  report=await financialReconciliation();expect(report.exceptions.some(row=>row.code==='merchandise_posting_mismatch')).toBe(true);
});
test('rider rate draft persists without altering current customer prices',async()=>{
  const {priceOrder}=await import('../services/pricing.service.js');const items=[{price:100,qty:1,type:'grocery'}];
  const before=priceOrder(items,{},null,null,2).deliveryCharge;
  const result=await request(app).post('/api/admin/delivery-rates').set('Authorization',bearer(admin,'admin')).send({mode:'quick',base:100,perKm:100,minPayout:0,isActive:false,note:'Synthetic rate draft'});
  expect(result.status).toBe(200);expect(result.body.data.isActive).toBe(false);expect(priceOrder(items,{},null,null,2).deliveryCharge).toBe(before);
  const denied=await request(app).post('/api/admin/delivery-rates').set('Authorization',bearer(admin,'admin')).send({mode:'quick',base:100,perKm:100,isActive:true,note:'Synthetic activation'});expect(denied.status).toBe(503);
});
test('independently configured customer distance tariff is unchanged by rider rate activation',async()=>{
  enable();const {priceOrder}=await import('../services/pricing.service.js');
  const customer=await request(app).post('/api/admin/delivery-charge').set('Authorization',bearer(admin,'admin')).send({flatFee:20,distanceRates:{quick:7,same_day:9},note:'Synthetic independent customer tariff'});
  expect(customer.status).toBe(200);const items=[{price:100,qty:1,type:'grocery'}];expect(priceOrder(items,{},null,null,2).deliveryCharge).toBe(14);
  const rate=await request(app).post('/api/admin/delivery-rates').set('Authorization',bearer(admin,'admin')).send({mode:'quick',base:100,perKm:99,minPayout:0,isActive:true,note:'Synthetic approved rider rate'});
  expect(rate.status).toBe(200);expect(priceOrder(items,{},null,null,2).deliveryCharge).toBe(14);
});
test('disputed verified cash freezes withdrawals and reopening verification does not double-post receipt',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  await recordCodEvent({orderId:order._id,actorId:admin._id,action:'dispute',input:{amount:100,reference:'DISPUTE-TEST',reason:'Synthetic missing cash investigation'}});
  const response=await request(app).post('/api/sellers/payouts').set('Authorization',bearer(user,'user','seller')).set('Idempotency-Key','disputed-payout-fixture').send({amount:30});
  expect(response.status).toBe(409);expect(response.body.message).toMatch(/Disputed COD/);
  await cod('verify',100,{reference:'REVERIFIED-CASH',reason:'Independent cash receipt investigation resolved'});
  expect(await Ledger.countDocuments({account:'cod_custody'})).toBe(2);
});
test('vendor report uses posted payable balances and never assumes commission from delivered totals',async()=>{
  enable();let response=await request(app).get('/api/admin/vendor-earnings').set('Authorization',bearer(admin,'admin'));
  expect(response.status).toBe(200);expect(response.body.data.rows[0].netPayable).toBe(0);expect(response.body.data.rows[0].commissionRate).toBeUndefined();
  await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  response=await request(app).get('/api/admin/vendor-earnings').set('Authorization',bearer(admin,'admin'));expect(response.body.data.rows[0].netPayable).toBe(90);
});
test('seller payout reservation and verified reconciliation are idempotent and cannot exceed payable',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  const withdraw=amount=>request(app).post('/api/sellers/payouts').set('Authorization',bearer(user,'user','seller')).set('Idempotency-Key','seller-payout-fixture').send({amount});
  const [a,b]=await Promise.all([withdraw(30),withdraw(30)]);expect(a.status).toBe(200);expect(b.status).toBe(200);expect(a.body.data._id).toBe(b.body.data._id);
  expect((await withdraw(31)).status).toBe(409);expect(await sellerBalances(seller._id)).toMatchObject({eligible:60,reserved:30});
  const payoutId=a.body.data._id;
  expect((await request(app).patch(`/api/admin/vendor-payouts/${payoutId}/settle`).set('Authorization',bearer(admin,'admin')).send({transactionRef:'BANK-TEST'})).status).toBe(400);
  const settle=()=>request(app).patch(`/api/admin/vendor-payouts/${payoutId}/settle`).set('Authorization',bearer(admin,'admin')).send({verified:true,transactionRef:'BANK-SELLER-TEST',reason:'Verified synthetic bank statement'});
  const results=await Promise.all([settle(),settle()]);expect(results.map(row=>row.status)).toEqual([200,200]);expect(await sellerBalances(seller._id)).toMatchObject({eligible:60,reserved:0,settled:30});
});
test('seller payout rejection returns only the existing reservation and retains an audit reason',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  const created=await request(app).post('/api/sellers/payouts').set('Authorization',bearer(user,'user','seller')).set('Idempotency-Key','seller-rejection-fixture').send({amount:30});expect(created.status).toBe(200);
  const reject=()=>request(app).patch(`/api/admin/vendor-payouts/${created.body.data._id}/reject`).set('Authorization',bearer(admin,'admin')).send({reason:'Synthetic bank detail correction'});
  const responses=await Promise.all([reject(),reject()]);expect(responses.map(row=>row.status)).toEqual([200,200]);expect(await sellerBalances(seller._id)).toMatchObject({eligible:90,reserved:0,settled:0});
  expect((await SellerPayout.findById(created.body.data._id)).rejectionReason).toBe('Synthetic bank detail correction');
});
