import mongoose from 'mongoose';
import Seller from '../models/Seller.js';
import SellerPayout from '../models/SellerPayout.js';
import { assertSellerSettlementClear } from './sellerSettlementEligibility.service.js';
import { postLedgerEntry, sellerBalances } from './sellerLedger.service.js';
import { requireFinanceOperation } from './financeSafety.service.js';
import { destinationFingerprint } from './payoutEvidence.service.js';
import { getFinancePolicy } from './financePolicy.service.js';
import { moneyPaise } from '../utils/financeMoney.js';
import { httpError } from '../utils/response.js';

/**
 * Reserve settlement-eligible seller funds for a manual bank transfer. Used by
 * the seller's own request (`userId` set, ownership enforced) and by the weekly
 * payout job (`automatic`), so both follow one set of balance rules.
 */
export const createSellerPayoutRequest = async ({ sellerId, userId = null, amount, key, requestedBy, automatic = false }) => {
  requireFinanceOperation('payouts');
  const submittedKey = String(key || '').trim();
  const idempotencyKey = `SELLER:${sellerId}:${submittedKey}`;
  moneyPaise(amount);
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'Payout amount must be positive');
  if (!submittedKey || submittedKey.length > 100) throw httpError(400, 'A valid Idempotency-Key is required');
  const existing = await SellerPayout.findOne({ idempotencyKey });
  if (existing) {
    if (String(existing.sellerId) !== String(sellerId) || existing.amount !== amount) throw httpError(409, 'Payout key reused with different financial data');
    return { payout: existing, alreadyProcessed: true };
  }
  const { sellerMinPayout, payoutSchedule } = await getFinancePolicy();
  if (payoutSchedule === 'weekly' && !automatic) throw httpError(409, 'Payouts are created automatically every week; manual requests are turned off');
  if (amount < sellerMinPayout) throw httpError(400, `Minimum payout amount is ₹${sellerMinPayout}`);

  const session = await mongoose.startSession();
  let payout;
  try {
    await session.withTransaction(async () => {
      await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      const replay = await SellerPayout.findOne({ idempotencyKey }).session(session);
      if (replay) {
        if (replay.amount !== amount) throw httpError(409, 'Payout key reused with a different amount');
        payout = replay; return;
      }
      const currentSeller = await Seller.findOne({ _id: sellerId, ...(userId ? { userId } : {}), status: 'approved' }).session(session);
      if (!currentSeller) throw httpError(403, 'Approved seller is required');
      const balances = await sellerBalances(currentSeller._id, { session });
      if (balances.held < 0) throw httpError(409, 'Outstanding seller adjustments require reconciliation');
      await assertSellerSettlementClear(currentSeller._id, session);
      if (balances.eligible < amount) throw httpError(409, 'Insufficient settlement-eligible balance');
      await Seller.updateOne({ _id: sellerId }, { $inc: { financialLedgerVersion: 1 } }, { session });
      destinationFingerprint(currentSeller.bankDetails);
      [payout] = await SellerPayout.create([{
        payoutNo: `PAY-${new mongoose.Types.ObjectId()}`,
        sellerId, amount, status: 'PENDING', idempotencyKey,
        requestedBy, bankDetails: currentSeller.bankDetails,
      }], { session });
      const reserveOut = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:ELIGIBLE`, sellerId, payoutId: payout._id,
        type: 'payout_reservation', direction: 'debit', bucket: 'eligible', amount,
        reference: payout.payoutNo, description: `Reserved for payout ${payout.payoutNo}`,
      }, { session });
      const reserveIn = await postLedgerEntry({
        idempotencyKey: `PAYOUT:${payout._id}:RESERVED`, sellerId, payoutId: payout._id,
        type: 'payout_reservation', direction: 'credit', bucket: 'reserved', amount,
        reference: payout.payoutNo, description: `Reserved for payout ${payout.payoutNo}`,
      }, { session });
      payout.ledgerEntryIds = [reserveOut.entry._id, reserveIn.entry._id];
      await payout.save({ session });
    });
  } finally {
    await session.endSession();
  }
  return { payout, alreadyProcessed: false };
};
