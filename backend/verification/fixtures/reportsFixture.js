import mongoose from 'mongoose';
import User from '../../models/User.js';
import Seller from '../../models/Seller.js';
import Order from '../../models/Order.js';
import Payment from '../../models/Payment.js';
import Return from '../../models/Return.js';
import Ledger from '../../models/SellerLedgerEntry.js';
import SellerPayout from '../../models/SellerPayout.js';
import Delivery from '../../models/Delivery.js';
import DeliveryPartner from '../../models/DeliveryPartner.js';

// September 2026 reports fixture shared by the API tests and the browser check.
// Covers multi-vendor orders, an abandoned checkout, a cancellation, both IST day
// boundaries, completed/pending/duplicate refunds, commission and earning
// reversals, a held→eligible release pair, payouts and verified/outstanding COD.
export const ist = text => new Date(`${text}+05:30`);
const id = () => new mongoose.Types.ObjectId();
export async function seedReports() {
  let ids;

  ids = Object.fromEntries(['buyerA', 'buyerB', 'riderUser', 'S1', 'S2', 'S3', 'P1', 'P2', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'pay1', 'pay5'].map(key => [key, id()]));
  const item = (seller, price, qty) => ({ _id: id(), productId: id(), sellerId: ids[seller], name: `${seller} product`, price, qty });
  await User.collection.insertMany([
    { _id: ids.buyerA, name: 'Asha Buyer', phone: '9876501111', roles: ['buyer'], isActive: true, createdAt: ist('2026-09-05T10:00:00') },
    { _id: ids.buyerB, name: '=HYPERLINK("http://x"), "Bala"', phone: '9876502222', roles: ['buyer'], isActive: true, createdAt: ist('2026-08-01T10:00:00') },
    { _id: ids.riderUser, name: 'Ravi Rider', phone: '9876503333', roles: ['delivery'], isActive: true, createdAt: ist('2026-08-01T10:00:00') },
  ]);
  await Seller.collection.insertMany([
    { _id: ids.S1, userId: id(), businessName: 'Alpha Store', status: 'approved' }, { _id: ids.S2, userId: id(), businessName: 'Beta Store', status: 'approved' },
    { _id: ids.S3, userId: id(), businessName: 'Gamma Store', status: 'pending' },
  ]);
  await Payment.collection.insertMany([
    { _id: ids.pay1, userId: ids.buyerA, orderId: ids.O1, method: 'online', status: 'paid', amount: 1000,
      captures: [{ gatewayPaymentId: 'pay_1', gatewayOrderId: 'go_1', amountPaise: 100000, currency: 'INR', disposition: 'settled', receivedAt: ist('2026-09-10T10:01:00') }],
      // The same provider refund recorded twice must count once.
      refundObligations: [{ _id: id(), providerRefundId: 'rf_cancel', gatewayPaymentId: 'pay_1', amountPaise: 10000, currency: 'INR', status: 'processed', verifiedAt: ist('2026-09-25T09:00:00') },
        { _id: id(), providerRefundId: 'rf_cancel', gatewayPaymentId: 'pay_1', amountPaise: 10000, currency: 'INR', status: 'processed', verifiedAt: ist('2026-09-25T09:00:00') }] },
    { _id: ids.pay5, userId: ids.buyerB, orderId: ids.O5, method: 'online', status: 'pending', amount: 999 },
  ]);
  const base = (key, user, created, extra) => ({ _id: ids[key], orderNo: `ORD-${key}`, userId: ids[user], type: 'ecommerce', createdAt: ist(created), updatedAt: ist(created), paymentMethod: 'cod', ...extra });
  await Order.collection.insertMany([
    base('O1', 'buyerA', '2026-09-10T10:00:00', { paymentMethod: 'online', paymentId: ids.pay1, status: 'delivered', timeline: [{ status: 'delivered', timestamp: ist('2026-09-11T12:00:00') }],
      items: [item('S1', 300, 2), item('S2', 350, 1)], pricing: { totalAmount: 1000 } }),
    base('O2', 'buyerA', '2026-09-12T08:00:00', { status: 'delivered', timeline: [{ status: 'delivered', timestamp: ist('2026-09-30T23:59:59') }], items: [item('S1', 500, 1)], pricing: { totalAmount: 500 },
      deliveryPartnerId: ids.P1, financialSnapshot: { version: 2 }, codFinance: { status: 'verified', collectedPaise: 50000, collectedAt: ist('2026-09-12T09:00:00'), verifiedPaise: 50000, events: [{ action: 'verify', at: ist('2026-09-13T10:00:00') }] } }),
    base('O3', 'buyerB', '2026-09-15T08:00:00', { status: 'cancelled', items: [item('S2', 200, 1)], pricing: { totalAmount: 200 } }),
    base('O4', 'buyerB', '2026-09-30T23:59:00', { status: 'placed', items: [item('S1', 300, 1)], pricing: { totalAmount: 300 } }),
    base('O5', 'buyerB', '2026-09-20T08:00:00', { paymentMethod: 'online', paymentId: ids.pay5, status: 'placed', items: [item('S1', 999, 1)], pricing: { totalAmount: 999 } }),
    base('O6', 'buyerA', '2026-08-25T08:00:00', { status: 'delivered', timeline: [{ status: 'delivered', timestamp: ist('2026-10-01T00:00:00') }], items: [item('S2', 700, 1)], pricing: { totalAmount: 700 },
      deliveryPartnerId: ids.P1, financialSnapshot: { version: 2 }, codFinance: { status: 'collected', collectedPaise: 70000, collectedAt: ist('2026-10-01T00:00:00') } }),
    base('O7', 'buyerB', '2026-08-31T23:59:59', { status: 'placed', items: [item('S1', 100, 1)], pricing: { totalAmount: 100 } }),
  ]);
  await Return.collection.insertMany([
    { _id: id(), returnNumber: 'RET-1', orderId: ids.O1, orderItemId: id(), customerId: ids.buyerA, sellerId: ids.S1, productId: id(), unitPriceSnapshot: 300, quantity: 1, reason: 'DAMAGED', status: 'REFUNDED', refundAmount: 300, refundedAt: ist('2026-09-20T10:00:00') },
    { _id: id(), returnNumber: 'RET-2', orderId: ids.O2, orderItemId: id(), customerId: ids.buyerA, sellerId: ids.S1, productId: id(), unitPriceSnapshot: 50, quantity: 1, reason: 'DAMAGED', status: 'REFUND_PENDING', refundAmount: 50 },
  ]);
  let n = 0;
  const ledger = (seller, account, type, direction, amount, extra = {}) => ({ _id: id(), entryNo: `E${++n}`, idempotencyKey: `K${n}`, sellerId: ids[seller], orderId: ids.O1, account, type, direction, bucket: 'held',
    amount, currency: 'INR', status: 'posted', description: 'fixture', metadata: { source: 'order-finance-v2' }, createdAt: ist('2026-09-11T12:05:00'), ...extra });
  await Ledger.collection.insertMany([
    ledger('S1', 'commission_revenue', 'platform_commission', 'credit', 60), ledger('S2', 'commission_revenue', 'platform_commission', 'credit', 35),
    ledger('S1', 'commission_revenue', 'reversal', 'debit', 10, { createdAt: ist('2026-09-20T10:00:00') }),
    ledger('S1', 'seller_payable', 'order_earning', 'credit', 540), ledger('S2', 'seller_payable', 'order_earning', 'credit', 315),
    ledger('S1', 'seller_payable', 'reversal', 'debit', 270, { createdAt: ist('2026-09-20T10:00:00') }),
    // A held→eligible release is a pair of adjustments and must net to zero.
    ledger('S1', 'seller_payable', 'adjustment', 'debit', 540), ledger('S1', 'seller_payable', 'adjustment', 'credit', 540, { bucket: 'eligible' }),
    ledger('S1', 'commission_revenue', 'platform_commission', 'credit', 999, { createdAt: ist('2026-10-01T00:00:00') }),
  ]);
  await SellerPayout.collection.insertMany([
    { _id: id(), payoutNo: 'PO-1', sellerId: ids.S1, amount: 200, status: 'APPROVED', processedAt: ist('2026-09-28T10:00:00'), requestedAt: ist('2026-09-27T10:00:00') },
    { _id: id(), payoutNo: 'PO-2', sellerId: ids.S2, amount: 100, status: 'PENDING', requestedAt: ist('2026-09-29T10:00:00') },
  ]);
  await DeliveryPartner.collection.insertMany([{ _id: ids.P1, userId: ids.riderUser, vehicleType: 'bike', status: 'approved' }, { _id: ids.P2, userId: id(), vehicleType: 'car', status: 'pending' }]);
  await Delivery.collection.insertMany([
    { _id: id(), orderId: ids.O1, partnerId: ids.P1, status: 'delivered', createdAt: ist('2026-09-11T10:00:00'), startTime: ist('2026-09-11T11:30:00'), endTime: ist('2026-09-11T12:00:00'), partnerEarnings: 40 },
    { _id: id(), orderId: ids.O2, partnerId: ids.P1, status: 'failed', createdAt: ist('2026-09-12T10:00:00'), endTime: ist('2026-09-12T11:00:00') },
    { _id: id(), orderId: ids.O4, partnerId: ids.P1, status: 'rejected', createdAt: ist('2026-09-14T10:00:00') },
    { _id: id(), orderId: ids.O6, partnerId: ids.P1, status: 'delivered', createdAt: ist('2026-08-20T10:00:00'), endTime: ist('2026-08-20T11:00:00'), partnerEarnings: 99 },
  ]);

  return ids;
}
