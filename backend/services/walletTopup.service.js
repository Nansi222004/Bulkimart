import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import { creditWallet } from './wallet.service.js';
import { httpError } from '../utils/response.js';
import { rupeesToPaise } from './razorpay.service.js';

// Called only with a server-fetched payment or a signature-checked webhook.
export const settleRazorpayWalletTopup = async ({ payment, state, gatewayOrderId, gatewayPaymentId, amountPaise, currency, paymentDetails }) => {
  if (!payment.isWalletTopup || payment.gateway?.provider !== 'razorpay'
      || payment.gateway.orderId !== gatewayOrderId || !gatewayPaymentId
      || !Number.isSafeInteger(amountPaise) || amountPaise !== rupeesToPaise(payment.amount) || currency !== 'INR') {
    throw httpError(400, 'Wallet payment details do not match the top-up');
  }
  if (state !== 'COMPLETED') return { status: payment.status };

  const session = await mongoose.startSession();
  try {
    let status;
    await session.withTransaction(async () => {
      const fresh = await Payment.findById(payment._id).session(session);
      if (!fresh) throw httpError(404, 'Top-up payment not found');
      status = fresh.status;
      if (status === 'paid') return;
      if (!['pending', 'failed'].includes(status)) throw httpError(409, 'Top-up cannot be credited');
      await creditWallet({
        userId: fresh.userId, amount: fresh.amount, type: 'WALLET_TOPUP', referenceType: 'TOPUP',
        referenceId: String(fresh._id), description: `Wallet top-up of ₹${fresh.amount} via Razorpay`,
        idempotencyKey: `TOPUP:${fresh._id}`, session,
      });
      fresh.status = 'paid';
      fresh.paidAt = new Date();
      fresh.gateway.paymentId = gatewayPaymentId;
      fresh.gateway.paymentDetails = paymentDetails;
      await fresh.save({ session });
      status = 'paid';
    });
    return { status };
  } finally {
    await session.endSession();
  }
};
