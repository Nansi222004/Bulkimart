import mongoose from "mongoose";
import { CHANNEL, CHANNELS, DELIVERY_MODES } from "../constants/enums.js";

const { Schema, model } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const cartItemSchema = new Schema({
  productId:  { type: ObjectId, ref: "Product", required: true },
  variantId:  { type: ObjectId },
  sku:        String,
  variantName: String,
  variantAttributes: [{ name: String, value: String }],
  name:       String,   // price snapshot at add time — display only, never trusted for money
  image:      String,
  price:      Number,
  mrp:        Number,
  qty:        { type: Number, min: 1, required: true },
  unit:       String,
  sellerId:   { type: ObjectId, ref: "Seller" },
  shgStoreId: { type: ObjectId, ref: "SHGStore" },
  type:       String,   // ecommerce | grocery | shg
  fulfillmentType: { type: String, enum: ['physical', 'digital'], default: 'physical' },

  /**
   * How the customer wants this particular line delivered.
   *
   * Per line rather than per basket, because a unified basket can reasonably
   * hold one thing wanted today and another wanted whenever — and because the
   * fulfilment group is keyed on it, so two modes from one shop are two
   * journeys and must not be merged.
   *
   * Absent means undecided, which is what keeps "the customer must choose"
   * enforceable: checkout has no default to fall back on. Quick lines never
   * carry one; they have only one way of arriving.
   */
  deliveryMode: { type: String, enum: DELIVERY_MODES },

  /**
   * Optional customer note/instruction for the seller for this specific item.
   */
  additionalMessage: {
    type: String,
    default: "",
    trim: true,
    maxlength: 500,
  },
});

/**
 * One cart PER CHANNEL, not one per user.
 *
 * Quick and Shop All are fulfilled completely differently — a local rider in
 * 30 minutes versus a courier in 3-5 days, from different stock. They cannot
 * ship together, so they do not share a basket either. Switching the storefront
 * toggle switches the cart, the way JioMart and Blinkit behave.
 */
const cartSchema = new Schema(
  {
    userId:  { type: ObjectId, ref: "User", required: true },
    channel: { type: String, enum: CHANNELS, required: true, default: CHANNEL.ECOM },
    items:   [cartItemSchema],
  },
  { timestamps: true }
);

// A user has at most one cart in each channel.
cartSchema.index({ userId: 1, channel: 1 }, { unique: true });

const Cart = model("Cart", cartSchema);
export default Cart;
