import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRoutes from '../routes/admin.routes.js';
import { errorHandler } from '../middlewares/error.middleware.js';
import { JWT_SECRET } from '../config/jwt.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import SellerPayout from '../models/SellerPayout.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { resolveRange, toCsv, maskPhone } from '../services/adminReports.service.js';
import { seedReports, ist } from './fixtures/reportsFixture.js';

const app = express(); app.use(express.json()); app.use('/api/admin', adminRoutes); app.use(errorHandler);
const id = () => new mongoose.Types.ObjectId();
const SEPT = 'range=custom&from=2026-09-01&to=2026-09-30';
let db, finance, plain, ids;
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
const get = (path, token = finance) => { const req = request(app).get(`/api/admin/reports/${path}`); return token ? req.set('Authorization', token) : req; };

async function seed() { ids = await seedReports(); }
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  const superId = id(), plainId = id();
  await Admin.collection.insertMany([{ _id: superId, name: 'Finance', email: 'f@example.test', role: 'superAdmin', isActive: true }, { _id: plainId, name: 'Ops', email: 'o@example.test', role: 'admin', permissions: [], isActive: true }]);
  finance = `Bearer ${jwt.sign({ id: String(superId), type: 'admin' }, JWT_SECRET)}`;
  plain = `Bearer ${jwt.sign({ id: String(plainId), type: 'admin' }, JWT_SECRET)}`;
});

test('reports require an authenticated admin with manage_finance', async () => {
  for (const path of ['overview', 'customers', 'vendors', 'delivery', 'export?report=overview']) {
    await get(path, null).expect(401);
    await get(path, plain).expect(403);
  }
});

test.each([['range=yesterday'], ['range=custom&from=2026-09-10&to=2026-09-01'], ['range=custom&from=2026-09-01&to=2099-01-01'], ['range=custom&from=2024-01-01&to=2025-06-30'],
  ['range=custom&from=2026-02-30&to=2026-03-01'], ['limit=500'], ['page=0'], ['sort=password'], ['dir=sideways'], ['status=deleted'], ['fields=password'], ['status[$ne]=x'], ['search=' + 'a'.repeat(81)]])('invalid query %s is rejected', async query => {
  await get(`customers?${query}`).expect(400);
});

test('IST day ranges are start-inclusive and end-exclusive', () => {
  const now = ist('2026-10-27T01:00:00').getTime();
  expect(resolveRange({ range: 'today' }, now)).toMatchObject({ fromDay: '2026-10-27', toDay: '2026-10-27' });
  expect(resolveRange({ range: 'last7' }, now).fromDay).toBe('2026-10-21');
  expect(resolveRange({ range: 'month' }, now).fromDay).toBe('2026-10-01');
  const sept = resolveRange({ range: 'custom', from: '2026-09-01', to: '2026-09-30' }, now);
  expect(sept.from.toISOString()).toBe('2026-08-31T18:30:00.000Z'); expect(sept.to.toISOString()).toBe('2026-09-30T18:30:00.000Z'); expect(sept.days).toHaveLength(30);
});

test('an empty database returns complete zeros, not errors', async () => {
  const data = (await get(`overview?${SEPT}`).expect(200)).body.data;
  expect(data.kpis.grossOrderValue).toMatchObject({ amountPaise: 0, status: 'complete' });
  expect(data.counts).toMatchObject({ totalOrders: 0, completedOrders: 0, activeCustomers: 0, deliverySuccessRate: null });
  expect(data.series).toHaveLength(30); expect(data.statuses).toEqual([]); expect(data.vendors).toEqual([]);
  for (const report of ['customers', 'vendors', 'delivery']) expect((await get(`${report}?${SEPT}`).expect(200)).body.data.meta.total).toBe(0);
});

test('platform overview separates order value, completed sales, refunds, commission, earnings and receipts', async () => {
  await seed();
  const data = (await get(`overview?${SEPT}`).expect(200)).body.data;
  expect(data.range).toEqual({ preset: 'custom', from: '2026-09-01', to: '2026-09-30', days: 30 });
  expect(data.counts).toMatchObject({ totalOrders: 4, cancelledOrders: 1, completedOrders: 2, activeCustomers: 2, activeSellers: 2, deliveriesCompleted: 1, deliveriesFailed: 1, deliverySuccessRate: 0.5 });
  const k = data.kpis;
  expect(k.grossOrderValue.amountPaise).toBe(200000);   // O1+O2+O3+O4; abandoned O5 and out-of-range O6/O7 excluded
  expect(k.cancelledOrderValue.amountPaise).toBe(20000);
  expect(k.completedSales.amountPaise).toBe(150000);    // O1 + O2 (23:59:59 IST on the last day); O6 at 00:00 next day excluded
  expect(k.refunds).toMatchObject({ amountPaise: 40000, count: 2 }); // return 300 + one cancellation refund 100 (duplicate ignored)
  expect(k.netSales.amountPaise).toBe(110000);
  expect(k.averageOrderValue.amountPaise).toBe(75000);
  expect(k.platformCommission.amountPaise).toBe(8500);  // 60 + 35 − 10; October entry excluded
  expect(k.sellerEarnings.amountPaise).toBe(58500);     // 540 + 315 − 270; release pair nets to zero
  expect(k.paymentsCaptured.amountPaise).toBe(100000);
  expect(k.codVerified.amountPaise).toBe(50000);
  expect(k.pendingRefunds).toMatchObject({ amountPaise: 5000, count: 1 });
  expect(data.statuses).toEqual([{ key: 'delivered', count: 2 }, { key: 'cancelled', count: 1 }, { key: 'placed', count: 1 }]);
  expect(data.vendors).toEqual([expect.objectContaining({ name: 'Alpha Store', merchandisePaise: 110000, orders: 2 }), expect.objectContaining({ name: 'Beta Store', merchandisePaise: 35000, orders: 1 })]);
  const days = Object.fromEntries(data.series.map(point => [point.day, point]));
  expect(days['2026-09-30']).toMatchObject({ ordersPlaced: 1, completedOrders: 1, completedSalesPaise: 50000 });
  expect(days['2026-09-25']).toMatchObject({ refundsPaise: 10000, refundCount: 1 });
});

test('an invalid stored amount makes the figure incomplete instead of partial', async () => {
  await seed();
  await Order.collection.insertOne({ _id: id(), orderNo: 'ORD-BAD', userId: ids.buyerA, type: 'ecommerce', paymentMethod: 'cod', status: 'placed', createdAt: ist('2026-09-16T08:00:00'), items: [], pricing: { totalAmount: 10.005 } });
  const gross = (await get(`overview?${SEPT}`).expect(200)).body.data.kpis.grossOrderValue;
  expect(gross).toMatchObject({ amountPaise: null, status: 'incomplete', verifiedSubtotalPaise: 200000, invalidRecords: 1 });
});

test('customer report: totals, activity definitions, search, sort, pagination and masking', async () => {
  await seed();
  const data = (await get(`customers?${SEPT}&sort=spend&dir=desc&limit=1`).expect(200)).body.data;
  expect(data.totals).toEqual({ registeredCustomers: 2, newRegistrations: 1, activeCustomers: 2, customersWithCompletedOrders: 1, repeatCustomers: 2 });
  expect(data.meta).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
  expect(data.rows[0]).toMatchObject({ name: 'Asha Buyer', ordersPlaced: 2, completedOrders: 2, spendPaise: 150000, isNew: true, phone: '98••••••11' });
  expect(JSON.stringify(data)).not.toMatch(/9876501111/);
  expect((await get(`customers?${SEPT}&sort=spend&dir=desc&limit=1&page=2`).expect(200)).body.data.rows[0]).toMatchObject({ ordersPlaced: 2, completedOrders: 0, spendPaise: 0 });
  expect((await get(`customers?${SEPT}&search=asha`).expect(200)).body.data.rows.map(r => r.name)).toEqual(['Asha Buyer']);
  expect((await get(`customers?${SEPT}&search=02222`).expect(200)).body.data.meta.total).toBe(1);
  expect((await get(`customers?${SEPT}&status=completed`).expect(200)).body.data.rows.map(r => r.name)).toEqual(['Asha Buyer']);
  expect((await get(`customers?${SEPT}&status=new`).expect(200)).body.data.meta.total).toBe(1);
  expect(data.series.find(point => point.day === '2026-09-05').registrations).toBe(1);
});

test('vendor report splits multi-vendor orders by item and uses ledger and payout records', async () => {
  await seed();
  const data = (await get(`vendors?${SEPT}&sort=sales`).expect(200)).body.data;
  expect(data.totals).toMatchObject({ totalVendors: 3, activeVendors: 2, vendorsWithSales: 2, salesPaise: 145000, commissionPaise: 8500, earningsPaise: 58500, settlementsPaidPaise: 20000, settlementsPendingPaise: 10000 });
  const [alpha, beta, gamma] = data.rows;
  expect(alpha).toMatchObject({ name: 'Alpha Store', ordersPlaced: 3, completedOrders: 2, salesPaise: 110000, refundsPaise: 30000, commissionPaise: 5000, earningsPaise: 27000, settlementsPaidPaise: 20000, settlementsPendingPaise: 0, incomplete: false });
  expect(beta).toMatchObject({ name: 'Beta Store', ordersPlaced: 2, completedOrders: 1, salesPaise: 35000, commissionPaise: 3500, earningsPaise: 31500, settlementsPendingPaise: 10000 });
  expect(gamma).toMatchObject({ name: 'Gamma Store', ordersPlaced: 0, salesPaise: 0 });
  expect(data.topProducts[0]).toMatchObject({ seller: 'Alpha Store', units: 2, salesPaise: 60000 });
  expect((await get(`vendors?${SEPT}&status=pending`).expect(200)).body.data.rows.map(r => r.name)).toEqual(['Gamma Store']);
  expect((await get(`vendors?${SEPT}&search=beta`).expect(200)).body.data.rows.map(r => r.name)).toEqual(['Beta Store']);
});

test('delivery report: trip outcomes, duration, recorded earnings and COD custody', async () => {
  await seed();
  const data = (await get(`delivery?${SEPT}`).expect(200)).body.data;
  expect(data.totals).toMatchObject({ assigned: 3, delivered: 1, failed: 1, rejected: 1, successRate: 0.5, avgDurationMinutes: 30, totalPartners: 2, activePartners: 1 });
  expect(data.cash.collected.amountPaise).toBe(50000);   // O6 collected at 00:00 Oct 1 is outside
  expect(data.cash.verified.amountPaise).toBe(50000);
  expect(data.cash.outstandingPaise).toBe(70000);         // current: O6 collected, not yet verified
  const rider = data.rows.find(r => r.name === 'Ravi Rider');
  expect(rider).toMatchObject({ assigned: 3, delivered: 1, failed: 1, rejected: 1, successRate: 0.5, avgDurationMinutes: 30, earningsPaise: 4000, codCollectedPaise: 50000, cashOutstandingPaise: 70000, phone: '98••••••33' });
  expect((await get(`delivery?${SEPT}&status=pending`).expect(200)).body.data.rows).toHaveLength(1);
});

test('CSV export downloads the full selected report with escaping and formula protection', async () => {
  await seed();
  const res = await get(`export?report=customers&${SEPT}&limit=1`).expect(200);
  expect(res.headers['content-type']).toMatch(/text\/csv/);
  expect(res.headers['content-disposition']).toBe('attachment; filename="bulkimart-customers-report-2026-09-01-to-2026-09-30.csv"');
  const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
  expect(lines).toHaveLength(3); // header + every customer, not just one page
  expect(lines[0]).toMatch(/^"Customer","Phone \(masked\)"/);
  expect(res.text).toContain(`"'=HYPERLINK(""http://x""), ""Bala"""`);
  expect(res.text).toMatch(/"Asha Buyer","98••••••11",.*,2,2,1500,/);
  for (const report of ['overview', 'vendors', 'delivery']) {
    const file = await get(`export?report=${report}&${SEPT}`).expect(200);
    expect(file.headers['content-disposition']).toMatch(new RegExp(`bulkimart-${report === 'overview' ? 'platform' : report}-report-2026-09-01-to-2026-09-30\\.csv`));
  }
  const overview = (await get(`export?report=overview&${SEPT}`)).text.trim().split('\r\n');
  expect(overview).toHaveLength(32); expect(overview.at(-1)).toBe('"Total",4,2000,2,1500,2,400');
  await get(`export?report=salaries&${SEPT}`).expect(400);
});

test('csv helpers keep numbers numeric and neutralise formulas in text', () => {
  expect(toCsv(['a', 'b'], [[-12.5, '-cmd'], ['x,"y"\nz', null]])).toBe('"a","b"\r\n-12.5,"\'-cmd"\r\n"x,""y""\nz",\r\n');
  expect(maskPhone('9876543210')).toBe('98••••••10'); expect(maskPhone('')).toBe('');
});

describe('order payments report', () => {
  const line = (sellerId, extra) => ({ itemId: String(id()), productId: String(id()), sellerId: String(sellerId), qty: 1, rule: { version: 1 }, allocatedDiscounts: {}, ...extra });
  async function seedOrders() {
    const [S1, S2, buyer, riderUser, P1] = [id(), id(), id(), id(), id()];
    await Seller.collection.insertMany([{ _id: S1, userId: id(), businessName: 'Alpha Store', status: 'approved' }, { _id: S2, userId: id(), businessName: 'Beta Store', status: 'approved' }]);
    await User.collection.insertMany([{ _id: buyer, name: 'Asha Buyer', phone: '9876501111', roles: ['buyer'] }, { _id: riderUser, name: 'Ravi Rider', phone: '9876503333', roles: ['delivery'] }]);
    await DeliveryPartner.collection.insertOne({ _id: P1, userId: riderUser, status: 'approved' });
    const a1 = line(S1, { grossPaise: 60000, eligiblePaise: 58000, commissionPaise: 5800, taxPaise: 1044, tcsPaise: 300, tdsPaise: 600, taxableValuePaise: 50847, gstRatePercent: 18, netPaise: 52256 });
    const a2 = line(S2, { grossPaise: 40000, eligiblePaise: 40000, commissionPaise: 4000, taxPaise: 720, tcsPaise: 200, tdsPaise: 400, taxableValuePaise: 38095, gstRatePercent: 5, netPaise: 34680 });
    const snapshot = (lines, components) => ({ version: 2, discountFunding: 'platform', lines, components: { merchandisePaise: 0, sellerIncentivePaise: 0, tipPaise: 0, donationPaise: 0, ...components } });
    const order = (key, extra) => ({ _id: id(), orderNo: `ORD-${key}`, userId: buyer, type: 'ecommerce', paymentMethod: 'cod', createdAt: ist('2026-09-10T10:00:00'), updatedAt: ist('2026-09-10T10:00:00'), ...extra });
    const delivered = order('A', { status: 'delivered', financialPosting: 'held',
      items: [{ _id: new mongoose.Types.ObjectId(a1.itemId), sellerId: S1, name: 'Rice 5kg', price: 600, qty: 1 }, { _id: new mongoose.Types.ObjectId(a2.itemId), sellerId: S2, name: 'Oil 1L', price: 400, qty: 1 }],
      pricing: { subtotal: 1000, deliveryCharge: 30, tipAmount: 5, totalAmount: 1015 }, financialSnapshot: snapshot([a1, a2], { deliveryPaise: 3000, tipPaise: 500 }) });
    const b1 = line(S1, { grossPaise: 20000, eligiblePaise: 20000, commissionPaise: 2000, taxPaise: 360, tcsPaise: 100, tdsPaise: 200, taxableValuePaise: 16949, gstRatePercent: 18, netPaise: 17340 });
    const open = order('B', { status: 'placed', items: [{ _id: new mongoose.Types.ObjectId(b1.itemId), sellerId: S1, name: 'Dal', price: 200, qty: 1 }], pricing: { subtotal: 200, deliveryCharge: 20, totalAmount: 220 },
      financialSnapshot: snapshot([b1], { deliveryPaise: 2000 }), delivery: { riderPayoutQuoted: 25 } });
    const payC = id();
    const cancelled = order('C', { status: 'cancelled', paymentMethod: 'wallet', paymentId: payC, items: [{ _id: id(), sellerId: S2, name: 'Tea', price: 150, qty: 1 }], pricing: { subtotal: 150, totalAmount: 150 } });
    await Payment.collection.insertOne({ _id: payC, userId: buyer, orderId: cancelled._id, method: 'wallet', status: 'refunded', amount: 150 });
    await Order.collection.insertMany([delivered, open, cancelled]);
    let n = 0;
    const post = (account, type, direction, amount, sellerId) => ({ _id: id(), entryNo: `OE${++n}`, idempotencyKey: `OK${n}`, orderId: delivered._id, sellerId, account, type, direction, bucket: 'held', amount, currency: 'INR', status: 'posted', description: 'fixture', metadata: {}, createdAt: ist('2026-09-11T12:05:00') });
    await Ledger.collection.insertMany([
      post('seller_payable', 'order_earning', 'credit', 522.56, S1), post('seller_payable', 'order_earning', 'credit', 346.8, S2),
      // A held→eligible release is a pair of moves and must not change the seller's earning.
      post('seller_payable', 'adjustment', 'debit', 522.56, S1), { ...post('seller_payable', 'adjustment', 'credit', 522.56, S1), bucket: 'eligible' },
      post('commission_revenue', 'platform_commission', 'credit', 58, S1), post('commission_revenue', 'platform_commission', 'credit', 40, S2),
      post('tax_liability', 'commission_tax', 'credit', 17.64), post('tcs_liability', 'tcs_deduction', 'credit', 5), post('tds_liability', 'tds_deduction', 'credit', 10),
      post('platform_discount_expense', 'platform_discount', 'credit', 20), post('customer_delivery', 'customer_delivery', 'credit', 30),
    ]);
    await Delivery.collection.insertOne({ _id: id(), orderId: delivered._id, partnerId: P1, status: 'delivered', direction: 'forward', createdAt: ist('2026-09-11T10:00:00'), endTime: ist('2026-09-11T12:00:00'), partnerEarnings: 45, partnerTip: 5 });
    const { default: WalletLedger } = await import('../models/WalletLedger.js');
    await WalletLedger.collection.insertOne({ _id: id(), transactionId: 'TX1', userId: buyer, type: 'REFUND', direction: 'credit', amount: 150, balanceBefore: 0, balanceAfter: 150, status: 'completed', referenceType: 'ORDER', referenceId: String(cancelled._id), createdAt: ist('2026-09-10T11:00:00') });
    return { delivered, open, cancelled };
  }

  test('each order shows the customer payment split into seller, delivery partner, commission, tax and admin earning', async () => {
    const { delivered, open, cancelled } = await seedOrders();
    const body = (await get(`orders?${SEPT}&limit=100`).expect(200)).body.data;
    const row = key => body.rows.find(r => r.id === String(key));
    expect(row(delivered._id)).toMatchObject({ orderNo: 'ORD-A', basis: 'posted', paidPaise: 101500, deliveryFeePaise: 3000, tipPaise: 500, sellers: ['Alpha Store', 'Beta Store'], riderName: 'Ravi Rider',
      sellerEarningPaise: 86936, commissionPaise: 9800, commissionGstPaise: 1764, tcsPaise: 500, tdsPaise: 1000, platformDiscountPaise: 2000, deliveryIncomePaise: 3000,
      riderEarningPaise: 4000, riderTipPaise: 500, adminEarningPaise: 9800 + 3000 - 4000 - 2000, productGstPaise: (60000 - 50847) + (40000 - 38095), discountPaise: 2000, customerPhone: '98••••••11' });
    expect(row(delivered._id).lines.map(l => [l.name, l.seller, l.commissionPaise, l.sellerNetPaise])).toEqual([['Rice 5kg', 'Alpha Store', 5800, 52256], ['Oil 1L', 'Beta Store', 4000, 34680]]);
    expect(row(open._id)).toMatchObject({ basis: 'expected', sellerEarningPaise: 17340, commissionPaise: 2000, commissionGstPaise: 360, riderEarningPaise: 2500, riderBasis: 'quoted', adminEarningPaise: 2000 + 2000 - 2500 });
    expect(row(cancelled._id)).toMatchObject({ basis: 'cancelled', paidPaise: 15000, refundsPaise: 15000, sellerEarningPaise: 0, commissionPaise: 0, riderEarningPaise: 0, adminEarningPaise: 0 });
    expect(body.totals).toMatchObject({ orders: 3, completedOrders: 1, cancelledOrders: 1, paidPaise: 138500, refundsPaise: 15000, sellerEarningPaise: 86936, riderEarningPaise: 4000, commissionPaise: 9800, adminEarningPaise: 6800 });

    expect((await get(`orders?${SEPT}&status=open`).expect(200)).body.data.rows.map(r => r.orderNo)).toEqual(['ORD-B']);
    expect((await get(`orders?${SEPT}&search=beta`).expect(200)).body.data.rows.map(r => r.orderNo).sort()).toEqual(['ORD-A', 'ORD-C']);
    expect((await get(`orders?${SEPT}&sort=admin&dir=desc`).expect(200)).body.data.rows.map(r => r.orderNo)).toEqual(['ORD-A', 'ORD-B', 'ORD-C']);
    await get(`orders?${SEPT}`, plain).expect(403);
    await get(`orders?${SEPT}&sort=bogus`).expect(400);

    const csv = await request(app).get(`/api/admin/reports/export?report=orders&${SEPT}`).set('Authorization', finance).expect(200);
    expect(csv.headers['content-disposition']).toMatch(/bulkimart-order-payments-2026-09-01-to-2026-09-30\.csv/);
    expect(csv.text).toMatch(/Admin earning \(INR\)/);
    expect(csv.text).toMatch(/"ORD-A".*1015,1000,20,30,5,0,110\.58,869\.36,40,98,17\.64,5,10,20,68,0,"posted"/);
  });
  test('orders without a usable checkout snapshot show an unavailable split instead of failing', async () => {
    await seed();
    const body = (await get(`orders?${SEPT}&limit=100`).expect(200)).body.data;
    const o2 = body.rows.find(r => r.orderNo === 'ORD-O2'), o3 = body.rows.find(r => r.orderNo === 'ORD-O3');
    expect(o2).toMatchObject({ basis: 'unavailable', sellerEarningPaise: null, adminEarningPaise: null, lines: [] });
    expect(o3).toMatchObject({ basis: 'cancelled', adminEarningPaise: 0 });
    expect(body.rows.some(r => r.orderNo === 'ORD-O5')).toBe(false); // unpaid online checkout
    expect(body.totals.incompleteOrders).toBeGreaterThan(0);
    // Orders without figures are left out; the totals still add up the rest instead of going blank.
    for (const key of ['sellerEarningPaise', 'riderEarningPaise', 'commissionPaise', 'adminEarningPaise']) expect(typeof body.totals[key]).toBe('number');
    expect(body.rows.find(r => r.orderNo === 'ORD-O4')).toMatchObject({ riderEarningPaise: null, riderBasis: 'not assigned' });
  });
});

