import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Return from '../models/Return.js';
import Ledger from '../models/SellerLedgerEntry.js';
import Partner from '../models/DeliveryPartner.js';

const cents = value => Math.round(Number(value || 0) * 100);
export const financialReconciliation = async ({ page = 1, limit = 50 } = {}) => {
  const filter = { 'financialSnapshot.version': 2 };
  const [orders, total, negative, duplicateKeys] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
    Ledger.aggregate([{ $group: { _id: { sellerId: '$sellerId', partnerId: '$partnerId', providerId: '$providerId', account: { $ifNull: ['$account', 'seller_payable'] }, bucket: '$bucket' },
      amount: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
      { $match: { amount: { $lt: -0.005 } } }, { $limit: 100 }]),
    Ledger.aggregate([{ $group: { _id: '$idempotencyKey', count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 100 }]),
  ]);
  const exceptions = [];
  for (const order of orders) {
    const snapshot = order.financialSnapshot;
    const issue = (code, detail) => exceptions.push({ orderId: order._id, orderNo: order.orderNo, code, detail });
    const [entries, payment, returns] = await Promise.all([
      Ledger.find({ orderId: order._id }).lean(), Payment.findById(order.paymentId).lean(),
      Return.find({ orderId: order._id, status: { $nin: ['REJECTED', 'CANCELLED'] } }).select('_id status').lean(),
    ]);
    if (snapshot.state === 'held_discount_policy') issue('discount_funding_policy_missing', 'Discount sponsor allocation is not approved; no seller deduction is assumed');
    else if (snapshot.state !== 'configured') issue('commission_rule_missing', 'No historical recalculation is permitted');
    if (Object.values(snapshot.components).reduce((a,b) => a+b,0) !== snapshot.expectedPaise) issue('order_total_mismatch', 'Frozen components differ from expected payment');
    if (!payment) issue('payment_missing', 'Linked customer payment is missing');
    if (payment?.merchandiseSettlementHold) issue('payment_disputed', 'Provider dispute requires reviewed recovery before settlement');
    if (order.status === 'delivered' && !order.financialPosting) issue('allocation_missing', 'Delivered order has no merchandise allocation');
    if (order.paymentMethod === 'cod') {
      if (['cancelled','returned','refunded'].includes(order.status) && order.codFinance?.collectedPaise) issue('terminal_order_cash_review', 'Cash custody and customer refund require separate reconciliation');
      if (!['verified', 'allocated'].includes(order.codFinance?.status)) issue('cod_unverified', 'Cash remains unavailable for settlement');
      const cash = entries.filter(row => row.account === 'cod_custody').reduce((sum,row) => sum + (row.direction === 'credit' ? 1 : -1) * cents(row.amount),0);
      const expectedCustody = Math.max(0, (order.codFinance?.collectedPaise || 0) - Math.min(snapshot.expectedPaise, order.codFinance?.verifiedPaise || 0) - (order.codFinance?.writtenOffCustodyPaise || 0));
      if (cash !== expectedCustody) issue('cod_custody_mismatch', `Ledger ${cash} paise; expected custody ${expectedCustody} paise`);
      if (order.codFinance?.status === 'discrepancy') issue('cash_discrepancy', `Shortage ${order.codFinance.shortagePaise} paise; excess ${order.codFinance.excessPaise} paise`);
      if (order.codFinance?.status === 'disputed') issue('cash_disputed', 'Cash receipt is under investigation; settlement is blocked');
    } else if (order.financialPosting && payment?.status !== 'paid' && !returns.length) issue('payment_settlement_mismatch', 'Allocated order lacks paid customer payment');
    if (order.financialPosting) for (const line of snapshot.lines) {
      for (const [account, type, expected] of [['seller_payable','order_earning',line.netPaise],['commission_revenue','platform_commission',line.commissionPaise],['tax_liability','commission_tax',line.taxPaise],
        ['tcs_liability','tcs_deduction',line.tcsPaise || 0],['tds_liability','tds_deduction',line.tdsPaise || 0],['platform_discount_expense','platform_discount',snapshot.discountFunding === 'platform' ? line.platformDiscountPaise || 0 : 0]]) {
        const actual = entries.filter(row => row.account === account && row.type === type && row.direction === 'credit' && row.metadata?.itemId === line.itemId).reduce((sum,row) => sum + cents(row.amount),0);
        if (actual !== expected) issue('merchandise_posting_mismatch', `${line.itemId}: ${account} ${actual} paise; expected ${expected} paise`);
      }
    }
    for (const ret of returns) if (!order.financialReturnQuantities?.[`return_${ret._id}`]) issue('return_reconciliation_required', `${ret._id}: ${ret.status}`);
  }
  const partners = await Partner.find({ financialWorkflowVersion: 2 }).select('_id earnings').limit(100).lean();
  for (const partner of partners) {
    const entries = await Ledger.find({ partnerId: partner._id, account: 'rider_payable' }).lean();
    for (const [bucket, counter] of [['held','held'],['eligible','pending'],['reserved','reserved'],['settled','paid']]) {
      const ledger = entries.filter(row=>row.bucket===bucket).reduce((sum,row)=>sum+(row.direction==='credit'?1:-1)*cents(row.amount),0);
      const persisted = cents(partner.earnings?.[counter]);
      if (ledger !== persisted) exceptions.push({ partnerId: partner._id, code: 'rider_balance_mismatch', detail: `${bucket}: ledger ${ledger} paise; counter ${persisted} paise. Historical amounts require separate reconciliation.` });
    }
  }
  return { exceptions, negativeBalances: negative, duplicateEventKeys: duplicateKeys,
    coverage: { page, limit, totalOrders: total, ordersChecked: orders.length, ridersChecked: partners.length, maxRiders: 100, maxNegativeBalances: 100, maxDuplicateKeys: 100, historicalOrdersIncluded: false } };
};
