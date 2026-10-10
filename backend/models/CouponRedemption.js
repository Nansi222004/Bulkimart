import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

/**
 * One row per successful use of a coupon.
 *
 * Kept as its own collection rather than a counter on the coupon, because
 * "how many times has THIS customer used it" and "what did we give away on
 * this code" are both questions the counter alone cannot answer.
 *
 * A redemption is written inside the checkout transaction, so a coupon can
 * never be counted for an order that failed to be created.
 */
const couponRedemptionSchema = new Schema(
  {
    couponId: { type: ObjectId, ref: 'Coupon', required: true },
    code:     { type: String, required: true },   // denormalised for reporting
    userId:   { type: ObjectId, ref: 'User', required: true },
    orderId:  { type: ObjectId, ref: 'Order' },
    discountAmount: { type: Number, required: true },
    orderTotal:     { type: Number },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ couponId: 1, userId: 1 });
couponRedemptionSchema.index({ userId: 1, createdAt: -1 });

const CouponRedemption = model("CouponRedemption", couponRedemptionSchema);
export default CouponRedemption;
