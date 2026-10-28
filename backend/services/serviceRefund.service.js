import Payment from '../models/Payment.js';
import { postLedgerEntry } from './sellerLedger.service.js';
import { WALLET_TRANSACTION_TYPE, WALLET_REFERENCE_TYPE } from '../models/WalletLedger.js';

// A rejected application's paid service fee goes back to the applicant's Bulkimart wallet.
// Both writes are keyed to the application, so retrying a rejection never refunds twice.
export async function refundServiceFeeToWallet(application, adminId) {
  const { creditWallet } = await import('./wallet.service.js');
  const bill = application.billing, amountPaise = bill.amountPaise, key = `SERVICE_WALLET_REFUND:${application._id}`;
  const credit = await creditWallet({ userId: application.user, amount: amountPaise / 100, type: WALLET_TRANSACTION_TYPE.REFUND,
    referenceType: WALLET_REFERENCE_TYPE.SERVICE, referenceId: application._id, description: `Refund for ${application.snapshot.name} (application rejected)`,
    idempotencyKey: key, createdBy: adminId, createdByModel: 'Admin', metadata: { serviceApplicationId: String(application._id) } });
  await postLedgerEntry({ idempotencyKey: key, serviceApplicationId: application._id, paymentId: bill.paymentId, account: 'service_collections', type: 'reversal',
    direction: 'debit', bucket: 'held', amount: amountPaise / 100, reference: credit.transaction?.transactionId || key, description: 'Service fee refunded to the applicant wallet after rejection' });
  await Payment.updateOne({ _id: bill.paymentId }, { $set: { status: 'refunded' } });
  application.billing = { ...bill, status: 'refunded', refundedPaise: amountPaise, refundedToWallet: true, refundedAt: new Date() };
  application.markModified('billing');
  application.events.push({ action: 'refunded_to_wallet', actor: adminId, actorType: 'admin', status: application.status });
}
