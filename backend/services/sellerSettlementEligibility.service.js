import Order from '../models/Order.js';
import Return from '../models/Return.js';
import { httpError } from '../utils/response.js';

export const assertSellerSettlementClear = async (sellerId, session) => {
  if (await Order.exists({ 'items.sellerId': sellerId, financialPosting: { $in: ['held','eligible'] }, status: { $in: ['returned','refunded','cancelled'] } }).session(session)) throw httpError(409, 'Terminal order adjustments require financial reconciliation');
  if (await Order.exists({ 'items.sellerId': sellerId, 'financialSnapshot.version': 2, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks seller settlement');
  const returns = await Return.find({ sellerId, status: { $nin: ['REJECTED', 'CANCELLED'] } }).select('_id orderId').session(session);
  for (const ret of returns) {
    const order = await Order.findById(ret.orderId).select('financialSnapshot financialReturnQuantities').session(session);
    if (order?.financialSnapshot && !order.financialReturnQuantities?.[`return_${ret._id}`]) throw httpError(409, 'Unreconciled returns block seller settlement');
  }
};
