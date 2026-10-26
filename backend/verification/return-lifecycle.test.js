import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';

const notices = { notifyUser: jest.fn(async () => {}), notifySeller: jest.fn(async () => {}), notifyRider: jest.fn(async () => {}), notifyAllAdmins: jest.fn(async () => {}), NOTIFICATION_EVENT: new Proxy({}, { get: (_, key) => String(key) }) };
jest.unstable_mockModule('../services/notification.service.js', () => notices);
const transport = {
  prepareReverseClient: jest.fn(async () => 'sandbox'),
  checkServiceability: jest.fn(async () => ({ available: true })),
  createReverseOrder: jest.fn(async () => ({ order_id: 301, shipment_id: 401, status: 'RETURN PENDING' })),
  assignCourier: jest.fn(async () => ({ awb: 'AWB401', courier_name: 'Fixture reverse courier' })),
  schedulePickup: jest.fn(async () => ({ pickup_status: 1 })),
  findReverseOrders: jest.fn(async () => []), getReverseOrder: jest.fn(),
  trackReverseShipment: jest.fn(async () => ({ tracking_data: { shipment_status: 3, shipment_track: [{ shipment_id: 401, awb_code: 'AWB401', current_status: 'Pickup Scheduled' }] } })),
  cancelReverseOrder: jest.fn(async () => ({ message: 'Cancellation requested' })),
};
const shiprocketOriginal = await import('../services/shiprocket.service.js');
jest.unstable_mockModule('../services/shiprocket.service.js', () => ({ ...shiprocketOriginal, ...transport }));
const { createReturnRequest, transitionReturnStatus, processReturnRefund, markCodRefundSettled, getReturnEligibility } = await import('../services/return.service.js');
const { bookReturnCourier, applyReverseTracking, reconcileReturnCourier, cancelReturnCourier } = await import('../services/returnCourier.service.js');
const { arrangeReturnPickup, acceptReturnPickup, verifyReturnPickupOtp, markReturnDeliveredToSeller } = await import('../services/returnPickup.service.js');
const { returnHoldOpen } = await import('../services/returnHold.service.js');
const { recordMerchandiseDispute } = await import('../services/merchandiseDispute.service.js');
const { debitWallet } = await import('../services/wallet.service.js');
const { financialTransaction } = await import('../services/financeSafety.service.js');
const { verifyReturnCashEvidence } = await import('../services/refundFunding.service.js');
const { postOrderFinance, releaseOrderFinance, reverseRefundedReturn } = await import('../services/orderFinance.service.js');
const { saveCommissionVersion } = await import('../services/vendorCommission.service.js');
const { createSellerPayoutRequest } = await import('../services/sellerPayout.service.js');
const { sellerBalances } = await import('../services/sellerLedger.service.js');
const { saveFinancePolicy } = await import('../services/financePolicy.service.js');
const { trialBalance } = await import('../services/financeReports.service.js');
const { shiprocketWebhook } = await import('../controllers/fulfillment.controller.js');
const { errorHandler } = await import('../middlewares/error.middleware.js');
const { default: Return } = await import('../models/Return.js');
const { default: Order } = await import('../models/Order.js');
const { default: Payment } = await import('../models/Payment.js');
const { default: User } = await import('../models/User.js');
const { default: Admin } = await import('../models/Admin.js');
const { default: Seller } = await import('../models/Seller.js');
const { default: Product } = await import('../models/Product.js');
const { default: WalletLedger } = await import('../models/WalletLedger.js');
const { default: Ledger } = await import('../models/SellerLedgerEntry.js');
const { default: Delivery } = await import('../models/Delivery.js');
const { default: Partner } = await import('../models/DeliveryPartner.js');
const { default: CoinWallet } = await import('../models/CoinWallet.js');
const { default: CoinTransaction } = await import('../models/CoinTransaction.js');
const id = () => new mongoose.Types.ObjectId();
let db, user, seller, product, payment, order, adminId;
const app = express(); app.use(express.json()); app.post('/tracking', shiprocketWebhook); app.use(errorHandler);
beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ binary: { version: '7.0.14' }, replSet: { count: 1 } });
  await mongoose.connect(db.getUri());
  await Promise.all([Return.init(), WalletLedger.init(), Ledger.init(), CoinWallet.init(), CoinTransaction.init()]);
});
afterAll(async () => { await mongoose.disconnect(); await db?.stop(); });
beforeEach(async () => {
  for (const collection of Object.values(mongoose.connection.collections)) await collection.deleteMany({});
  jest.clearAllMocks();
  process.env.SHIPROCKET_MODE = 'sandbox'; process.env.SHIPROCKET_SANDBOX_CONFIRMED = 'true';
  process.env.SHIPROCKET_SANDBOX_BASE_URL = 'https://isolated.example.test'; process.env.SHIPROCKET_SANDBOX_EMAIL = 'fixture@example.test';
  process.env.SHIPROCKET_SANDBOX_PASSWORD = 'fixture'; process.env.SHIPROCKET_SANDBOX_WEBHOOK_SECRET = 'fixture-webhook';
  user = await User.create({ name: 'Customer', phone: '9876608001', email: 'customer@example.test', roles: ['buyer'], wallet: { balance: 0 } });
  seller = await Seller.collection.insertOne({ _id: id(), userId: user._id, status: 'approved', businessName: 'Fixture', storeDetails: { name: 'Fixture', address: 'Seller road', city: 'Delhi', state: 'Delhi', pincode: '110002', phone: '9876608002', email: 'seller@example.test', lat: 28.62, lng: 77.22 }, bankDetails: { upiId: 'fixture@test' } });
  seller = await Seller.findById(seller.insertedId);
  const productId = id(); await Product.collection.insertOne({ _id: productId, type: 'grocery', category: id(), stock: 5, weight: 500, dimensions: { length: 12, breadth: 10, height: 8 } }); product = await Product.findById(productId);
  adminId = id();
  await Admin.collection.insertOne({ _id: adminId, name: 'Fixture admin', email: 'admin@example.test', role: 'admin', isActive: true, permissions: ['manage_finance'] });
  await saveCommissionVersion({ vendorType: 'general', channel: 'quick', method: 'percentage', value: 10, base: 'eligible_item_subtotal', fixedScope: 'order_item', taxTreatment: 'exempt', taxRate: 0, effectiveDate: '2020-01-01', isActive: true, reason: 'Synthetic return verification' }, adminId);
  payment = await Payment.create({ userId: user._id, amount: 100, method: 'cod', status: 'paid' });
  order = await Order.create({ userId: user._id, type: 'grocery', status: 'delivered', paymentMethod: 'cod', paymentId: payment._id,
    shippingAddress: { name: 'Customer', line1: 'Customer road', city: 'Delhi', state: 'Delhi', pincode: '110001', phone: '9876608001', lat: 28.61, lng: 77.21 },
    pricing: { subtotal: 100, totalAmount: 100, discountRepresentation: 'components-v1' },
    items: [{ productId, sellerId: seller._id, type: 'grocery', name: 'Fixture item', price: 50, qty: 2, deliveredAt: new Date(), returnPolicy: { returnEligible: true, returnWindowDays: 7 }, returnEligibleUntil: new Date(Date.now() + 86400000) }] });
  payment.orderId = order._id; await payment.save();
});
const makeReturn = async (extra = {}) => Return.create({ orderId: order._id, orderItemId: order.items[0]._id, customerId: user._id, sellerId: seller._id, productId: product._id, unitPriceSnapshot: 50, productName: 'Fixture item', quantity: 1, reason: 'DAMAGED', status: 'APPROVED', ...extra });
const inspected = { status: 'RETURN_RECEIVED', receivedAt: new Date(), restockDecision: 'NON_RESTOCKABLE', restockStatus: 'NOT_RESTOCKED' };
const createInput = () => ({ orderId: order._id, orderItemId: order.items[0]._id, customerId: user._id, quantity: 1, reason: 'DAMAGED' });

describe('Return eligibility and quantities', () => {
  test('reserves concurrent partial quantities atomically and rejects excess', async () => {
    const results = await Promise.allSettled(Array.from({ length: 3 }, (_, n) => createReturnRequest({ ...createInput(), requestKey: `request-${n}` })));
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(2);
    expect((await Order.findById(order._id)).items[0].returnedQty).toBe(2);
    expect(await Return.countDocuments()).toBe(2);
  });
  test('same request key replays one return and rejects changed quantity', async () => {
    const first = await createReturnRequest({ ...createInput(), requestKey: 'one' });
    expect((await createReturnRequest({ ...createInput(), requestKey: 'one' }))._id).toEqual(first._id);
    await expect(createReturnRequest({ ...createInput(), quantity: 2, requestKey: 'one' })).rejects.toThrow(/different/);
    expect((await Order.findById(order._id)).items[0].returnedQty).toBe(1);
  });
  test('cancellation releases reservation once', async () => {
    const ret = await createReturnRequest(createInput());
    await transitionReturnStatus({ returnId: ret._id, toStatus: 'CANCELLED', adminId });
    await expect(transitionReturnStatus({ returnId: ret._id, toStatus: 'CANCELLED', adminId })).rejects.toThrow();
    expect((await Order.findById(order._id)).items[0].returnedQty).toBe(0);
  });
  test('an active courier cannot be bypassed by cancelling the return', async () => {
    const ret = await makeReturn(); await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    await expect(transitionReturnStatus({ returnId: ret._id, toStatus: 'CANCELLED', adminId })).rejects.toThrow(/pickup|Cannot move/);
    expect((await Return.findById(ret._id)).status).toBe('APPROVED');
  });
  test.each(['expired', 'undelivered', 'foreign', 'nonreturnable'])('%s return is rejected', async mode => {
    if (mode === 'expired') await Order.updateOne({ _id: order._id }, { $set: { 'items.0.returnEligibleUntil': new Date() } });
    if (mode === 'undelivered') await Order.updateOne({ _id: order._id }, { $set: { status: 'placed' } });
    if (mode === 'nonreturnable') await Order.updateOne({ _id: order._id }, { $set: { 'items.0.returnPolicy.returnEligible': false } });
    await expect(getReturnEligibility({ ...createInput(), ...(mode === 'foreign' ? { customerId: id() } : {}) })).rejects.toThrow();
  });
  test('receipt requires seller evidence and QC; stock changes once', async () => {
    const ret = await makeReturn({ status: 'AWAITING_RETURN' });
    await expect(transitionReturnStatus({ returnId: ret._id, toStatus: 'RETURN_RECEIVED', adminId, restockDecision: 'RESTOCKABLE' })).rejects.toThrow(/Seller receipt/);
    await Return.updateOne({ _id: ret._id }, { $set: { 'pickup.status': 'DELIVERED_TO_SELLER', 'pickup.sellerConfirmedReceivedAt': new Date() } });
    await expect(transitionReturnStatus({ returnId: ret._id, toStatus: 'RETURN_RECEIVED', adminId })).rejects.toThrow(/decision/);
    await transitionReturnStatus({ returnId: ret._id, toStatus: 'RETURN_RECEIVED', adminId, restockDecision: 'RESTOCKABLE' });
    expect((await Product.findById(product._id)).stock).toBe(6);
    await expect(transitionReturnStatus({ returnId: ret._id, toStatus: 'RETURN_RECEIVED', adminId, restockDecision: 'RESTOCKABLE' })).rejects.toThrow();
    expect((await Product.findById(product._id)).stock).toBe(6);
  });
});

describe('COD wallet', () => {
  test('concurrent refund credits once, evidence reconciles, and money is spendable', async () => {
    const ret = await makeReturn(inspected);
    const result = await Promise.allSettled([processReturnRefund({ returnId: ret._id, adminId }), processReturnRefund({ returnId: ret._id, adminId })]);
    expect(result.some(row => row.status === 'fulfilled')).toBe(true);
    await processReturnRefund({ returnId: ret._id, adminId });
    const fresh = await Return.findById(ret._id);
    expect(fresh).toMatchObject({ status: 'REFUNDED', refundDestination: 'wallet', refundAmount: 50 });
    expect((await User.findById(user._id)).wallet.balance).toBe(50);
    expect(await WalletLedger.countDocuments({ direction: 'credit' })).toBe(1);
    await financialTransaction(session => verifyReturnCashEvidence(payment, fresh, session));
    await financialTransaction(session => debitWallet({ userId: user._id, amount: 30, referenceId: 'future-order', idempotencyKey: 'future-purchase', session }));
    expect((await User.findById(user._id)).wallet.balance).toBe(20);
    await expect(markCodRefundSettled({ returnId: ret._id, adminId, note: 'cash paid' })).rejects.toThrow(/retired/);
  });
  test('coin restoration is separate and exactly once', async () => {
    const ret = await makeReturn({ ...inspected, refundBreakdown: { refundAmount: 45, allocatedCoinsCount: 5 }, refundAmount: 45 });
    await processReturnRefund({ returnId: ret._id, adminId }); await processReturnRefund({ returnId: ret._id, adminId });
    expect((await User.findById(user._id)).wallet.balance).toBe(45);
    expect((await CoinWallet.findOne({ userId: user._id })).availableCoins).toBe(5);
    expect(await CoinTransaction.countDocuments()).toBe(1);
  });
  test('crash after wallet credit recovers without incrementing payment totals twice', async () => {
    const ret = await makeReturn(inspected);
    await processReturnRefund({ returnId: ret._id, adminId });
    await Return.updateOne({ _id: ret._id }, { $set: { status: 'REFUND_PENDING', refundStatus: 'processing' }, $unset: { refundedAt: 1 } });
    await processReturnRefund({ returnId: ret._id, adminId });
    expect((await Payment.findById(payment._id)).refund.totalRefundedAmount).toBe(50);
    expect((await User.findById(user._id)).wallet.balance).toBe(50);
  });
  test.each(['inspection', 'historical', 'unpaid'])('%s blocks new credit', async mode => {
    const ret = await makeReturn({ ...inspected, ...(mode === 'inspection' ? { receivedAt: undefined } : {}), ...(mode === 'historical' ? { status: 'REFUND_PENDING', refundStatus: 'manual_pending', refundAmount: 50 } : {}) });
    if (mode === 'unpaid') await Payment.updateOne({ _id: payment._id }, { $set: { status: 'pending' } });
    await expect(processReturnRefund({ returnId: ret._id, adminId })).rejects.toThrow();
    expect(await WalletLedger.countDocuments()).toBe(0);
  });
});

describe('Shiprocket reverse pickup', () => {
  test('uses verified reverse API steps, real identifiers, no invented URL', async () => {
    const ret = await makeReturn();
    const booked = await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    expect(booked.reverseBooking).toMatchObject({ state: 'booked', orderId: '301', shipmentId: '401' });
    expect(booked.awbNumber).toBe('AWB401'); expect(booked.trackingUrl).toBeUndefined();
    expect(transport.createReverseOrder).toHaveBeenCalledWith(expect.objectContaining({ pickup_address: 'Customer road', shipping_address: 'Seller road', payment_method: 'PREPAID', weight: 0.5 }));
    expect(transport.assignCourier).toHaveBeenCalledWith(401, undefined, { isReturn: true });
    await bookReturnCourier({ returnId: ret._id, sellerId: seller._id }); expect(transport.createReverseOrder).toHaveBeenCalledTimes(1);
  });
  test('concurrent bookings dispatch once', async () => {
    const ret = await makeReturn();
    await Promise.allSettled([1, 2].map(() => bookReturnCourier({ returnId: ret._id, sellerId: seller._id })));
    expect(transport.createReverseOrder).toHaveBeenCalledTimes(1);
  });
  test('delivery webhook during scheduling cannot be overwritten by the scheduling response', async () => {
    const ret = await makeReturn();
    transport.schedulePickup.mockImplementationOnce(async () => {
      await applyReverseTracking({ shipmentId: 401, awb: 'AWB401', statusId: 7, environment: 'sandbox' });
      return { pickup_status: 1 };
    });
    const booked = await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    expect(booked.reverseBooking.trackingState).toBe('DELIVERED');
    expect(booked.reverseBooking.trackingRank).toBe(5);
  });
  test.each(['foreign', 'status', 'address', 'package', 'credentials', 'serviceability'])('%s prevents dispatch', async mode => {
    const ret = await makeReturn(mode === 'status' ? { status: 'RETURN_REQUESTED' } : {});
    if (mode === 'address') await Seller.updateOne({ _id: seller._id }, { $unset: { 'storeDetails.address': 1 } });
    if (mode === 'package') await Product.updateOne({ _id: product._id }, { $unset: { dimensions: 1 } });
    if (mode === 'credentials') transport.prepareReverseClient.mockRejectedValueOnce(new Error('Credentials missing'));
    if (mode === 'serviceability') transport.checkServiceability.mockResolvedValueOnce({ available: false });
    await expect(bookReturnCourier({ returnId: ret._id, sellerId: mode === 'foreign' ? id() : seller._id })).rejects.toThrow();
    expect(transport.createReverseOrder).not.toHaveBeenCalled();
  });
  test.each(['timeout', 'rejected', 'missing-id', 'awb-timeout', 'pickup-timeout'])('%s stays uncertain and never retries creation', async mode => {
    const ret = await makeReturn();
    if (['timeout', 'rejected'].includes(mode)) transport.createReverseOrder.mockRejectedValueOnce(new Error(mode));
    if (mode === 'missing-id') transport.createReverseOrder.mockResolvedValueOnce({ status: 'RETURN PENDING' });
    if (mode === 'awb-timeout') transport.assignCourier.mockRejectedValueOnce(new Error('timeout'));
    if (mode === 'pickup-timeout') transport.schedulePickup.mockRejectedValueOnce(new Error('timeout'));
    await expect(bookReturnCourier({ returnId: ret._id, sellerId: seller._id })).rejects.toThrow(/uncertain/);
    await expect(bookReturnCourier({ returnId: ret._id, sellerId: seller._id })).rejects.toThrow(/reconciled/);
    await expect(arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id })).rejects.toThrow(/existing courier/);
    expect(transport.createReverseOrder).toHaveBeenCalledTimes(1);
  });
  test('verified webhook deduplicates, resists out-of-order events, and does not bypass receipt', async () => {
    const ret = await makeReturn(); await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    const event = { is_return: 1, shipment_id: 401, awb: 'AWB401', shipment_status_id: 7, shipment_status: 'Delivered', event_id: 'delivery' };
    await request(app).post('/tracking').set('x-api-key', 'wrong').send(event).expect(401);
    await request(app).post('/tracking').set('x-api-key', 'fixture-webhook').send(event).expect(200);
    await request(app).post('/tracking').set('x-api-key', 'fixture-webhook').send(event).expect(200);
    await request(app).post('/tracking').set('x-api-key', 'fixture-webhook').send({ ...event, event_id: 'old', shipment_status_id: 18 }).expect(200);
    let fresh = await Return.findById(ret._id);
    expect(fresh.reverseBooking.trackingState).toBe('DELIVERED'); expect(fresh.reverseBooking.events).toHaveLength(1);
    expect(fresh.status).toBe('APPROVED'); expect(fresh.pickup.sellerConfirmedReceivedAt).toBeUndefined();
    await markReturnDeliveredToSeller({ returnId: ret._id, sellerId: seller._id });
    fresh = await Return.findById(ret._id); expect(fresh.pickup.status).toBe('DELIVERED_TO_SELLER');
    expect(await Ledger.countDocuments()).toBe(0);
  });
  test('wrong shipment AWB and environment cannot update a return', async () => {
    const ret = await makeReturn(); await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    await expect(applyReverseTracking({ shipmentId: 401, awb: 'OTHER', statusId: 7, environment: 'sandbox' })).rejects.toThrow(/identity/);
    expect(await applyReverseTracking({ shipmentId: 401, awb: 'AWB401', statusId: 7, environment: 'live' })).toMatchObject({ matched: false });
  });
  test('cancellation acknowledgment cannot authorize switching; confirmed cancellation can', async () => {
    const ret = await makeReturn(); await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    await cancelReturnCourier({ returnId: ret._id, sellerId: seller._id });
    await expect(arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id })).rejects.toThrow();
    await applyReverseTracking({ shipmentId: 401, awb: 'AWB401', statusId: 8, environment: 'sandbox' });
    expect((await Return.findById(ret._id)).reverseBooking.state).toBe('cancelled');
  });
  test('polling verifies shipment ownership without recreating pickup', async () => {
    const ret = await makeReturn(); await bookReturnCourier({ returnId: ret._id, sellerId: seller._id });
    await reconcileReturnCourier({ returnId: ret._id, sellerId: seller._id });
    expect(transport.createReverseOrder).toHaveBeenCalledTimes(1);
    expect(transport.trackReverseShipment).toHaveBeenCalledWith('401');
  });
});

describe('Manual delivery', () => {
  test('inter-city pickup never searches riders or invokes courier automatically', async () => {
    const ret = await makeReturn(); await Order.updateOne({ _id: order._id }, { $set: { 'shippingAddress.city': 'Mumbai' } });
    await expect(arrangeReturnPickup({ returnId: ret._id, sellerId: seller._id })).rejects.toThrow(/same city/);
    expect(transport.createReverseOrder).not.toHaveBeenCalled();
  });
  test('unoffered rider cannot claim a pickup', async () => {
    const rider = await Partner.create({ userId: user._id, status: 'approved' });
    const ret = await makeReturn({ pickupMethod: 'MANUAL' });
    await expect(acceptReturnPickup({ returnId: ret._id, partnerId: rider._id })).rejects.toThrow();
    expect((await Return.findById(ret._id)).pickup.partnerId).toBeUndefined();
  });
  test('OTP collection and seller receipt credit one earning with balanced Delivery cost journal', async () => {
    const rider = await Partner.create({ userId: user._id, status: 'approved', financialWorkflowVersion: 2 });
    const ret = await makeReturn({ pickupMethod: 'MANUAL', pickup: { partnerId: rider._id, status: 'ASSIGNED' } });
    const delivery = await Delivery.create({ orderId: order._id, returnId: ret._id, partnerId: rider._id, direction: 'return_pickup', status: 'assigned', otp: '1234', otpIssuedAt: new Date(), route: { distanceKm: 2 }, ratesUsed: { rateId: id(), mode: 'quick', base: 20, perKm: 10 } });
    await Return.updateOne({ _id: ret._id }, { $set: { 'pickup.deliveryId': delivery._id } });
    await expect(verifyReturnPickupOtp({ returnId: ret._id, partnerId: id(), otp: '1234' })).rejects.toThrow();
    await expect(verifyReturnPickupOtp({ returnId: ret._id, partnerId: rider._id, otp: '0000' })).rejects.toThrow(/Incorrect/);
    expect((await Delivery.findById(delivery._id)).otpAttempts).toBe(1);
    await verifyReturnPickupOtp({ returnId: ret._id, partnerId: rider._id, otp: '1234' });
    await Promise.all([1, 2].map(() => markReturnDeliveredToSeller({ returnId: ret._id, sellerId: seller._id })));
    expect(await Ledger.countDocuments({ type: 'delivery_earning' })).toBe(1);
    expect((await Partner.findById(rider._id)).earnings.pending).toBe(40);
    const today = new Date();
    const balance = await trialBalance({ from: `${today.getUTCFullYear()}-01-01`, to: `${today.getUTCFullYear()}-12-31` });
    expect(balance.balanced).toBe(true); expect(balance.rows.find(row => row.account === 'Delivery cost').debitPaise).toBe(4000);
  });
});

describe('Payout return windows', () => {
  test('expiry boundary, frozen missing deadline, zero days and non-returnable policies', () => {
    const now = new Date('2026-01-08');
    const item = { deliveredAt: new Date('2026-01-01'), returnPolicy: { returnEligible: true, returnWindowDays: 7 } };
    expect(returnHoldOpen(item, now)).toBe(false);
    expect(returnHoldOpen(item, new Date(now - 1))).toBe(true);
    expect(returnHoldOpen({ ...item, returnPolicy: { returnEligible: false }, returnEligibleUntil: new Date('2100-01-01') }, now)).toBe(false);
    expect(returnHoldOpen({ ...item, returnPolicy: { returnWindowDays: 0 } }, now)).toBe(false);
    expect(returnHoldOpen({ ...item, deliveredAt: null }, now)).toBe(true);
  });
  test('mixed order releases unrelated item once; pending return retains its own earning', async () => {
    // Build a new online order with two independently priced financial lines.
    const pay = await Payment.create({ userId: user._id, method: 'online', status: 'paid', amount: 100, gateway: { provider: 'razorpay' }, captures: [{ gatewayPaymentId: 'pay-mixed', gatewayOrderId: 'order-mixed', amountPaise: 10000, currency: 'INR', disposition: 'settled' }] });
    const mixed = await Order.create({ userId: user._id, type: 'grocery', status: 'delivered', paymentMethod: 'online', paymentId: pay._id, pricing: { subtotal: 100, totalAmount: 100 }, items: [
      { productId: product._id, sellerId: seller._id, name: 'Held', type: 'grocery', price: 50, qty: 1, deliveredAt: new Date(), returnPolicy: { returnEligible: true, returnWindowDays: 7 }, returnEligibleUntil: new Date(Date.now() + 86400000) },
      { productId: product._id, sellerId: seller._id, name: 'Available', type: 'grocery', price: 50, qty: 1, deliveredAt: new Date(), returnPolicy: { returnEligible: false, returnWindowDays: 0 } },
    ] }); pay.orderId = mixed._id; await pay.save();
    await postOrderFinance(mixed._id, adminId);
    await Return.create({ orderId: mixed._id, orderItemId: mixed.items[0]._id, customerId: user._id, sellerId: seller._id, productId: product._id, unitPriceSnapshot: 50, quantity: 1, reason: 'DAMAGED' });
    await releaseOrderFinance(mixed._id, adminId);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 45, eligible: 45 });
    await expect(releaseOrderFinance(mixed._id, adminId)).rejects.toThrow(/hold/);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 45, eligible: 45 });
    await expect(createSellerPayoutRequest({ sellerId: seller._id, userId: user._id, amount: 46, key: 'too-much' })).rejects.toThrow(/Insufficient/);
    const reserved = await Promise.allSettled(['one', 'two'].map(key => createSellerPayoutRequest({ sellerId: seller._id, userId: user._id, amount: 45, key })));
    expect(reserved.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(await sellerBalances(seller._id)).toMatchObject({ held: 45, eligible: 0, reserved: 45 });
  });
  test('verified merchandise disputes deduplicate and block release and payout', async () => {
    payment = await Payment.create({ userId: user._id, method: 'online', amount: 100, status: 'paid', gateway: { provider: 'razorpay' }, captures: [{ gatewayPaymentId: 'pay-disputed', gatewayOrderId: 'order-disputed', amountPaise: 10000, currency: 'INR', disposition: 'settled' }] });
    const funded = await Order.create({ userId: user._id, type: 'grocery', status: 'delivered', paymentMethod: 'online', paymentId: payment._id, pricing: { subtotal: 100, totalAmount: 100 }, items: [{ productId: product._id, sellerId: seller._id, name: 'Disputed item', type: 'grocery', price: 100, qty: 1, deliveredAt: new Date(), returnPolicy: { returnEligible: false, returnWindowDays: 0 } }] });
    payment.orderId = funded._id; await payment.save();
    await postOrderFinance(funded._id, adminId); await releaseOrderFinance(funded._id, adminId);
    const event = { event: 'payment.dispute.created', payload: { dispute: { entity: { id: 'disp-fixture', payment_id: 'pay-disputed' } } } };
    expect(await recordMerchandiseDispute(event)).toBe(true); expect(await recordMerchandiseDispute(event)).toBe(true);
    expect((await Payment.findById(payment._id)).merchandiseDisputes).toHaveLength(1);
    await expect(createSellerPayoutRequest({ sellerId: seller._id, userId: user._id, amount: 30, key: 'dispute' })).rejects.toThrow(/Disputed/);
    await recordMerchandiseDispute({ ...event, event: 'payment.dispute.closed' });
    expect((await Payment.findById(payment._id)).merchandiseSettlementHold).toBe(true);
  });
});
