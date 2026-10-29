import crypto from 'node:crypto';
import { codCashDuePaise } from './financeMoney.js';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const historicalManifestRow = ({ order, item, payment, deliveries = [], returns = [], entries = [], policies = [], payouts = [], unscopedEntries = [] }) => {
  const reasons = [];
  const ownEntries = entries.filter(row => String(row.sellerId) === String(item.sellerId));
  if (!payment?.userId || !order.userId || String(payment.userId) !== String(order.userId) || payment.method !== order.paymentMethod) reasons.push('missing_payment_evidence');
  if (order.paymentMethod === 'online' && !payment?.captures?.some(row => row.disposition === 'settled' && row.gatewayPaymentId && row.currency === 'INR' && row.amountPaise === Math.round(payment.amount * 100))) reasons.push('missing_payment_evidence');
  if (order.paymentMethod === 'wallet') reasons.push('wallet_debit_requires_review');
  if (order.paymentMethod === 'cod' && (!['verified', 'allocated'].includes(order.codFinance?.status) || !order.codFinance?.verifiedAt || order.codFinance.verifiedPaise !== codCashDuePaise(Math.round(order.pricing.totalAmount * 100)))) reasons.push('missing_cod_custody_evidence');
  // Current Commission documents cannot establish a historical agreement.
  reasons.push('missing_historical_commission_policy');
  if (!item.deliveredAt || order.status !== 'delivered') reasons.push('incomplete_delivery_evidence');
  if (returns.length) reasons.push('returns_require_individual_reconciliation');
  if (order.financialSnapshotError?.message) reasons.push('breakdown_not_recorded_at_checkout');
  if (ownEntries.length) reasons.push('existing_postings_require_review');
  const sellerPayouts = payouts.filter(row => String(row.sellerId) === String(item.sellerId));
  const unattributed = unscopedEntries.filter(row => String(row.sellerId) === String(item.sellerId));
  if (sellerPayouts.length || unattributed.length) reasons.push('prior_payout_or_unattributed_ledger_requires_review');
  const evidence = {
    orderId: String(order._id), orderNo: order.orderNo, itemId: String(item._id), sellerId: String(item.sellerId),
    status: order.status, price: item.price, qty: item.qty, pricing: order.pricing, deliveredAt: item.deliveredAt || null,
    payment: payment ? { id: String(payment._id), method: payment.method, status: payment.status, amount: payment.amount, captures: payment.captures || [], refunds: payment.refundObligations || [], legacyCapturePresent: Boolean(payment.gateway?.paymentId || payment.gateway?.paymentDetails?.length) } : null,
    cash: order.codFinance || null,
    deliveries: deliveries.map(row => ({ id: String(row._id), status: row.status, otpVerified: row.otpVerified })),
    returns: returns.map(row => ({ id: String(row._id), itemId: String(row.orderItemId), quantity: row.quantity, status: row.status, amount: row.refundAmount, reference: row.refundReference })),
    entries: ownEntries.map(row => ({ id: String(row._id), key: row.idempotencyKey, amount: row.amount, account: row.account, bucket: row.bucket, direction: row.direction, type: row.type })),
    payouts: sellerPayouts.map(row => ({ id: String(row._id), reference: row.payoutNo, amount: row.amount, status: row.status, ledgerEntryIds: row.ledgerEntryIds })),
    unattributedEntries: unattributed.map(row => ({ id: String(row._id), key: row.idempotencyKey, amount: row.amount, direction: row.direction, bucket: row.bucket })),
    currentRuleIds: policies.map(row => String(row._id)), historicalPolicyEstablished: false,
  };
  const already = ownEntries.some(row => row.metadata?.source === 'historical-reviewed-v1' && row.metadata?.itemId === String(item._id));
  return { manifestVersion: 1, orderId: evidence.orderId, orderNo: evidence.orderNo, itemId: evidence.itemId, sellerId: evidence.sellerId,
    currency: 'INR', classification: already ? 'already_reconciled' : reasons.includes('missing_cod_custody_evidence') ? 'missing_cod_custody_evidence' : reasons.includes('missing_payment_evidence') ? 'missing_payment_evidence' : 'missing_historical_commission_policy',
    reasons: [...new Set(reasons)], evidence, evidenceHash: hash(evidence), policyVersion: null, proposedPayable: null, proposedPostings: [],
    idempotencyKey: `HISTORICAL:${order._id}:${item._id}:v1`, operator: null, approvalReference: null, batchId: null };
};

