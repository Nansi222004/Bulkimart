import Payment from '../models/Payment.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { WALLET_TRANSACTION_TYPE, WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';

// A rejected (or applicant-cancelled) application's paid service fee goes back to the
// applicant's Bulkimart wallet. Both writes are keyed to the application, so retrying a
// rejection or cancellation never refunds twice.
export async function refundServiceFeeToWallet(application, actorId, { actorType = 'admin', reason = 'rejected' } = {}) {
  const { creditWallet } = await import('./wallet.service.js');
  const bill = application.billing, amountPaise = bill.amountPaise, key = `SERVICE_WALLET_REFUND:${application._id}`;
  const why = reason === 'cancelled' ? 'request cancelled' : 'application rejected';
  const credit = await creditWallet({ userId: application.user, amount: amountPaise / 100, type: WALLET_TRANSACTION_TYPE.REFUND,
    referenceType: WALLET_REFERENCE_TYPE.SERVICE, referenceId: application._id, description: `Refund for ${application.snapshot.name} (${why})`,
    idempotencyKey: key, createdBy: actorId, createdByModel: actorType === 'admin' ? 'Admin' : 'User', metadata: { serviceApplicationId: String(application._id) } });
  await postLedgerEntry({ idempotencyKey: key, serviceApplicationId: application._id, paymentId: bill.paymentId, account: 'service_collections', type: 'reversal',
    direction: 'debit', bucket: 'held', amount: amountPaise / 100, reference: credit.transaction?.transactionId || key, description: `Service fee refunded to the applicant wallet after ${why}` });
  await Payment.updateOne({ _id: bill.paymentId }, { $set: { status: 'refunded' } });
  application.billing = { ...bill, status: 'refunded', refundedPaise: amountPaise, refundedToWallet: true, refundedAt: new Date(), cancelRefundDue: undefined };
  application.markModified('billing');
  application.events.push({ action: 'refunded_to_wallet', actor: actorId, actorType, status: application.status });
}
