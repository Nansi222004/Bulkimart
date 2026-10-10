import mongoose from "mongoose";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const basketItemSchema = new Schema(
  {
    productId: { type: ObjectId, ref: "Product", required: true },
    qty:       { type: Number, min: 1, required: true },
  },
  { _id: false }
);

/**
 * The subscription basket a customer is still building — before they've
 * configured a schedule or paid. Deliberately its own collection, not
 * `Cart`: subscription.service.js already treats the subscription basket as
 * "NOT the cart" (one seller only, groceries only, a weight ceiling per
 * delivery), and a customer assembling a month of rations must never empty
 * or reprice the basket they're using for tonight's dinner.
 *
 * Only `productId`/`qty` are stored — no price/name snapshot, unlike Cart.
 * A subscription basket is a short-lived staging area (add items, configure
 * a schedule, pay), not something a price needs to be preserved across, so
 * every read re-resolves against the live product instead of trusting a
 * stale copy.
 *
 * One document per (user, vendor): exactly matches the seller-tabs the
 * frontend already shows when a shopper is building baskets from more than
 * one store at once — each is its own draft, checked out independently.
 * "Vendor" is a Seller OR an SHGStore, never both — same `sellerId`/
 * `shgStoreId` pair Product/Order/Subscription already use, so an SHG
 * group's Quick Commerce listing is exactly as subscribable as a Seller's.
 */
const subscriptionBasketSchema = new Schema(
  {
    userId:     { type: ObjectId, ref: "User", required: true },
    sellerId:   { type: ObjectId, ref: "Seller" },
    shgStoreId: { type: ObjectId, ref: "SHGStore" },
    items:      [basketItemSchema],
  },
  { timestamps: true }
);

subscriptionBasketSchema.index({ userId: 1, sellerId: 1, shgStoreId: 1 }, { unique: true });

const SubscriptionBasket = model("SubscriptionBasket", subscriptionBasketSchema);
export default SubscriptionBasket;
