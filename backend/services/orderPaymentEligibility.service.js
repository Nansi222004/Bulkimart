import Payment from '../models/Payment.js';

export const paymentAllowsFulfilment = (order, payment) => order.paymentMethod === 'cod' || payment?.status === 'paid';
export async function orderPaymentReady(order) {
  if (order.paymentMethod === 'cod') return true;
  const payment = order.paymentId ? await Payment.findById(order.paymentId).select('status') : null;
  return paymentAllowsFulfilment(order, payment);
}
// Used before pagination/counting: unpaid online orders must not inflate the
// actionable seller queue. Admin/customer order monitoring stays unchanged.
export const eligiblePaymentStages = () => [
  { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id', as: '_eligibilityPayment' } },
  { $match: { $or: [{ paymentMethod: 'cod' }, { '_eligibilityPayment.status': 'paid' }] } },
  { $unset: '_eligibilityPayment' },
];

// Filter before counting/pagination, using the durable payment marker rather
// than a cancellation reason that a customer could also enter on a real order.
export const orderHistoryPaymentStages = () => [
  { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id',
    pipeline: [{ $project: { checkoutAbandonedAt: 1 } }], as: '_historyPayment' } },
  { $match: { '_historyPayment.checkoutAbandonedAt': null } },
  { $unset: '_historyPayment' },
];

// The seller's order history: an online order reaches the seller only once its
// payment was actually received, so a checkout the customer cancelled or that
// failed at the gateway never appears there as a "cancelled" order. COD orders
// and paid orders (including ones later refunded) still show.
export const sellerHistoryPaymentStages = () => [
  { $lookup: { from: 'payments', localField: 'paymentId', foreignField: '_id',
    pipeline: [{ $project: { checkoutAbandonedAt: 1, status: 1, paidAt: 1 } }], as: '_sellerPayment' } },
  { $match: { $or: [
    { paymentMethod: 'cod' },
    { $and: [
      { '_sellerPayment.checkoutAbandonedAt': null },
      { $or: [
        { '_sellerPayment.status': { $in: ['paid', 'partial_refund', 'refunded'] } },
        { '_sellerPayment.paidAt': { $ne: null } },
      ] },
    ] },
  ] } },
  { $unset: '_sellerPayment' },
];
