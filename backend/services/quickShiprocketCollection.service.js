import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import Snapshot from '../models/QuickCommerceFinancialSnapshot.js';
import Order from '../models/Order.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { razorpayAttempt, addRefundObligation } from './paymentObligations.service.js';
import { httpError } from '../utils/response.js';
import { shiprocketEnvironment } from '../config/shiprocketEnvironment.js';
import { courierObligationAccount } from './quickCommerceFinance.service.js';

// Called only after the shared Razorpay verifier/webhook has authenticated the
// provider signal. Seller collection never settles the customer's Payment.
export const settleQuickShiprocketCollection = async ({ payment, state, gatewayOrderId, gatewayPaymentId, amountPaise, currency }) => {
  if (state === 'PENDING') return { changed: false, status: payment.status };
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const fresh = await Payment.findById(payment._id).session(session);
      const snapshot = await Snapshot.findById(fresh.quickFeeSnapshotId).session(session);
      if (!snapshot || Math.round(snapshot.vendorDeliveryFeeObligation * 100) !== Math.round(fresh.amount * 100)) throw httpError(409, 'Seller fee does not reconcile with its immutable obligation');
      if (snapshot.paymentEnvironment !== process.env.RAZORPAY_MODE) throw httpError(409, 'Seller payment environment changed; provider reconciliation is required');
      const attempt = razorpayAttempt(fresh, gatewayOrderId);
      if (!gatewayPaymentId || amountPaise !== attempt.amountPaise || amountPaise !== Math.round(fresh.amount * 100) || currency !== 'INR') throw httpError(400, 'Seller fee payment mismatch');
      if (fresh.captures?.some(row => row.gatewayPaymentId === gatewayPaymentId && row.gatewayOrderId === gatewayOrderId)) { result = { changed: false, status: fresh.status }; return; }
      if (state !== 'COMPLETED') {
        // A failed attempt does not invalidate another captured payment.
        if (fresh.status !== 'paid') fresh.status = 'failed';
        await fresh.save({ session }); result = { changed: true, status: fresh.status }; return;
      }
      const order = await Order.findById(snapshot.orderId).session(session);
      const extra = ['paid', 'partial_refund', 'refunded'].includes(fresh.status) || order?.status !== 'preparing' || order?.fulfillment?.method === 'manual';
      fresh.captures.push({ gatewayOrderId, gatewayPaymentId, amountPaise, currency, disposition: extra ? 'refund_required' : 'settled', receivedAt: new Date() });
      if (extra) {
        addRefundObligation(fresh, { key: `QUICK_CAPTURE:${gatewayPaymentId}`, gatewayOrderId, gatewayPaymentId, amountPaise, reason: 'Additional capture or order no longer eligible for Quick Shiprocket; reconcile seller collection' });
      } else {
        fresh.status = 'paid'; fresh.paidAt = new Date();
        fresh.gateway = { ...fresh.gateway, provider: 'razorpay', orderId: gatewayOrderId, paymentId: gatewayPaymentId };
        await postLedgerEntry({ idempotencyKey: `QUICK_COLLECTION:${snapshot._id}`, sellerId: snapshot.sellerId, orderId: snapshot.orderId, snapshotId: snapshot._id,
          account: await courierObligationAccount(snapshot.orderId, session),
          type: 'quick_fee_payment', direction: 'credit', bucket: 'held', amount: fresh.amount, reference: gatewayPaymentId,
          description: 'Verified seller payment against Quick Shiprocket freight, service fee and tax' }, { session });
        await Order.updateOne({ _id: snapshot.orderId }, { $set: { 'fulfillment.chargeStatus': 'collected' } }, { session });
      }
      await fresh.save({ session }); result = { changed: true, status: fresh.status };
    });
  } finally { await session.endSession(); }
  return result;
};

export const requireVerifiedQuickCollection = async (order, sellerId) => {
  const snapshot = await Snapshot.findOne({ orderId: order._id, sellerId });
  if (snapshot && (snapshot.providerEnvironment !== shiprocketEnvironment().mode || snapshot.paymentEnvironment !== process.env.RAZORPAY_MODE)) throw httpError(409, 'Fee obligation belongs to another provider environment; use isolated test orders and reconcile before switching');
  const payment = snapshot && await Payment.findOne({ quickFeeSnapshotId: snapshot._id });
  if (snapshot?.quoteExpiresAt && snapshot.quoteExpiresAt < new Date()) throw httpError(409, 'Paid quote expired; platform reconciliation is required before shipment creation');
  if (!snapshot || !payment || payment.status !== 'paid' || payment.amount !== snapshot.vendorDeliveryFeeObligation || !payment.captures?.some(row => row.disposition === 'settled' && row.amountPaise === Math.round(snapshot.vendorDeliveryFeeObligation * 100) && row.currency === 'INR') || payment.refundObligations?.some(row => row.status !== 'failed')) throw httpError(409, 'Complete and verify the seller fee payment before creating a shipment');
  if (!await SellerLedgerEntry.exists({ idempotencyKey: `QUICK_COLLECTION:${snapshot._id}`, sellerId, amount: payment.amount, direction: 'credit', bucket: 'held' })) throw httpError(409, 'Seller collection has no matching ledger credit; reconciliation is required');
  return { snapshot, payment };
};
