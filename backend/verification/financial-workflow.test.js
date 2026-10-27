import mongoose from 'mongoose';
import { jest } from '@jest/globals';
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
import { discountAllocation } from '../services/orderDiscounts.service.js';
import { calculateReturnRefund, processReturnRefund } from '../services/return.service.js';
import { historicalExceptions, applyReviewedHistoricalBatch } from '../services/historicalFinance.service.js';
import { historicalManifestRow } from '../utils/historicalManifest.js';
import { destinationFingerprint } from '../services/payoutEvidence.service.js';
import { eligibleValueOfOrder, computeItemEligibleValue } from '../services/coin.service.js';
import { saveFinancePolicy, getFinancePolicy } from '../services/financePolicy.service.js';
import { runFinanceAutomationOnce } from '../services/financeAutomation.service.js';

const app = express(); app.use(express.json());
app.use('/api/admin', adminRoutes); app.use('/api/delivery', deliveryRoutes); app.use('/api/sellers', sellerRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const ruleInput = () => ({ vendorType: 'general', channel: 'quick', method: 'percentage', value: 10,
  minimum: null, maximum: null, base: 'eligible_item_subtotal', fixedScope: 'order_item',
  taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' });
const enable = () => { process.env.FINANCE_POLICY_APPROVAL_REFERENCE = 'TEST-POLICY'; process.env.FINANCE_E2E_APPROVAL_REFERENCE = 'TEST-E2E'; };
let db, user, rider, admin, seller, product, partner, order, payment, delivery;
const bearer = (who, type = 'user', role = 'delivery') => `Bearer ${jwt.sign({ id: String(who._id), type, ...(type === 'user' ? { role } : {}) }, JWT_SECRET)}`;
const cod = (action, amount = 100, extra = {}) => recordCodEvent({ orderId: order._id, partnerId: partner._id, actorId: action === 'verify' ? admin._id : rider._id, action,
  input: { amount, method: 'cash', reference: `${action}-TEST`, reason: 'Synthetic cash evidence', ...extra } });
const seedBeneficiaryProcess = async reference => mongoose.connection.collection('finance_approved_processes').updateOne({ _id: reference }, { $set: { kind: 'bank_beneficiary_verification', status: 'approved', approvedBy: admin._id, approvalEvidenceReference: 'SYNTHETIC-PROCESS-APPROVAL', version: 'fixture-v1', effectiveAt: new Date('2020-01-01') } }, { upsert: true });
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
  const adminId = id(); await Admin.collection.insertOne({ _id: adminId, name: 'Fixture admin', email: 'fixture@example.test', password: 'not-a-password', role: 'admin', permissions: ['manage_finance'], isActive: true }); admin = await Admin.findById(adminId);
  const sellerId = id(); await Seller.collection.insertOne({ _id: sellerId, userId: user._id, businessName: 'Fixture store', status: 'approved', bankDetails: { upiId: 'fixture@test' } }); seller = await Seller.findById(sellerId);
  const productId = id(); await Product.collection.insertOne({ _id: productId, category: id(), type: 'grocery' }); product = await Product.findById(productId);
  await Category.collection.insertOne({ _id: product.category, name: 'Fixture category', type: 'grocery' });
  partner = await Partner.create({ userId: rider._id, status: 'approved', bankDetails: { upiId: 'fixture@test' } });
  await saveCommissionVersion(ruleInput(), admin._id);
  payment = await Payment.create({ userId: user._id, amount: 100, method: 'cod', status: 'pending' });
  order = await Order.create({ userId: user._id, type: 'grocery', items: [{ productId, sellerId, type: 'grocery', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }],
    paymentMethod: 'cod', paymentId: payment._id, status: 'delivered', pricing: { subtotal: 100, totalAmount: 100 } });
  delete process.env.FINANCE_SNAPSHOTS_ENABLED;
  payment.orderId = order._id; await payment.save();
  delivery = await Delivery.create({ orderId: order._id, partnerId: partner._id, status: 'delivered', otpVerified: true, direction: 'forward', route: { distanceKm: 2 }, ratesUsed: { base: 20, perKm: 10, rateId: id(), mode: 'quick' }, partnerEarnings: 40 });
  await Order.updateOne({ _id: order._id }, { $set: { deliveryId: delivery._id, deliveryPartnerId: partner._id } }); order = await queryOrder();
});

test('money operations are active by default and can process cash collection', async () => {
  expect(() => requireFinanceOperation()).not.toThrow();
  await cod('collect');
  expect((await queryOrder()).codFinance.status).toBe('collected');
  expect(await Ledger.countDocuments({ account: 'cod_custody' })).toBe(1);
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

test('legacy delivered order cannot be allocated or backfilled by a financial read', async () => {
  enable();
  const legacy = { ...order.toObject(), _id: id(), orderNo: 'AUDIT-LEGACY' };
  delete legacy.financialSnapshot;
  await Order.collection.insertOne(legacy);
  await expect(postOrderFinance(legacy._id, admin._id)).rejects.toThrow(/historical backfill/);
  const report = await financialReconciliation();
  expect(report.coverage.totalOrders).toBe(1); // Legacy absent from v2 monitoring, not auto-repaired.
  expect((await Order.collection.findOne({ _id: legacy._id })).financialSnapshot).toBeUndefined();
  expect(await Ledger.countDocuments()).toBe(0);
});

test('database failure is a summary API error rather than a successful zero balance', async () => {
  const spy = jest.spyOn(Ledger, 'aggregate').mockRejectedValue(new Error('Isolated ledger read failure'));
  try {
    const r = await request(app).get('/api/sellers/finances/summary').set('Authorization', bearer(user, 'user', 'seller'));
    expect(r.status).toBe(500); expect(r.body.success).toBe(false); expect(r.body.data).toBeNull();
  } finally { spy.mockRestore(); }
});

test('legacy coupon alias is normalized without a write; platform funds the discount', async () => {
  const copy = order.toObject();
  // Exact shape written by createOrder: discount includes couponDiscount already.
  copy.pricing = { subtotal: 100, discount: 10, couponDiscount: 10, totalAmount: 90 };
  const frozen = await buildOrderFinancialSnapshot(copy);
  expect(frozen).toMatchObject({ expectedPaise: 9000, discountRepresentation: 'legacy-coupon-alias', state: 'configured', discountFunding: 'platform' });
  // ₹100 item, ₹10 coupon, 10% commission on the ₹90 paid: seller gets ₹91.
  expect(frozen.lines[0]).toMatchObject({ grossPaise: 10000, eligiblePaise: 9000, commissionPaise: 900, platformDiscountPaise: 1000, netPaise: 9100 });
  expect(copy.pricing.discount).toBe(10);
  expect(await Ledger.countDocuments()).toBe(0);
});

test('policy and end-to-end operations are active by default without env flags', () => {
  expect(() => requireFinanceOperation()).not.toThrow();
  expect(() => requireFinanceOperation('payouts')).not.toThrow();
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
test.each([{ value: null }, { taxRate: '' }, { taxRate: 18, taxTreatment: 'exempt' }, { minimum: -1 }, { minimum: 10, maximum: 1 }, { isActive: 'true' }, { reason: 'x' }, { channel: 'unknown' }, { productId: '$gt' }, { value: 100.001 }])('backend rejects invalid configuration: %j', changes => {
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
test('product override wins; replacing the channel rule never changes frozen orders', async () => {
  await saveCommissionVersion({ ...ruleInput(), productId: String(product._id), value: 12 }, admin._id);
  expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1200);
  await saveCommissionVersion({ ...ruleInput(), value: 20, supersedes: (await Commission.findOne({ productId: null }))._id.toString() }, admin._id);
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
test('impossible collection, duplicate evidence, unauthorized rider and unverified delivery fail closed', async () => {
  enable(); await expect(cod('collect', 101)).rejects.toThrow(/at most the order amount/);
  await expect(cod('collect', 0)).rejects.toThrow(/more than zero/);
  await expect(recordCodEvent({ orderId: order._id, partnerId: id(), actorId: rider._id, action: 'collect', input: { amount: 100, method: 'cash', reference: 'TEST', reason: 'Fixture evidence' } })).rejects.toMatchObject({ status: 404 });
  await cod('collect'); await cod('collect');
  expect(await Ledger.countDocuments({ account: 'cod_custody' })).toBe(1);
  await expect(cod('collect',100,{reference:'another-collection'})).rejects.toThrow(/already/);
  await expect(cod('collect',100,{reason:'Changed evidence'})).rejects.toThrow(/reused/);
});
test.each([90,110])('shortage/excess %i remains disputed and cannot allocate', async amount => {
  // The rider can hand over at most what they collected; the admin may still receive more or less.
  enable(); await cod('collect'); await cod('remit', Math.min(amount, 100)); await cod('verify', amount);
  expect((await queryOrder()).codFinance.status).toBe('discrepancy');
  expect((await Payment.findById(payment._id)).status).toBe('pending');
  const custody=await Ledger.find({account:'cod_custody'});expect(custody.reduce((sum,row)=>sum+(row.direction==='credit'?row.amount:-row.amount),0)).toBe(Math.max(0,100-amount));
  if(amount>100)expect((await Ledger.findOne({account:'cod_excess_liability'})).amount).toBe(amount-100);
  await expect(postOrderFinance(order._id, admin._id)).rejects.toThrow(/not verified/);
  await cod('verify',100,{ reference:'CORRECTED-HANDOVER', reason:'Additional cash independently received' });
  expect((await queryOrder()).codFinance.events).toHaveLength(4);
});
test('a rider cannot report handing over more cash than they collected', async () => {
  enable(); await cod('collect', 80);
  await expect(cod('remit', 90)).rejects.toThrow(/at most the ₹80.00 you collected/);
  await expect(cod('remit', 0)).rejects.toThrow();
  expect((await queryOrder()).codFinance.status).toBe('collected');
});
test('a handover report alerts admins and a confirmed receipt tells the rider', async () => {
  const { default: Notification } = await import('../models/Notification.js');
  enable(); await cod('collect'); await cod('remit');
  const alert = await Notification.findOne({ event: 'COD_HANDOVER_REPORTED' }).lean();
  expect(alert).toMatchObject({ title: 'Rider cash settlement request', route: '/admin/finance-center?area=orders&view=cod' });
  expect(await Notification.countDocuments({ userId: rider._id, event: 'COD_CASH_SETTLED' })).toBe(0);
  await cod('verify');
  expect(await Notification.findOne({ userId: rider._id, event: 'COD_CASH_SETTLED' }).lean()).toMatchObject({ title: 'COD cash settled', route: '/delivery/earnings' });
  expect((await Order.findById(order._id).lean()).codFinance.updatedAt).toBeInstanceOf(Date);
  await cod('verify');
  expect(await Notification.countDocuments({ userId: rider._id, event: 'COD_CASH_SETTLED' })).toBe(1);
  await Notification.create({ userId: rider._id, type: 'order', event: 'ORDER_CREATED', title: 'Customer order', message: 'Customer account only', route: '/orders' });
  const { getMyNotifications } = await import('../controllers/notification.controller.js');
  const inbox = await new Promise((resolve, reject) => getMyNotifications({ user: rider, tokenRole: 'delivery', query: {} }, {
    status() { return this; }, json(body) { resolve(body); },
  }, reject));
  expect(inbox.data).toHaveLength(1); expect(inbox.data[0].event).toBe('COD_CASH_SETTLED');
});
test('the admin COD list returns pending handovers, including when filtered by rider', async () => {
  enable(); await cod('collect'); await cod('remit');
  for (const query of ['cod=true', 'cod=true&partnerId=' + partner._id]) {
    const list = await request(app).get('/api/admin/finance/orders?' + query).set('Authorization', bearer(admin, 'admin'));
    expect(list.status).toBe(200);
    expect(list.body.data.map(row => [String(row._id), row.cash.status])).toEqual([[String(order._id), 'remittance_reported']]);
    expect(list.body.data[0].codFinance.events.at(-1)).toMatchObject({ action: 'remit' });
  }
});
test('confirming COD cash after an early wallet refund keeps the refund state', async () => {
  enable(); await Payment.updateOne({ _id: payment._id }, { $set: { 'refund.totalRefundedAmount': 40 } });
  await cod('collect'); await cod('remit'); await cod('verify');
  expect((await Payment.findById(payment._id)).status).toBe('partial_refund');
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
  await Order.updateOne({_id:order._id},{$set:{'items.0.returnEligibleUntil':new Date('2100-01-01'), 'items.0.returnPolicy.returnEligible': true, 'items.0.returnPolicy.returnWindowDays': 7}});
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
  const { default: Notification } = await import('../models/Notification.js');
  expect(await Notification.find({ userId: rider._id, event: 'PAYOUT_COMPLETED' }).lean()).toEqual([expect.objectContaining({ title: 'Payout settled', route: '/delivery/earnings' })]);
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
  const retId=id(); await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'MANUAL-COD',codSettledBy:admin._id,codSettledAt:new Date(),codSettlementNote:'Synthetic manual cash receipt',refundAmount:50,returnNumber:'RET-TEST'});
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
  // Fully discounted lines carry no commission; the platform-funded discount pays the seller the item price.
  expect(snapshot.lines.every(line=>line.eligiblePaise===0&&line.commissionPaise===0&&line.platformDiscountPaise===1&&line.netPaise===1)).toBe(true);
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

test('a valid capture for a smaller payment cannot fund a larger frozen order', async () => {
  enable(); await prepaidFixture('online');
  await Payment.updateOne({_id:payment._id},{$set:{amount:90,'captures.0.amountPaise':9000}});
  await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/original payment funding/);
  expect(await Ledger.countDocuments()).toBe(0);
});
test('wallet payment status alone cannot substitute for the authoritative wallet debit', async () => {
  enable();await prepaidFixture('wallet');await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/Wallet debit/);
  await WalletLedger.collection.insertOne({userId:user._id,direction:'debit',referenceId:String(order._id),amount:100,status:'completed',transactionId:'WALLET-TEST'});
  await postOrderFinance(order._id,admin._id);expect(await sellerBalances(seller._id)).toMatchObject({held:90});
});

test('wallet partial refund needs matching debit and refund credit before remaining net releases', async () => {
  enable(); await prepaidFixture('wallet');
  await WalletLedger.collection.insertOne({userId:user._id,direction:'debit',referenceId:String(order._id),amount:100,status:'completed',transactionId:'WALLET-DEBIT'});
  await postOrderFinance(order._id,admin._id);
  const retId=id();await Return.collection.insertOne({_id:retId,customerId:user._id,sellerId:seller._id,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'WALLET-CREDIT',refundAmount:50,returnNumber:'RET-WALLET'});
  await Payment.updateOne({_id:payment._id},{$set:{status:'partial_refund','refund.totalRefundedAmount':50}});
  await expect(reverseRefundedReturn(retId,admin._id)).rejects.toThrow(/Wallet refund credit/);
  await WalletLedger.collection.insertOne({userId:user._id,direction:'credit',referenceType:'RETURN',referenceId:String(retId),amount:50,status:'completed',transactionId:'WALLET-CREDIT'});
  await reverseRefundedReturn(retId,admin._id);await releaseOrderFinance(order._id,admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:45});
});

test('one prepaid payment funds only the exact sum of its seller-scoped sibling orders', async () => {
  enable(); await prepaidFixture('online');
  order = await queryOrder();
  const groupRef='SYNTHETIC-SHARED-PAYMENT',otherSeller=id();
  await Seller.collection.insertOne({_id:otherSeller,userId:id(),status:'approved'});
  await Order.updateOne({_id:order._id},{$set:{groupRef}});
  const siblingId=id(),itemId=id(),original=order.financialSnapshot;
  const sibling={...order.toObject(),_id:siblingId,orderNo:'SYNTHETIC-SIBLING',groupRef,items:[{...order.items[0].toObject(),_id:itemId,sellerId:otherSeller}],financialSnapshot:{...original,snapshotId:String(id()),lines:original.lines.map(line=>({...line,itemId:String(itemId),sellerId:String(otherSeller)}))}};
  await Order.collection.insertOne(sibling);
  await Payment.updateOne({_id:payment._id},{$set:{groupRef,amount:200,'captures.0.amountPaise':20000}});
  await Promise.all([postOrderFinance(order._id,admin._id),postOrderFinance(siblingId,admin._id)]);
  expect(await sellerBalances(seller._id)).toMatchObject({held:90});expect(await sellerBalances(otherSeller)).toMatchObject({held:90});
  expect(await Ledger.countDocuments({account:'seller_payable',type:'order_earning'})).toBe(2);
});
test.each(['placed','confirmed','cancelled'])('%s status cannot establish collected cash or earnings',async status=>{
  enable();await Order.updateOne({_id:order._id},{$set:{status}});
  await expect(cod('collect')).rejects.toThrow(/delivery/);await expect(postOrderFinance(order._id,admin._id)).rejects.toThrow(/completed deliveries/);
  expect(await Ledger.countDocuments()).toBe(0);expect((await Payment.findById(payment._id)).status).toBe('pending');
});
test('full refund compensates every remaining paisa and does not rewrite the original entries', async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:2,status:'REFUNDED',refundReference:'MANUAL-COD',codSettledBy:admin._id,codSettledAt:new Date(),codSettlementNote:'Synthetic manual cash receipt',refundAmount:100,returnNumber:'RET-FULL'});
  await reverseRefundedReturn(retId,admin._id);await releaseOrderFinance(order._id,admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:0});
  expect((await Ledger.findOne({type:'order_earning'})).amount).toBe(90);
});
test('post-settlement refund creates explicit held debt and reconciliation exceptions',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);await releaseOrderFinance(order._id,admin._id);
  await postLedgerEntry({idempotencyKey:'fixture-paid',sellerId:seller._id,account:'seller_payable',type:'payout_reservation',direction:'debit',bucket:'eligible',amount:90,description:'Synthetic completed withdrawal'});
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'MANUAL-COD',codSettledBy:admin._id,codSettledAt:new Date(),codSettlementNote:'Synthetic manual cash receipt',refundAmount:50,returnNumber:'RET-LATE'});
  await reverseRefundedReturn(retId,admin._id);expect(await sellerBalances(seller._id)).toMatchObject({eligible:0,held:-45});
  const report=await financialReconciliation();expect(report.negativeBalances.some(row=>row._id.account==='seller_payable'&&row.amount===-45)).toBe(true);
});
test('refund allocation mismatch requires reconciliation and cannot silently alter earnings',async()=>{
  enable();await verifyCash();await postOrderFinance(order._id,admin._id);
  const retId=id();await Return.collection.insertOne({_id:retId,orderId:order._id,orderItemId:order.items[0]._id,quantity:1,status:'REFUNDED',refundReference:'MANUAL-COD',codSettledBy:admin._id,codSettledAt:new Date(),codSettlementNote:'Synthetic manual cash receipt',refundAmount:49.99,returnNumber:'RET-BAD'});
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
  const denied=await request(app).post('/api/admin/delivery-rates').set('Authorization',bearer(admin,'admin')).send({mode:'quick',base:100,perKm:100,isActive:true,note:'Synthetic activation'});expect([409,503]).toContain(denied.status);
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
  const reviewer = id(); await Admin.collection.insertOne({ _id: reviewer, name: 'Independent reviewer', email: 'reviewer@example.test', role: 'admin', permissions: ['manage_finance'], isActive: true });
  await seedBeneficiaryProcess('TEST-APPROVED-PROCESS');
  const { destinationFingerprint } = await import('../services/payoutEvidence.service.js');
  expect((await request(app).patch(`/api/admin/vendor-payouts/${payoutId}/beneficiary-review`).set('Authorization', bearer({_id:reviewer},'admin')).send({ fingerprint: destinationFingerprint(seller.bankDetails), evidenceReference: 'TEST-OWNERSHIP', approvalReference: 'TEST-APPROVED-PROCESS', reason: 'Synthetic bank ownership review' })).status).toBe(200);
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

test('simultaneous seller payout requests cannot reserve the same eligible money twice', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id, admin._id); await releaseOrderFinance(order._id, admin._id);
  const requestPayout = key => request(app).post('/api/sellers/payouts').set('Authorization', bearer(user, 'user', 'seller')).set('Idempotency-Key', key).send({ amount: 70 });
  const rows = await Promise.all([requestPayout('audit-concurrent-a'), requestPayout('audit-concurrent-b')]);
  expect(rows.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await sellerBalances(seller._id)).toMatchObject({ eligible: 20, reserved: 70, settled: 0 });
  expect(await SellerPayout.countDocuments()).toBe(1);
});

test('partial refund with missing provider evidence remains blocked after compensation', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id, admin._id);
  const retId = id();
  await Return.collection.insertOne({ _id: retId, orderId: order._id, orderItemId: order.items[0]._id, sellerId: seller._id, quantity: 1, status: 'REFUNDED', refundReference: 'AUDIT-REFUND', refundAmount: 50, returnNumber: 'AUDIT-RETURN' });
  await Payment.updateOne({ _id: payment._id }, { $set: { status: 'partial_refund' } });
  await expect(reverseRefundedReturn(retId, admin._id)).rejects.toThrow(/Verified provider refund evidence/);
  await expect(releaseOrderFinance(order._id, admin._id)).rejects.toThrow(/Verified provider refund evidence/);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 90, eligible: 0 });
});

test('audit integration blocker: reference-free zero-value refunded return cannot be financially reconciled', async () => {
  enable();
  const retId = id();
  await Return.collection.insertOne({ _id: retId, orderId: order._id, orderItemId: order.items[0]._id, quantity: 1, status: 'REFUNDED', refundReference: null, refundAmount: 0, returnNumber: 'AUDIT-ZERO' });
  await expect(reverseRefundedReturn(retId, admin._id)).rejects.toThrow(/Authoritatively completed refund/);
});

test.each([
  [{ subtotal: 100, totalAmount: 100 }, [10000], 10000],
  [{ subtotal: 90, totalAmount: 90 }, [9000], 9000], // campaign already lowered frozen item price
  [{ discountRepresentation: 'components-v1', subtotal: 100, couponDiscount: 10, totalAmount: 90 }, [2500,7500], 9000],
  [{ discountRepresentation: 'components-v1', subtotal: 100, discount: 1, couponDiscount: 2, cdsDiscount: 3, coinDiscount: 4, totalAmount: 90 }, [3333,6667], 9000],
  [{ subtotal: 100, discount: 12, couponDiscount: 10, totalAmount: 88 }, [10000], 8800], // legacy aggregate = promotion2 + coupon10
  [{ subtotal: .03, couponDiscount: .02, totalAmount: .01 }, [1,1,1], 1],
])('canonical discount allocation conserves payment components %j', (pricing, gross, expected) => {
  const result = discountAllocation(pricing, gross);
  const net = gross.map((value,index) => value - result.keys.reduce((sum,key) => sum + result.discounts[key][index],0));
  expect(net.every(value => value >= 0)).toBe(true); expect(net.reduce((a,b) => a+b,0)).toBe(expected);
});

test('canonical fields cannot silently use legacy alias normalization', () => {
  expect(() => discountAllocation({ discountRepresentation: 'components-v1', discount: 10, couponDiscount: 10, totalAmount: 90 }, [10000])).toThrow(/reconcile/);
});

test('Coins reward base preserves the old coupon deduction and excludes its own redemption', () => {
  const items = [{ _id:id(),price:25,qty:1 },{ _id:id(),price:75,qty:1 }];
  const legacy = {items,pricing:{subtotal:100,discount:10,couponDiscount:10,coinDiscount:5}};
  const canonical = {items,pricing:{subtotal:100,discountRepresentation:'components-v1',discount:0,couponDiscount:10,coinDiscount:5}};
  expect(eligibleValueOfOrder(canonical)).toBe(eligibleValueOfOrder(legacy));
  expect(eligibleValueOfOrder(canonical)).toBe(90);
  expect(items.map(item=>computeItemEligibleValue(canonical,item))).toEqual([22.5,67.5]);
  expect(computeItemEligibleValue(canonical,{...items[1],returnedQty:1})).toBe(0);
});

const recordedOnlineReturn = async (quantity = 1) => {
  const retId = id(), amount = quantity * 50, reference = `refund-${retId}`;
  await Return.collection.insertOne({ _id: retId, orderId: order._id, orderItemId: order.items[0]._id, quantity, status: 'REFUNDED', refundStatus: 'completed', refundReference: reference, refundAmount: amount, returnNumber: `RET-${retId}` });
  await Payment.updateOne({ _id: payment._id }, { $set: { status: quantity === 2 ? 'refunded' : 'partial_refund', 'refund.totalRefundedAmount': amount,
    refundObligations: [{ key: `RETURN_REFUND:${retId}`, returnId: retId, orderId: order._id, gatewayPaymentId: 'pay-test', amountPaise: amount * 100, currency: 'INR', status: 'processed', providerRefundId: reference, verifiedAt: new Date() }] } });
  return retId;
};

test('verified online partial refund releases only compensated remaining net, once', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id, admin._id);
  const retId = await recordedOnlineReturn();
  await expect(releaseOrderFinance(order._id, admin._id)).rejects.toThrow(/financial reconciliation/);
  await Promise.all([reverseRefundedReturn(retId, admin._id), reverseRefundedReturn(retId, admin._id)]);
  await Promise.all([releaseOrderFinance(order._id, admin._id), releaseOrderFinance(order._id, admin._id)]);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 45, earnedEarnings: 90, reversals: 45 });
});

test('fully refunded online order compensates all net and releases no money', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id, admin._id);
  const retId = await recordedOnlineReturn(2);
  await expect(releaseOrderFinance(order._id, admin._id)).rejects.toThrow(/Fully refunded/);
  await reverseRefundedReturn(retId, admin._id);
  expect(await releaseOrderFinance(order._id, admin._id)).toMatchObject({ status: 'reversed' });
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 0 });
});

test('refund projection mismatch and unverified provider obligation block remaining funds', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id, admin._id);
  const retId = await recordedOnlineReturn(); await reverseRefundedReturn(retId, admin._id);
  await Payment.updateOne({ _id: payment._id }, { $set: { 'refund.totalRefundedAmount': 49 } });
  await expect(releaseOrderFinance(order._id, admin._id)).rejects.toThrow(/totals do not reconcile/);
  await Payment.updateOne({ _id: payment._id }, { $set: { 'refund.totalRefundedAmount': 50, 'refundObligations.0.status': 'processing' } });
  await expect(releaseOrderFinance(order._id, admin._id)).rejects.toThrow(/evidence/);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 45, eligible: 0 });
});

test('zero return completion records internal evidence and never a provider transfer or payable credit', async () => {
  enable();
  // Synthetic historical approved funding fixture: one free line and one paid
  // line. The new checkout cannot assume this historical sponsorship policy.
  const frozen = order.financialSnapshot, freeItem = { ...order.items[0].toObject(), _id: id() };
  const freeLine = { ...frozen.lines[0], itemId: String(freeItem._id), eligiblePaise: 0, commissionPaise: 0, taxPaise: 0, netPaise: 0, allocatedDiscounts: { couponDiscount: 10000 } };
  await Order.collection.updateOne({ _id: order._id }, { $set: { items: [freeItem, ...order.items.map(row=>row.toObject())], pricing: { subtotal: 200, couponDiscount: 100, totalAmount: 100 }, financialSnapshot: { ...frozen, lines: [freeLine, ...frozen.lines] } } });
  await verifyCash(); await postOrderFinance(order._id, admin._id);
  const retId = id(); await Return.collection.insertOne({ _id: retId, orderId: order._id, orderItemId: freeItem._id, customerId: user._id, sellerId: seller._id,
    quantity: 1, productId: product._id, reason: 'OTHER', unitPriceSnapshot: 50, status: 'RETURN_RECEIVED', receivedAt: new Date(), restockDecision: 'NON_RESTOCKABLE', restockStatus: 'NOT_RESTOCKED', returnNumber: 'RET-ZERO', history: [], refundAllocationStartQuantity: 0 });
  const before = await Ledger.countDocuments();
  const ret = await processReturnRefund({ returnId: retId, adminId: admin._id });
  expect(ret.refundReference).toBeNull(); expect(ret.refundAmount).toBe(0); expect(ret.zeroRefundEvidence.key).toBe(`ZERO_RETURN:${retId}`);
  expect(ret.zeroRefundEvidence.actorId).toEqual(admin._id);
  await Promise.all([reverseRefundedReturn(retId, admin._id), reverseRefundedReturn(retId, admin._id)]);
  // Gross reporting compensation is allowed; no fictitious zero cash/payable entry.
  expect(await Ledger.countDocuments({ 'metadata.returnId': String(retId), account: 'seller_payable' })).toBe(0);
  expect(await Ledger.countDocuments()).toBe(before + 1);
  expect((await Payment.findById(payment._id)).refundObligations).toHaveLength(0);
  await releaseOrderFinance(order._id, admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 90 });
});

test('snapshot refund allocation conserves every paisa across partial quantities', () => {
  const itemId = id();
  const data = { items: [{ _id: itemId, price: .01, qty: 3 }], pricing: { coinsUsed: 0 }, financialSnapshot: { version: 2, lines: [{ itemId: String(itemId), grossPaise: 3, eligiblePaise: 2, allocatedDiscounts: { couponDiscount: 1 } }] } };
  const amounts = [0,1,2].map(start => calculateReturnRefund({ orderItemId: itemId, quantity: 1, refundAllocationStartQuantity: start }, data).refundAmount);
  expect(amounts).toEqual([.01,0,.01]); expect(Math.round(amounts.reduce((a,b)=>a+b,0)*100)).toBe(2);
});

test('finance routes require explicit permission, including recovery and legacy aliases', async () => {
  await Admin.updateOne({ _id: admin._id }, { $set: { permissions: [] } });
  for (const route of ['/finance/commissions','/finance/historical-exceptions','/vendor-sales','/vendor-payouts','/seller-balances','/payment-attempt-recovery']) {
    expect((await request(app).get(`/api/admin${route}`).set('Authorization', bearer(admin,'admin'))).status).toBe(403);
  }
});

test('ledger refuses fractional paisa, other currencies, and conflicting currency replay', async () => {
  const payload = { idempotencyKey: 'precision-fixture', sellerId: seller._id, amount: 1, type: 'adjustment', direction: 'credit', bucket: 'held', description: 'Synthetic precision fixture' };
  await expect(postLedgerEntry({ ...payload, amount: .001 })).rejects.toThrow(/decimal/);
  await expect(postLedgerEntry({ ...payload, currency: 'USD' })).rejects.toThrow(/INR/);
  await postLedgerEntry(payload);
  await expect(postLedgerEntry({ ...payload, currency: 'USD' })).rejects.toThrow(/INR/);
  await Ledger.collection.insertOne({ ...payload, idempotencyKey: 'RAW-BAD', currency: 'USD' });
  await expect(sellerBalances(seller._id)).rejects.toThrow(/currency or precision/);
});

test('ledger activity and buckets sum integer paisa and convert to rupees exactly once', async () => {
  for (const [key,type,direction,amount] of [['a','order_earning','credit',1.01],['b','quick_freight_obligation','debit',.1],['c','quick_service_fee','debit',.2]]) await postLedgerEntry({idempotencyKey:key,sellerId:seller._id,type,direction,bucket:'held',amount,description:'Synthetic precision event'});
  // Courier obligations are reported on their own and never reduce held earnings.
  expect(await sellerBalances(seller._id)).toMatchObject({held:1.01,earnedEarnings:1.01,quickFreightObligations:.1,bulkimartServiceFees:.2,courierObligations:{charged:.3,paid:0,outstanding:.3}});
});

test('historical report is read-only, payable unknown, and known online/COD evidence stays blocked', async () => {
  for (const [orderNo, method] of [['ORD-20261015-K2OCHK','online'],['ORD-20261019-CIRFK5','cod']]) {
    const legacy = { ...order.toObject(), _id: id(), orderNo, paymentMethod: method }; delete legacy.financialSnapshot;
    await Order.collection.insertOne(legacy);
  }
  const before = await Order.find({}).lean();
  const report = await historicalExceptions();
  expect(report.rows).toHaveLength(2); expect(report.mutations).toBe(0);
  expect(report.rows.every(row => row.proposedPayable === null && row.proposedPostings.length === 0)).toBe(true);
  expect(report.rows.find(row=>row.orderNo==='ORD-20261019-CIRFK5').classification).toBe('missing_cod_custody_evidence');
  expect(report.rows.find(row=>row.orderNo==='ORD-20261015-K2OCHK').reasons).toContain('missing_payment_evidence');
  expect(await Order.find({}).lean()).toEqual(before); expect(await Ledger.countDocuments()).toBe(0);
  enable(); await expect(applyReviewedHistoricalBatch({ batchId: 'unreviewed', actorId: admin._id, approvalReference: 'TEST-ONLY' })).rejects.toThrow(/approval is missing/);
});

const fundedSellerRequest = async (key, amount = 30) => request(app).post('/api/sellers/payouts')
  .set('Authorization', bearer(user,'user','seller')).set('Idempotency-Key', key).send({amount});
const financeReviewer = async () => {
  await seedBeneficiaryProcess('FIXTURE-PROCESS');
  const reviewer = id(); await Admin.collection.insertOne({ _id: reviewer, name: 'Review operator', email: `${reviewer}@example.test`, role: 'admin', permissions: ['manage_finance'], isActive: true }); return reviewer;
};
const beneficiaryReview = (payoutId, reviewer) => request(app).patch(`/api/admin/vendor-payouts/${payoutId}/beneficiary-review`)
  .set('Authorization', bearer({_id:reviewer},'admin')).send({ fingerprint: destinationFingerprint(seller.bankDetails), evidenceReference: 'FIXTURE-OWNERSHIP', approvalReference: 'FIXTURE-PROCESS', reason: 'Synthetic independent beneficiary evidence' });
const settleSeller = (payoutId, reference, actor = admin._id) => request(app).patch(`/api/admin/vendor-payouts/${payoutId}/settle`)
  .set('Authorization', bearer({_id:actor},'admin')).send({ verified: true, transactionRef: reference, reason: 'Synthetic verified bank receipt' });

test('unverified beneficiary and same-operator reconciliation cannot mark a payout paid', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id); await releaseOrderFinance(order._id,admin._id);
  const created = await fundedSellerRequest('review-required'); const payoutId = created.body.data._id;
  expect(created.body.data.bankDetails).toBeUndefined(); expect(created.body.data.transferMode).toBe('manual_external');
  expect((await settleSeller(payoutId, 'BANK-SECURITY')).status).toBe(409);
  expect((await beneficiaryReview(payoutId,admin._id)).status).toBe(409);
  await seedBeneficiaryProcess('FIXTURE-PROCESS');
  expect((await beneficiaryReview(payoutId,admin._id)).status).toBe(200);
  expect((await settleSeller(payoutId, 'BANK-SECURITY')).status).toBe(409);
  const independent = await financeReviewer(); expect((await settleSeller(payoutId,'BANK-SECURITY',independent)).status).toBe(200);
  expect(await sellerBalances(seller._id)).toMatchObject({ reserved: 0, settled: 30 });
});

test('bank reference is unique across payouts after whitespace and case normalization', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id); await releaseOrderFinance(order._id,admin._id);
  const first = (await fundedSellerRequest('first-transfer')).body.data._id;
  const second = (await fundedSellerRequest('second-transfer')).body.data._id;
  const reviewer = await financeReviewer(); await beneficiaryReview(first,reviewer); await beneficiaryReview(second,reviewer);
  expect((await settleSeller(first,'Bank-Unique')).status).toBe(200);
  expect((await settleSeller(second,'  bank-unique  ')).status).toBe(409);
  expect((await SellerPayout.findById(second)).status).toBe('PENDING');
  expect(await sellerBalances(seller._id)).toMatchObject({ eligible: 30, reserved: 30, settled: 30 });
  const response = await request(app).get('/api/admin/vendor-payouts').set('Authorization',bearer(admin,'admin'));
  expect(JSON.stringify(response.body)).not.toContain('fixture@test');
  expect(response.body.data[0].bankDetails).toBeUndefined();
});

test('Admin allocation needs a reviewed current revision and records evidence atomically', async () => {
  enable(); await verifyCash(); const current = await queryOrder();
  const route = `/api/admin/finance/orders/${order._id}/allocate`;
  expect((await request(app).post(route).set('Authorization',bearer(admin,'admin')).send({})).status).toBe(400);
  const proof = { expectedRevision: current.financialRevision, reference: 'ALLOCATE-TEST', reason: 'Reviewed synthetic allocation evidence' };
  expect((await request(app).post(route).set('Authorization',bearer(admin,'admin')).send(proof)).status).toBe(200);
  expect((await request(app).post(route).set('Authorization',bearer(admin,'admin')).send(proof)).status).toBe(409);
  const updated = await queryOrder(); expect(updated.financialOperationLog).toHaveLength(1);
  expect(updated.financialOperationLog[0].reference).toBe('ALLOCATE-TEST');
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 90 });
});

test('reviewed historical batch posts exact approved held amounts once; stale evidence and unknown payable fail', async () => {
  enable(); const legacy = { ...order.toObject(), _id: id(), orderNo: 'SYNTHETIC-HISTORICAL-ONLY' }; delete legacy.financialSnapshot;
  await Order.collection.insertOne(legacy);
  const report = await historicalExceptions({ orderIds: [legacy._id] }); const row = report.rows[0];
  const reviewer = await financeReviewer(); const batchId = 'ISOLATED-APPROVED-BATCH';
  const proposal = { ...row, policyVersion: 'SYNTHETIC-ORIGINAL-CONTRACT', originalAgreementReference: 'FIXTURE-CONTRACT', fundingEvidenceReference: 'FIXTURE-CASH-RECEIPT', codCustodyApprovalReference: 'FIXTURE-INDEPENDENT-CUSTODY', entitlementApprovalReference: 'FIXTURE-EXACT-AMOUNT',
    proposedPayablePaise: 9000, grossPaise: 10000, eligiblePaise: 10000, commissionPaise: 1000, taxPaise: 0 };
  const { createHash } = await import('node:crypto');
  const batch = { _id: batchId, manifestVersion: 1, status: 'approved', operatorId: admin._id, reviewerId: reviewer, approvalReference: 'FIXTURE-APPROVAL', rows: [proposal] };
  batch.manifestHash = createHash('sha256').update(JSON.stringify(batch.rows)).digest('hex');
  const unresolved = { ...batch, _id:'UNRESOLVED-BATCH', rows:[{...proposal,proposedPayablePaise:null}] };
  unresolved.manifestHash=createHash('sha256').update(JSON.stringify(unresolved.rows)).digest('hex');
  await mongoose.connection.collection('finance_historical_reviewed_batches').insertOne(unresolved);
  await expect(applyReviewedHistoricalBatch({batchId:'UNRESOLVED-BATCH',actorId:admin._id,approvalReference:'FIXTURE-APPROVAL'})).rejects.toThrow(/unresolved/);
  expect(await Ledger.countDocuments()).toBe(0);
  await mongoose.connection.collection('finance_historical_reviewed_batches').insertOne(batch);
  const apply = () => applyReviewedHistoricalBatch({ batchId, actorId:admin._id, approvalReference:'FIXTURE-APPROVAL' });
  await Promise.all([apply(),apply()]);
  expect(await sellerBalances(seller._id)).toMatchObject({held:90,eligible:0});
  expect(await Ledger.countDocuments({'metadata.source':'historical-reviewed-v1'})).toBe(3);
  expect((await Order.findById(legacy._id)).financialSnapshot).toBeUndefined();
  await expect(postOrderFinance(legacy._id,admin._id)).rejects.toThrow(/historical backfill/);
  const second = { ...batch, _id:'SECOND-BATCH', status:'approved' }; await mongoose.connection.collection('finance_historical_reviewed_batches').insertOne(second);
  await expect(applyReviewedHistoricalBatch({batchId:'SECOND-BATCH',actorId:admin._id,approvalReference:'FIXTURE-APPROVAL'})).rejects.toThrow(/stale or conflicts/);
});

test('refund, release and payout race cannot withdraw the refunded entitlement', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id,admin._id); await releaseOrderFinance(order._id,admin._id);
  const retId = await recordedOnlineReturn();
  const results = await Promise.allSettled([reverseRefundedReturn(retId,admin._id), releaseOrderFinance(order._id,admin._id), fundedSellerRequest('racing-refund',80)]);
  expect(results[0].status).toBe('fulfilled');
  expect(results[2].value.status).toBe(409);
  expect(await sellerBalances(seller._id)).toMatchObject({held:0,eligible:45,reserved:0});
});

test('concurrent same-reference transfers can settle only one request', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id); await releaseOrderFinance(order._id,admin._id);
  const first = (await fundedSellerRequest('receipt-race-a')).body.data._id, second = (await fundedSellerRequest('receipt-race-b')).body.data._id;
  const reviewer = await financeReviewer(); await beneficiaryReview(first,reviewer); await beneficiaryReview(second,reviewer);
  const results = await Promise.all([settleSeller(first,'BANK-RACE'),settleSeller(second,'bank-race')]);
  expect(results.map(row=>row.status).sort()).toEqual([200,409]);
  expect(await sellerBalances(seller._id)).toMatchObject({eligible:30,reserved:30,settled:30});
});

test('beneficiary process revision blocks stale evidence and retains earlier reviews on renewal', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id,admin._id); await releaseOrderFinance(order._id,admin._id);
  const payoutId=(await fundedSellerRequest('process-revision')).body.data._id, reviewer=await financeReviewer();
  expect((await beneficiaryReview(payoutId,reviewer)).status).toBe(200);
  await mongoose.connection.collection('finance_approved_processes').updateOne({_id:'FIXTURE-PROCESS'},{$set:{version:'fixture-v2'}});
  expect((await settleSeller(payoutId,'BANK-RENEW')).status).toBe(409);
  expect((await beneficiaryReview(payoutId,reviewer)).status).toBe(409);
  const renewed=await request(app).patch(`/api/admin/vendor-payouts/${payoutId}/beneficiary-review`).set('Authorization',bearer({_id:reviewer},'admin'))
    .send({fingerprint:destinationFingerprint(seller.bankDetails),evidenceReference:'NEW-OWNERSHIP-EVIDENCE',approvalReference:'FIXTURE-PROCESS',reason:'Synthetic renewed ownership review'});
  expect(renewed.status).toBe(200); expect(renewed.body.data.beneficiaryVerificationHistory).toHaveLength(1);
  expect((await settleSeller(payoutId,'BANK-RENEW')).status).toBe(200);
});

// ---- Approved end-to-end policy: platform-funded discounts, TCS/TDS, COD
// shortage write-off, admin payout policy and automation.
const policyInput = (changes = {}) => ({ tcsRatePercent: 0, tdsRatePercent: 0, sellerMinPayout: 0, riderMinPayout: 100, payoutSchedule: 'on_request', payoutWeekday: 1,
  requireIndependentPayoutReviewer: true, bankVerificationMethod: '', note: 'Synthetic approved finance policy', ...changes });
const setPolicy = async changes => saveFinancePolicy({ ...policyInput(changes), revision: (await getFinancePolicy()).revision }, admin._id);
const discountedCodOrder = async () => {
  await Payment.updateOne({ _id: payment._id }, { $set: { amount: 90 } });
  await Order.collection.deleteOne({ _id: order._id });
  order = await Order.create({ userId: user._id, type: 'grocery', items: [{ productId: product._id, sellerId: seller._id, type: 'grocery', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }],
    paymentMethod: 'cod', paymentId: payment._id, status: 'delivered', deliveryId: delivery._id, deliveryPartnerId: partner._id,
    pricing: { discountRepresentation: 'components-v1', subtotal: 100, couponDiscount: 10, totalAmount: 90 } });
  delete process.env.FINANCE_SNAPSHOTS_ENABLED;
  await Payment.updateOne({ _id: payment._id }, { $set: { orderId: order._id } });
  await Delivery.collection.updateOne({ _id: delivery._id }, { $set: { orderId: order._id } });
};

test('platform-funded coupon: seller is paid on full price with TCS/TDS withheld, and refunds return the same net', async () => {
  enable(); await setPolicy({ tcsRatePercent: 0.5, tdsRatePercent: 0.1 }); await discountedCodOrder();
  expect(order.financialSnapshot.lines[0]).toMatchObject({ grossPaise: 10000, eligiblePaise: 9000, commissionPaise: 900, tcsPaise: 50, tdsPaise: 10, platformDiscountPaise: 1000, netPaise: 9040 });
  await cod('collect', 90); await cod('remit', 90); await cod('verify', 90);
  await postOrderFinance(order._id, admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 90.4, earnedEarnings: 90.4 });
  const summary = await request(app).get('/api/sellers/finances/summary').set('Authorization', bearer(user, 'user', 'seller')).expect(200);
  expect(summary.body.data.deliveredSales.orders.find(row => row._id === String(order._id)).sellerAmounts)
    .toMatchObject({ subtotal: 100, couponDiscount: 10, commission: 9, tcs: .5, tds: .1, netEarnings: 90.4 });
  for (const [account, amount] of [['platform_discount_expense', 10], ['tcs_liability', .5], ['tds_liability', .1], ['commission_revenue', 9]]) expect((await Ledger.findOne({ account })).amount).toBe(amount);
  const retId = id(); await Return.collection.insertOne({ _id: retId, orderId: order._id, orderItemId: order.items[0]._id, quantity: 1, status: 'REFUNDED', refundReference: 'MANUAL-COD', codSettledBy: admin._id, codSettledAt: new Date(), codSettlementNote: 'Synthetic manual cash receipt', refundAmount: 45, returnNumber: 'RET-PLATFORM' });
  await reverseRefundedReturn(retId, admin._id);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 45.2 });
  expect((await financialReconciliation()).exceptions.filter(row => row.code === 'merchandise_posting_mismatch')).toHaveLength(0);
});

test('a verified COD shortage is absorbed by the platform and unblocks settlement exactly once', async () => {
  enable(); await cod('collect'); await cod('remit', 90); await cod('verify', 90);
  const writeoff = () => recordCodEvent({ orderId: order._id, actorId: admin._id, action: 'writeoff', input: { reference: 'WRITEOFF-TEST', reason: 'Approved platform shortage absorption' } });
  await expect(postOrderFinance(order._id, admin._id)).rejects.toThrow(/not verified/);
  await Promise.all([writeoff(), writeoff()]);
  const cash = (await queryOrder()).codFinance;
  expect(cash).toMatchObject({ status: 'verified', writtenOffPaise: 1000, writtenOffCustodyPaise: 1000 });
  expect((await Payment.findById(payment._id)).status).toBe('paid');
  const custody = await Ledger.find({ account: 'cod_custody' }); expect(custody.reduce((sum, row) => sum + (row.direction === 'credit' ? row.amount : -row.amount), 0)).toBe(0);
  expect((await Ledger.findOne({ account: 'cod_shortage_expense' })).amount).toBe(10);
  await expect(recordCodEvent({ orderId: order._id, actorId: admin._id, action: 'writeoff', input: { reference: 'SECOND-WRITEOFF', reason: 'Second write-off attempt' } })).rejects.toThrow(/Only a verified cash shortage/);
  await postOrderFinance(order._id, admin._id); expect(await sellerBalances(seller._id)).toMatchObject({ held: 90 });
  expect((await financialReconciliation()).exceptions.filter(row => row.code === 'cod_custody_mismatch')).toHaveLength(0);
});

test('a short doorstep collection is recorded honestly and settled by write-off', async () => {
  enable(); await cod('collect', 95); await cod('remit', 95); await cod('verify', 95);
  expect((await queryOrder()).codFinance).toMatchObject({ status: 'discrepancy', shortagePaise: 500 });
  await recordCodEvent({ orderId: order._id, actorId: admin._id, action: 'writeoff', input: { reference: 'SHORT-COLLECTION', reason: 'Customer paid short at the door' } });
  expect((await queryOrder()).codFinance).toMatchObject({ status: 'verified', writtenOffPaise: 500, writtenOffCustodyPaise: 0 });
  expect((await financialReconciliation()).exceptions.filter(row => row.code === 'cod_custody_mismatch')).toHaveLength(0);
});

test('rider cannot be paid while holding unverified COD cash', async () => {
  enable(); await fundedRider(); await cod('collect');
  await expect(requestVerifiedRiderPayout({ partnerId: partner._id, userId: rider._id, amount: 300, key: 'cash-in-hand' })).rejects.toThrow(/Hand over/);
  await cod('remit'); await cod('verify');
  expect((await requestVerifiedRiderPayout({ partnerId: partner._id, userId: rider._id, amount: 300, key: 'cash-in-hand' })).payout.amount).toBe(300);
});

test('admin payout policy enforces minimums and turns manual requests off on a weekly schedule', async () => {
  enable(); await verifyCash(); await postOrderFinance(order._id, admin._id); await releaseOrderFinance(order._id, admin._id); await fundedRider();
  await setPolicy({ sellerMinPayout: 50, riderMinPayout: 350 });
  expect((await fundedSellerRequest('below-minimum', 30)).status).toBe(400);
  await expect(requestVerifiedRiderPayout({ partnerId: partner._id, userId: rider._id, amount: 300, key: 'below-minimum' })).rejects.toThrow(/Minimum payout amount is ₹350/);
  await setPolicy({ payoutSchedule: 'weekly' });
  expect((await fundedSellerRequest('weekly-manual', 60)).status).toBe(409);
  await expect(requestVerifiedRiderPayout({ partnerId: partner._id, userId: rider._id, amount: 300, key: 'weekly-manual' })).rejects.toThrow(/automatically every week/);
  const summary = await request(app).get('/api/sellers/finances/summary').set('Authorization', bearer(user, 'user', 'seller'));
  expect(summary.body.data.payoutPolicy).toMatchObject({ schedule: 'weekly', minimum: 0 }); expect(summary.body.data.payoutActionsEnabled).toBe(false);
});

test('automation posts, releases seller and rider earnings, reverses refunds and creates weekly payouts', async () => {
  enable();
  const settlement = { total: 40, tip: 0, base: 20, perKm: 10, distanceKm: 2 };
  await financialTransaction(session => recordDeliveryEarning({ order, delivery, settlement, session }));
  await Partner.updateOne({ _id: partner._id }, { $set: { 'earnings.held': 40, 'earnings.total': 40 } });
  expect(await runFinanceAutomationOnce()).toEqual({});
  expect((await queryOrder()).financialPosting).toBeUndefined();
  await verifyCash();
  expect(await runFinanceAutomationOnce()).toMatchObject({ post: 1, release: 1, rider_release: 1 });
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 90 });
  expect((await Partner.findById(partner._id)).earnings).toMatchObject({ held: 0, pending: 40 });
  expect((await Delivery.findById(delivery._id)).financialEarningStatus).toBe('eligible');
  expect(await runFinanceAutomationOnce()).toEqual({});
  const now = Date.now(); const weekday = new Date(now + 5.5 * 3600 * 1000).getUTCDay();
  await setPolicy({ payoutSchedule: 'weekly', payoutWeekday: weekday, riderMinPayout: 10 });
  await runFinanceAutomationOnce({ now }); await runFinanceAutomationOnce({ now });
  expect((await SellerPayout.find({})).map(row => row.amount)).toEqual([90]);
  expect((await DeliveryPayout.find({})).map(row => row.amount)).toEqual([40]);
});

test('automation records why an order still needs an admin and retries later', async () => {
  enable(); await prepaidFixture('online'); await Payment.updateOne({ _id: payment._id }, { $set: { captures: [] } });
  const now = Date.now();
  await runFinanceAutomationOnce({ now });
  expect((await queryOrder()).financeAutomation).toMatchObject({ step: 'post', lastError: expect.stringMatching(/captured/) });
  const listed = await request(app).get('/api/admin/finance/orders').set('Authorization', bearer(admin, 'admin'));
  expect(listed.body.data[0].exceptions).toContain('needs_admin_review');
  expect(await runFinanceAutomationOnce({ now: now + 60 * 1000 })).toEqual({});
  await prepaidFixture('online');
  expect(await runFinanceAutomationOnce({ now: now + 16 * 60 * 1000 })).toMatchObject({ post: 1 });
  expect((await queryOrder()).financeAutomation).toBeUndefined();
});

test('finance policy API validates, versions and registers the bank verification process', async () => {
  const put = body => request(app).put('/api/admin/finance/policy').set('Authorization', bearer(admin, 'admin')).send(body);
  expect((await put({ ...policyInput(), note: '' })).status).toBe(400);
  expect((await put({ ...policyInput(), tcsRatePercent: 9 })).status).toBe(400);
  const saved = await put({ ...policyInput({ bankVerificationMethod: 'Penny-drop test plus cancelled cheque' }), revision: 0 });
  expect(saved.status).toBe(200); expect(saved.body.data.policy).toMatchObject({ revision: 1, configured: true });
  expect((await put({ ...policyInput(), revision: 0 })).status).toBe(409);
  const read = await request(app).get('/api/admin/finance/policy').set('Authorization', bearer(admin, 'admin'));
  expect(read.body.data.policy.bankVerificationMethod).toBe('Penny-drop test plus cancelled cheque');
  enable(); await verifyCash(); await postOrderFinance(order._id, admin._id); await releaseOrderFinance(order._id, admin._id);
  const payoutId = (await fundedSellerRequest('default-process')).body.data._id;
  const review = await request(app).patch(`/api/admin/vendor-payouts/${payoutId}/beneficiary-review`).set('Authorization', bearer(admin, 'admin'))
    .send({ fingerprint: destinationFingerprint(seller.bankDetails), evidenceReference: 'PENNY-DROP-OK', reason: 'Penny-drop name matched' });
  expect(review.status).toBe(200);
  expect((await settleSeller(payoutId, 'BANK-SAME-ADMIN')).status).toBe(409);
  await setPolicy({ bankVerificationMethod: 'Penny-drop test plus cancelled cheque', requireIndependentPayoutReviewer: false });
  expect((await settleSeller(payoutId, 'BANK-SAME-ADMIN')).status).toBe(200);
});

test('overview reports work to do and money totals from the ledger', async () => {
  enable(); await cod('collect'); await cod('remit');
  let overview = await request(app).get('/api/admin/finance/overview').set('Authorization', bearer(admin, 'admin'));
  expect(overview.status).toBe(200); expect(overview.body.data.todo).toMatchObject({ cashToVerify: 1, waitingPayment: 1 });
  expect(overview.body.data.totalsPaise.codCashWithRiders).toBe(10000);
  await cod('verify'); await postOrderFinance(order._id, admin._id);
  overview = await request(app).get('/api/admin/finance/overview').set('Authorization', bearer(admin, 'admin'));
  expect(overview.body.data.totalsPaise).toMatchObject({ sellersOnHold: 9000, commission: 1000, codCashWithRiders: 0 });
  expect(overview.body.data.commissionRulesConfigured).toBe(true);
});

// ---- Follow-up fixes: ledger-only rider balances, COD at OTP, TCS base,
// tax reports, accounting journal, ageless refund reconciliation, old-order batches.
test('TCS is withheld on the value excluding the product GST; TDS on the full price', async () => {
  await setPolicy({ tcsRatePercent: 0.5, tdsRatePercent: 0.1 });
  await Product.collection.updateOne({ _id: product._id }, { $set: { gstRate: 18 } });
  const line = (await buildOrderFinancialSnapshot(order)).lines[0];
  // ₹100 incl. 18% GST → taxable ₹84.75; TCS 0.5% = ₹0.42; TDS 0.1% of ₹100 = ₹0.10.
  expect(line).toMatchObject({ gstRatePercent: 18, taxableValuePaise: 8475, tcsPaise: 42, tdsPaise: 10, netPaise: 10000 - 1000 - 42 - 10 });
});

test('rider payouts and balances come only from the ledger', async () => {
  enable(); await fundedRider();
  await Partner.updateOne({ _id: partner._id }, { $set: { financialWorkflowVersion: 2, 'earnings.pending': 50 } });
  const { riderFinancialSummary } = await import('../services/deliveryPayout.service.js');
  const summary = await riderFinancialSummary(await Partner.findById(partner._id));
  expect(summary).toMatchObject({ verifiedPayable: 400, balances: { onHold: 0, available: 400, requested: 0, paid: 0 }, legacyUnverified: 0, balanceMismatch: true });
  const { payout } = await requestVerifiedRiderPayout({ partnerId: partner._id, userId: rider._id, amount: 300, key: 'ledger-only' });
  await resolveVerifiedRiderPayout({ payoutId: payout._id, actorId: admin._id, complete: true, input: { verified: true, transactionRef: 'BANK-LEDGER', reason: 'Verified bank statement' } });
  expect((await riderFinancialSummary(await Partner.findById(partner._id))).balances).toMatchObject({ available: 100, requested: 0, paid: 300 });
});

test('rider records COD cash in the OTP delivery step', async () => {
  enable();
  await Order.updateOne({ _id: order._id }, { $set: { status: 'out_for_delivery' } });
  await Delivery.collection.updateOne({ _id: delivery._id }, { $set: { status: 'in_transit', otp: '1234', otpVerified: false } });
  const response = await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set('Authorization', bearer(rider)).send({ otp: '1234', codCollected: 95 });
  expect(response.status).toBe(200); expect(response.body.data.codCollection).toEqual({ recorded: true });
  expect((await queryOrder()).codFinance).toMatchObject({ status: 'collected', collectedPaise: 9500, collectedAt: expect.any(Date) });
  await Order.updateOne({ _id: order._id }, { $set: { 'codFinance.collectedAt': new Date(Date.now() - 25 * 3600 * 1000) } });
  const overview = await request(app).get('/api/admin/finance/overview').set('Authorization', bearer(admin, 'admin'));
  expect(overview.body.data.todo).toMatchObject({ cashWithRiders: 1, cashOverdue: 1 });
});

test('a failed cash record never undoes the delivery', async () => {
  await Order.updateOne({ _id: order._id }, { $set: { status: 'out_for_delivery' } });
  await Delivery.collection.updateOne({ _id: delivery._id }, { $set: { status: 'in_transit', otp: '4321', otpVerified: false } });
  const response = await request(app).post(`/api/delivery/orders/${order._id}/verify-otp`).set('Authorization', bearer(rider)).send({ otp: '4321', codCollected: 999999 });
  expect(response.status).toBe(200); expect(response.body.data.codCollection.recorded).toBe(false);
  expect((await queryOrder()).status).toBe('delivered');
});

test('monthly tax report and seller statement show TCS/TDS with GSTIN/PAN gaps', async () => {
  enable(); await setPolicy({ tcsRatePercent: 0.5, tdsRatePercent: 0.1 }); await discountedCodOrder();
  await cod('collect', 90); await cod('remit', 90); await cod('verify', 90); await postOrderFinance(order._id, admin._id);
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000), month = istNow.toISOString().slice(0, 7);
  const report = await request(app).get(`/api/admin/finance/tax-report?month=${month}`).set('Authorization', bearer(admin, 'admin'));
  expect(report.status).toBe(200);
  expect(report.body.data.rows[0]).toMatchObject({ grossPaise: 10000, taxablePaise: 10000, tcsPaise: 50, tdsPaise: 10, missing: ['GSTIN', 'PAN'] });
  const csv = await request(app).get(`/api/admin/finance/tax-report?month=${month}&format=csv`).set('Authorization', bearer(admin, 'admin'));
  expect(csv.headers['content-type']).toMatch(/text\/csv/); expect(csv.text).toContain('"0.50"');
  expect((await request(app).get('/api/admin/finance/tax-report?month=2026-13').set('Authorization', bearer(admin, 'admin'))).status).toBe(400);
  const statement = await request(app).get('/api/sellers/finances/tax-statement').set('Authorization', bearer(user, 'user', 'seller'));
  expect(statement.status).toBe(200); expect(statement.body.data.months[0]).toMatchObject({ month, tcsPaise: 50, tdsPaise: 10 });
  expect(statement.body.data.months).toHaveLength(12);
});

test('accounting journal is balanced and clears COD customer money to zero', async () => {
  enable(); await cod('collect'); await cod('remit'); await cod('verify'); await postOrderFinance(order._id, admin._id);
  const settlement = { total: 40, tip: 0, base: 20, perKm: 10, distanceKm: 2 };
  await financialTransaction(session => recordDeliveryEarning({ order, delivery, settlement, session }));
  const day = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const tb = await request(app).get(`/api/admin/finance/trial-balance?from=${day}&to=${day}`).set('Authorization', bearer(admin, 'admin'));
  expect(tb.status).toBe(200); expect(tb.body.data.balanced).toBe(true);
  const balance = name => tb.body.data.rows.find(row => row.account === name)?.balancePaise ?? 0;
  expect(balance('Customer payments clearing')).toBe(0); expect(balance('Bank')).toBe(10000);
  expect(balance('Seller payable')).toBe(-9000); expect(balance('Commission income')).toBe(-1000);
  expect(balance('COD cash with riders')).toBe(0); expect(balance('Delivery cost')).toBe(4000); expect(balance('Rider payable')).toBe(-4000);
  const csv = await request(app).get(`/api/admin/finance/journal?from=${day}&to=${day}&format=csv`).set('Authorization', bearer(admin, 'admin'));
  expect(csv.text.split('\r\n')[0]).toContain('Debit account');
  expect((await request(app).get('/api/admin/finance/journal?from=2026-01-02&to=2026-01-01').set('Authorization', bearer(admin, 'admin'))).status).toBe(400);
});

test('automation reconciles old refunds with no age limit and skips orders without a snapshot once', async () => {
  enable(); await prepaidFixture('online'); await postOrderFinance(order._id, admin._id);
  const retId = await recordedOnlineReturn();
  await Return.collection.updateOne({ _id: retId }, { $set: { updatedAt: new Date('2020-01-01') } });
  const legacy = { ...order.toObject(), _id: id(), orderNo: 'LEGACY-REFUND', paymentId: id() }; delete legacy.financialSnapshot; await Order.collection.insertOne(legacy);
  const legacyReturn = id(); await Return.collection.insertOne({ _id: legacyReturn, orderId: legacy._id, orderItemId: legacy.items[0]._id, quantity: 1, status: 'REFUNDED', refundReference: 'OLD', refundAmount: 50, returnNumber: 'RET-OLD' });
  expect(await runFinanceAutomationOnce()).toMatchObject({ refund: 1 });
  expect((await Return.findById(retId)).financeReconciledAt).toBeInstanceOf(Date);
  expect((await Return.findById(legacyReturn)).financeSkipReason).toBe('no_finance_snapshot');
  expect(await sellerBalances(seller._id)).toMatchObject({ eligible: 45, held: 0 });
});

test('old-order batch needs a second admin, then applies and releases exactly once', async () => {
  enable(); const legacy = { ...order.toObject(), _id: id(), orderNo: 'OLD-ORDER-BATCH' }; delete legacy.financialSnapshot;
  await Order.collection.insertOne(legacy);
  const post = (path, body, who = admin) => request(app).post(`/api/admin/finance/historical-batches${path}`).set('Authorization', bearer(who, 'admin')).send(body);
  const row = { orderId: String(legacy._id), itemId: String(legacy.items[0]._id), commission: 10, commissionGst: 0, agreementReference: 'Signed agreement 2025', fundingEvidenceReference: 'Cash book page 12',
    entitlementApprovalReference: 'Finance head email 1 Oct', codCustodyApprovalReference: 'Hub receipt 0042' };
  expect((await post('', { rows: [{ ...row, commission: 200 }], note: 'October old orders' })).status).toBe(400);
  const created = await post('', { rows: [row], note: 'October old orders' }); expect(created.status).toBe(200);
  const batchId = created.body.data._id; expect(created.body.data.rows[0]).toMatchObject({ grossPaise: 10000, proposedPayablePaise: 9000 });
  expect((await post('', { rows: [row], note: 'Duplicate attempt' })).status).toBe(409);
  expect((await post(`/${batchId}/review`, { approve: true, note: 'Checked evidence' })).status).toBe(409);
  const reviewer = id(); await Admin.collection.insertOne({ _id: reviewer, name: 'Reviewer', email: 'old-batch@example.test', role: 'admin', permissions: ['manage_finance'], isActive: true });
  expect((await post(`/${batchId}/release`, {})).status).toBe(409);
  expect((await post(`/${batchId}/review`, { approve: true, note: 'Checked evidence' }, { _id: reviewer })).status).toBe(200);
  expect((await post(`/${batchId}/apply`, {})).status).toBe(200);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 90, eligible: 0 });
  await Promise.all([post(`/${batchId}/release`, {}), post(`/${batchId}/release`, {})]);
  expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 90 });
  const list = await request(app).get('/api/admin/finance/historical-batches').set('Authorization', bearer(admin, 'admin'));
  expect(list.body.data.batches[0].status).toBe('released');
});

test('an order whose breakdown cannot be frozen is still placed and flagged for review', async () => {
  const placed = await Order.create({ userId: user._id, type: 'grocery', items: [{ productId: product._id, sellerId: seller._id, type: 'grocery', name: 'Odd price', qty: 1, price: 33.333 }],
    paymentMethod: 'cod', paymentId: payment._id, status: 'placed', pricing: { subtotal: 33.333, totalAmount: 33.333 } });
  expect(placed.financialSnapshot).toBeUndefined();
  expect(placed.financialSnapshotError.message).toMatch(/two decimal places/);
  const overview = await request(app).get('/api/admin/finance/overview').set('Authorization', bearer(admin, 'admin'));
  expect(overview.body.data.todo.snapshotFailed).toBe(1);
});
