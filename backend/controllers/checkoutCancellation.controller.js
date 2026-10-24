import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Payment from '../models/Payment.js';
import Cart from '../models/Cart.js';
import CoinTransaction from '../models/CoinTransaction.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, httpError } from '../utils/response.js';
import { mutateInventory } from '../services/inventory.service.js';
import { releaseCoupon } from '../services/coupon.service.js';
import { releaseReservedCoins } from '../services/coin.service.js';
import { COIN_REFERENCE_TYPE } from '../constants/enums.js';

// Keep the financial records. Undo an unpaid checkout atomically, including
// every fulfilment order, and merge the original lines into the current carts.
export const abandonCheckoutPayment = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findOne({ _id: req.params.id, userId: req.user._id }).session(session);
      if (!order) throw httpError(404, 'Order not found');
      const payment = await Payment.findOne({ _id: order.paymentId, userId: req.user._id, method: 'online' }).session(session);
      if (!payment) throw httpError(409, 'Only an unpaid online checkout can be abandoned');
      if (payment.checkoutAbandonedAt) { result = { cancelled: true }; return; }
      if (payment.status === 'paid' && order.status !== 'cancelled') { result = { cancelled: false, status: 'paid' }; return; }
      if (!['pending', 'failed'].includes(payment.status) || payment.captures?.length) throw httpError(409, 'Payment requires reconciliation before cancellation');
      if (payment.gateway?.provider && payment.gateway.provider !== 'razorpay' || payment.gatewayAttempts?.some(attempt => attempt.provider !== 'razorpay')) throw httpError(409, 'This historical payment requires provider reconciliation');
      const orders = await Order.find({ paymentId: payment._id }).session(session);
      if (!orders.length || orders.some(row => String(row.userId) !== String(req.user._id) || row.status !== 'placed' || row.shiprocket?.orderId || ['creating', 'assigning', 'reconciliation_required'].includes(row.shiprocket?.status))) {
        throw httpError(409, 'This checkout has already changed; check its payment status');
      }

      // All settlement paths write this same document. Mongo retries a capture
      // race against a fresh snapshot: paid wins, or cancellation wins and any
      // late capture is journaled for refund by settle().
      payment.checkoutAbandonedAt = new Date();
      payment.status = 'failed';
      payment.settlementRevision = (payment.settlementRevision || 0) + 1;
      await payment.save({ session });
      for (const row of orders) {
        row.status = 'cancelled';
        row.cancelReason = 'Payment cancelled by customer';
        row.timeline.push({ status: 'cancelled', note: row.cancelReason, timestamp: new Date() });
        await row.save({ session });
        await releaseCoupon(row.coupon, row._id, session);

        const channel = row.salesChannel === 'wholesale' ? 'wholesale' : row.type;
        const cart = await Cart.findOne({ userId: req.user._id, channel }).session(session)
          || new Cart({ userId: req.user._id, channel, items: [] });
        for (const item of row.items) {
          if (item.fulfillmentType !== 'digital') await mutateInventory({ productId: item.productId, variantId: item.variantId, quantity: item.qty, session, restore: true });
          const deliveryMode = item.fulfillmentType !== 'digital' ? row.delivery?.mode : undefined;
          const existing = cart.items.find(line => String(line.productId) === String(item.productId) && String(line.variantId || '') === String(item.variantId || '') && (line.deliveryMode || '') === (deliveryMode || ''));
          if (existing) existing.qty = item.fulfillmentType === 'digital' ? 1 : existing.qty + item.qty;
          else cart.items.push({ productId: item.productId, variantId: item.variantId, sku: item.sku,
            variantName: item.variantName, variantAttributes: item.variantAttributes, name: item.name, image: item.image,
            price: item.price, qty: item.qty, unit: item.unitSnapshot, sellerId: item.sellerId, shgStoreId: item.shgStoreId,
            type: item.type || row.type, fulfillmentType: item.fulfillmentType, deliveryMode, additionalMessage: item.additionalMessage });
        }
        cart.increment();
        await cart.save({ session });
      }
      if (payment.coinsUsed > 0 && payment.orderId && !await CoinTransaction.exists({ idempotencyKey: `RELEASE:${payment.orderId}` }).session(session)) {
        await releaseReservedCoins({ userId: payment.userId, amount: payment.coinsUsed,
          referenceType: COIN_REFERENCE_TYPE.ORDER, referenceId: String(payment.orderId),
          idempotencyKey: `RELEASE:${payment.orderId}`, description: 'Checkout payment cancelled — Coins released', session });
      }
      result = { cancelled: true };
    });
  } finally { await session.endSession(); }
  return ok(res, result, result.cancelled ? 'Payment cancelled and basket restored' : 'Payment is already verified');
});
