import DeliveryPartner from '../models/DeliveryPartner.js';
import DeliveryPayout from '../models/DeliveryPayout.js';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { requireFinanceOperation, financialTransaction } from './financeSafety.service.js';
import { moneyPaise } from './vendorCommission.service.js';
import { httpError } from '../utils/response.js';
import Order from '../models/Order.js';
import { financeFlags } from './financeSafety.service.js';
import { getFinancePolicy } from './financePolicy.service.js';
import { riderCodCashBalances } from './riderCashEligibility.service.js';
import { NOTIFICATION_EVENT, notifyRider } from './notification.service.js';

// COD cash the rider has collected but Bulkimart has not yet received. It is
// customer money in the rider's hands, so no earnings are paid out against it.
/**
 * A rider's money, read only from the ledger: the single source for every
 * payout decision and every balance shown. `DeliveryPartner.earnings` is kept
 * as a mirror for older screens (and holds pre-ledger history), but nothing
 * decides on it.
 */
export const riderLedgerBalances = async (partnerId, { session = null } = {}) => {
  const query = SellerLedgerEntry.find({ partnerId, account: 'rider_payable' }).select('direction amount bucket').lean();
  if (session) query.session(session);
  const paise = { held: 0, eligible: 0, reserved: 0, settled: 0 };
  for (const row of await query) if (row.bucket in paise) paise[row.bucket] += (row.direction === 'credit' ? 1 : -1) * moneyPaise(row.amount);
  return paise;
};

export const riderFinancialSummary = async (partner) => {
  const flags = financeFlags();
  const { riderMinPayout, payoutSchedule, payoutWeekday } = await getFinancePolicy();
  const [ledger, cash, pending, disputed, legacyCash] = await Promise.all([
    riderLedgerBalances(partner._id), riderCodCashBalances([partner._id]),
    DeliveryPayout.exists({ partnerId: partner._id, status: 'pending' }),
    Order.exists({ deliveryPartnerId: partner._id, 'codFinance.status': { $in: ['disputed', 'discrepancy'] } }),
    Order.exists({ deliveryPartnerId: partner._id, paymentMethod: 'cod', 'financialSnapshot.version': { $ne: 2 }, 'codFinance.status': { $in: ['collected', 'remittance_reported'] } }),
  ]);
  const outstanding = (cash.get(String(partner._id)) || 0) / 100;
  const verifiedPayable = Math.max(0, ledger.eligible) / 100;
  // Pre-ledger earnings still on the old counter; shown, never paid from here.
  const legacyUnverified = Math.max(0, Math.round((partner.earnings?.pending || 0) * 100) - Math.max(0, ledger.eligible)) / 100;
  const payoutBlockers = [
    ...(!(flags.payouts && flags.policyApproved && flags.testsApproved) ? [{ code: 'payouts_unavailable', message: 'Payout processing is unavailable. Contact support.' }] : []),
    ...(partner.status !== 'approved' ? [{ code: 'rider_not_approved', message: 'Your rider account must be approved before cashout.' }] : []),
    ...(payoutSchedule !== 'on_request' ? [{ code: 'weekly_schedule', message: 'Payouts are created automatically on the weekly payout day.' }] : []),
    ...(pending ? [{ code: 'request_pending', message: 'A payout request is already awaiting processing.' }] : []),
    ...(!partner.bankDetails?.upiId && !partner.bankDetails?.accountNo ? [{ code: 'destination_missing', message: 'Add your bank account or UPI ID in Profile before cashing out.' }] : []),
    ...(disputed ? [{ code: 'cod_disputed', message: 'A COD cash record is disputed or has an amount mismatch. Admin must reconcile it before cashout.' }] : []),
    ...(legacyCash ? [{ code: 'legacy_cod_review', message: 'An older COD collection needs finance reconciliation before cashout.' }] : []),
    ...(outstanding > 0 ? [{ code: 'cod_outstanding', message: `₹${outstanding.toFixed(2)} COD cash still needs admin receipt confirmation. Report the handover in COD records, then wait for confirmation.` }] : []),
    ...(verifiedPayable <= 0 ? [{ code: 'no_available_earnings', message: 'No verified earnings are available for withdrawal yet.' }] : verifiedPayable < riderMinPayout ? [{ code: 'below_minimum', message: `Minimum cashout is ₹${riderMinPayout.toFixed(2)}. Available earnings are ₹${verifiedPayable.toFixed(2)}.` }] : []),
  ];
  return { verifiedPayable, reportedCodOutstanding: outstanding, historicalCashIncluded: false, minimumPayout: riderMinPayout, payoutSchedule, payoutWeekday,
    balances: { onHold: ledger.held / 100, available: verifiedPayable, requested: ledger.reserved / 100, paid: ledger.settled / 100 }, legacyUnverified,
    payoutActionsEnabled: payoutBlockers.length === 0, payoutBlockers,
    balanceMismatch: Math.round((partner.earnings?.pending || 0) * 100) !== ledger.eligible };
};

export const requestVerifiedRiderPayout = async ({ partnerId, userId, amount, key, automatic = false }) => {
  requireFinanceOperation('payouts');
  const paise = moneyPaise(amount);
  const { riderMinPayout, payoutSchedule } = await getFinancePolicy();
  if (payoutSchedule === 'weekly' && !automatic) throw httpError(409, 'Payouts are created automatically every week; manual requests are turned off');
  if (amount < riderMinPayout) throw httpError(400, `Minimum payout amount is ₹${riderMinPayout}`);
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
    if (!partner.bankDetails?.upiId && !partner.bankDetails?.accountNo) throw httpError(400, 'Add your bank account or UPI ID in your profile before requesting a payout');
    if (await DeliveryPayout.exists({ partnerId, status: 'pending' }).session(session)) throw httpError(409, 'A payout request is already pending');
    if (await Order.exists({ deliveryPartnerId: partnerId, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks rider payout');
    if (await Order.exists({ deliveryPartnerId: partnerId, paymentMethod: 'cod', 'financialSnapshot.version': { $ne: 2 }, 'codFinance.status': { $in: ['collected', 'remittance_reported'] } }).session(session)) throw httpError(409, 'Older COD collections need finance reconciliation before payout');
    const cash = await riderCodCashBalances([partnerId], { session });
    if ((cash.get(String(partnerId)) || 0) > 0) throw httpError(409, 'Hand over all collected COD cash and wait for admin receipt confirmation before requesting a payout');
    const { eligible: payable } = await riderLedgerBalances(partnerId, { session });
    if (paise > payable) throw httpError(409, 'Payout exceeds verified payable balance; legacy earnings require reconciliation');
    const [payout] = await DeliveryPayout.create([{ partnerId, userId, amount, status: 'pending', financeVersion: 2, idempotencyKey, payoutMethod: partner.bankDetails }], { session });
    for (const [bucket, direction] of [['eligible', 'debit'], ['reserved', 'credit']]) await postLedgerEntry({
      idempotencyKey: `RIDER_PAYOUT:${payout._id}:${bucket}`, partnerId, deliveryPayoutId: payout._id, account: 'rider_payable', type: 'payout_reservation',
      direction, bucket, amount, description: `Rider payout reservation ${payout._id}`, reference: String(payout._id),
      metadata: { source: 'order-finance-v2' },
    }, { session });
    // Mirror for older screens; may differ only by pre-ledger history.
    await DeliveryPartner.updateOne({ _id: partnerId }, { $inc: { 'earnings.pending': -amount, 'earnings.reserved': amount } }, { session });
    return { payout, earnings: { ...partner.earnings.toObject?.() || partner.earnings, pending: partner.earnings.pending - amount } };
  });
};

export const resolveVerifiedRiderPayout = async ({ payoutId, actorId, complete, input }) => {
  requireFinanceOperation('payouts');
  const reference = String(input.transactionRef || '').trim();
  const reason = String(input.reason || '').trim();
  if (reason.length < 5 || reason.length > 1000 || complete && (input.verified !== true || reference.length < 4 || reference.length > 200)) throw httpError(400, 'Verified transfer reference and reconciliation reason are required to mark paid');
  let resolved = false;
  const result = await financialTransaction(async session => {
    resolved = false; // a retried attempt starts clean
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
    if ((await riderLedgerBalances(payout.partnerId, { session })).reserved < moneyPaise(payout.amount)) throw httpError(409, 'Reserved balance mismatch');
    await DeliveryPartner.updateOne({ _id: payout.partnerId }, { $inc: { 'earnings.reserved': -payout.amount, [complete ? 'earnings.paid' : 'earnings.pending']: payout.amount } }, { session });
    if (complete && await Order.exists({ deliveryPartnerId: payout.partnerId, 'codFinance.status': { $in: ['disputed','discrepancy'] } }).session(session)) throw httpError(409, 'Disputed COD cash blocks rider payout completion');
    for (const [bucket, direction] of [['reserved', 'debit'], [complete ? 'settled' : 'eligible', 'credit']]) await postLedgerEntry({
      idempotencyKey: `RIDER_PAYOUT:${payout._id}:RESOLVE:${bucket}`, partnerId: payout.partnerId, deliveryPayoutId: payout._id, account: 'rider_payable',
      type: 'payout_settlement', direction, bucket, amount: payout.amount, reference,
      description: `Rider payout ${target}: ${reason}`, postedBy: actorId, postedByRole: 'admin', metadata: { source: 'order-finance-v2', payoutId: String(payout._id) },
    }, { session });
    resolved = true;
    return payout;
  });
  // After commit, and only for a real transition: a replayed request must not notify twice.
  if (resolved) {
    const amountText = `₹${Number(result.amount).toFixed(2)}`;
    await notifyRider(result.partnerId, complete
      ? { event: NOTIFICATION_EVENT.PAYOUT_COMPLETED, title: 'Payout settled', message: `${amountText} has been sent to your account. Ref: ${reference}.`, route: '/delivery/earnings' }
      : { event: NOTIFICATION_EVENT.PAYOUT_REJECTED, title: 'Payout request returned', message: `Your ${amountText} payout was not processed: ${reason}. The amount is back in your available balance.`, route: '/delivery/earnings' }).catch(() => {});
  }
  return result;
};
