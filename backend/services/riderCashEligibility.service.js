import Order from '../models/Order.js';
import { RIDER_COD_CASH_LIMIT } from '../shared/deliveryCash.mjs';

/**
 * COD cash each rider is holding that Bulkimart has not yet confirmed receiving.
 *
 * Counts what the rider recorded collecting, and also every COD order the rider
 * delivered without recording the cash at all — that cash is just as much in
 * their hands, so it is taken at the amount due (the order total rounded to the
 * rupee). Without the second part, skipping the cash record kept a rider's
 * payouts and COD cash limit open while they held the customer's money.
 */
export const riderCodCashBalances = async (partnerIds, { session = null } = {}) => {
  if (!partnerIds.length) return new Map();
  // Half-up to the rupee, matching codCashDuePaise (MongoDB's $round would round halves to even).
  const duePaise = { $multiply: [{ $floor: { $add: [{ $divide: ['$financialSnapshot.expectedPaise', 100] }, 0.5] } }, 100] };
  const holdingPaise = { $cond: [{ $gt: [{ $ifNull: ['$codFinance.collectedPaise', 0] }, 0] }, '$codFinance.collectedPaise', duePaise] };
  const query = Order.aggregate([
    { $match: { deliveryPartnerId: { $in: partnerIds }, paymentMethod: 'cod', 'financialSnapshot.version': 2,
      $or: [{ 'codFinance.collectedPaise': { $gt: 0 } }, { status: 'delivered', 'financialSnapshot.expectedPaise': { $gt: 0 } }] } },
    { $group: { _id: '$deliveryPartnerId', outstanding: { $sum: { $max: [0, { $subtract: [
      holdingPaise, { $add: [{ $ifNull: ['$codFinance.verifiedPaise', 0] }, { $ifNull: ['$codFinance.writtenOffPaise', 0] }] },
    ] }] } } } },
  ]);
  if (session) query.session(session);
  return new Map((await query).map(row => [String(row._id), row.outstanding]));
};

export const riderCashAllowsOrder = async (partnerId, order, options) => {
  if (order.paymentMethod !== 'cod') return true;
  const balances = await riderCodCashBalances([partnerId], options);
  return (balances.get(String(partnerId)) || 0) < RIDER_COD_CASH_LIMIT * 100;
};
