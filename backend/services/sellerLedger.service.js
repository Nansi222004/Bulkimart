import crypto from 'crypto';
import SellerLedgerEntry from '../models/SellerLedgerEntry.js';

export const postLedgerEntry = async (payload, { session = null } = {}) => {
  const existing = session
    ? await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey }).session(session)
    : await SellerLedgerEntry.findOne({ idempotencyKey: payload.idempotencyKey });
  if (existing) return { entry: existing, alreadyProcessed: true };
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
      if (entry) return { entry, alreadyProcessed: true };
    }
    throw error;
  }
};

export const sellerBalances = async (sellerId, { session = null } = {}) => {
  const rowsQuery = SellerLedgerEntry.aggregate([
    { $match: { sellerId } },
    { $group: {
      _id: '$bucket',
      amount: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', { $multiply: ['$amount', -1] }] } },
    } },
  ]);
  if (session) rowsQuery.session(session);
  const rows = await rowsQuery;
  const balances = { pending: 0, held: 0, eligible: 0, reserved: 0, settled: 0 };
  rows.forEach((row) => { balances[row._id] = Number((row.amount || 0).toFixed(2)); });
  const totalsQuery = SellerLedgerEntry.aggregate([
    { $match: { sellerId } },
    { $group: {
      _id: '$type',
      credits: { $sum: { $cond: [{ $eq: ['$direction', 'credit'] }, '$amount', 0] } },
      debits: { $sum: { $cond: [{ $eq: ['$direction', 'debit'] }, '$amount', 0] } },
    } },
  ]);
  if (session) totalsQuery.session(session);
  const totals = await totalsQuery;
  const byType = Object.fromEntries(totals.map((row) => [row._id, {
    credits: Number(row.credits.toFixed(2)), debits: Number(row.debits.toFixed(2)),
  }]));
  const countQuery = SellerLedgerEntry.countDocuments({ sellerId });
  if (session) countQuery.session(session);
  const ledgerEntryCount = await countQuery;
  return {
    ...balances,
    earnedEarnings: byType.order_earning?.credits || 0,
    quickFreightObligations: byType.quick_freight_obligation?.debits || 0,
    bulkimartServiceFees: byType.quick_service_fee?.debits || 0,
    adjustments: (byType.adjustment?.credits || 0) - (byType.adjustment?.debits || 0),
    reversals: byType.reversal?.credits || 0,
    ledgerEntryCount,
  };
};
