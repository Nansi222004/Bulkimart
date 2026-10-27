import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Delivery from '../models/Delivery.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';

const fail = (status, message) => Object.assign(new Error(message), { statusCode: status });

export const rateDeliveryPartner = asyncHandler(async (req, res) => {
  const rating = req.body.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'Choose a rating from 1 to 5 stars');
  const session = await mongoose.startSession();
  let customerRating;
  let ratedPartnerId;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.id).session(session).lean();
      if (!order) throw fail(404, 'Order not found');
      if (String(order.userId) !== String(req.user._id)) throw fail(403, 'This is not your order');
      if (order.status !== 'delivered' || !order.deliveryId || !order.deliveryPartnerId) {
        throw fail(400, 'A delivery partner can be rated after completing your delivery');
      }
      customerRating = { rating, ratedAt: new Date() };
      const delivery = await Delivery.findOneAndUpdate({
        _id: order.deliveryId, orderId: order._id, partnerId: order.deliveryPartnerId,
        status: 'delivered', direction: { $ne: 'return_pickup' },
        'customerRating.rating': { $exists: false },
      }, { $set: { customerRating } }, { returnDocument: 'after', session });
      if (!delivery) throw fail(409, 'This delivery is unavailable for rating or has already been rated');
      // Both writes commit together. A retried or simultaneous submission cannot
      // count twice, and concurrent customers cannot overwrite the average.
      const partner = await DeliveryPartner.findOneAndUpdate({ _id: delivery.partnerId }, [
        { $set: {
          ratingCount: { $add: [{ $ifNull: ['$ratingCount', 0] }, 1] },
          ratingTotal: { $add: [{ $ifNull: ['$ratingTotal', 0] }, rating] },
        } },
        { $set: { rating: { $divide: ['$ratingTotal', '$ratingCount'] } } },
      ], { session, returnDocument: 'after', updatePipeline: true });
      if (!partner) throw fail(409, 'This delivery partner is unavailable for rating');
      ratedPartnerId = partner._id;
    });
  } finally { await session.endSession(); }
  try {
    const { emitToRider } = await import('../socket/rooms.js');
    emitToRider(String(ratedPartnerId), 'rider_rating_updated', { partnerId: String(ratedPartnerId) });
  } catch { /* The rating is saved; a profile refresh also retrieves it. */ }
  return ok(res, customerRating, 'Delivery partner rated');
});
