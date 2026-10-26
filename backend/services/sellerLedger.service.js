import { moneyPaise } from '../utils/financeMoney.js';
import crypto from 'crypto';
import SellerLedgerEntry, { SELLER_COURIER_OBLIGATION_TYPES } from '../models/SellerLedgerEntry.js';
import { httpError } from '../utils/response.js';

// Aggregation expression for the account an entry belongs to. Courier
// obligations posted to seller_payable before they had their own account are
// reported with the ones that have it.
export const effectiveAccountExpr = { $cond: [{ $in: ['$type', SELLER_COURIER_OBLIGATION_TYPES] }, 'seller_courier_obligation', { $ifNull: ['$account', 'seller_payable'] }] };

const verifyReplay = (entry, payload) => {
  if ((entry.currency || 'INR') !== (payload.currency || 'INR')) throw httpError(409, 'Ledger currency mismatch');
  if (entry.advertisingCampaignId && (String(entry.advertisingCampaignId)!==String(payload.advertisingCampaignId) || String(entry.advertiserSellerId)!==String(payload.advertiserSellerId) || entry.advertisingRevision!==payload.advertisingRevision || entry.currency!==payload.currency)) throw httpError(409,'Advertising ledger replay mismatch');
  if (entry.parcelDeliveryId && (entry.currency || 'INR') !== (payload.currency || 'INR')) throw httpError(409, 'Parcel ledger currency mismatch');
  for (const key of ['sellerId', 'partnerId', 'orderId', 'payoutId', 'deliveryPayoutId', 'paymentId', 'deliveryId', 'snapshotId', 'serviceApplicationId', 'gstAssistanceRequestId', 'parcelDeliveryId', 'providerId', 'type', 'direction', 'bucket', 'amount']) {
    if (String(entry[key] ?? '') !== String(payload[key] ?? '')) throw httpError(409, 'Ledger event key reused with different financial data');
  }
  if ((entry.account || 'seller_payable') !== (payload.account || 'seller_payable')) throw httpError(409, 'Ledger account mismatch');
  return { entry, alreadyProcessed: true };
};

export const postLedgerEntry = async (payload, { session = null } = {}) => {
  moneyPaise(payload.amount);
  if ((payload.currency || 'INR') !== 'INR') throw httpError(400, 'Only INR ledger postings are supported; currency mismatch');
  const existing = session
    ? await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey }).session(session)
    : await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey });
  if (existing) return verifyReplay(existing, payload);
  const data = { ...payload, entryNo: payload.entryNo || `SLE-${crypto.randomUUID()}` };
  try {
    const entry = session
      ? (await SellerLedgerEntry.create([data], { session }))[0]
      : await SellerLedgerEntry.create(data);
    return { entry, alreadyProcessed: false };
  } catch (error) {
    if (error?.code === 11000) {
      const entry = session
        ? await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey }).session(session)
        : await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey });
      if (entry) return verifyReplay(entry, payload);
    }
    throw error;
  }
};

export const sellerBalances = async (sellerId, { session = null } = {}) => {
  const payableMatch = { sellerId, $or: [{ account: 'seller_payable' }, { account: { $exists: false } }] };
  const invalid = SellerLedgerEntry.exists({ ...payableMatch, $and: [{ $or: [{ currency: { $exists: true, $ne: 'INR' } }, { $expr: { $gt: [{ $abs: { $subtract: [{ $multiply: ['$amount', 100] }, { $round: [{ $multiply: ['$amount', 100] }, 0] }] } }, 0.00001] } }] }] });
  if (session) invalid.session(session);
  if (await invalid) throw httpError(409, 'Seller ledger currency or precision requires reconciliation');
  const paise = { $toLong: { $round: [{ $multiply: ['$amount', 100] }, 0] } };
  const rupees = amount => { if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) throw httpError(409, 'Seller balance exceeds supported integer precision'); return amount / 100; };
  // Earnings buckets exclude courier obligations, including ones posted to
  // seller_payable before they had their own account.
  const rowsQuery = SellerLedgerEntry.aggregate([
    { $match: { ...payableMatch, type: { $nin: SELLER_COURIER_OBLIGATION_TYPES } } },
    { $group: {
      _id: '$bucket',
      amount: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, paise, { $multiply: [paise, -1] }] } },
    } },
  ]);
  if (session) rowsQuery.session(session);
  const rows = await rowsQuery;
  const balances = { pending: 0, held: 0, eligible: 0, reserved: 0, settled: 0 };
  rows.forEach((row) => { balances[row._id] = rupees(row.amount); });
  const totalsQuery = SellerLedgerEntry.aggregate([
    { $match: { sellerId, $or: [{ account: { $in: ['seller_payable', 'seller_courier_obligation'] } }, { account: { $exists: false } }] } },
    { $group: {
      _id: '$type',
      credits: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, paise, 0] } },
      debits: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, paise, 0] } },
    } },
  ]);
  if (session) totalsQuery.session(session);
  const totals = await totalsQuery;
  const byType = Object.fromEntries(totals.map((row) => [row._id, {
    credits: rupees(row.credits), debits: rupees(row.debits),
  }]));
  const countQuery = SellerLedgerEntry.countDocuments({ sellerId });
  if (session) countQuery.session(session);
  const ledgerEntryCount = await countQuery;
  const chargedPaise = ['quick_freight_obligation', 'quick_service_fee', 'quick_fee_tax'].reduce((sum, type) => sum + Math.round((byType[type]?.debits || 0) * 100), 0);
  const paidPaise = Math.round((byType.quick_fee_payment?.credits || 0) * 100);
  return {
    ...balances,
    earnedEarnings: byType.order_earning?.credits || 0,
    sameDayIncentives: byType.same_day_incentive?.credits || 0,
    quickFreightObligations: byType.quick_freight_obligation?.debits || 0,
    bulkimartServiceFees: byType.quick_service_fee?.debits || 0,
    // Prepaid Shiprocket charges: what was charged, what the seller paid, what is still owed.
    courierObligations: { charged: chargedPaise / 100, paid: paidPaise / 100, outstanding: Math.max(0, chargedPaise - paidPaise) / 100 },
    adjustments: (byType.adjustment?.credits || 0) - (byType.adjustment?.debits || 0),
    reversals: byType.reversal?.debits || 0,
    ledgerEntryCount,
  };
};
