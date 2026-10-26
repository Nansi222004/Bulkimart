import Return from '../models/Return.js';
import Order from '../models/Order.js';
import WalletLedger from '../models/WalletLedger.js';
import { moneyPaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';

export const verifyReturnCashEvidence = async (payment, ret, session) => {
  const amount = moneyPaise(ret.refundAmount);
  if (!amount) return; // The caller checks the explicit internal zero proof.
  if (payment?.method === 'online') {
    const rows = payment.refundObligations.filter(row => String(row.returnId) === String(ret._id));
    if (rows.length !== 1 || rows[0].status !== 'processed' || !rows[0].verifiedAt || rows[0].amountPaise !== amount || rows[0].currency !== 'INR'
      || rows[0].providerRefundId !== ret.refundReference || !payment.captures.some(row => row.disposition === 'settled' && row.gatewayPaymentId === rows[0].gatewayPaymentId)) throw httpError(409, 'Verified provider refund evidence is missing');
  } else if (payment?.method === 'wallet' || payment?.method === 'cod' && ret.refundDestination === 'wallet') {
    if (!await WalletLedger.exists({ userId: payment.userId, direction: 'credit', referenceId: String(ret._id), referenceType: 'RETURN', amount: ret.refundAmount, status: 'completed' }).session(session)) throw httpError(409, 'Wallet refund credit evidence is missing');
  } else if (payment?.method !== 'cod' || !ret.codSettledBy || !ret.codSettledAt || ret.refundReference !== 'MANUAL-COD' || ret.codSettlementNote?.length < 5) throw httpError(409, 'Manual COD refund settlement evidence is missing');
};

// A refunded projection is not funding evidence. Reconcile every completed
// cash refund against its durable provider obligation (or wallet credit).
export const verifyRefundedFunding = async (payment, order, session) => {
  if (!['partial_refund', 'refunded'].includes(payment.status)) throw httpError(409, 'Verified customer payment is required');
  const siblings = await Order.find({ paymentId: payment._id }).select('_id').session(session);
  const allReturns = await Return.find({ orderId: { $in: siblings.map(row => row._id) }, status: { $nin: ['REJECTED', 'CANCELLED'] } }).session(session);
  const returns = allReturns.filter(ret => ret.status === 'REFUNDED');
  if (!returns.length) throw httpError(409, 'Refund events are unresolved');
  let refundedPaise = 0; const providerReferences = new Set();
  for (const ret of returns) {
    const amount = moneyPaise(ret.refundAmount);
    if (!amount) {
      if (ret.zeroRefundEvidence?.key !== `ZERO_RETURN:${ret._id}` || !ret.zeroRefundEvidence.actorId || !ret.zeroRefundEvidence.reason || ret.refundReference) throw httpError(409, 'Zero refund evidence is missing');
      continue;
    }
    if (payment.method === 'online') {
      const matches = payment.refundObligations.filter(row => String(row.returnId) === String(ret._id));
      if (matches.length !== 1 || matches[0].status !== 'processed' || !matches[0].verifiedAt || matches[0].currency !== 'INR'
        || matches[0].amountPaise !== amount || !matches[0].providerRefundId || matches[0].providerRefundId !== ret.refundReference
        || !payment.captures.some(capture => capture.disposition === 'settled' && capture.gatewayPaymentId === matches[0].gatewayPaymentId)) throw httpError(409, 'Verified provider refund evidence is missing');
    } else if (!await WalletLedger.exists({ userId: payment.userId, direction: 'credit', referenceId: String(ret._id), referenceType: 'RETURN', amount: ret.refundAmount, status: 'completed' }).session(session)) throw httpError(409, 'Wallet refund credit evidence is missing');
    if (payment.method === 'online') { if (providerReferences.has(ret.refundReference)) throw httpError(409, 'Provider refund reference was reused'); providerReferences.add(ret.refundReference); }
    refundedPaise += amount;
  }
  if (payment.method === 'online' && payment.refundObligations.some(row => !allReturns.some(ret => String(ret._id) === String(row.returnId)) || row.status === 'processed' && !returns.some(ret => String(ret._id) === String(row.returnId)))) throw httpError(409, 'Unmatched payment refund obligation requires reconciliation');
  if (moneyPaise(payment.refund?.totalRefundedAmount ?? 0) !== refundedPaise || refundedPaise > moneyPaise(payment.amount)) throw httpError(409, 'Payment refund totals do not reconcile');
  const remaining = moneyPaise(payment.amount) - refundedPaise;
  if (payment.status !== (remaining ? 'partial_refund' : 'refunded') || !remaining) throw httpError(409, 'Fully refunded payment has no releasable funding');
  const ownRefund = returns.filter(ret => String(ret.orderId) === String(order._id)).reduce((sum, ret) => sum + moneyPaise(ret.refundAmount), 0);
  if (ownRefund >= order.financialSnapshot.expectedPaise) throw httpError(409, 'Fully refunded order has no releasable funding');
};
