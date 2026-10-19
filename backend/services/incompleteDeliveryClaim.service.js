import mongoose from 'mongoose';

// Release only an acceptance that never created a delivery. Existing trips and
// picked-up orders are deliberately excluded; no rider duty or money is changed.
export async function releaseIncompleteDeliveryClaim(db, id, { apply = false, session } = {}) {
  if (!mongoose.isValidObjectId(id)) throw new Error('A valid order ID is required');
  const _id = new mongoose.Types.ObjectId(String(id));
  const order = await db.collection('orders').findOne({ _id }, { session });
  if (!order || order.status !== 'dispatched' || order.deliveryId || !order.deliveryPartnerId || order.deliveryType === 'shiprocket') return { eligible: false, released: false };
  if (await db.collection('deliveries').countDocuments({ orderId: _id }, { session })) return { eligible: false, released: false };
  const accepted = order.offerAttempts?.some(attempt => String(attempt.riderId) === String(order.deliveryPartnerId) && attempt.status === 'ACCEPTED');
  if (!accepted) return { eligible: false, released: false };
  if (!apply) return { eligible: true, released: false };
  const result = await db.collection('orders').updateOne({ _id, status: 'dispatched', deliveryId: null,
    deliveryPartnerId: order.deliveryPartnerId, updatedAt: order.updatedAt,
  }, { $unset: { deliveryPartnerId: '', 'offerAttempts.$[attempt].respondedAt': '' },
    $set: { 'offerAttempts.$[attempt].status': 'OFFERED', 'offerAttempts.$[attempt].offeredAt': new Date(), updatedAt: new Date() },
    $push: { timeline: { status: 'dispatched', timestamp: new Date(), note: 'Incomplete rider acceptance released for retry; no delivery record was created.' } },
    $inc: { __v: 1 },
  }, { session, arrayFilters: [{ 'attempt.riderId': order.deliveryPartnerId, 'attempt.status': 'ACCEPTED' }] });
  return { eligible: true, released: result.modifiedCount === 1 };
}
