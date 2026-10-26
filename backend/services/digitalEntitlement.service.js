import DigitalEntitlement from '../models/DigitalEntitlement.js';
import Order from '../models/Order.js';

/** Activate every digital line covered by a verified paid payment. */
export const activateDigitalEntitlements = async ({ payment, session }) => {
  let orders = [];
  if (payment.groupRef) {
    let query = Order.find({ groupRef: payment.groupRef });
    if (typeof query.select === 'function') query = query.select('+items.digitalFile');
    orders = await (typeof query.session === 'function' ? query.session(session) : query);
  } else if (payment.orderId) {
    let query = Order.findById(payment.orderId);
    if (typeof query.select === 'function') query = query.select('+items.digitalFile');
    orders = [await (typeof query.session === 'function' ? query.session(session) : query)];
  }

  for (const order of orders.filter(Boolean)) {
    if (['cancelled', 'refunded'].includes(order.status)) continue;
    const digitalItems = (order.items || []).filter((item) => item.fulfillmentType === 'digital');
    for (const item of digitalItems) {
      const file = item.digitalFile;
      if (!file?.fileId || file.status !== 'uploaded') {
        throw new Error(`Paid digital order ${order._id} has no verified private file`);
      }
      await DigitalEntitlement.updateOne(
        { userId: payment.userId, orderId: order._id, productId: item.productId },
        { $setOnInsert: {
          userId: payment.userId,
          orderId: order._id,
          productId: item.productId,
          paymentId: payment._id,
          gatewayPaymentId: payment.gateway?.paymentId,
          fileId: file.fileId,
          fileSha256: file.sha256,
          fileSizeBytes: file.sizeBytes,
          status: 'active',
          activatedAt: new Date(),
        } },
        { upsert: true, session },
      );
    }
    if (digitalItems.length > 0 && digitalItems.length === (order.items || []).length && order.status !== 'delivered') {
      // Access activation is the fulfilment moment. Stamp it on every item the
      // same way rider and courier delivery do, so the return window (from the
      // item's own frozen policy) starts here and held earnings can release.
      const deliveredAt = new Date();
      for (const item of order.items) {
        const { returnEligible, returnWindowDays } = item.returnPolicy || {};
        item.deliveredAt = deliveredAt;
        item.returnEligibleUntil = returnEligible && Number.isFinite(returnWindowDays) && returnWindowDays > 0
          ? new Date(deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000)
          : null;
      }
      order.status = 'delivered';
      order.timeline.push({ status: 'delivered', timestamp: deliveredAt, note: 'Digital purchase access activated' });
      await order.save({ session });
    }
  }
};
