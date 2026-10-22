import DeliveryPartner from '../models/DeliveryPartner.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { requireFinanceOperation, financialTransaction } from './financeSafety.service.js';
import { moneyPaise } from './vendorCommission.service.js';
import { httpError } from '../utils/response.js';
import { DELIVERY_MIN_PAYOUT_AMOUNT } from '../constants/enums.js';
import Order from '../models/Order.js';
import { financeFlags } from './financeSafety.service.js';

export const riderFinancialSummary = async (partner) => {
  const flags = financeFlags();
  if (partner.financialWorkflowVersion !== 2) return { verifiedPayable: 0, reportedCodOutstanding: 0, payoutActionsEnabled: false, historicalCashIncluded: false };
  const rows = await SellerLedgerEntry.find({ partnerId: partner._id, account: 'rider_payable', bucket: 'eligible' }).select('direction amount').lean();
  const ledgerPayable = rows.reduce((sum, row) => sum + (row.direction === 'credit' ? 1 : -1) * moneyPaise(row.amount), 0) / 100;
  const cash = await Order.find({ deliveryPartnerId: partner._id, paymentMethod: 'cod', 'financialSnapshot.version': 2, 'codFinance.collectedPaise': { $gt: 0 } }).select('codFinance').lean();
  const outstanding = cash.reduce((sum, order) => sum + Math.max(0, order.codFinance.collectedPaise - (order.codFinance.verifiedPaise || 0)), 0) / 100;
  const verifiedPayable = Math.max(0, Math.min(ledgerPayable, partner.earnings?.pending || 0));
  return { verifiedPayable, reportedCodOutstanding: outstanding, historicalCashIncluded: false,
    payoutActionsEnabled: flags.payouts && flags.policyApproved && flags.testsApproved && verifiedPayable >= DELIVERY_MIN_PAYOUT_AMOUNT,
    balanceMismatch: ledgerPayable !== (partner.earnings?.pending || 0) };
};

export const requestVerifiedRiderPayout = async ({ partnerId, userId, amount, key }) => {
  requireFinanceOperation('payouts');
  const paise = moneyPaise(amount);
  if (amount < DELIVERY_MIN_PAYOUT_AMOUNT) throw httpError(400, `Minimum payout amount is ₹${DELIVERY_MIN_PAYOUT_AMOUNT}`);
  if (paise <= 0 || !/^[\w:.-]{8,100}$/.test(key || '')) throw httpError(400, 'Positive amount and an Idempotency-Key of 8–100 characters are required');
  return financialTransaction(async session => {
    const partner = await DeliveryPartner.findOneAndUpdate({ _id: partnerId, userId, status: 'approved' }, { $inc: { __v: 1 } }, { session, returnDocument: 'after' });
    if (!partner) throw httpError(404, 'Approved rider not found');
    const idempotencyKey = `RIDER:${partnerId}:${key}`;
    const existing = await DeliveryPayout.findOne({ idempotencyKey }).session(session);
    if (existing) {
      if (existing.amount !== amount) throw httpError(409, 'Payout key reused with a different amount');
      return { payout: existing, earnings: partner.earnings };
    }
    if (!partner.bankDetails?.upiId && !partner.bankDetails?.accountNo) throw httpError(400, 'Verified payout destination is required');
    if (await DeliveryPayout.exists({ partnerId, status: 'pending' }).session(session)) throw httpError(409, 'A payout request is already pending');
    if (await Order.exists({ deliveryPartnerId: partnerId, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks rider payout');
    const entries = await SellerLedgerEntry.find({ partnerId, account: 'rider_payable', bucket: 'eligible' }).session(session);
    const payable = entries.reduce((sum, row) => sum + (row.direction === 'credit' ? 1 : -1) * moneyPaise(row.amount), 0);
    if (paise > payable || paise > moneyPaise(partner.earnings.pending || 0)) throw httpError(409, 'Payout exceeds verified payable balance; legacy earnings require reconciliation');
    const [payout] = await DeliveryPayout.create([{ partnerId, userId, amount, status: 'pending', financeVersion: 2, idempotencyKey, payoutMethod: partner.bankDetails }], { session });
    for (const [bucket, direction] of [['eligible', 'debit'], ['reserved', 'credit']]) await postLedgerEntry({
      idempotencyKey: `RIDER_PAYOUT:${payout._id}:${bucket}`, partnerId, deliveryPayoutId: payout._id, account: 'rider_payable', type: 'payout_reservation',
      direction, bucket, amount, description: `Rider payout reservation ${payout._id}`, reference: String(payout._id),
      metadata: { source: 'order-finance-v2' },
    }, { session });
    await DeliveryPartner.updateOne({ _id: partnerId }, { $inc: { 'earnings.pending': -amount, 'earnings.reserved': amount } }, { session });
    return { payout, earnings: { ...partner.earnings.toObject?.() || partner.earnings, pending: partner.earnings.pending - amount } };
  });
};

export const resolveVerifiedRiderPayout = async ({ payoutId, actorId, complete, input }) => {
  requireFinanceOperation('payouts');
  const reference = String(input.transactionRef || '').trim();
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000 || complete && (input.verified !== true || reference.length < 4 || reference.length > 200)) throw httpError(400, 'Verified transfer reference and reconciliation reason are required to mark paid');
  return financialTransaction(async session => {
    const payout = await DeliveryPayout.findById(payoutId).session(session);
    if (!payout || payout.financeVersion !== 2) throw httpError(409, 'Legacy payout requires separate reconciliation; no verified reservation');
    const target = complete ? 'completed' : 'rejected';
    if (payout.status === target) {
      if (complete && payout.transactionRef !== reference) throw httpError(409, 'Payout was completed with a different reference');
      return payout;
    }
    if (payout.status !== 'pending') throw httpError(409, 'Payout is already resolved');
    // Mutate the claim and counters in one transaction; conflicting resolutions retry.
    payout.status = target; payout.processedAt = new Date(); payout.processedBy = actorId;
    payout.transactionRef = complete ? reference : undefined;
    payout.reconciliationReason = reason; payout.rejectionReason = complete ? undefined : reason;
    await payout.save({ session });
    const reservation = await SellerLedgerEntry.findOne({ idempotencyKey: `RIDER_PAYOUT:${payout._id}:reserved`, amount: payout.amount, partnerId: payout.partnerId, account: 'rider_payable' }).session(session);
    if (!reservation) throw httpError(409, 'Matching payout reservation is missing');
    const updated = await DeliveryPartner.updateOne({ _id: payout.partnerId, 'earnings.reserved': { $gte: payout.amount } },
      { $inc: { 'earnings.reserved': -payout.amount, [complete ? 'earnings.paid' : 'earnings.pending']: payout.amount } }, { session });
    if (!updated.modifiedCount) throw httpError(409, 'Reserved balance mismatch');
    if (complete && await Order.exists({ deliveryPartnerId: payout.partnerId, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks rider payout completion');
    for (const [bucket, direction] of [['reserved', 'debit'], [complete ? 'settled' : 'eligible', 'credit']]) await postLedgerEntry({
      idempotencyKey: `RIDER_PAYOUT:${payout._id}:RESOLVE:${bucket}`, partnerId: payout.partnerId, deliveryPayoutId: payout._id, account: 'rider_payable',
      type: 'payout_settlement', direction, bucket, amount: payout.amount, reference,
      description: `Rider payout ${target}: ${reason}`, postedBy: actorId, postedByRole: 'admin', metadata: { source: 'order-finance-v2', payoutId: String(payout._id) },
    }, { session });
    return payout;
  });
};
