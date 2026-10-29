import Order from '../models/Order.js';

// Delivered item sales that have not produced a seller earning entry. Gross
// sales explain the missing coverage; they never become a withdrawable amount.
export async function sellerPayoutCoverage(sellerIds) {
  const rows = await Order.aggregate([
    { $match: { status: 'delivered', financialPosting: { $nin: ['held', 'eligible', 'reversed'] }, ...(sellerIds ? { 'items.sellerId': { $in: sellerIds } } : {}) } },
    { $unwind: '$items' },
    { $match: { 'items.sellerId': sellerIds ? { $in: sellerIds } : { $exists: true } } },
    { $lookup: { from: 'seller_ledger_entries', let: { order: '$_id', seller: '$items.sellerId', item: { $toString: '$items._id' } }, pipeline: [
      { $match: { $expr: { $and: [{ $eq: ['$orderId', '$$order'] }, { $eq: ['$sellerId', '$$seller'] }, { $eq: ['$account', 'seller_payable'] },
        { $or: [{ $eq: ['$type', 'order_earning'] }, { $eq: ['$metadata.source', 'historical-reviewed-v1'] }] },
        { $eq: ['$metadata.itemId', '$$item'] }] } } }, { $limit: 1 }, { $project: { _id: 1 } },
    ], as: 'earning' } },
    { $match: { earning: { $size: 0 } } },
    { $project: { sellerId: '$items.sellerId', grossPaise: { $round: [{ $multiply: ['$items.price', '$items.qty', 100] }, 0] },
      reason: { $switch: { branches: [
        { case: { $ne: [{ $ifNull: ['$financialSnapshot.version', 0] }, 2] }, then: 'original_terms_missing' },
        { case: { $ne: ['$financialSnapshot.state', 'configured'] }, then: 'commission_terms_missing' },
        { case: { $and: [{ $eq: ['$paymentMethod', 'cod'] }, { $not: [{ $in: ['$codFinance.status', ['verified', 'allocated']] }] }] }, then: 'cod_confirmation_pending' },
        { case: { $ne: [{ $ifNull: ['$financeAutomation.lastError', null] }, null] }, then: 'processing_review_required' },
      ], default: 'payment_or_posting_pending' } } } },
    { $group: { _id: { sellerId: '$sellerId', reason: '$reason', orderId: '$_id' }, grossPaise: { $sum: '$grossPaise' } } },
  ]);
  const sellers = new Map();
  for (const row of rows) {
    const key = String(row._id.sellerId);
    if (!sellers.has(key)) sellers.set(key, { sellerId: row._id.sellerId, orders: new Set(), grossPaise: 0, reasons: {} });
    const seller = sellers.get(key); seller.orders.add(String(row._id.orderId)); seller.grossPaise += row.grossPaise;
    const issue = seller.reasons[row._id.reason] ||= { code: row._id.reason, orderCount: 0, grossPaise: 0 };
    issue.orderCount++; issue.grossPaise += row.grossPaise;
  }
  return [...sellers.values()].map(({ orders, reasons, ...seller }) => ({ ...seller, orderCount: orders.size, reasons: Object.values(reasons) }));
}
