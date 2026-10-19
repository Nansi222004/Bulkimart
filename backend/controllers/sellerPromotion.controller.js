import mongoose from 'mongoose';
import Payment from '../models/Payment.js';
import SellerPromotion from '../models/SellerPromotion.js';
import { PAYMENT_STATUS } from '../constants/enums.js';

// Financial reconciliation only: old verified callbacks may settle money,
// but must never activate advertisements, banners, ranking, or notifications.
export const settleSellerPromotionPayment = async ({ payment, state, gatewayOrderId, paymentDetails, errorCode }) => {
  if (payment.status === PAYMENT_STATUS.PAID) return { changed: false, status: 'paid' };
  const session = await mongoose.startSession();
  let result = { changed: false, status: payment.status };
  try {
    await session.withTransaction(async () => {
      const fresh = await Payment.findById(payment._id).session(session);
      if (!fresh || fresh.status === PAYMENT_STATUS.PAID) return;
      if (!['COMPLETED', 'FAILED'].includes(state)) return;
      fresh.status = state === 'COMPLETED' ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.FAILED;
      if (state === 'COMPLETED') fresh.paidAt = new Date();
      fresh.gateway = { ...(fresh.gateway || {}), orderId: gatewayOrderId, ...(state === 'COMPLETED' ? { paymentDetails } : { errorCode }) };
      await fresh.save({ session });
      await SellerPromotion.updateOne({ _id: fresh.sellerPromotionId }, { $set: { status: 'DISABLED' } }, { session });
      result = { changed: true, status: fresh.status };
    });
  } finally { await session.endSession(); }
  return result;
};
