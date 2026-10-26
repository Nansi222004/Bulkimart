import Order from '../models/Order.js';
import Return from '../models/Return.js';
import { httpError } from '../utils/response.js';
import Ledger from '../models/SellerLedgerEntry.js';
import { returnHoldOpen } from './returnHold.service.js';
import Payment from '../models/Payment.js';

export const assertSellerSettlementClear = async (sellerId, session) => {
  if (await Order.exists({ 'items.sellerId': sellerId, financialPosting: { $in: ['held','eligible'] }, status: { $in: ['returned','refunded','cancelled'] } }).session(session)) throw httpError(409, 'Terminal order adjustments require financial reconciliation');
  if (await Order.exists({ 'items.sellerId': sellerId, 'financialSnapshot.version': 2, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks seller settlement');
  // Order-item ownership is authoritative, including old Return documents
  // without the denormalized sellerId. Never reserve another seller's refund.
  const ownOrders = await Order.find({ 'items.sellerId': sellerId }).select('_id items financialSnapshot financialReturnQuantities').session(session).lean();
  const released = await Ledger.find({ sellerId, account: 'seller_payable', bucket: 'eligible', direction: 'credit', idempotencyKey: /:RELEASE:eligible$/ }).session(session).lean();
  const originals = await Ledger.find({ _id: { $in: released.map(row => row.metadata?.originalEntryId).filter(Boolean) } }).session(session).lean();
  const releasedOrders = await Order.find({ _id: { $in: originals.map(row => row.orderId) } }).select('paymentId').session(session);
  if (await Payment.exists({ _id: { $in: releasedOrders.map(row => row.paymentId) }, merchandiseSettlementHold: true }).session(session)) throw httpError(409, 'Disputed released earnings require financial reconciliation');
  const isReleased = (orderId, itemId) => originals.some(row => String(row.orderId) === String(orderId) && row.metadata?.itemId === String(itemId));
  for (const order of ownOrders) for (const item of order.items) {
    if (String(item.sellerId) === String(sellerId) && isReleased(order._id, item._id) && returnHoldOpen(item)) throw httpError(409, 'Released earnings have an open return hold; reconciliation required');
  }
  const ownItems = ownOrders.flatMap(order => order.items.filter(item => String(item.sellerId) === String(sellerId)).map(item => item._id));
  const returns = await Return.find({ orderId: { $in: ownOrders.map(order => order._id) }, orderItemId: { $in: ownItems }, status: { $nin: ['REJECTED', 'CANCELLED'] } }).select('_id orderId orderItemId').session(session);
  for (const ret of returns) {
    const order = ownOrders.find(order => String(order._id) === String(ret.orderId));
    if (!order?.financialReturnQuantities?.[`return_${ret._id}`] && isReleased(ret.orderId, ret.orderItemId)) throw httpError(409, 'Unreconciled returns on released earnings block seller settlement');
  }
};
