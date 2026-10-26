import Payment from '../models/Payment.js';
import Order from '../models/Order.js';
import Seller from '../models/Seller.js';
import { financialTransaction } from './financeSafety.service.js';
import { httpError } from '../utils/response.js';

// Called only after webhook signature verification. Disputes need a reviewed
// recovery decision; a late 'closed' event must never silently free earnings.
export const recordMerchandiseDispute = async body => {
  if (!String(body.event || '').startsWith('payment.dispute.')) return false;
  const dispute = body.payload?.dispute?.entity;
  if (!dispute?.id || !dispute.payment_id) throw httpError(400, 'Dispute identity required');
  return financialTransaction(async session => {
    const payment = await Payment.findOne({ 'gateway.provider': 'razorpay', captures: { $elemMatch: { gatewayPaymentId: dispute.payment_id, disposition: 'settled' } }, serviceApplicationId: { $exists: false }, parcelDeliveryId: { $exists: false }, gstAssistanceRequestId: { $exists: false }, advertising: { $exists: false } }).session(session);
    if (!payment) return false;
    if (payment.merchandiseDisputes.some(row => row.providerId === dispute.id && row.event === body.event)) return true;
    payment.merchandiseDisputes.push({ providerId: dispute.id, gatewayPaymentId: dispute.payment_id, event: body.event, receivedAt: new Date() });
    payment.merchandiseSettlementHold = true;
    payment.settlementRevision += 1;
    const orders = await Order.find({ paymentId: payment._id }).select('items.sellerId').session(session);
    const sellers = [...new Set(orders.flatMap(order => order.items.map(item => String(item.sellerId)).filter(value => value !== 'undefined')))];
    await Seller.updateMany({ _id: { $in: sellers } }, { $inc: { financialLedgerVersion: 1 } }, { session });
    await payment.save({ session });
    return true;
  });
};
