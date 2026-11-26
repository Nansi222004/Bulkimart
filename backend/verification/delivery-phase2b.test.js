import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Seller from '../models/Seller.js';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import Product from '../models/Product.js';
import Category from '../models/Category.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import WalletLedger from '../models/WalletLedger.js';
import CourierCodRemittance from '../models/CourierCodRemittance.js';
import CourierCharge from '../models/CourierCharge.js';
import { saveCommissionVersion } from '../services/vendorCommission.service.js';
import { recordCourierCodRemittance, reapplyCourierCodRemittance, courierCodReconciliationReport, postOrderFinance, releaseOrderFinance } from '../services/orderFinance.service.js';
import { runFinanceAutomationOnce } from '../services/financeAutomation.service.js';
import { applyForwardTracking } from '../services/courierTracking.service.js';
import { reportExternalNotReceived, adminResolveExternalShipment, sellerUpdateExternalShipment } from '../services/externalCourier.service.js';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';

/**
 * Delivery methods, Phase 2B (approved 2026-11-25):
 *   - C3: unsettled courier remittance lines can be re-applied by finance, never crediting twice.
 *   - Gross vs net remittance is reported side by side; shortfalls are never settled automatically.
 *   - Self Delivery (own courier): delivery charge credited to the seller once (shared idempotency key),
 *     a confirmation hold and a customer "not received" report gate seller earnings, admin resolution.
 */
const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const DAY = 24 * 60 * 60 * 1000;
const rule = (channel) => ({ vendorType: 'general', channel, method: 'percentage', value: 10, minimum: null, maximum: null, base: 'eligible_item_subtotal',
  fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01T00:00:00Z', isActive: true, reason: 'Synthetic fixture policy only' });
let db, user, admin, seller, productId;

/** A Shop All COD order booked with Shiprocket (₹100 goods + ₹20 delivery = ₹120). */
const courierCodOrder = async ({ awb = 'AWB-E1', status = 'delivered', extra = {} } = {}) => {
  const pay = await Payment.create({ userId: user._id, amount: 120, method: 'cod', status: 'pending' });
  const order = await Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: 'cod', paymentId: pay._id, status, deliveryType: 'shiprocket', deliveryMethod: 'easy_ship', fulfillmentOwner: 'seller',
    items: [{ productId, sellerId: seller._id, type: 'ecommerce', name: 'Fixture', qty: 2, price: 50, deliveredAt: new Date('2020-01-01') }],
    pricing: { subtotal: 100, deliveryCharge: 20, totalAmount: 120 }, ...(status === 'delivered' ? { deliveredAt: new Date('2020-01-01') } : {}),
    shiprocket: { environment: 'sandbox', orderId: 'SR-' + awb, shipmentId: 'SH-' + awb, awb, courier: 'Fixture', status: 'IN_TRANSIT' }, ...extra });
  pay.orderId = order._id; await pay.save();
  return order;
};
/** A prepaid Self Delivery order the seller handed to their own courier (₹100 goods + ₹40 delivery). */
const externalOrder = async ({ status = 'delivered', deliveredAt = new Date(Date.now() - 30 * DAY), payee = 'seller', extra = {} } = {}) => {
  const pay = await Payment.create({ userId: user._id, amount: 140, method: 'online', status: 'paid', paidAt: new Date(),
    captures: [{ gatewayOrderId: 'order-' + id(), gatewayPaymentId: 'pay-' + id(), amountPaise: 14000, currency: 'INR', disposition: 'settled' }] });
  const order = await Order.create({ userId: user._id, type: 'ecommerce', paymentMethod: 'online', paymentId: pay._id, status, deliveryType: 'external', deliveryMethod: 'self_delivery', fulfillmentOwner: 'seller',
    items: [{ productId, variantId: undefined, sellerId: seller._id, type: 'ecommerce', name: 'Fixture', qty: 2, price: 50, ...(status === 'delivered' ? { deliveredAt } : {}) }],
    pricing: { subtotal: 100, deliveryCharge: 40, totalAmount: 140 }, ...(status === 'delivered' ? { deliveredAt } : {}),
    fulfillment: { method: 'external_courier', selectedBy: 'seller' },
    externalShipment: { courierName: 'DTDC', awb: 'D-' + id().toString().slice(-6), trackingUrl: 'https://www.dtdc.in/track', dispatchedAt: new Date(),
      status: status === 'delivered' ? 'delivered' : 'dispatched', deliveryFeePayee: payee, events: [] }, ...extra });
  pay.orderId = order._id; await pay.save();
  return order;
};
const remit = (reference, lines) => recordCourierCodRemittance({ reference, remittedAt: new Date(), evidenceNote: 'Shiprocket remittance report fixture', lines, actorId: admin._id });
const token = (who) => 'Bearer ' + jwt.sign({ id: String(who), type: 'admin' }, JWT_SECRET);

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Ledger.init(), Payment.init(), Order.init(), CourierCodRemittance.init(), WalletLedger.init(), Return.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  user = await User.create({ name: 'Customer', phone: '9876600101', roles: ['buyer'], isActive: true, wallet: { balance: 0 } });
  const adminId = id();
  await Admin.collection.insertOne({ _id: adminId, name: 'Finance admin', email: 'finance@example.test', password: 'x', role: 'admin', permissions: ['manage_finance'], isActive: true });
  admin = await Admin.findById(adminId);
  const sellerId = id();
  await Seller.collection.insertOne({ _id: sellerId, userId: id(), businessName: 'Fixture store', status: 'approved', bankDetails: { upiId: 'fixture@test' } });
  seller = await Seller.findById(sellerId);
  productId = id();
  const category = id();
  await Product.collection.insertOne({ _id: productId, category, type: 'ecommerce', name: 'Fixture', stock: 10, price: 50, variants: [] });
  await Category.collection.insertOne({ _id: category, name: 'Fixture category', type: 'ecommerce' });
  await saveCommissionVersion(rule('ecommerce'), admin._id);
});

describe('C3: re-applying unsettled remittance lines', () => {
  test('cash remitted before the delivered scan is held, then applied once on re-application', async () => {
    const order = await courierCodOrder({ status: 'dispatched' });
    const first = await remit('SR-EARLY', [{ awb: 'AWB-E1', amount: 120 }]);
    expect(first.remittance.lines[0].outcome).toBe('not_delivered');
    expect((await Order.findById(order._id)).codFinance?.status).toBeUndefined();

    // A delivered scan alone never settles cash.
    await applyForwardTracking({ awb: 'AWB-E1', shipmentId: 'SH-AWB-E1', statusId: 7, status: 'DELIVERED', eventId: 'EV-D', environment: 'sandbox', source: 'webhook' });
    let row = await Order.findById(order._id);
    expect(row.status).toBe('delivered');
    expect(row.codFinance?.status).toBeUndefined();
    expect((await Payment.findById(order.paymentId)).status).toBe('pending');
    await expect(postOrderFinance(order._id, null)).rejects.toMatchObject({ status: 409 });

    const result = await reapplyCourierCodRemittance({ remittanceId: first.remittance._id, reason: 'Delivered scan arrived after the remittance', actorId: admin._id });
    expect(result.results).toEqual([expect.objectContaining({ awb: 'AWB-E1', previousOutcome: 'not_delivered', outcome: 'applied' })]);
    row = await Order.findById(order._id);
    expect(row.codFinance).toMatchObject({ source: 'courier_remittance', status: 'verified', remittedPaise: 12000 });
    expect((await Payment.findById(order.paymentId)).status).toBe('paid');

    // The original evidence is untouched; the attempt is appended; a second attempt has nothing to do.
    const stored = await CourierCodRemittance.findById(first.remittance._id).lean();
    expect(stored.lines).toEqual([expect.objectContaining({ awb: 'AWB-E1', outcome: 'not_delivered' })]);
    expect(stored.reapplications).toHaveLength(1);
    await expect(reapplyCourierCodRemittance({ remittanceId: first.remittance._id, reason: 'Trying again by mistake', actorId: admin._id }))
      .rejects.toMatchObject({ status: 409, meta: { code: 'NOTHING_TO_REAPPLY' } });
    expect((await Order.findById(order._id)).codFinance.events.filter((e) => e.action === 'courier_remittance')).toHaveLength(1);

    await postOrderFinance(order._id, null);
    expect(await Ledger.countDocuments({ orderId: order._id, type: 'order_earning' })).toBe(1);
  });

  test('concurrent re-applications settle the line exactly once', async () => {
    const order = await courierCodOrder({ status: 'dispatched' });
    const { remittance } = await remit('SR-RACE', [{ awb: 'AWB-E1', amount: 120 }]);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered' } });
    const outcomes = await Promise.allSettled([1, 2, 3].map(() => reapplyCourierCodRemittance({ remittanceId: remittance._id, reason: 'Concurrent finance clicks', actorId: admin._id })));
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const row = await Order.findById(order._id);
    expect(row.codFinance.remittedPaise).toBe(12000);
    expect(row.codFinance.events.filter((e) => e.action === 'courier_remittance')).toHaveLength(1);
    expect((await CourierCodRemittance.findById(remittance._id)).reapplications).toHaveLength(1);
  });

  test('only waiting lines are retried: applied, partial and excess lines are never re-run; unmatched AWBs can match later', async () => {
    await courierCodOrder({ awb: 'AWB-A' });
    await courierCodOrder({ awb: 'AWB-B', status: 'dispatched' });
    await courierCodOrder({ awb: 'AWB-P' });
    const { remittance } = await remit('SR-MIX', [{ awb: 'AWB-A', amount: 120 }, { awb: 'AWB-B', amount: 120 }, { awb: 'AWB-P', amount: 60 }, { awb: 'AWB-LATE', amount: 120 }]);
    expect(remittance.lines.map((l) => l.outcome)).toEqual(['applied', 'not_delivered', 'partial', 'unmatched']);
    await Order.updateOne({ 'shiprocket.awb': 'AWB-B' }, { $set: { status: 'delivered' } });
    await courierCodOrder({ awb: 'AWB-LATE' });
    const result = await reapplyCourierCodRemittance({ remittanceId: remittance._id, reason: 'Delivery and AWB caught up', actorId: admin._id });
    expect(result.results.map((r) => [r.awb, r.outcome])).toEqual([['AWB-B', 'applied'], ['AWB-LATE', 'applied']]);
    const a = await Order.findOne({ 'shiprocket.awb': 'AWB-A' });
    expect(a.codFinance.remittedPaise).toBe(12000); // not credited twice
    const p = await Order.findOne({ 'shiprocket.awb': 'AWB-P' });
    expect(p.codFinance).toMatchObject({ status: 'remittance_reported', remittedPaise: 6000, shortagePaise: 6000 });
  });

  test('excess remittances stay a discrepancy and block earnings; remittance evidence cannot be rewritten', async () => {
    const order = await courierCodOrder();
    const { remittance } = await remit('SR-EXCESS', [{ awb: 'AWB-E1', amount: 150 }]);
    expect(remittance.lines[0].outcome).toBe('excess');
    expect((await Order.findById(order._id)).codFinance.status).toBe('discrepancy');
    await expect(postOrderFinance(order._id, null)).rejects.toMatchObject({ status: 409 });
    await expect(CourierCodRemittance.updateOne({ _id: remittance._id }, { $set: { 'lines.0.outcome': 'applied' } })).rejects.toThrow(/immutable/);
    await expect(CourierCodRemittance.deleteOne({ _id: remittance._id })).rejects.toThrow(/immutable/);
  });

  test('re-application needs the finance permission', async () => {
    const order = await courierCodOrder({ status: 'dispatched' });
    const { remittance } = await remit('SR-PERM', [{ awb: 'AWB-E1', amount: 120 }]);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'delivered' } });
    const plainId = id();
    await Admin.collection.insertOne({ _id: plainId, name: 'Catalogue admin', email: 'catalogue@example.test', password: 'x', role: 'admin', permissions: ['manage_products'], isActive: true });
    const url = `/api/admin/finance/courier-cod/remittances/${remittance._id}/reapply`;
    await request(app).post(url).set('Authorization', token(plainId)).send({ reason: 'Not allowed to do this' }).expect(403);
    await request(app).post(url).set('Authorization', token(admin._id)).send({ reason: 'x' }).expect(400);
    await request(app).post(url).set('Authorization', token(admin._id)).send({ reason: 'Delivery confirmed later' }).expect(200);
  });
});

describe('gross vs net remittance (account mode not yet verified)', () => {
  test('the report separates gross, verified courier charges, remitted, outstanding and unexplained — and settles nothing', async () => {
    const order = await courierCodOrder();
    await remit('SR-NET', [{ awb: 'AWB-E1', amount: 90 }]); // as if ₹30 of charges were deducted
    await CourierCharge.create({ _id: 'forward:SH-AWB-E1', direction: 'forward', orderId: order._id, shipmentId: 'SH-AWB-E1', awb: 'AWB-E1', status: 'actual', actualPaise: 2500, evidence: [] });
    const row = (await courierCodReconciliationReport({})).rows.find((r) => String(r.orderId) === String(order._id));
    expect(row.amounts).toEqual({ grossCodPaise: 12000, verifiedCourierChargesPaise: 2500, remittedPaise: 9000, outstandingPaise: 3000, unexplainedPaise: 500, excessPaise: 0 });
    expect(row.cashStatus).toBe('remittance_reported');
    expect((await Payment.findById(order.paymentId)).status).toBe('pending');
    await expect(postOrderFinance(order._id, null)).rejects.toMatchObject({ status: 409 });
  });
});

describe('Self Delivery (own courier) finance', () => {
  test('the delivery charge is credited to the seller once — never also to the platform — and released with the order', async () => {
    const order = await externalOrder();
    await postOrderFinance(order._id, null);
    await postOrderFinance(order._id, null); // replay is a no-op
    const fee = await Ledger.find({ orderId: order._id, type: 'self_delivery_fee' }).lean();
    expect(fee).toHaveLength(1);
    expect(fee[0]).toMatchObject({ account: 'seller_payable', amount: 40, bucket: 'held', direction: 'credit' });
    expect(String(fee[0].sellerId)).toBe(String(seller._id));
    expect(await Ledger.countDocuments({ orderId: order._id, type: 'customer_delivery' })).toBe(0);
    // Commission is on the goods only; the seller's earning is unchanged by the delivery credit.
    expect((await Ledger.findOne({ orderId: order._id, type: 'order_earning' })).amount).toBe(90);
    await releaseOrderFinance(order._id, null);
    const released = await Ledger.find({ orderId: order._id, type: 'adjustment', 'metadata.kind': 'self_delivery_fee' }).lean();
    expect(released.map((r) => [r.bucket, r.direction, r.amount])).toEqual(expect.arrayContaining([['held', 'debit', 40], ['eligible', 'credit', 40]]));
  });

  test('orders handed off while the credit switch was off keep the charge as platform income', async () => {
    const order = await externalOrder({ payee: 'platform' });
    await postOrderFinance(order._id, null);
    expect(await Ledger.countDocuments({ orderId: order._id, type: 'self_delivery_fee' })).toBe(0);
    expect((await Ledger.findOne({ orderId: order._id, type: 'customer_delivery' })).amount).toBe(40);
  });

  test('a seller-reported delivery posts nothing during the confirmation hold or while the customer reports it missing', async () => {
    const fresh = await externalOrder({ deliveredAt: new Date() });
    await expect(postOrderFinance(fresh._id, null)).rejects.toMatchObject({ status: 409, meta: { code: 'EXTERNAL_DELIVERY_HOLD' } });
    await runFinanceAutomationOnce();
    expect((await Order.findById(fresh._id)).financialPosting).toBeUndefined();
    expect((await Order.findById(fresh._id)).financeAutomation).toBeUndefined(); // skipped quietly, not an error

    await reportExternalNotReceived({ orderId: fresh._id, userId: user._id, reason: 'Nothing came to my door' });
    await Order.updateOne({ _id: fresh._id }, { $set: { deliveredAt: new Date(Date.now() - 30 * DAY) } }); // hold over, report still open
    await expect(postOrderFinance(fresh._id, null)).rejects.toMatchObject({ status: 409 });
    await adminResolveExternalShipment({ orderId: fresh._id, adminId: admin._id, action: 'confirm_delivered', reason: 'Courier proof of delivery checked' });
    await postOrderFinance(fresh._id, null);
    expect((await Order.findById(fresh._id)).financialPosting).toBe('held');
  });

  test('not received → admin cancels and refunds before any earnings; stock only when the parcel came back', async () => {
    const order = await externalOrder({ deliveredAt: new Date() });
    await expect(reportExternalNotReceived({ orderId: order._id, userId: id(), reason: 'Not mine but trying' })).rejects.toMatchObject({ status: 403 });
    await expect(adminResolveExternalShipment({ orderId: order._id, adminId: admin._id, action: 'cancel_refund', reason: 'No report yet so not allowed' })).rejects.toMatchObject({ status: 409 });
    await reportExternalNotReceived({ orderId: order._id, userId: user._id, reason: 'Nothing came to my door' });
    await expect(reportExternalNotReceived({ orderId: order._id, userId: user._id, reason: 'Reporting a second time' })).rejects.toMatchObject({ status: 409 });
    await adminResolveExternalShipment({ orderId: order._id, adminId: admin._id, action: 'cancel_refund', reason: 'Courier could not show proof', restock: false });
    const row = await Order.findById(order._id).lean();
    expect(row.status).toBe('cancelled');
    expect(row.externalShipment.dispute).toMatchObject({ status: 'resolved', resolution: 'cancelled_refunded' });
    expect((await Payment.findById(order.paymentId)).refund).toMatchObject({ status: 'pending', amount: 140 });
    expect((await Product.findById(productId).lean()).stock).toBe(10); // not restocked
    await expect(postOrderFinance(order._id, null)).rejects.toMatchObject({ status: 409 });
    expect(await Ledger.countDocuments({ orderId: order._id })).toBe(0);
  });

  test('admin can cancel an undelivered external order with restock; posted orders cannot be cancelled here', async () => {
    const live = await externalOrder({ status: 'dispatched' });
    await adminResolveExternalShipment({ orderId: live._id, adminId: admin._id, action: 'cancel_refund', reason: 'Returned to seller by courier', restock: true });
    expect((await Product.findById(productId).lean()).stock).toBe(12);
    const posted = await externalOrder();
    await postOrderFinance(posted._id, null);
    await reportExternalNotReceived({ orderId: posted._id, userId: user._id, reason: 'Late report attempt' }).catch(() => {});
    await expect(adminResolveExternalShipment({ orderId: posted._id, adminId: admin._id, action: 'cancel_refund', reason: 'Too late for this path' })).rejects.toMatchObject({ status: 409 });
  });

  test('seller corrections keep history (max three) and failed attempts are recorded; finished deliveries cannot change', async () => {
    let order = await externalOrder({ status: 'dispatched' });
    const original = order.externalShipment.awb;
    for (let n = 1; n <= 3; n += 1) {
      order = await sellerUpdateExternalShipment({ order: await Order.findById(order._id), body: { action: 'correct_tracking', awb: `FIX${n}000`, reason: `Typo number ${n} on the slip` } });
    }
    expect(order.externalShipment.awb).toBe('FIX3000');
    expect(order.externalShipment.corrections.map((c) => c.previous.awb)).toEqual([original, 'FIX1000', 'FIX2000']);
    await expect(sellerUpdateExternalShipment({ order: await Order.findById(order._id), body: { action: 'correct_tracking', awb: 'FIX4000', reason: 'One more time please' } })).rejects.toMatchObject({ status: 409 });
    order = await sellerUpdateExternalShipment({ order: await Order.findById(order._id), body: { action: 'delivery_failed', reason: 'Customer not at home' } });
    expect(order.externalShipment).toMatchObject({ status: 'delivery_failed', failure: { reason: 'Customer not at home', by: 'seller' } });
    expect(order.status).toBe('dispatched');
    const done = await externalOrder();
    await expect(sellerUpdateExternalShipment({ order: done, body: { action: 'delivery_failed', reason: 'Trying after delivery' } })).rejects.toMatchObject({ status: 409 });
  });
});
