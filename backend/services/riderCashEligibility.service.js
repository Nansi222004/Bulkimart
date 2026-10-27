import Order from '../models/Order.js';
import { RIDER_COD_CASH_LIMIT } from '../shared/deliveryCash.mjs';

export const riderCodCashBalances = async (partnerIds, { session = null } = {}) => {
  if (!partnerIds.length) return new Map();
  const query = Order.aggregate([
    { $match: { deliveryPartnerId: { $in: partnerIds }, paymentMethod: 'cod', 'financialSnapshot.version': 2, 'codFinance.collectedPaise': { $gt: 0 } } },
    { $group: { _id: '$deliveryPartnerId', outstanding: { $sum: { $max: [0, { $subtract: [
      '$codFinance.collectedPaise', { $add: [{ $ifNull: ['$codFinance.verifiedPaise', 0] }, { $ifNull: ['$codFinance.writtenOffPaise', 0] }] },
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
