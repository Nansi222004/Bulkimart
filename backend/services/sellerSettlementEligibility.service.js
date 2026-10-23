import Order from '../models/Order.js';
import Return from '../models/Return.js';
import { httpError } from '../utils/response.js';

export const assertSellerSettlementClear = async (sellerId, session) => {
  if (await Order.exists({ 'items.sellerId': sellerId, financialPosting: { $in: ['held','eligible'] }, status: { $in: ['returned','refunded','cancelled'] } }).session(session)) throw httpError(409, 'Terminal order adjustments require financial reconciliation');
  if (await Order.exists({ 'items.sellerId': sellerId, 'financialSnapshot.version': 2, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks seller settlement');
  // Order-item ownership is authoritative, including old Return documents
  // without the denormalized sellerId. Never reserve another seller's refund.
  const ownOrders = await Order.find({ 'items.sellerId': sellerId, 'financialSnapshot.version': 2 }).select('_id items._id items.sellerId financialSnapshot financialReturnQuantities').session(session).lean();
  const ownItems = ownOrders.flatMap(order => order.items.filter(item => String(item.sellerId) === String(sellerId)).map(item => item._id));
  const returns = await Return.find({ orderId: { $in: ownOrders.map(order => order._id) }, orderItemId: { $in: ownItems }, status: { $nin: ['REJECTED', 'CANCELLED'] } }).select('_id orderId').session(session);
  for (const ret of returns) {
    const order = ownOrders.find(order => String(order._id) === String(ret.orderId));
    if (order?.financialSnapshot && !order.financialReturnQuantities?.[`return_${ret._id}`]) throw httpError(409, 'Unreconciled returns block seller settlement');
  }
};
