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
