import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Commission from '../models/Commission.js';
import CommissionCurrent from '../models/CommissionCurrent.js';
import CourierCharge from '../models/CourierCharge.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Return from '../models/Return.js';
import SellerPayout from '../models/SellerPayout.js';
import WalletLedger from '../models/WalletLedger.js';
import DigitalEntitlement from '../models/DigitalEntitlement.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { saveCommissionVersion, buildOrderFinancialSnapshot, bootstrapCurrentCommissionRules } from '../services/vendorCommission.service.js';
import { postOrderFinance, releaseOrderFinance, reverseRefundedReturn, deliverySplit } from '../services/orderFinance.service.js';
import { sellerBalances, postLedgerEntry } from '../services/sellerLedger.service.js';
import { createSellerPayoutRequest } from '../services/sellerPayout.service.js';
import { courierObligationAccount } from '../services/quickCommerceFinance.service.js';
import { recordActualCourierCost, disputeCourierCost, listCourierCosts, courierCostSummary } from '../services/courierCost.service.js';
import { activateDigitalEntitlements } from '../services/digitalEntitlement.service.js';
import { financialReconciliation } from '../services/financialReconciliation.service.js';
import { trialBalance } from '../services/financeReports.service.js';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

const app = express(); app.use(express.json());
app.use('/api/admin', adminRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const bearer = who => `Bearer ${jwt.sign({ id: String(who._id), type: 'admin' }, JWT_SECRET)}`;
const rule = (changes = {}) => ({ vendorType: 'general', channel: 'quick', method: 'percentage', value: 10, minimum: null, maximum: null,
  base: 'eligible_item_subtotal', fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, isActive: true, reason: 'Synthetic fixture policy only', ...changes });
const current = async (channel = 'quick', vendorType = 'general') => CommissionCurrent.findById(`${channel}:${vendorType}:*:*`);
const today = () => new Date().toISOString().slice(0, 10);
let db, user, admin, seller, product, ecomProduct;

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Ledger.init(), Payment.init(), SellerPayout.init(), Order.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  user = await User.create({ name: 'Customer', phone: '9876611001', roles: ['buyer', 'seller'], isActive: true });
  const adminId = id(); await Admin.collection.insertOne({ _id: adminId, name: 'Fixture admin', email: 'gaps@example.test', password: 'not-a-password', role: 'admin', permissions: ['manage_finance'], isActive: true });
  admin = await Admin.findById(adminId);
  const sellerId = id(); await Seller.collection.insertOne({ _id: sellerId, userId: user._id, businessName: 'Fixture store', status: 'approved', bankDetails: { upiId: 'fixture@test' } });
  seller = await Seller.findById(sellerId);
  const categoryId = id(); await Category.collection.insertOne({ _id: categoryId, name: 'Fixture category', type: 'grocery' });
  const productId = id(), ecomId = id();
  await Product.collection.insertMany([{ _id: productId, category: categoryId, type: 'grocery' }, { _id: ecomId, category: categoryId, type: 'ecommerce' }]);
  product = await Product.findById(productId); ecomProduct = await Product.findById(ecomId);
});

const quickOrder = async (changes = {}) => {
  const payment = await Payment.create({ userId: user._id, amount: 100, method: 'online', status: 'pending' });
  const order = await Order.create({ userId: user._id, type: 'grocery', paymentMethod: 'online', paymentId: payment._id, status: 'placed',
    items: [{ productId: product._id, sellerId: seller._id, type: 'grocery', name: 'Fixture', qty: 2, price: 50 }], pricing: { subtotal: 100, totalAmount: 100 }, ...changes });
  payment.orderId = order._id; await payment.save();
  return order;
};

// ---- commission: one current rule per scope ---------------------------------

describe('commission current rule', () => {
  test('admin updates the current rule; new orders use it and placed orders keep their snapshot', async () => {
    const created = await request(app).post('/api/admin/finance/commissions').set('Authorization', bearer(admin)).send(rule({ value: 10 }));
    expect(created.status).toBe(200);
    const placed = await quickOrder();
    expect(placed.financialSnapshot.lines[0].commissionPaise).toBe(1000);

    const updated = await request(app).post('/api/admin/finance/commissions').set('Authorization', bearer(admin))
      .send(rule({ value: 15, reason: 'Rate review for quick commerce', supersedes: String(created.body.data._id) }));
    expect(updated.status).toBe(200);
    expect((await quickOrder()).financialSnapshot.lines[0].commissionPaise).toBe(1500);
    expect((await Order.findById(placed._id)).financialSnapshot.lines[0]).toMatchObject({ commissionPaise: 1000, rule: { value: 10 } });

    const listed = await request(app).get('/api/admin/finance/commissions').set('Authorization', bearer(admin));
    expect(listed.body.data.current).toHaveLength(1);
    expect(listed.body.data.current[0]).toMatchObject({ value: 15, reason: 'Rate review for quick commerce' });
    expect(listed.body.data.rules).toHaveLength(2); // full history kept for audit
    expect(listed.body.data.coverage.find(row => row.channel === 'quick' && row.vendorType === 'general')).toMatchObject({ active: true });
    expect(listed.body.data.coverage.find(row => row.channel === 'ecommerce' && row.vendorType === 'general')).toMatchObject({ active: false, ruleId: null });
  });

  test('a saved rule applies immediately; no requested date can schedule or bury it', async () => {
    await saveCommissionVersion(rule({ value: 10 }), admin._id);
    const first = await current();
    // Old date-based selection would have kept 10% for a backdated version and ignored a future one.
    await saveCommissionVersion(rule({ value: 12, effectiveDate: '2000-01-01', supersedes: String(first.ruleId) }), admin._id);
    expect((await quickOrder()).financialSnapshot.lines[0].commissionPaise).toBe(1200);
    await saveCommissionVersion(rule({ value: 14, effectiveDate: '2100-01-01', supersedes: String((await current()).ruleId) }), admin._id);
    expect((await quickOrder()).financialSnapshot.lines[0].commissionPaise).toBe(1400);
    expect((await current()).revision).toBe(3);
  });

  test('each channel and vendor type resolves its own current rule', async () => {
    await saveCommissionVersion(rule({ channel: 'quick', value: 10 }), admin._id);
    await saveCommissionVersion(rule({ channel: 'ecommerce', value: 7 }), admin._id);
    await saveCommissionVersion(rule({ channel: 'wholesale', value: 4 }), admin._id);
    const order = await quickOrder();
    expect((await buildOrderFinancialSnapshot(order)).lines[0].commissionPaise).toBe(1000);
    expect((await buildOrderFinancialSnapshot({ ...order.toObject(), type: 'ecommerce' })).lines[0].commissionPaise).toBe(700);
    expect((await buildOrderFinancialSnapshot({ ...order.toObject(), salesChannel: 'wholesale' })).lines[0].commissionPaise).toBe(400);
    const shg = order.toObject(); shg.items[0].type = 'shg';
    expect((await buildOrderFinancialSnapshot(shg)).state).toBe('held_missing_rule');
  });

  test('switching the current rule off holds new orders; a switched-off override falls back to the channel rule', async () => {
    await saveCommissionVersion(rule({ value: 10 }), admin._id);
    await saveCommissionVersion(rule({ productId: String(product._id), value: 12 }), admin._id);
    const override = await CommissionCurrent.findById(`quick:general:*:${product._id}`);
    await saveCommissionVersion(rule({ productId: String(product._id), value: 12, isActive: false, supersedes: String(override.ruleId) }), admin._id);
    expect((await quickOrder()).financialSnapshot.lines[0].commissionPaise).toBe(1000);
    await saveCommissionVersion(rule({ value: 10, isActive: false, supersedes: String((await current()).ruleId) }), admin._id);
    expect((await quickOrder()).financialSnapshot.state).toBe('held_missing_rule');
  });

  test('missing, invalid and stale configuration never changes the current rule', async () => {
    expect((await quickOrder()).financialSnapshot.state).toBe('held_missing_rule');
    await saveCommissionVersion(rule({ value: 10 }), admin._id);
    const before = await current();
    for (const bad of [{ value: 101 }, { taxTreatment: 'exempt', taxRate: 18 }, { reason: '' }, { isActive: 'yes' }, { channel: 'legal' }]) {
      const response = await request(app).post('/api/admin/finance/commissions').set('Authorization', bearer(admin)).send(rule({ ...bad, supersedes: String(before.ruleId) }));
      expect(response.status).toBe(400);
    }
    await expect(saveCommissionVersion(rule({ value: 11 }), admin._id)).rejects.toThrow(/refresh/);
    const results = await Promise.allSettled([11, 12].map(value => saveCommissionVersion(rule({ value, supersedes: String(before.ruleId) }), admin._id)));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await current()).revision).toBe(2);
    await expect(Commission.updateOne({ _id: before.ruleId }, { value: 99 })).rejects.toThrow(/append-only/);
  });

  test('migration keeps the rate the old selection used today and never activates future versions', async () => {
    await Commission.collection.insertMany([
      { ...rule({ value: 8 }), financeVersion: 2, version: 'old', effectiveDate: new Date('2024-01-01'), createdAt: new Date('2024-01-01') },
      { ...rule({ value: 9 }), financeVersion: 2, version: 'live', effectiveDate: new Date('2025-01-01'), createdAt: new Date('2023-01-01') },
      { ...rule({ value: 30 }), financeVersion: 2, version: 'future', effectiveDate: new Date('2100-01-01'), createdAt: new Date() },
    ]);
    const dry = await bootstrapCurrentCommissionRules();
    expect(dry).toMatchObject({ applied: false, plan: [{ scopeKey: 'quick:general:*:*', value: 9, action: 'set_current' }], futureVersions: [{ scopeKey: 'quick:general:*:*' }] });
    expect(await CommissionCurrent.countDocuments()).toBe(0);
    await bootstrapCurrentCommissionRules({ apply: true });
    await bootstrapCurrentCommissionRules({ apply: true });
    expect(await CommissionCurrent.countDocuments()).toBe(1);
    expect((await quickOrder()).financialSnapshot.lines[0].commissionPaise).toBe(900);
  });
});

// ---- same-day seller incentive ----------------------------------------------

const sameDayOrder = async ({ sameDay = true, method = 'wallet' } = {}) => {
  await saveCommissionVersion(rule({ channel: 'ecommerce', value: 10 }), admin._id);
  const deliveryCharge = sameDay ? 80 : 40;
  const total = 100 + deliveryCharge;
  const payment = await Payment.create({ userId: user._id, amount: total, method, status: 'paid' });
  const order = await Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: method, paymentId: payment._id, status: 'delivered',
    items: [{ productId: ecomProduct._id, sellerId: seller._id, type: 'ecommerce', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }],
    delivery: sameDay ? { mode: 'same_day', standardFee: 40, fee: 30, sellerIncentive: 10 } : { mode: 'scheduled', standardFee: 40 },
    pricing: { subtotal: 100, deliveryCharge, totalAmount: total } });
  payment.orderId = order._id; await payment.save();
  await WalletLedger.collection.insertOne({ userId: user._id, direction: 'debit', referenceId: String(order._id), amount: total, status: 'completed', transactionId: `W-${order._id}` });
  return order;
};

describe('same-day seller incentive', () => {
  test('is frozen separately, credited to the seller once and released with the order', async () => {
    const order = await sameDayOrder();
    expect(order.financialSnapshot.components).toMatchObject({ deliveryPaise: 7000, sellerIncentivePaise: 1000 });
    await Promise.all([postOrderFinance(order._id, admin._id), postOrderFinance(order._id, admin._id)]);
    const incentive = await Ledger.find({ type: 'same_day_incentive' });
    expect(incentive).toHaveLength(1);
    expect(incentive[0]).toMatchObject({ account: 'seller_payable', bucket: 'held', direction: 'credit', amount: 10 });
    expect(String(incentive[0].sellerId)).toBe(String(seller._id));
    expect((await Ledger.findOne({ type: 'customer_delivery' })).amount).toBe(70);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 100, sameDayIncentives: 10 });
    await releaseOrderFinance(order._id, admin._id); await releaseOrderFinance(order._id, admin._id);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 100, sameDayIncentives: 10 });
    expect((await financialReconciliation()).exceptions.filter(row => /delivery|incentive/.test(row.code))).toHaveLength(0);
    expect((await trialBalance({ from: today(), to: today() })).balanced).toBe(true);
  });

  test('an order that is not Same-Day earns no incentive', async () => {
    const order = await sameDayOrder({ sameDay: false });
    expect(order.financialSnapshot.components).toMatchObject({ deliveryPaise: 4000, sellerIncentivePaise: 0 });
    await postOrderFinance(order._id, admin._id);
    expect(await Ledger.countDocuments({ type: 'same_day_incentive' })).toBe(0);
    expect((await Ledger.findOne({ type: 'customer_delivery' })).amount).toBe(40);
  });

  test('a cancelled order before delivery credits nothing', async () => {
    const order = await sameDayOrder();
    await Order.updateOne({ _id: order._id }, { $set: { status: 'cancelled' } });
    await expect(postOrderFinance(order._id, admin._id)).rejects.toThrow(/completed deliveries/);
    expect(await Ledger.countDocuments()).toBe(0);
  });

  test('a full item refund reverses merchandise but keeps the unrefunded incentive, released once', async () => {
    const order = await sameDayOrder();
    await postOrderFinance(order._id, admin._id);
    const retId = id();
    await Return.collection.insertOne({ _id: retId, customerId: user._id, sellerId: seller._id, orderId: order._id, orderItemId: order.items[0]._id, quantity: 2,
      status: 'REFUNDED', refundReference: 'WALLET-REFUND', refundAmount: 100, returnNumber: 'RET-SAMEDAY' });
    await Payment.updateOne({ _id: order.paymentId }, { $set: { status: 'refunded', 'refund.totalRefundedAmount': 100 } });
    await WalletLedger.collection.insertOne({ userId: user._id, direction: 'credit', referenceType: 'RETURN', referenceId: String(retId), amount: 100, status: 'completed', transactionId: 'W-REFUND' });
    await reverseRefundedReturn(retId, admin._id); await reverseRefundedReturn(retId, admin._id);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 10, reversals: 90, sameDayIncentives: 10 });
    expect(await Ledger.countDocuments({ idempotencyKey: /SAME_DAY_INCENTIVE/ })).toBe(1);
  });

  test('older snapshots without the split still credit the incentive from the frozen delivery record', () => {
    const legacy = { delivery: { mode: 'same_day', sellerIncentive: 10 }, pricing: { deliveryCharge: 80 } };
    expect(deliverySplit(legacy, { components: { deliveryPaise: 8000 } })).toEqual({ deliveryPaise: 7000, incentivePaise: 1000 });
    expect(deliverySplit({ delivery: { mode: 'scheduled' } }, { components: { deliveryPaise: 4000 } })).toEqual({ deliveryPaise: 4000, incentivePaise: 0 });
    expect(() => deliverySplit({ delivery: { mode: 'same_day', sellerIncentive: 90 } }, { components: { deliveryPaise: 8000 } })).toThrow(/exceeds/);
  });
});

// ---- held obligations ---------------------------------------------------------

const eligibleEarnings = async () => {
  await saveCommissionVersion(rule({ value: 10 }), admin._id);
  const order = await quickOrder({ status: 'delivered', items: [{ productId: product._id, sellerId: seller._id, type: 'grocery', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }] });
  await Payment.updateOne({ _id: order.paymentId }, { $set: { status: 'paid', captures: [{ gatewayOrderId: 'o', gatewayPaymentId: 'p', amountPaise: 10000, currency: 'INR', disposition: 'settled' }] } });
  await postOrderFinance(order._id, admin._id); await releaseOrderFinance(order._id, admin._id);
  return order;
};
const obligation = (key, type, direction, amount, account) => postLedgerEntry({ idempotencyKey: key, sellerId: seller._id, orderId: id(), type, direction, bucket: 'held', amount,
  description: 'Synthetic courier obligation', ...(account ? { account } : {}) });

describe('seller courier obligations', () => {
  test('are reported separately and never turn the earnings hold negative or block payouts', async () => {
    await eligibleEarnings();
    await obligation('Q-NEW', 'quick_freight_obligation', 'debit', 25, 'seller_courier_obligation');
    await obligation('Q-LEGACY', 'quick_service_fee', 'debit', 5); // posted to seller_payable before the split
    const balances = await sellerBalances(seller._id);
    expect(balances).toMatchObject({ held: 0, eligible: 90, courierObligations: { charged: 30, paid: 0, outstanding: 30 } });
    const { payout } = await createSellerPayoutRequest({ sellerId: seller._id, userId: user._id, amount: 90, key: 'courier-obligation-payout', requestedBy: user._id });
    expect(payout.status).toBe('PENDING');
    await obligation('Q-PAID', 'quick_fee_payment', 'credit', 30, 'seller_courier_obligation');
    expect((await sellerBalances(seller._id)).courierObligations).toEqual({ charged: 30, paid: 30, outstanding: 0 });
    expect((await financialReconciliation()).negativeBalances).toHaveLength(0);
  });

  test('real refund debt in held still blocks payouts', async () => {
    await eligibleEarnings();
    await postLedgerEntry({ idempotencyKey: 'DEBT', sellerId: seller._id, type: 'reversal', direction: 'debit', bucket: 'held', amount: 5, description: 'Synthetic refund debt' });
    await expect(createSellerPayoutRequest({ sellerId: seller._id, userId: user._id, amount: 10, key: 'debt-payout', requestedBy: user._id })).rejects.toThrow(/reconciliation/);
  });

  test('new obligations use their own account and payments follow the obligation they settle', async () => {
    const orderId = id();
    expect(await courierObligationAccount(orderId)).toBe('seller_courier_obligation');
    await postLedgerEntry({ idempotencyKey: 'LEGACY-FREIGHT', sellerId: seller._id, orderId, type: 'quick_freight_obligation', direction: 'debit', bucket: 'held', amount: 3, description: 'Legacy' });
    expect(await courierObligationAccount(orderId)).toBe('seller_payable');
    await expect(postLedgerEntry({ idempotencyKey: 'WRONG', sellerId: seller._id, account: 'seller_courier_obligation', type: 'order_earning', direction: 'credit', bucket: 'held', amount: 1, description: 'Wrong' })).rejects.toThrow(/courier obligation type/);
  });
});

// ---- courier costs ------------------------------------------------------------

const shippedOrder = async (changes = {}) => {
  if (!await current('ecommerce')) await saveCommissionVersion(rule({ channel: 'ecommerce', value: 10 }), admin._id);
  const payment = await Payment.create({ userId: user._id, amount: 140, method: 'online', status: 'paid' });
  return Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: 'online', paymentId: payment._id, status: 'dispatched',
    items: [{ productId: ecomProduct._id, sellerId: seller._id, type: 'ecommerce', name: 'Fixture', qty: 2, price: 50 }], pricing: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 },
    shiprocket: { shipmentId: 'SR-1', awb: 'AWB-1' }, fulfillment: { quote: { provider: 'shiprocket', courierCharge: 55.5 } }, ...changes });
};
const evidence = (changes = {}) => ({ direction: 'forward', amount: 60, reference: 'INV-1001', source: 'provider_invoice', reason: 'Shiprocket invoice line', ...changes });

describe('courier costs', () => {
  test('estimates are never booked; an actual cost is booked once from provider evidence', async () => {
    const order = await shippedOrder();
    expect((await listCourierCosts()).rows[0]).toMatchObject({ status: 'estimated', estimatePaise: 5550, actualPaise: null });
    expect(await courierCostSummary()).toMatchObject({ shipments: 1, estimatedOnly: 1, estimatedUnverifiedPaise: 5550 });
    expect(await Ledger.countDocuments({ account: 'courier_expense' })).toBe(0);

    const input = evidence({ orderId: String(order._id) });
    await Promise.allSettled([recordActualCourierCost({ actorId: admin._id, input }), recordActualCourierCost({ actorId: admin._id, input })]);
    await recordActualCourierCost({ actorId: admin._id, input });
    expect(await Ledger.find({ account: 'courier_expense' })).toHaveLength(1);
    await expect(recordActualCourierCost({ actorId: admin._id, input: { ...input, amount: 61 } })).rejects.toThrow(/different amount/);

    await recordActualCourierCost({ actorId: admin._id, input: { ...input, amount: 58, reference: 'INV-1001-CN' } });
    const entries = await Ledger.find({ account: 'courier_expense' }).sort({ createdAt: 1 });
    expect(entries.map(row => [row.direction, row.amount])).toEqual([['credit', 60], ['debit', 2]]);
    expect(await CourierCharge.findById('forward:SR-1')).toMatchObject({ status: 'actual', actualPaise: 5800, estimatePaise: 5550 });
    expect(await courierCostSummary()).toMatchObject({ actual: 1, estimatedOnly: 0, estimatedUnverifiedPaise: 0 });
    expect((await trialBalance({ from: today(), to: today() })).rows.find(row => row.account === 'Courier expense')).toMatchObject({ balancePaise: 5800 });
  });

  test('disputes move no money, missing evidence is refused, and seller-prepaid Quick freight is excluded', async () => {
    const order = await shippedOrder();
    await disputeCourierCost({ actorId: admin._id, input: { direction: 'forward', orderId: String(order._id), reference: 'TICKET-9', reason: 'Weight discrepancy raised' } });
    expect((await listCourierCosts()).rows[0].status).toBe('disputed');
    expect(await Ledger.countDocuments({ account: 'courier_expense' })).toBe(0);
    await expect(recordActualCourierCost({ actorId: admin._id, input: evidence({ orderId: String(order._id), reference: '' }) })).rejects.toThrow(/billing reference/);
    await expect(recordActualCourierCost({ actorId: admin._id, input: evidence({ orderId: String(order._id), source: 'estimate' }) })).rejects.toThrow(/confirmed/);
    await recordActualCourierCost({ actorId: admin._id, input: evidence({ orderId: String(order._id) }) });
    expect(await CourierCharge.findById('forward:SR-1')).toMatchObject({ status: 'actual' });

    const quick = await shippedOrder({ shiprocket: { shipmentId: 'SR-Q' }, fulfillment: { financialSnapshotId: id() } });
    await expect(recordActualCourierCost({ actorId: admin._id, input: evidence({ orderId: String(quick._id), reference: 'INV-Q' }) })).rejects.toThrow(/prepaid obligation/);
  });

  test('reverse pickups are recorded against the return shipment', async () => {
    const order = await shippedOrder();
    const retId = id();
    await Return.collection.insertOne({ _id: retId, customerId: user._id, sellerId: seller._id, orderId: order._id, orderItemId: order.items[0]._id, quantity: 1, status: 'APPROVED',
      returnNumber: 'RET-REV', pickupMethod: 'SHIPROCKET', reverseBooking: { shipmentId: 'SR-R1' }, awbNumber: 'AWB-R1' });
    await recordActualCourierCost({ actorId: admin._id, input: evidence({ direction: 'reverse', returnId: String(retId), amount: 45, reference: 'INV-R1' }) });
    expect((await listCourierCosts({ direction: 'reverse' })).rows[0]).toMatchObject({ status: 'actual', actualPaise: 4500, returnNumber: 'RET-REV' });
    expect((await Ledger.findOne({ account: 'courier_expense' })).metadata).toMatchObject({ shipmentKey: 'reverse:SR-R1', returnId: String(retId) });
  });
});

// ---- digital orders -------------------------------------------------------------

const digitalOrder = async ({ returnPolicy, file = { fileId: 'file-1', sha256: 'a'.repeat(64), sizeBytes: 10, status: 'uploaded' } } = {}) => {
  await saveCommissionVersion(rule({ channel: 'ecommerce', value: 10 }), admin._id);
  const payment = await Payment.create({ userId: user._id, amount: 100, method: 'online', status: 'paid',
    captures: [{ gatewayOrderId: 'o', gatewayPaymentId: 'p', amountPaise: 10000, currency: 'INR', disposition: 'settled' }] });
  const order = await Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: 'online', paymentId: payment._id, status: 'placed',
    items: [{ productId: ecomProduct._id, sellerId: seller._id, type: 'ecommerce', name: 'E-book', qty: 1, price: 100, fulfillmentType: 'digital', digitalFile: file, ...(returnPolicy ? { returnPolicy } : {}) }],
    pricing: { subtotal: 100, totalAmount: 100 } });
  payment.orderId = order._id; await payment.save();
  return { order, payment };
};
const activate = async payment => {
  const session = await mongoose.startSession();
  try { await session.withTransaction(() => activateDigitalEntitlements({ payment, session })); } finally { await session.endSession(); }
};

describe('digital orders', () => {
  test('activation stamps fulfilment once; a non-returnable e-book releases after posting', async () => {
    const { order, payment } = await digitalOrder();
    await activate(payment);
    const delivered = await Order.findById(order._id);
    expect(delivered.status).toBe('delivered');
    expect(delivered.items[0].deliveredAt).toBeInstanceOf(Date);
    expect(delivered.items[0].returnEligibleUntil).toBeNull();
    await activate(payment);
    const again = await Order.findById(order._id);
    expect(again.items[0].deliveredAt.getTime()).toBe(delivered.items[0].deliveredAt.getTime());
    expect(again.timeline.filter(row => row.status === 'delivered')).toHaveLength(1);
    expect(await DigitalEntitlement.countDocuments()).toBe(1);
    await postOrderFinance(order._id, null); await releaseOrderFinance(order._id, null); await releaseOrderFinance(order._id, null);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 90 });
  });

  test('a returnable e-book stays held through its window and releases after it closes', async () => {
    const { order, payment } = await digitalOrder({ returnPolicy: { returnEligible: true, returnWindowDays: 7 } });
    await activate(payment);
    const delivered = await Order.findById(order._id);
    expect(delivered.items[0].returnEligibleUntil.getTime() - delivered.items[0].deliveredAt.getTime()).toBe(7 * 86400000);
    await postOrderFinance(order._id, null);
    await expect(releaseOrderFinance(order._id, null)).rejects.toThrow(/return hold/);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 90, eligible: 0 });
    // Synthetic clock: the window has passed.
    await Order.collection.updateOne({ _id: order._id }, { $set: { 'items.0.returnEligibleUntil': new Date(Date.now() - 1000) } });
    await releaseOrderFinance(order._id, null);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 0, eligible: 90 });
  });

  test('an open return keeps the earnings held after the window closes', async () => {
    const { order, payment } = await digitalOrder({ returnPolicy: { returnEligible: true, returnWindowDays: 7 } });
    await activate(payment); await postOrderFinance(order._id, null);
    await Order.collection.updateOne({ _id: order._id }, { $set: { 'items.0.returnEligibleUntil': new Date(Date.now() - 1000) } });
    await Return.collection.insertOne({ _id: id(), customerId: user._id, sellerId: seller._id, orderId: order._id, orderItemId: order.items[0]._id, quantity: 1, status: 'REQUESTED', returnNumber: 'RET-OPEN' });
    await expect(releaseOrderFinance(order._id, null)).rejects.toThrow(/return hold/);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 90, eligible: 0 });
  });

  test('a failed activation is not a delivery and accrues nothing', async () => {
    const { order, payment } = await digitalOrder({ file: { sha256: 'a'.repeat(64), sizeBytes: 10, status: 'uploaded' } });
    await expect(activate(payment)).rejects.toThrow(/verified private file/);
    const stored = await Order.findById(order._id);
    expect(stored.status).toBe('placed');
    expect(stored.items[0].deliveredAt).toBeUndefined();
    await expect(postOrderFinance(order._id, null)).rejects.toThrow(/completed deliveries/);
    expect(await Ledger.countDocuments()).toBe(0);
  });
});
